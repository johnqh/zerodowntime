import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  buildCraigslistSearchUrl,
  type CreateWatchInput,
} from "@craigsnotice/types";
import type { Db } from "../db";
import {
  alertFeedback,
  dealAlerts,
  listings,
  scrapeRuns,
  watches,
} from "../db/schema";
import type { PortClient } from "./port/client";
import { mirrorWatch, safeMirror } from "./port/mirror";

export const createWatch = async (
  db: Db,
  userId: string,
  input: CreateWatchInput,
  port?: PortClient,
  ownerEmail = ""
) => {
  const searchUrl = buildCraigslistSearchUrl({
    siteCode: input.siteCode,
    subarea: input.subarea,
    categoryCode: input.categoryCode,
    query: input.query,
  });

  const [row] = await db
    .insert(watches)
    .values({
      userId,
      siteCode: input.siteCode,
      subarea: input.subarea ?? null,
      categoryCode: input.categoryCode,
      query: input.query,
      targetPrice:
        input.targetPrice === undefined ? null : String(input.targetPrice),
      intervalSec: input.intervalSec,
      searchUrl,
    })
    .returning();

  if (port) await safeMirror(() => mirrorWatch(port, row!, ownerEmail));

  return row!;
};

/**
 * Includes when the watch last ran, so the UI can show that it is genuinely
 * watching rather than waiting for someone to press a button.
 */
export const listWatches = async (db: Db, userId: string) => {
  const rows = await db
    .select({
      watch: watches,
      lastRunAt: sql<Date | null>`max(${scrapeRuns.startedAt})`,
      runCount: sql<number>`count(${scrapeRuns.id})::int`,
    })
    .from(watches)
    .leftJoin(scrapeRuns, eq(scrapeRuns.watchId, watches.id))
    .where(eq(watches.userId, userId))
    .groupBy(watches.id)
    .orderBy(desc(watches.createdAt));

  if (rows.length === 0) return [];

  // One image per alerted deal, newest first, for the stack on each row.
  const images = await db
    .select({
      watchId: dealAlerts.watchId,
      imageUrl: listings.imageUrl,
      createdAt: dealAlerts.createdAt,
    })
    .from(dealAlerts)
    .innerJoin(listings, eq(dealAlerts.listingId, listings.id))
    .where(
      and(
        inArray(
          dealAlerts.watchId,
          rows.map((r) => r.watch.id)
        ),
        isNotNull(listings.imageUrl)
      )
    )
    .orderBy(desc(dealAlerts.createdAt));

  const byWatch = new Map<string, string[]>();
  const dealCounts = new Map<string, number>();
  for (const img of images) {
    const list = byWatch.get(img.watchId) ?? [];
    if (list.length < 5 && img.imageUrl) list.push(img.imageUrl);
    byWatch.set(img.watchId, list);
    dealCounts.set(img.watchId, (dealCounts.get(img.watchId) ?? 0) + 1);
  }

  const allCounts = await db
    .select({
      watchId: dealAlerts.watchId,
      count: sql<number>`count(*)::int`,
    })
    .from(dealAlerts)
    .where(
      inArray(
        dealAlerts.watchId,
        rows.map((r) => r.watch.id)
      )
    )
    .groupBy(dealAlerts.watchId);
  const totals = new Map(allCounts.map((c) => [c.watchId, c.count]));

  return rows.map((r) => ({
    ...r.watch,
    lastRunAt: r.lastRunAt ? new Date(r.lastRunAt).toISOString() : null,
    runCount: r.runCount,
    dealCount: totals.get(r.watch.id) ?? 0,
    dealImages: byWatch.get(r.watch.id) ?? [],
  }));
};

export const getWatch = async (db: Db, userId: string, id: string) => {
  const rows = await db
    .select()
    .from(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)));
  return rows[0] ?? null;
};

/**
 * Foreign keys point at a watch from four directions, so the delete has to
 * unwind them in order or Postgres rejects it.
 */
export const deleteWatch = async (
  db: Db,
  userId: string,
  id: string
): Promise<boolean> => {
  const owned = await db
    .select({ id: watches.id })
    .from(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)));
  if (owned.length === 0) return false;

  const alertIds = (
    await db
      .select({ id: dealAlerts.id })
      .from(dealAlerts)
      .where(eq(dealAlerts.watchId, id))
  ).map((a) => a.id);

  if (alertIds.length > 0) {
    await db
      .delete(alertFeedback)
      .where(inArray(alertFeedback.alertId, alertIds));
  }
  await db.delete(dealAlerts).where(eq(dealAlerts.watchId, id));
  await db.delete(scrapeRuns).where(eq(scrapeRuns.watchId, id));
  await db.delete(listings).where(eq(listings.watchId, id));
  await db.delete(watches).where(eq(watches.id, id));

  return true;
};
