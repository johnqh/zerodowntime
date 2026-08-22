import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakeBrightData } from "../src/services/brightdata/fake";
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
