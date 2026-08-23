import { sql } from "drizzle-orm";
import { createDb, initDb } from "../src/db";

// CI starts the runner's own Postgres, which needs a password; locally the
// peer-authenticated socket URL works. Either can be overridden explicitly.
const url =
  process.env.DATABASE_URL ??
  (process.env.CI
    ? "postgres://postgres:postgres@localhost:5432/craigsnotice_test"
    : "postgres://localhost/craigsnotice_test");

if (!url.includes("_test")) {
  throw new Error(`refusing to run tests against a non-test database: ${url}`);
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
