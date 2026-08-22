import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { searchResultRowSchema } from "@craigsnotice/types";
import { parseRows } from "../src/services/parse";
import { extractJsonObject } from "../src/services/port/sse";
import { db, resetDb } from "./setup";
import {
  createFixtureBrightData,
  createFixturePort,
  FIXTURE_SEARCH_COLLECTOR,
  FIXTURE_DETAIL_COLLECTOR,
} from "../src/services/fixtures";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { runWatchCycle } from "../src/services/scheduler";
import { listings, scraperConfigs, users, watches } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};

describe("fixtures mode", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("parses every real captured row without a schema violation", async () => {
    // The fixtures are a verbatim capture of a live Bright Data run, so this
    // pins the schema against the shape Scraper Studio actually returns.
    const rows = JSON.parse(
      readFileSync(
        new URL("../src/fixtures/search-results.json", import.meta.url).pathname,
        "utf8"
      )
    ) as unknown[];
    const parsed = parseRows(rows, searchResultRowSchema);

    expect(parsed.violations).toBe(0);
    expect(parsed.rows).toHaveLength(rows.length);
    expect(parsed.rows.every((r) => typeof r.postId === "string")).toBe(true);
  });

  it("serves search rows without any network call", async () => {
    const bd = createFixtureBrightData();
    const id = await bd.trigger(FIXTURE_SEARCH_COLLECTOR, [
      { url: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio" },
    ]);
    const snap = await bd.fetchSnapshot(id);

    expect(snap.status).toBe("ready");
    expect(snap.rows!.length).toBeGreaterThan(0);
  });

  it("serves detail rows for the detail collector", async () => {
    const bd = createFixtureBrightData();
    const id = await bd.trigger(FIXTURE_DETAIL_COLLECTOR, []);
    const snap = await bd.fetchSnapshot(id);

    const first = snap.rows![0] as Record<string, unknown>;
    expect(first.condition).toBeTruthy();
    expect(first.description).toBeTruthy();
  });

  it("returns a well-formed verdict from the fixture agent", async () => {
    const reply = await createFixturePort().invokeAgent(
      "deal-agent",
      "Judge this listing."
    );
    const verdict = extractJsonObject(reply) as Record<string, unknown>;

    expect(verdict).toHaveProperty("isGoodDeal");
    expect(verdict).toHaveProperty("reasoning");
    expect(typeof verdict.score).toBe("number");
  });

  it("runs a full watch cycle end to end offline", async () => {
    const [u] = await db
      .insert(users)
      .values({ firebaseUid: "u1", email: "a@b.c" })
      .returning();
    const [w] = await db
      .insert(watches)
      .values({
        userId: u!.id,
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "Mac Studio",
        targetPrice: "1500",
        searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
      })
      .returning();
    await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: FIXTURE_SEARCH_COLLECTOR });

    const bd = createFixtureBrightData();
    const dispatch = vi.fn(async () => {});

    const result = await runWatchCycle(
      {
        db,
        bd,
        port: createFixturePort(),
        delivery: createPollingDelivery(bd, { sleep: noSleep }),
        searchCollectorId: FIXTURE_SEARCH_COLLECTOR,
        detailCollectorId: FIXTURE_DETAIL_COLLECTOR,
        agentId: "deal-agent",
        minBaselineSamples: 5,
        violationRateThreshold: 0.3,
        dispatcher: { dispatch },
      },
      w!.id
    );

    expect(result.degraded).toBe(false);
    expect(result.scrapedCount).toBe(20);
    expect(result.judged).toBe(20);
    // The verdict list cycles, so some listings alert and some do not —
    // the demo shows both outcomes.
    expect(result.alerted).toBeGreaterThan(0);
    expect(result.alerted).toBeLessThan(20);
    expect(dispatch).toHaveBeenCalled();

    expect(await db.select().from(listings)).toHaveLength(20);
  });

  it("builds a real baseline on the second cycle", async () => {
    const [u] = await db
      .insert(users)
      .values({ firebaseUid: "u1", email: "a@b.c" })
      .returning();
    const [w] = await db
      .insert(watches)
      .values({
        userId: u!.id,
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "Mac Studio",
        searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
      })
      .returning();
    await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: FIXTURE_SEARCH_COLLECTOR });

    const bd = createFixtureBrightData();
    const port = createFixturePort();
    const invocations: unknown[] = [];
    const wrapped = {
      ...port,
      invokeAgent: async (id: string, prompt: string) => {
        invocations.push(prompt);
        return port.invokeAgent(id, prompt);
      },
    };

    await runWatchCycle(
      {
        db,
        bd,
        port: wrapped,
        delivery: createPollingDelivery(bd, { sleep: noSleep }),
        searchCollectorId: FIXTURE_SEARCH_COLLECTOR,
        detailCollectorId: FIXTURE_DETAIL_COLLECTOR,
        agentId: "deal-agent",
        minBaselineSamples: 5,
        violationRateThreshold: 0.3,
        dispatcher: { dispatch: async () => {} },
      },
      w!.id
    );

    // The 20 fixture listings all land before judgment, so even the first
    // listing judged already has a full baseline behind it.
    const last = invocations[invocations.length - 1] as string;
    expect(last).toContain('"count": 20');
    expect(last).toContain('"median": 2214.5');
  });
});
