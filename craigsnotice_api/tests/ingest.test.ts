import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import { createFakePort } from "../src/services/port/fake";
import { createPollingDelivery } from "../src/services/brightdata/delivery";
import { ingestWatch } from "../src/services/ingest";
import {
  listings,
  scrapeRuns,
  users,
  watches,
  scraperConfigs,
} from "../src/db/schema";

const noSleep = async (): Promise<void> => {};

const searchRow = (id: string) => ({
  post_id: id,
  title: `Mac Studio ${id}`,
  price: "$1,200",
  url: `https://sfbay.craigslist.org/sfc/sya/d/x/${id}.html`,
});

const detailRow = (id: string) => ({
  ...searchRow(id),
  description: "Mint condition",
  condition: "like new",
  image_count: 4,
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
  const [sc] = await db
    .insert(scraperConfigs)
    .values({ kind: "search", bdCollectorId: "search-collector" })
    .returning();
  return { watch: w!, scraperConfigId: sc!.id };
};

const depsWith = (bd: ReturnType<typeof createFakeBrightData>) => ({
  db,
  bd,
  delivery: createPollingDelivery(bd, { sleep: noSleep }),
  searchCollectorId: "search-collector",
  detailCollectorId: "detail-collector",
});

describe("ingestWatch", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores new listings and returns their ids", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1"), searchRow("2")]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(result.scrapedCount).toBe(2);
    expect(result.newListingIds).toHaveLength(2);
    expect(result.violationRate).toBe(0);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, watch.id))
    ).toHaveLength(2);
  });

  it("records a scrape run and marks it ready", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);
    const [run] = await db
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.id, result.runId));

    expect(run!.status).toBe("ready");
    expect(run!.rowCount).toBe(1);
    expect(run!.finishedAt).not.toBeNull();
  });

  it("does not re-insert or re-report a post id seen on a previous run", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    await ingestWatch(depsWith(bd), watch, scraperConfigId);

    bd.queue("x", [searchRow("1"), searchRow("2")]);
    const second = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(second.newListingIds).toHaveLength(1);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, watch.id))
    ).toHaveLength(2);
  });

  it("enriches listings from the detail collector", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    const deps = depsWith(bd);
    bd.queue("x", [detailRow("1")]);

    await ingestWatch(deps, watch, scraperConfigId);

    const [row] = await db
      .select()
      .from(listings)
      .where(eq(listings.clPostId, "1"));
    expect(row!.condition).toBe("like new");
    expect(row!.imageCount).toBe(4);
    expect(row!.detailFetchedAt).not.toBeNull();
  });

  it("surfaces the violation rate without storing malformed rows", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1"), { title: "broken" }, { title: "broken" }]);

    const result = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(result.violationRate).toBeCloseTo(2 / 3);
    expect(result.sampleViolation).toMatch(/post_id/);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, watch.id))
    ).toHaveLength(1);
  });

  it("backfills the hero image only when the scraper did not return one", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    const fetchImage = vi.fn(async (_url: string) => "https://images.craigslist.org/og.jpg");

    await ingestWatch({ ...depsWith(bd), fetchImage }, watch, scraperConfigId);

    expect(fetchImage).toHaveBeenCalledOnce();
    const [row] = await db
      .select()
      .from(listings)
      .where(eq(listings.clPostId, "1"));
    expect(row!.imageUrl).toBe("https://images.craigslist.org/og.jpg");
  });

  it("prefers the scraper's image over the backfill", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [
      { ...searchRow("1"), image_url: "https://images.craigslist.org/scraped.jpg" },
    ]);
    const fetchImage = vi.fn(async (_url: string) => "https://images.craigslist.org/og.jpg");

    await ingestWatch({ ...depsWith(bd), fetchImage }, watch, scraperConfigId);

    expect(fetchImage).not.toHaveBeenCalled();
    const [row] = await db
      .select()
      .from(listings)
      .where(eq(listings.clPostId, "1"));
    expect(row!.imageUrl).toBe("https://images.craigslist.org/scraped.jpg");
  });

  it("mirrors the run and each new listing to Port when a client is supplied", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    const port = createFakePort();

    await ingestWatch({ ...depsWith(bd), port }, watch, scraperConfigId);

    const runs = port.upserts.filter(
      (u) => u.blueprint === "craigsnotice_scrape_run"
    );
    expect(runs.map((r) => r.properties.status)).toEqual([
      "collecting",
      "ready",
    ]);
    expect(runs[1]!.properties.rowCount).toBe(1);
    expect(runs[1]!.relations).toEqual({
      watch: watch.id,
      scraper: scraperConfigId,
    });

    const mirrored = port.upserts.filter(
      (u) => u.blueprint === "craigsnotice_listing"
    );
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.title).toBe("Mac Studio 1");
    expect(mirrored[0]!.relations.watch).toBe(watch.id);
  });

  it("keeps ingesting when the Port mirror throws", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")]);
    const port = createFakePort();
    port.upsertEntity = async () => {
      throw new Error("port is down");
    };

    const result = await ingestWatch(
      { ...depsWith(bd), port },
      watch,
      scraperConfigId
    );

    expect(result.newListingIds).toHaveLength(1);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, watch.id))
    ).toHaveLength(1);
  });

  it("marks the run failed and rethrows when delivery times out", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();
    bd.queue("x", [searchRow("1")], 1000);
    const deps = {
      ...depsWith(bd),
      delivery: createPollingDelivery(bd, { sleep: noSleep, timeoutMs: 10000 }),
    };

    await expect(ingestWatch(deps, watch, scraperConfigId)).rejects.toThrow();

    const runs = await db
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.watchId, watch.id));
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).not.toBeNull();
  });
});

