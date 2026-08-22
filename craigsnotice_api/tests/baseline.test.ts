import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDb } from "./setup";
import {
  computeBaseline,
  percentile,
  watchBaseline,
} from "../src/services/baseline";
import { listings, users, watches } from "../src/db/schema";

describe("percentile", () => {
  it("returns the exact element when the index lands on one", () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
  });
  it("interpolates between neighbours", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(25);
  });
  it("returns the only element for a single-item list", () => {
    expect(percentile([42], 0.25)).toBe(42);
  });
});

describe("computeBaseline", () => {
  it("returns null below the minimum sample count", () => {
    expect(computeBaseline([100, 200, 300, 400], 5)).toBeNull();
  });

  it("computes median, p25, min and max at exactly the minimum", () => {
    const b = computeBaseline([500, 100, 300, 200, 400], 5);
    expect(b).not.toBeNull();
    expect(b!.count).toBe(5);
    expect(b!.median).toBe(300);
    expect(b!.p25).toBe(200);
    expect(b!.min).toBe(100);
    expect(b!.max).toBe(500);
  });

  it("returns null for an empty list", () => {
    expect(computeBaseline([], 5)).toBeNull();
  });
});

describe("watchBaseline", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const seedWatch = async () => {
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
    return w!;
  };

  const addListing = (
    watchId: string,
    postId: string,
    price: string | null,
    firstSeenAt: Date
  ) =>
    db.insert(listings).values({
      watchId,
      clPostId: postId,
      title: `t${postId}`,
      price,
      firstSeenAt,
      url: `https://sfbay.craigslist.org/x/${postId}.html`,
    });

  it("returns null for a brand-new watch (cold start)", async () => {
    const w = await seedWatch();
    expect(await watchBaseline(db, w.id, 5)).toBeNull();
  });

  it("ignores listings with no price", async () => {
    const w = await seedWatch();
    const now = new Date();
    for (const [i, p] of ["100", "200", "300", "400", null].entries()) {
      await addListing(w.id, `p${i}`, p, now);
    }
    expect(await watchBaseline(db, w.id, 5)).toBeNull();
  });

  it("ignores listings older than 30 days", async () => {
    const w = await seedWatch();
    const now = new Date("2026-08-22T12:00:00Z");
    const old = new Date("2026-06-01T12:00:00Z");
    for (const [i, p] of ["100", "200", "300", "400", "500"].entries()) {
      await addListing(w.id, `fresh${i}`, p, now);
    }
    await addListing(w.id, "stale", "99999", old);

    const b = await watchBaseline(db, w.id, 5, now);
    expect(b!.count).toBe(5);
    expect(b!.max).toBe(500);
  });
});
