import { sql } from "drizzle-orm";
import { createDb, initDb } from "../src/db";

const url =
  process.env.DATABASE_URL ?? "postgres://localhost/craigsnotice_test";

if (!url.includes("_test")) {
  throw new Error(
    `refusing to run tests against a non-test database: ${url}`
  );
}

export const db = createDb(url);

export const resetDb = async (): Promise<void> => {
  await initDb(db);
  await db.execute(
    sql.raw(
      "TRUNCATE alert_feedback, deal_alerts, listings, scrape_runs, watches, scraper_configs, users CASCADE"
    )
  );
};
