import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import {
  buildHealPrompt,
  handleDegraded,
  createFailureInjector,
} from "../src/services/selfheal";
import { scraperConfigs } from "../src/db/schema";

const seedConfig = async () => {
  const [sc] = await db
    .insert(scraperConfigs)
    .values({ kind: "search", bdCollectorId: "search-collector" })
    .returning();
  return sc!;
};

describe("buildHealPrompt", () => {
  it("names the failing fields from the sample violation", () => {
    const p = buildHealPrompt("search", "price: Required; post_id: Required");
    expect(p).toMatch(/price/);
    expect(p).toMatch(/post_id/);
    expect(p).toMatch(/craigslist/i);
  });

  it("falls back to a generic prompt when there is no sample", () => {
    expect(buildHealPrompt("search", null)).toMatch(/re-derive/i);
  });
});

describe("handleDegraded", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const deps = (
    bd: ReturnType<typeof createFakeBrightData>,
    port: ReturnType<typeof createFakePort>,
    emit = vi.fn()
  ) => ({ db, bd, port, emit });

  it("marks the config degraded, heals it, and restores health", async () => {
    const cfg = await seedConfig();
    const bd = createFakeBrightData();
    const port = createFakePort();

    const out = await handleDegraded(deps(bd, port), {
      scraperConfigId: cfg.id,
      violationRate: 0.75,
      sampleViolation: "post_id: Required",
    });

    expect(out.healed).toBe(true);
    expect(bd.healCalls).toHaveLength(1);
    expect(bd.healCalls[0]!.collectorId).toBe("search-collector");

    const [after] = await db
      .select()
      .from(scraperConfigs)
      .where(eq(scraperConfigs.id, cfg.id));
    expect(after!.health).toBe("healthy");
    expect(after!.lastHealedAt).not.toBeNull();
    expect(after!.healPrompt).toBe(out.prompt);
  });

  it("emits triggered then succeeded", async () => {
    const cfg = await seedConfig();
    const emit = vi.fn();

    await handleDegraded(deps(createFakeBrightData(), createFakePort(), emit), {
      scraperConfigId: cfg.id,
      violationRate: 0.75,
      sampleViolation: null,
    });

    expect(emit.mock.calls.map(([e]) => e)).toEqual([
      "scraper.selfheal.triggered",
      "scraper.selfheal.succeeded",
    ]);
    expect(emit.mock.calls[0]![1].violationRate).toBe(0.75);
  });

  it("patches the Port entity to degraded and back to healthy", async () => {
    const cfg = await seedConfig();
    const port = createFakePort();

    await handleDegraded(deps(createFakeBrightData(), port), {
      scraperConfigId: cfg.id,
      violationRate: 0.75,
      sampleViolation: null,
    });

    expect(port.patches.map((p) => p.properties.health)).toEqual([
      "degraded",
      "healthy",
    ]);
    expect(port.patches[0]!.blueprint).toBe("craigsnotice_scraper_config");
  });

  it("emits failed and leaves the config degraded when the heal throws", async () => {
    const cfg = await seedConfig();
    const bd = createFakeBrightData();
    bd.heal = async () => {
      throw new Error("heal API unavailable");
    };
    const emit = vi.fn();

    const out = await handleDegraded(deps(bd, createFakePort(), emit), {
      scraperConfigId: cfg.id,
      violationRate: 0.9,
      sampleViolation: null,
    });

    expect(out.healed).toBe(false);
    expect(out.error).toMatch(/heal API unavailable/);
    expect(emit.mock.calls.map(([e]) => e)).toEqual([
      "scraper.selfheal.triggered",
      "scraper.selfheal.failed",
    ]);

    const [after] = await db
      .select()
      .from(scraperConfigs)
      .where(eq(scraperConfigs.id, cfg.id));
    expect(after!.health).toBe("degraded");
  });
});

describe("createFailureInjector", () => {
  it("is disarmed by default", () => {
    expect(createFailureInjector().consume()).toBe(false);
  });

  it("fires exactly once after being armed", () => {
    const injector = createFailureInjector();
    injector.arm();
    expect(injector.consume()).toBe(true);
    expect(injector.consume()).toBe(false);
  });
});
