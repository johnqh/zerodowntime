// api.port.io and api.getport.io both resolve; getport.io is the documented
// one. Override with PORT_API_BASE for a non-default region or a mock.
import { executionText } from "./sse";

const DEFAULT_BASE = "https://api.getport.io/v1";
const TOKEN_SKEW_MS = 60_000;

export interface Blueprint {
  identifier: string;
  title: string;
  icon?: string;
  schema: { properties: Record<string, unknown>; required?: string[] };
  relations?: Record<
    string,
    { target: string; required?: boolean; many?: boolean }
  >;
}

export interface PortClient {
  upsertEntity(
    blueprint: string,
    identifier: string,
    title: string,
    properties: Record<string, unknown>,
    relations?: Record<string, string>
  ): Promise<void>;
  patchEntity(
    blueprint: string,
    identifier: string,
    properties: Record<string, unknown>
  ): Promise<void>;
  /** Sends a prompt and returns the agent's full reply text. */
  invokeAgent(agentId: string, prompt: string): Promise<string>;
  upsertBlueprint(blueprint: Blueprint): Promise<void>;
}

export interface PortClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export const createPortClient = (opts: PortClientOptions): PortClient => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const BASE = opts.baseUrl ?? DEFAULT_BASE;

  let token: string | null = null;
  let expiresAt = 0;

  const getToken = async (): Promise<string> => {
    if (token && now() < expiresAt - TOKEN_SKEW_MS) return token;

    const res = await fetchImpl(`${BASE}/auth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`port auth failed: ${res.status}`);

    const body = (await res.json()) as {
      accessToken: string;
      expiresIn: number;
    };
    token = body.accessToken;
    expiresAt = now() + body.expiresIn * 1000;
    return token;
  };

  const request = async (
    path: string,
    method: string,
    body: unknown
  ): Promise<unknown> => {
    const bearer = await getToken();
    const res = await fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`port ${method} ${path} failed: ${res.status}`);
    }
    return res.json();
  };

  return {
    async upsertEntity(blueprint, identifier, title, properties, relations) {
      await request(
        `/blueprints/${blueprint}/entities?upsert=true&merge=true`,
        "POST",
        { identifier, title, properties, relations: relations ?? {} }
      );
    },

    async patchEntity(blueprint, identifier, properties) {
      await request(
        `/blueprints/${blueprint}/entities/${identifier}`,
        "PATCH",
        {
          properties,
        }
      );
    },

    async invokeAgent(agentId, prompt) {
      const bearer = await getToken();
      const res = await fetchImpl(`${BASE}/agent/${agentId}/invoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        throw new Error(`port agent invoke failed: ${res.status}`);
      }
      return executionText(await res.text());
    },

    async upsertBlueprint(blueprint) {
      try {
        await request("/blueprints", "POST", blueprint);
      } catch (err) {
        // Already exists — fall back to a full replace.
        if (!/failed: 409/.test((err as Error).message)) throw err;
        await request(`/blueprints/${blueprint.identifier}`, "PUT", blueprint);
      }
    },
  };
};
