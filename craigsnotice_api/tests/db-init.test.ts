import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { initDb } from "../src/db";
import { users, watches } from "../src/db/schema";

describe("initDb", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("is idempotent when run twice", async () => {
    await expect(initDb(db)).resolves.not.toThrow();
  });

  it("creates every expected table", async () => {
    const rows = await db.execute(
      sql.raw(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
      )
    );
    const names = (rows as unknown as Array<{ table_name: string }>).map(
      (r) => r.table_name
    );
    for (const t of [
      "users",
      "watches",
      "scraper_configs",
      "scrape_runs",
      "listings",
      "deal_alerts",
      "alert_feedback",
    ]) {
      expect(names, `missing table ${t}`).toContain(t);
    }
  });

  it("applies watch column defaults", async () => {
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

    expect(w!.intervalSec).toBe(300);
    expect(w!.status).toBe("active");
  });
});
