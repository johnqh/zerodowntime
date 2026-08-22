import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDb } from "./setup";
import { createApp } from "../src/app";
import { createFakePort } from "../src/services/port/fake";
import type { TokenVerifier } from "../src/middleware/firebaseAuth";
import { dealAlerts, listings, users, watches } from "../src/db/schema";

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t === "user-a") return { uid: "uid-a", email: "a@x.dev" };
    if (t === "user-b") return { uid: "uid-b", email: "b@x.dev" };
    throw new Error("invalid");
  },
};

const seedAlert = async (email: string, uid: string) => {
  const [u] = await db
    .insert(users)
    .values({ firebaseUid: uid, email })
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
  const [l] = await db
    .insert(listings)
    .values({
      watchId: w!.id,
      clPostId: `p-${uid}`,
      title: "Mac Studio M2 Max",
      price: "1200",
      url: `https://sfbay.craigslist.org/x/${uid}.html`,
    })
    .returning();
  const [a] = await db
    .insert(dealAlerts)
    .values({
      listingId: l!.id,
      watchId: w!.id,
      score: 88,
      isGoodDeal: true,
      reasoning: "34% under median",
      priceVsMedian: "-0.34",
    })
    .returning();
  return { user: u!, alert: a! };
};

describe("alerts routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const app = () => createApp({ db, verifier, port: createFakePort() });
  const authed = (t: string) => ({
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
  });

  it("lists the caller's alerts with a null userFeedback before voting", async () => {
    await seedAlert("a@x.dev", "uid-a");

    const res = await app().request("/api/v1/alerts", {
      headers: authed("user-a"),
    });
    expect(res.status).toBe(200);

    const { data } = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Mac Studio M2 Max");
    expect(data[0].price).toBe(1200);
    expect(data[0].priceVsMedian).toBeCloseTo(-0.34);
    expect(data[0].userFeedback).toBeNull();
  });

  it("does not list another user's alerts", async () => {
    await seedAlert("a@x.dev", "uid-a");

    const res = await app().request("/api/v1/alerts", {
      headers: authed("user-b"),
    });
    const { data } = await res.json();
    expect(data).toHaveLength(0);
  });

  it("reflects feedback on the next listing", async () => {
    const { alert } = await seedAlert("a@x.dev", "uid-a");
    const a = app();

    const posted = await a.request(`/api/v1/alerts/${alert.id}/feedback`, {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify({ verdict: "bad" }),
    });
    expect(posted.status).toBe(200);

    const { data } = await (
      await a.request("/api/v1/alerts", { headers: authed("user-a") })
    ).json();
    expect(data[0].userFeedback).toBe("bad");
  });

  it("rejects an unauthenticated alert list", async () => {
    expect((await app().request("/api/v1/alerts")).status).toBe(401);
  });

  it("accepts a query token on the SSE stream", async () => {
    await seedAlert("a@x.dev", "uid-a");

    const res = await app().request("/api/v1/alerts/stream?token=user-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    await res.body?.cancel();
  });

  it("rejects the SSE stream with no token at all", async () => {
    expect((await app().request("/api/v1/alerts/stream")).status).toBe(401);
  });

  it("registers an FCM token without duplicating it", async () => {
    await seedAlert("a@x.dev", "uid-a");
    const a = app();

    for (let i = 0; i < 2; i += 1) {
      const res = await a.request("/api/v1/users/fcm-token", {
        method: "POST",
        headers: authed("user-a"),
        body: JSON.stringify({ fcmToken: "tok-xyz" }),
      });
      expect(res.status).toBe(200);
    }

    const [u] = await db.select().from(users);
    expect(u!.fcmTokens).toEqual(["tok-xyz"]);
  });
});
