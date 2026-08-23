import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: text("firebase_uid").notNull().unique(),
  email: text("email").notNull(),
  fcmTokens: text("fcm_tokens").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watches = pgTable("watches", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  siteCode: text("site_code").notNull(),
  subarea: text("subarea"),
  categoryCode: text("category_code").notNull(),
  query: text("query").notNull(),
  targetPrice: numeric("target_price"),
  intervalSec: integer("interval_sec").notNull().default(300),
  status: text("status").notNull().default("active"),
  searchUrl: text("search_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const scraperConfigs = pgTable("scraper_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  bdCollectorId: text("bd_collector_id").notNull(),
  health: text("health").notNull().default("healthy"),
  violationRate: numeric("violation_rate").notNull().default("0"),
  lastHealedAt: timestamp("last_healed_at", { withTimezone: true }),
  healPrompt: text("heal_prompt"),
});

export const scrapeRuns = pgTable("scrape_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  watchId: uuid("watch_id").references(() => watches.id),
  scraperConfigId: uuid("scraper_config_id")
    .notNull()
    .references(() => scraperConfigs.id),
  snapshotId: text("snapshot_id").notNull(),
  status: text("status").notNull().default("collecting"),
  rowCount: integer("row_count").notNull().default(0),
  violationCount: integer("violation_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});

export const listings = pgTable("listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  watchId: uuid("watch_id")
    .notNull()
    .references(() => watches.id),
  clPostId: text("cl_post_id").notNull(),
  title: text("title").notNull(),
  price: numeric("price"),
  url: text("url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  location: text("location"),
  condition: text("condition"),
  description: text("description"),
  imageCount: integer("image_count").notNull().default(0),
  imageUrl: text("image_url"),
  detailFetchedAt: timestamp("detail_fetched_at", { withTimezone: true }),
  /** Null until judged. False = the search returned something the buyer did
   *  not ask for, so it must not alert and must not skew the baseline. */
  matchesQuery: boolean("matches_query"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => ({
  // Dedup is PER WATCH. A global unique on cl_post_id meant a Craigslist post
  // could belong to only one watch ever: two watches whose searches overlap —
  // "Mac Studio" and "Mac mini" both live in the computers category — and the
  // second silently stored nothing.
  watchPost: unique("listings_watch_post_key").on(t.watchId, t.clPostId),
}));

export const dealAlerts = pgTable("deal_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  listingId: uuid("listing_id")
    .notNull()
    .references(() => listings.id),
  watchId: uuid("watch_id")
    .notNull()
    .references(() => watches.id),
  score: integer("score").notNull(),
  isGoodDeal: boolean("is_good_deal").notNull(),
  reasoning: text("reasoning").notNull(),
  priceVsMedian: numeric("price_vs_median").notNull(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const alertFeedback = pgTable("alert_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertId: uuid("alert_id")
    .notNull()
    .references(() => dealAlerts.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  verdict: text("verdict").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
