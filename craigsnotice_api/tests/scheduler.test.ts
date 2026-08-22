import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { runWatchCycle } from "../src/services/scheduler";
import type { DegradedInfo } from "../src/services/selfheal";
import { listings, scraperConfigs, users, watches } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};
const GOOD = {
  isGoodDeal: true,
  score: 90,
  reasoning: "cheap",
  priceVsMedian: -0.4,
};

const row = (id: string) => ({
  post_id: id,
  title: `Mac Studio ${id}`,
  price: "$1,200",
  url: `https://sfbay.craigslist.org/x/${id}.html`,
});

const seed = async () => {
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
    .values({ kind: "search", bdCollectorId: "search-collector" });
  return { user: u!, watch: w! };
};

const makeDeps = (
  bd: ReturnType<typeof createFakeBrightData>,
  port: ReturnType<typeof createFakePort>,
  extra: Record<string, unknown> = {}
) => ({
  db,
  bd,
  port,
  delivery: createPollingDelivery(bd, { sleep: noSleep }),
  searchCollectorId: "search-collector",
  detailCollectorId: "detail-collector",
  agentId: "deal-agent",
  minBaselineSamples: 5,
  violationRateThreshold: 0.3,
  dispatcher: { dispatch: vi.fn(async () => {}) },
  ...extra,
});

describe("runWatchCycle", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("scrapes, judges and dispatches an alert end to end", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith(GOOD);
    const deps = makeDeps(bd, port);

    const result = await runWatchCycle(deps, watch.id);

    expect(result.scrapedCount).toBe(1);
    expect(result.judged).toBe(1);
    expect(result.alerted).toBe(1);
    expect(deps.dispatcher.dispatch).toHaveBeenCalledOnce();

    const [, payload] = (deps.dispatcher.dispatch as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(payload.title).toBe("Mac Studio 1");
    expect(payload.price).toBe(1200);
    expect(payload.reasoning).toBe("cheap");
  });

  it("dispatches nothing when the agent rejects the listing", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith({
      isGoodDeal: false,
      score: 10,
      reasoning: "pricey",
      priceVsMedian: 0.3,
    });
    const deps = makeDeps(bd, port);

    const result = await runWatchCycle(deps, watch.id);

    expect(result.alerted).toBe(0);
    expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it("judges nothing on a second cycle that finds no new listings", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith(GOOD);
    const deps = makeDeps(bd, port);

    await runWatchCycle(deps, watch.id);
    bd.queue("x", [row("1")]);
    const second = await runWatchCycle(deps, watch.id);

    expect(second.judged).toBe(0);
    expect(await db.select().from(listings)).toHaveLength(1);
  });

  it("invokes the degraded callback and skips judgment when the violation rate is too high", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1"), { title: "broken" }, { title: "broken" }]);
    const port = createFakePort();
    const onDegraded = vi.fn(async (_info: DegradedInfo) => {});
    const deps = makeDeps(bd, port, { onDegraded });

    const result = await runWatchCycle(deps, watch.id);

    expect(result.degraded).toBe(true);
    expect(onDegraded).toHaveBeenCalledOnce();
    expect(onDegraded.mock.calls[0]![0].violationRate).toBeCloseTo(2 / 3);
    expect(result.judged).toBe(0);
  });

  it("still dispatches when the agent errors on one of two listings", async () => {
    const { watch } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith(new Error("port timeout"));
    const deps = makeDeps(bd, port);

    const result = await runWatchCycle(deps, watch.id);

    expect(result.judged).toBe(1);
    expect(result.alerted).toBe(0);
    expect(result.degraded).toBe(false);
    // the listing is still stored: the pipeline degrades to a data collector
    expect(await db.select().from(listings)).toHaveLength(1);
  });
});
