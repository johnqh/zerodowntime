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
      "https://api.getport.io/v1/blueprints/craigsnotice_listing/entities?upsert=true&merge=true"
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
      "https://api.getport.io/v1/blueprints/craigsnotice_deal_alert/entities/a1"
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      properties: { userFeedback: "good" },
    });
  });

  it("sends a prompt and concatenates the streamed execution chunks", async () => {
    // Shaped exactly like a captured live response.
    const stream =
      "event: conversationIdentifier\ndata: c1\n\n" +
      "event: thinkingDone\ndata: {}\n\n" +
      'event: execution\ndata: ```json\\n{"isGoodD\n\n' +
      'event: execution\ndata: eal": false, "score": 40}\\n```\n\n' +
      "event: done\ndata: {}\n\n";

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(
        () =>
          new Response(stream, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          })
      );
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const out = await client.invokeAgent("deal-agent", "Judge this listing.");

    expect(out).toContain('"isGoodDeal": false');
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.getport.io/v1/agent/deal-agent/invoke"
    );
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({
      prompt: "Judge this listing.",
    });
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

  it("honours an overridden base URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementation(() => json({ ok: true }));
    const client = createPortClient({
      clientId: "id",
      clientSecret: "s",
      baseUrl: "https://api.port.io/v1",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.patchEntity("b", "e", {});

    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://api.port.io/v1/auth/access_token"
    );
    expect(fetchImpl.mock.calls[1]![0]).toBe(
      "https://api.port.io/v1/blueprints/b/entities/e"
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