describe("dedup is per watch, not global", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores the same Craigslist post for two different watches", async () => {
    // Regression: a global UNIQUE(cl_post_id) meant a post could belong to one
    // watch only. "Mac Studio" and "Mac mini" both live in the computers
    // category and their searches overlap, so the second watch silently
    // stored nothing and showed "no deals yet" forever.
    const [u] = await db
      .insert(users)
      .values({ firebaseUid: "u1", email: "a@b.c" })
      .returning();

    const mkWatch = async (query: string) => {
      const [w] = await db
        .insert(watches)
        .values({
          userId: u!.id,
          siteCode: "sfbay",
          categoryCode: "sya",
          query,
          searchUrl: `https://sfbay.craigslist.org/search/sya?query=${query}`,
        })
        .returning();
      return w!;
    };

    const [cfg] = await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "search-collector" })
      .returning();

    const studio = await mkWatch("Mac+Studio");
    const mini = await mkWatch("Mac+mini");

    const shared = searchRow("7952521094");

    const bd1 = createFakeBrightData();
    bd1.queue("x", [shared]);
    const first = await ingestWatch(depsWith(bd1), studio, cfg!.id);

    const bd2 = createFakeBrightData();
    bd2.queue("x", [shared]);
    const second = await ingestWatch(depsWith(bd2), mini, cfg!.id);

    expect(first.newListingIds).toHaveLength(1);
    expect(second.newListingIds).toHaveLength(1);

    expect(
      await db.select().from(listings).where(eq(listings.watchId, studio.id))
    ).toHaveLength(1);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, mini.id))
    ).toHaveLength(1);
  });

  it("still dedups within a single watch", async () => {
    const { watch, scraperConfigId } = await seed();
    const bd = createFakeBrightData();

    bd.queue("x", [searchRow("1")]);
    await ingestWatch(depsWith(bd), watch, scraperConfigId);

    bd.queue("x", [searchRow("1")]);
    const second = await ingestWatch(depsWith(bd), watch, scraperConfigId);

    expect(second.newListingIds).toHaveLength(0);
    expect(
      await db.select().from(listings).where(eq(listings.watchId, watch.id))
    ).toHaveLength(1);
  });
});
