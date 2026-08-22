import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { db, resetDb } from "./setup";
import { createHooksRouter } from "../src/routes/hooks";
import type { DegradedInfo } from "../src/services/selfheal";
import { scraperConfigs } from "../src/db/schema";

const post = (app: Hono, body: unknown) =>
  app.request("/signoz/heal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /hooks/signoz/heal", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const build = (
    onHeal = vi.fn(async (_info: DegradedInfo) => ({
      healed: true,
      prompt: "p",
      error: null as string | null,
    }))
  ) => {
    const app = new Hono();
    app.route("/", createHooksRouter(onHeal));
    return { app, onHeal };
  };

  it("heals the named scraper on a firing alert", async () => {
    const [cfg] = await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "c1", health: "degraded" })
      .returning();
    const { app, onHeal } = build();

    const res = await post(app, {
      alerts: [
        {
          status: "firing",
          labels: { scraper_config_id: cfg!.id, collector_id: "c1" },
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(onHeal).toHaveBeenCalledOnce();
    expect(onHeal.mock.calls[0]![0].scraperConfigId).toBe(cfg!.id);
  });

  it("ignores a resolved alert", async () => {
    const [cfg] = await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "c1" })
      .returning();
    const { app, onHeal } = build();

    const res = await post(app, {
      alerts: [
        {
          status: "resolved",
          labels: { scraper_config_id: cfg!.id, collector_id: "c1" },
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(onHeal).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not a SigNoz alert payload", async () => {
    const { app } = build();
    expect((await post(app, { hello: "world" })).status).toBe(400);
  });

  it("reports which scrapers were healed", async () => {
    const [cfg] = await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "c1", health: "degraded" })
      .returning();
    const { app } = build();

    const res = await post(app, {
      alerts: [
        {
          status: "firing",
          labels: { scraper_config_id: cfg!.id, collector_id: "c1" },
        },
      ],
    });

    expect((await res.json()).data.healed).toEqual([cfg!.id]);
  });
});
