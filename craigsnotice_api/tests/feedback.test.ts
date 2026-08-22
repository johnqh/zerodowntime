import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFakePort } from "../src/services/port/fake";
import { recordFeedback } from "../src/services/feedback";
import {
  alertFeedback,
  dealAlerts,
  listings,
  users,
  watches,
} from "../src/db/schema";

const seed = async () => {
  const [owner] = await db
    .insert(users)
    .values({ firebaseUid: "u1", email: "a@b.c" })
    .returning();
  const [other] = await db
    .insert(users)
    .values({ firebaseUid: "u2", email: "z@b.c" })
    .returning();
  const [w] = await db
    .insert(watches)
    .values({
      userId: owner!.id,
      siteCode: "sfbay",
      categoryCode: "sya",
      query: "Mac Studio",
      searchUrl: "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    })
    .returning();
  const [l] = await db
    .insert(listings)
    .values({
      watchId: w!.id,
      clPostId: "1",
      title: "Mac Studio",
      price: "1200",
      url: "https://sfbay.craigslist.org/x/1.html",
    })
    .returning();
  const [a] = await db
    .insert(dealAlerts)
    .values({
      listingId: l!.id,
      watchId: w!.id,
      score: 88,
      isGoodDeal: true,
      reasoning: "under median",
      priceVsMedian: "-0.34",
    })
    .returning();

  return { owner: owner!, other: other!, alert: a! };
};

describe("recordFeedback", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("stores a verdict for the alert owner", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    const result = await recordFeedback(db, port, owner.id, alert.id, "good");

    expect(result).not.toBeNull();
    const rows = await db
      .select()
      .from(alertFeedback)
      .where(eq(alertFeedback.alertId, alert.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("good");
  });

  it("patches the Port entity so the loop is visible in the catalog", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    await recordFeedback(db, port, owner.id, alert.id, "bad");

    expect(port.patches[0]).toEqual({
      blueprint: "craigsnotice_deal_alert",
      identifier: alert.id,
      properties: { userFeedback: "bad" },
    });
  });

  it("replaces rather than duplicates when the user changes their mind", async () => {
    const { owner, alert } = await seed();
    const port = createFakePort();

    await recordFeedback(db, port, owner.id, alert.id, "good");
    await recordFeedback(db, port, owner.id, alert.id, "bad");

    const rows = await db
      .select()
      .from(alertFeedback)
      .where(eq(alertFeedback.alertId, alert.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("bad");
  });

  it("returns null for an alert belonging to someone else", async () => {
    const { other, alert } = await seed();
    const port = createFakePort();

    expect(
      await recordFeedback(db, port, other.id, alert.id, "good")
    ).toBeNull();
    expect(await db.select().from(alertFeedback)).toHaveLength(0);
  });
});
