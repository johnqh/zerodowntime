import { describe, it, expect, beforeEach } from "vitest";
import { db, resetDb } from "./setup";
import {
  alertFeedback,
  dealAlerts,
  listings,
  scrapeRuns,
  scraperConfigs,
  users,
  watches,
} from "../src/db/schema";
import { createApp } from "../src/app";
import type { TokenVerifier } from "../src/middleware/firebaseAuth";

const verifier: TokenVerifier = {
  verify: async (t) => {
    if (t === "user-a") return { uid: "uid-a", email: "a@x.dev" };
    if (t === "user-b") return { uid: "uid-b", email: "b@x.dev" };
    throw new Error("invalid");
  },
};

const app = () => createApp({ db, verifier });

const authed = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const body = {
  siteCode: "sfbay",
  categoryCode: "sya",
  query: "Mac Studio",
  targetPrice: 1200,
};

describe("watches routes", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a watch and derives the search URL", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);

    const { data } = await res.json();
    expect(data.searchUrl).toBe(
      "https://sfbay.craigslist.org/search/sya?query=Mac+Studio"
    );
    expect(data.intervalSec).toBe(300);
    expect(data.status).toBe("active");
  });

  it("rejects an unauthenticated create", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 with a useful message for an unknown site", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify({ ...body, siteCode: "atlantis" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown site/);
  });

  it("returns 400 for a body that fails schema validation", async () => {
    const res = await app().request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify({ ...body, query: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("lists only the calling user's watches", async () => {
    const a = app();
    await a.request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify(body),
    });
    await a.request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-b"),
      body: JSON.stringify(body),
    });

    const res = await a.request("/api/v1/watches", {
      headers: authed("user-a"),
    });
    const { data } = await res.json();
    expect(data).toHaveLength(1);
  });

  it("returns 404 when fetching another user's watch", async () => {
    const a = app();
    const created = await (
      await a.request("/api/v1/watches", {
        method: "POST",
        headers: authed("user-a"),
        body: JSON.stringify(body),
      })
    ).json();

    const res = await a.request(`/api/v1/watches/${created.data.id}`, {
      headers: authed("user-b"),
    });
    expect(res.status).toBe(404);
  });

  it("reports lastRunAt and runCount so the UI can show it is watching", async () => {
    const a = app();
    await a.request("/api/v1/watches", {
      method: "POST",
      headers: authed("user-a"),
      body: JSON.stringify(body),
    });

    const { data } = await (
      await a.request("/api/v1/watches", { headers: authed("user-a") })
    ).json();

    expect(data[0]).toHaveProperty("lastRunAt");
    expect(data[0].lastRunAt).toBeNull();
    expect(data[0].runCount).toBe(0);
  });

  it("deletes a watch that has runs, listings, alerts and feedback", async () => {
    const a = app();
    const created = await (
      await a.request("/api/v1/watches", {
        method: "POST",
        headers: authed("user-a"),
        body: JSON.stringify(body),
      })
    ).json();
    const watchId = created.data.id;

    // Everything that holds a foreign key to the watch.
    const [u] = await db.select().from(users);
    const [cfg] = await db
      .insert(scraperConfigs)
      .values({ kind: "search", bdCollectorId: "c1" })
      .returning();
    await db.insert(scrapeRuns).values({
      watchId,
      scraperConfigId: cfg!.id,
      snapshotId: "snap_1",
    });
    const [l] = await db
      .insert(listings)
      .values({
        watchId,
        clPostId: "p1",
        title: "Mac Studio",
        price: "1200",
        url: "https://sfbay.craigslist.org/x/1.html",
      })
      .returning();
    const [alert] = await db
      .insert(dealAlerts)
      .values({
        listingId: l!.id,
        watchId,
        score: 80,
        isGoodDeal: true,
        reasoning: "cheap",
        priceVsMedian: "-0.3",
      })
      .returning();
    await db
      .insert(alertFeedback)
      .values({ alertId: alert!.id, userId: u!.id, verdict: "good" });

    const res = await a.request(`/api/v1/watches/${watchId}`, {
      method: "DELETE",
      headers: authed("user-a"),
    });
    expect(res.status).toBe(200);

    expect(await db.select().from(watches)).toHaveLength(0);
    expect(await db.select().from(listings)).toHaveLength(0);
    expect(await db.select().from(dealAlerts)).toHaveLength(0);
    expect(await db.select().from(alertFeedback)).toHaveLength(0);
    expect(await db.select().from(scrapeRuns)).toHaveLength(0);
  });

  it("will not delete another user's watch", async () => {
    const a = app();
    const created = await (
      await a.request("/api/v1/watches", {
        method: "POST",
        headers: authed("user-a"),
        body: JSON.stringify(body),
      })
    ).json();

    const res = await a.request(`/api/v1/watches/${created.data.id}`, {
      method: "DELETE",
      headers: authed("user-b"),
    });
    expect(res.status).toBe(404);
    expect(await db.select().from(watches)).toHaveLength(1);
  });

  it("deletes a watch", async () => {
    const a = app();
    const created = await (
      await a.request("/api/v1/watches", {
        method: "POST",
        headers: authed("user-a"),
        body: JSON.stringify(body),
      })
    ).json();

    expect(
      (
        await a.request(`/api/v1/watches/${created.data.id}`, {
          method: "DELETE",
          headers: authed("user-a"),
        })
      ).status
    ).toBe(200);

    const list = await (
      await a.request("/api/v1/watches", { headers: authed("user-a") })
    ).json();
    expect(list.data).toHaveLength(0);
  });
});
