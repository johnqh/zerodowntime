import type { Blueprint, PortClient } from "./client";

export interface RecordedUpsert {
  blueprint: string;
  identifier: string;
  title: string;
  properties: Record<string, unknown>;
  relations: Record<string, string>;
}

export interface FakePort extends PortClient {
  readonly upserts: RecordedUpsert[];
  readonly patches: Array<{
    blueprint: string;
    identifier: string;
    properties: Record<string, unknown>;
  }>;
  readonly invocations: Array<{ agentId: string; prompt: string }>;
  readonly blueprints: Blueprint[];
  /**
   * Set what the next invokeAgent returns. An object is serialised the way a
   * real agent replies (fenced JSON); a string is returned verbatim; an Error
   * makes the call throw.
   */
  respondWith(value: unknown): void;
}

export const createFakePort = (): FakePort => {
  const upserts: RecordedUpsert[] = [];
  const patches: FakePort["patches"] = [];
  const invocations: FakePort["invocations"] = [];
  const blueprints: Blueprint[] = [];

  let next: unknown = {
    isGoodDeal: false,
    score: 0,
    reasoning: "default fake verdict",
    priceVsMedian: 0,
  };

  return {
    upserts,
    patches,
    invocations,
    blueprints,

    respondWith(value) {
      next = value;
    },

    async upsertEntity(blueprint, identifier, title, properties, relations) {
      upserts.push({
        blueprint,
        identifier,
        title,
        properties,
        relations: relations ?? {},
      });
    },

    async patchEntity(blueprint, identifier, properties) {
      patches.push({ blueprint, identifier, properties });
    },

    async invokeAgent(agentId, prompt) {
      invocations.push({ agentId, prompt });
      if (next instanceof Error) throw next;
      if (typeof next === "string") return next;
      return "```json\n" + JSON.stringify(next) + "\n```";
    },

    async upsertBlueprint(blueprint) {
      blueprints.push(blueprint);
    },
  };
};
