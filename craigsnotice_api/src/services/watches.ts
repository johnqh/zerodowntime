import { and, desc, eq } from "drizzle-orm";
import {
  buildCraigslistSearchUrl,
  type CreateWatchInput,
} from "@craigsnotice/types";
import type { Db } from "../db";
import { watches } from "../db/schema";

export const createWatch = async (
  db: Db,
  userId: string,
  input: CreateWatchInput
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

  return row!;
};

export const listWatches = (db: Db, userId: string) =>
  db
    .select()
    .from(watches)
    .where(eq(watches.userId, userId))
    .orderBy(desc(watches.createdAt));

export const getWatch = async (db: Db, userId: string, id: string) => {
  const rows = await db
    .select()
    .from(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)));
  return rows[0] ?? null;
};

export const deleteWatch = async (
  db: Db,
  userId: string,
  id: string
): Promise<boolean> => {
  const rows = await db
    .delete(watches)
    .where(and(eq(watches.id, id), eq(watches.userId, userId)))
    .returning();
  return rows.length > 0;
};
