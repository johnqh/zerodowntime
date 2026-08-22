import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakePort } from "../src/services/port/fake";
import { judgeListing, recentFeedback } from "../src/services/judgment";
import {
  alertFeedback,
  dealAlerts,
  listings,
  users,
  watches,
} from "../src/db/schema";

const GOOD = {
  isGoodDeal: true,
  score: 88,
  reasoning: "34% under median",
  priceVsMedian: -0.34,
};
const BAD = {
  isGoodDeal: false,
  score: 21,
  reasoning: "above median",
  priceVsMedian: 0.2,
};

const seed = async (prices: Array<string | null> = []) => {
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

  for (const [i, p] of prices.entries()) {
    await db.insert(listings).values({
      watchId: w!.id,
      clPostId: `hist${i}`,
      title: `hist ${i}`,
      price: p,
      url: `https://sfbay.craigslist.org/x/hist${i}.html`,
    });
  }

  const [target] = await db
    .insert(listings)
    .values({
      watchId: w!.id,
      clPostId: "target",
      title: "Mac Studio M2 Max",
      price: "1200",
      url: "https://sfbay.craigslist.org/x/target.html",
      condition: "like new",
      imageCount: 3,
    })
    .returning();

  return { user: u!, watch: w!, listing: target! };
};

const deps = (port: ReturnType<typeof createFakePort>) => ({
  db,
  port,
  agentId: "deal-agent",
  minBaselineSamples: 5,
});

describe("judgeListing", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an alert when the agent says it is a good deal", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toEqual(GOOD);
    expect(out.alertId).not.toBeNull();
    const [alert] = await db
      .select()
      .from(dealAlerts)
      .where(eq(dealAlerts.id, out.alertId!));
    expect(alert!.score).toBe(88);
    expect(alert!.reasoning).toBe("34% under median");
  });

  it("creates no alert when the agent says it is not a good deal", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(BAD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.alertId).toBeNull();
    expect(await db.select().from(dealAlerts)).toHaveLength(0);
  });

  it("sends a null baseline on cold start and still returns a verdict", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    await judgeListing(deps(port), watch.id, listing.id);

    const payload = port.invocations[0]!.payload as {
      baseline: unknown;
      targetPrice: number | null;
    };
    expect(payload.baseline).toBeNull();
    expect(payload.targetPrice).toBe(1500);
  });

  it("sends a computed baseline once enough priced history exists", async () => {
    const { watch, listing } = await seed([
      "1000",
      "1400",
      "1600",
      "1800",
      "2000",
    ]);
    const port = createFakePort();
    port.respondWith(GOOD);

    await judgeListing(deps(port), watch.id, listing.id);

    const payload = port.invocations[0]!.payload as {
      baseline: { count: number; median: number };
    };
    expect(payload.baseline.count).toBe(6);
    expect(payload.baseline.median).toBeGreaterThan(0);
  });

  it("includes recent user feedback in the agent payload", async () => {
    const { user, watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    const first = await judgeListing(deps(port), watch.id, listing.id);
    await db
      .insert(alertFeedback)
      .values({ alertId: first.alertId!, userId: user.id, verdict: "bad" });

    const [second] = await db
      .insert(listings)
      .values({
        watchId: watch.id,
        clPostId: "second",
        title: "Another Mac Studio",
        price: "1250",
        url: "https://sfbay.craigslist.org/x/second.html",
      })
      .returning();

    await judgeListing(deps(port), watch.id, second!.id);

    const payload = port.invocations[1]!.payload as {
      recentFeedback: Array<{ verdict: string }>;
    };
    expect(payload.recentFeedback).toHaveLength(1);
    expect(payload.recentFeedback[0]!.verdict).toBe("bad");
  });

  it("degrades gracefully when the agent returns a malformed verdict", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith({ isGoodDeal: true, score: 500 });

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toBeNull();
    expect(out.alertId).toBeNull();
    expect(out.error).toMatch(/verdict/i);
    expect(
      await db.select().from(listings).where(eq(listings.id, listing.id))
    ).toHaveLength(1);
  });

  it("degrades gracefully when the agent throws", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(new Error("port timeout"));

    const out = await judgeListing(deps(port), watch.id, listing.id);

    expect(out.verdict).toBeNull();
    expect(out.error).toMatch(/port timeout/);
  });

  it("mirrors the alert to Port", async () => {
    const { watch, listing } = await seed();
    const port = createFakePort();
    port.respondWith(GOOD);

    const out = await judgeListing(deps(port), watch.id, listing.id);

    const upsert = port.upserts.find(
      (u) => u.blueprint === "craigsnotice_deal_alert"
    );
    expect(upsert!.identifier).toBe(out.alertId);
    expect(upsert!.properties.score).toBe(88);
    expect(upsert!.relations.watch).toBe(watch.id);
  });
});

describe("recentFeedback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns an empty array for a watch with no feedback", async () => {
    const { watch } = await seed();
    expect(await recentFeedback(db, watch.id)).toEqual([]);
  });
});
