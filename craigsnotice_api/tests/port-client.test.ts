import { describe, it, expect, vi } from "vitest";
import { createPortClient } from "../src/services/port/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const tokenResponse = () => json({ accessToken: "tok-1", expiresIn: 3600 });

describe("createPortClient", () => {
  it("fetches an access token before the first call and reuses it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json({ ok: true }));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.upsertEntity("craigsnotice_watch", "w1", "Mac Studio", {
      query: "Mac Studio",
    });
    await client.upsertEntity("craigsnotice_watch", "w2", "Herman Miller", {
      query: "Herman Miller",
    });

    const tokenCalls = fetchImpl.mock.calls.filter(([u]) =>
      String(u).includes("/auth/access_token")
    );
    expect(tokenCalls).toHaveLength(1);
    expect(JSON.parse(tokenCalls[0]![1].body)).toEqual({
      clientId: "id",
      clientSecret: "secret",
    });
  });

  it("upserts an entity with identifier, title, properties and relations", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json({ ok: true }));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.upsertEntity(
      "craigsnotice_listing",
      "l1",
      "Mac Studio M2",
      { price: 1200 },
      { watch: "w1" }
    );

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(
      "https://api.port.io/v1/blueprints/craigsnotice_listing/entities?upsert=true&merge=true"
    );
    expect(init.headers.Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(init.body)).toEqual({
      identifier: "l1",
      title: "Mac Studio M2",
      properties: { price: 1200 },
      relations: { watch: "w1" },
    });
  });

  it("patches only the given properties", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json({ ok: true }));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.patchEntity("craigsnotice_deal_alert", "a1", {
      userFeedback: "good",
    });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(
      "https://api.port.io/v1/blueprints/craigsnotice_deal_alert/entities/a1"
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      properties: { userFeedback: "good" },
    });
  });

  it("invokes an agent and returns the parsed body", async () => {
    const verdict = {
      isGoodDeal: true,
      score: 88,
      reasoning: "well under median",
      priceVsMedian: -0.34,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json(verdict, 202));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const out = await client.invokeAgent("deal-agent", {
      listing: { title: "x" },
    });

    expect(out).toEqual(verdict);
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.port.io/v1/agent/deal-agent/invoke"
    );
  });

  it("re-fetches the token once it has expired", async () => {
    let clock = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: "tok-1", expiresIn: 100 }))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ accessToken: "tok-2", expiresIn: 100 }))
      .mockResolvedValueOnce(json({ ok: true }));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
    });

    await client.patchEntity("b", "e", {});
    clock = 200_000;
    await client.patchEntity("b", "e", {});

    expect(
      fetchImpl.mock.calls.filter(([u]) => String(u).includes("access_token"))
    ).toHaveLength(2);
    expect(fetchImpl.mock.calls[3]![1].headers.Authorization).toBe(
      "Bearer tok-2"
    );
  });

  it("throws on a failed request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json({ error: "bad" }, 500));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.patchEntity("b", "e", {})).rejects.toThrow(/500/);
  });
});
