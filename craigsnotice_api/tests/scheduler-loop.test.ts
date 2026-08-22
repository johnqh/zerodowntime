import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { createScheduler, type CycleDeps } from "../src/services/scheduler";
import { scrapeRuns, scraperConfigs, users, watches } from "../src/db/schema";

const noSleep = async (): Promise<void> => {};

const row = (id: string) => ({
  post_id: id,
  title: `Mac Studio ${id}`,
  price: "$1,200",
  url: `https://sfbay.craigslist.org/x/${id}.html`,
});

const seedWatch = async (intervalSec: number, status = "active") => {
  const [u] = await db
    .insert(users)
    .values({ firebaseUid: `u-${intervalSec}-${status}`, email: "a@b.c" })
    .returning();
  const [w] = await db
    .insert(watches)
    .values({
      userId: u!.id,
      siteCode: "sfbay",
      categoryCode: "sya",
      query: "Mac Studio",
      intervalSec,
      status,
      searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    })
    .returning();
  return w!;
};

const makeDeps = (bd: ReturnType<typeof createFakeBrightData>): CycleDeps => ({
  db,
  bd,
  port: createFakePort(),
  delivery: createPollingDelivery(bd, { sleep: noSleep }),
  searchCollectorId: "search-collector",
  detailCollectorId: "detail-collector",
  agentId: "deal-agent",
  minBaselineSamples: 5,
  violationRateThreshold: 0.3,
  dispatcher: { dispatch: async () => {} },
});

/**
 * A tick fires synchronously but its cycle finishes on real time, so advancing
 * the fake clock is not enough — yield to the real event loop before asserting.
 * setTimeout is deliberately not faked, so this really waits.
 */
const settle = async (ms = 60): Promise<void> => {
  await new Promise((r) => globalThis.setTimeout(r, ms));
};

const runsFor = async (watchId: string): Promise<number> =>
  (await db.select().from(scrapeRuns).where(eq(scrapeRuns.watchId, watchId)))
    .length;

describe("createScheduler", () => {
  beforeEach(async () => {
    await resetDb();
    await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "search-collector" });
    // Fake only the scheduler's own clock. Faking setTimeout too would stall
    // the postgres driver's internal timers and every query would hang.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not run anything before start()", async () => {
    const watch = await seedWatch(60);
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    createScheduler(makeDeps(bd), db, { tickMs: 1000 });

    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(await runsFor(watch.id)).toBe(0);
  });

  it("runs a due watch on the first tick", async () => {
    const watch = await seedWatch(60);
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 1000 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    scheduler.stop();

    expect(await runsFor(watch.id)).toBe(1);
  });

  it("does not re-run a watch before its interval has elapsed", async () => {
    const watch = await seedWatch(60);
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 1000 });

    scheduler.start();
    // ten ticks, but the watch's interval is 60s
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    scheduler.stop();

    expect(await runsFor(watch.id)).toBe(1);
  });

  it("runs again once the interval has elapsed", async () => {
    const watch = await seedWatch(60);
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 1000 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    await vi.advanceTimersByTimeAsync(61_000);
    await settle();
    scheduler.stop();

    expect(await runsFor(watch.id)).toBe(2);
  });

  it("never runs two cycles for the same watch concurrently", async () => {
    const watch = await seedWatch(1);
    const bd = createFakeBrightData();
    // 5 polls of latency, so a cycle spans several ticks
    bd.queue("x", [row("1")], 5);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 100 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    // Many ticks fired while one cycle was still in flight.
    expect(await runsFor(watch.id)).toBe(1);
  });

  it("skips paused watches", async () => {
    const paused = await seedWatch(60, "paused");
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 1000 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    scheduler.stop();

    expect(await runsFor(paused.id)).toBe(0);
  });

  it("stops ticking after stop()", async () => {
    const watch = await seedWatch(1);
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 500 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    const after = await runsFor(watch.id);
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(20_000);
    await settle();
    expect(await runsFor(watch.id)).toBe(after);
  });

  it("survives a failing cycle and keeps scheduling", async () => {
    const watch = await seedWatch(1);
    const bd = createFakeBrightData();
    bd.trigger = async () => {
      throw new Error("bright data is down");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scheduler = createScheduler(makeDeps(bd), db, { tickMs: 500 });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    scheduler.stop();

    // It logged rather than throwing, and kept ticking.
    expect(warn).toHaveBeenCalled();
    expect(
      warn.mock.calls.some(([m]) => String(m).includes("bright data is down"))
    ).toBe(true);
    warn.mockRestore();
  });
});
