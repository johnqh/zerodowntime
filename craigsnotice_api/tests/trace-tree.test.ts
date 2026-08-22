import { describe, it, expect, beforeEach } from "vitest";
import { trace, context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { runWatchCycle } from "../src/services/scheduler";
import { scraperConfigs, users, watches } from "../src/db/schema";

const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
);
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

const noSleep = async (): Promise<void> => {};

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
  return w!;
};

describe("watch cycle trace tree", () => {
  beforeEach(async () => {
    await resetDb();
    exporter.reset();
  });

  it("emits the full span tree with watch.tick as the single root", async () => {
    const watch = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")]);
    const port = createFakePort();
    port.respondWith({
      isGoodDeal: true,
      score: 90,
      reasoning: "cheap",
      priceVsMedian: -0.4,
    });

    await runWatchCycle(
      {
        db,
        bd,
        port,
        delivery: createPollingDelivery(bd, { sleep: noSleep }),
        searchCollectorId: "search-collector",
        detailCollectorId: "detail-collector",
        agentId: "deal-agent",
        minBaselineSamples: 5,
        violationRateThreshold: 0.3,
        dispatcher: {
          dispatch: async () => {},
        },
      },
      watch.id
    );

    const spans = exporter.getFinishedSpans();
    const names = spans.map((s) => s.name);

    for (const expected of [
      "watch.tick",
      "scrape.trigger",
      "scrape.poll",
      "scrape.parse",
      "listing.detail.fetch",
      "baseline.compute",
      "agent.invoke",
    ]) {
      expect(names, `missing span ${expected}`).toContain(expected);
    }

    const root = spans.find((s) => s.name === "watch.tick")!;
    expect(root.parentSpanContext).toBeUndefined();

    // Every other span descends from the tick, so one alert is traceable
    // back to the scrape that produced it.
    for (const span of spans.filter((s) => s.name !== "watch.tick")) {
      expect(
        span.parentSpanContext,
        `${span.name} has no parent`
      ).toBeDefined();
      expect(span.spanContext().traceId).toBe(root.spanContext().traceId);
    }
  });

  it("carries watch.id on every span and the violation rate on the parse", async () => {
    const watch = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1"), { title: "broken" }]);
    const port = createFakePort();

    await runWatchCycle(
      {
        db,
        bd,
        port,
        delivery: createPollingDelivery(bd, { sleep: noSleep }),
        searchCollectorId: "search-collector",
        detailCollectorId: "detail-collector",
        agentId: "deal-agent",
        minBaselineSamples: 5,
        violationRateThreshold: 0.9,
        dispatcher: { dispatch: async () => {} },
      },
      watch.id
    );

    const spans = exporter.getFinishedSpans();
    const parse = spans.find((s) => s.name === "scrape.parse")!;
    expect(parse.attributes["scrape.violation_rate"]).toBeCloseTo(0.5);
    expect(parse.attributes["scrape.row_count"]).toBe(2);

    for (const s of spans.filter((s) => s.name.startsWith("scrape."))) {
      expect(s.attributes["watch.id"], `${s.name} missing watch.id`).toBe(
        watch.id
      );
    }
  });

  it("marks the tick errored when the pipeline throws", async () => {
    const watch = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [row("1")], 1000);
    const port = createFakePort();

    await expect(
      runWatchCycle(
        {
          db,
          bd,
          port,
          delivery: createPollingDelivery(bd, {
            sleep: noSleep,
            timeoutMs: 10000,
          }),
          searchCollectorId: "search-collector",
          detailCollectorId: "detail-collector",
          agentId: "deal-agent",
          minBaselineSamples: 5,
          violationRateThreshold: 0.3,
          dispatcher: { dispatch: async () => {} },
        },
        watch.id
      )
    ).rejects.toThrow();

    const tick = exporter
      .getFinishedSpans()
      .find((s) => s.name === "watch.tick")!;
    expect(tick.status.code).toBe(2); // ERROR
    expect(tick.events.some((e) => e.name === "exception")).toBe(true);
  });
});
