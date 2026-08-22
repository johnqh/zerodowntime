import { describe, it, expect, vi } from "vitest";
import {
  createBrightDataClient,
  type HealRunner,
} from "../src/services/brightdata/client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createBrightDataClient", () => {
  it("triggers a collection and returns the snapshot id", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ collection_id: "j_abc123" }));
    const client = createBrightDataClient(
      "tok",
      fetchImpl as unknown as typeof fetch
    );

    const id = await client.trigger("c1", [
      { url: "https://sfbay.craigslist.org/search/sya?query=x" },
    ]);

    expect(id).toBe("j_abc123");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(
      "https://api.brightdata.com/dca/trigger?collector=c1&queue_next=1"
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual([
      { url: "https://sfbay.craigslist.org/search/sya?query=x" },
    ]);
  });

  it("throws on a non-2xx trigger response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "nope" }, 401));
    const client = createBrightDataClient(
      "bad",
      fetchImpl as unknown as typeof fetch
    );
    await expect(
      client.trigger("c1", [{ url: "https://a.b/c" }])
    ).rejects.toThrow(/401/);
  });

  it("reports a building snapshot as not ready", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "building" }));
    const snap = await createBrightDataClient(
      "tok",
      fetchImpl as unknown as typeof fetch
    ).fetchSnapshot("j_1");

    expect(snap.status).toBe("building");
    expect(snap.rows).toBeNull();
  });

  it("heals through the injected runner, not over REST", async () => {
    // There is no REST heal endpoint — POST /dca/collector/:id/heal 404s.
    // The real mechanism is `bdata scraper heal <id> <prompt>`.
    const fetchImpl = vi.fn();
    const runner = vi.fn<HealRunner>(async () => ({
      exitCode: 0,
      output: "healed",
    }));
    const client = createBrightDataClient(
      "tok",
      fetchImpl as unknown as typeof fetch,
      runner
    );

    await client.heal("c_abc", "Re-derive the price selector.");

    expect(runner).toHaveBeenCalledWith("c_abc", "Re-derive the price selector.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws with the CLI output when the heal exits non-zero", async () => {
    const runner = vi.fn<HealRunner>(async () => ({
      exitCode: 1,
      output: "collector not found",
    }));
    const client = createBrightDataClient(
      "tok",
      vi.fn() as unknown as typeof fetch,
      runner
    );

    await expect(client.heal("c_abc", "fix it")).rejects.toThrow(
      /exit 1.*collector not found/s
    );
  });

  it("reports an array snapshot as ready with its rows", async () => {
    const rows = [{ post_id: "1" }, { post_id: "2" }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(rows));
    const snap = await createBrightDataClient(
      "tok",
      fetchImpl as unknown as typeof fetch
    ).fetchSnapshot("j_1");

    expect(snap.status).toBe("ready");
    expect(snap.rows).toEqual(rows);
  });
});
