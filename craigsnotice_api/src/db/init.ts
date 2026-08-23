import { sql } from "drizzle-orm";
import type { Db } from "./index";

/**
 * Idempotent, forward-only schema creation. Statements run in foreign-key
 * dependency order. Migrations are ALTER TABLE ... ADD COLUMN IF NOT EXISTS;
 * never drop.
 */
const STATEMENTS: string[] = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,

  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firebase_uid text NOT NULL UNIQUE,
    email text NOT NULL,
    fcm_tokens text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scraper_configs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL,
    bd_collector_id text NOT NULL,
    health text NOT NULL DEFAULT 'healthy',
    violation_rate numeric NOT NULL DEFAULT 0,
    last_healed_at timestamptz,
    heal_prompt text
  )`,

  `CREATE TABLE IF NOT EXISTS watches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    site_code text NOT NULL,
    subarea text,
    category_code text NOT NULL,
    query text NOT NULL,
    target_price numeric,
    interval_sec integer NOT NULL DEFAULT 300,
    status text NOT NULL DEFAULT 'active',
    search_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS scrape_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_id uuid REFERENCES watches(id),
    scraper_config_id uuid NOT NULL REFERENCES scraper_configs(id),
    snapshot_id text NOT NULL,
    status text NOT NULL DEFAULT 'collecting',
    row_count integer NOT NULL DEFAULT 0,
    violation_count integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error text
  )`,

  `CREATE TABLE IF NOT EXISTS listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    watch_id uuid NOT NULL REFERENCES watches(id),
    cl_post_id text NOT NULL,
    title text NOT NULL,
    price numeric,
    url text NOT NULL,
    posted_at timestamptz,
    location text,
    condition text,
    description text,
    image_count integer NOT NULL DEFAULT 0,
    detail_fetched_at timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS deal_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id uuid NOT NULL REFERENCES listings(id),
    watch_id uuid NOT NULL REFERENCES watches(id),
    score integer NOT NULL,
    is_good_deal boolean NOT NULL,
    reasoning text NOT NULL,
    price_vs_median numeric NOT NULL,
    notified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE IF NOT EXISTS alert_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id uuid NOT NULL REFERENCES deal_alerts(id),
    user_id uuid NOT NULL REFERENCES users(id),
    verdict text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS matches_query boolean`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS image_url text`,

  // Dedup is per watch, not global. The original UNIQUE(cl_post_id) meant a
  // post could belong to only one watch ever, so a second watch whose search
  // overlapped silently stored nothing.
  `ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_cl_post_id_key`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'listings_watch_post_key'
     ) THEN
       ALTER TABLE listings
         ADD CONSTRAINT listings_watch_post_key UNIQUE (watch_id, cl_post_id);
     END IF;
   END $$`,

  `CREATE INDEX IF NOT EXISTS listings_watch_idx ON listings(watch_id)`,
  `CREATE INDEX IF NOT EXISTS listings_first_seen_idx ON listings(first_seen_at)`,
  `CREATE INDEX IF NOT EXISTS deal_alerts_watch_idx ON deal_alerts(watch_id)`,
  `CREATE INDEX IF NOT EXISTS scrape_runs_watch_idx ON scrape_runs(watch_id)`,
];

export const initDb = async (db: Db): Promise<void> => {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
};

if (import.meta.main) {
  const { createDb } = await import("./index");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  await initDb(createDb(url));
  console.log(`schema initialised on ${url}`);
  process.exit(0);
}
