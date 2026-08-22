import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  createWebhookStore,
  createWebhookDelivery,
  SnapshotTimeoutError,
} from "../src/services/brightdata/delivery";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createHooksRouter } from "../src/routes/hooks";
import { ingestWatch } from "../src/services/ingest";

const SECRET = "hook-secret";

describe("createWebhookStore", () => {
  it("resolves a waiter when Bright Data reports the rows", async () => {
    const store = createWebhookStore();
    const pending = store.waitFor("snap_1", 5000);
    expect(store.pending()).toBe(1);

    expect(store.resolve("snap_1", [{ post_id: "1" }])).toBe(true);
    await expect(pending).resolves.toEqual([{ post_id: "1" }]);
    expect(store.pending()).toBe(0);
  });

  it("reports false for an id nobody is waiting on", () => {
    expect(createWebhookStore().resolve("unknown", [])).toBe(false);
  });

  it("rejects the waiter when Bright Data reports a failure", async () => {
    const store = createWebhookStore();
    const pending = store.waitFor("snap_1", 5000);

    expect(store.fail("snap_1", "blocked")).toBe(true);
    await expect(pending).rejects.toThrow(/blocked/);
  });

  it("times out rather than waiting forever on a webhook that never lands", async () => {
    const store = createWebhookStore();
    await expect(store.waitFor("snap_1", 20)).rejects.toThrow(
      SnapshotTimeoutError
    );
  });
});

describe("POST /hooks/brightdata", () => {
  const build = (store = createWebhookStore(), rows: unknown[] = [{ post_id: "1" }]) => {
    const app = new Hono();
    app.route(
      "/",
      createHooksRouter(
        vi.fn(async () => ({ healed: true, prompt: "p", error: null })),
        SECRET,
        { store, fetchRows: async () => rows }
      )
    );
    return { app, store };
  };

  const post = (app: Hono, body: unknown) =>
    app.request("/brightdata", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signoz-token": SECRET },
      body: JSON.stringify(body),
    });

  it("hands the delivered rows to the waiting cycle", async () => {
    const { app, store } = build();
    const pending = store.waitFor("j_abc", 5000);

    const res = await post(app, { collection_id: "j_abc", status: "ready" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ accepted: true, rows: 1 });

    await expect(pending).resolves.toEqual([{ post_id: "1" }]);
  });

  it("accepts snapshot_id as well as collection_id", async () => {
    const { app, store } = build();
    const pending = store.waitFor("s_1", 5000);

    await post(app, { snapshot_id: "s_1" });
    await expect(pending).resolves.toHaveLength(1);
  });

  it("fails the waiter when Bright Data reports an error", async () => {
    const { app, store } = build();
    const pending = store.waitFor("j_err", 5000);

    await post(app, { collection_id: "j_err", error: "zone blocked" });
    await expect(pending).rejects.toThrow(/zone blocked/);
  });

  it("reports accepted=false for an id nobody awaits, without erroring", async () => {
    const { app } = build();
    const res = await post(app, { collection_id: "stale" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.accepted).toBe(false);
  });

  it("rejects a payload with no collection id", async () => {
    const { app } = build();
    expect((await post(app, { status: "ready" })).status).toBe(400);
  });

  it("still requires the shared secret", async () => {
    const { app } = build();
    const res = await app.request("/brightdata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: "j_abc" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("ingest with webhook delivery", () => {
  it("tells Bright Data where to deliver instead of polling", async () => {
    const bd = createFakeBrightData();
    const store = createWebhookStore();
    const delivery = createWebhookDelivery(store, 5000);

    const watch = { id: "w1", searchUrl: "https://sfbay.craigslist.org/search/sya?query=x" };

    // Bright Data "calls back" as soon as the trigger has happened.
    queueMicrotask(() => {
      setTimeout(() => store.resolve("snap_1", []), 5);
    });

    await expect(
      ingestWatch(
        {
          db: null as never,
          bd,
          delivery,
          searchCollectorId: "search",
          detailCollectorId: "detail",
          deliverTo: "https://tunnel.example/api/v1/hooks/brightdata",
        },
        watch,
        "cfg"
      )
    ).rejects.toBeDefined(); // no db in this unit test; we only assert the trigger

    expect(bd.lastDeliveryEndpoint()).toBe(
      "https://tunnel.example/api/v1/hooks/brightdata"
    );
  });
});
