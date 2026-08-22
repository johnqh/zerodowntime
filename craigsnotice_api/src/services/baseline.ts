import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { Baseline } from "@craigsnotice/types";
import type { Db } from "../db";
import { listings } from "../db/schema";

const WINDOW_DAYS = 30;

/** Linear-interpolated percentile over an ascending-sorted array. */
export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) throw new Error("percentile of an empty list");
  if (sorted.length === 1) return sorted[0]!;

  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
};

/**
 * Returns null below `minSamples`. That is the cold-start path: the first run
 * of a brand-new watch has no history, and the agent must still produce a
 * verdict from targetPrice alone.
 */
export const computeBaseline = (
  prices: number[],
  minSamples: number
): Baseline | null => {
  const usable = prices.filter((p) => Number.isFinite(p));
  if (usable.length < minSamples || usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
};

export const watchBaseline = async (
  db: Db,
  watchId: string,
  minSamples: number,
  now: Date = new Date()
): Promise<Baseline | null> => {
  const cutoff = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ price: listings.price })
    .from(listings)
    .where(
      and(
        eq(listings.watchId, watchId),
        isNotNull(listings.price),
        gte(listings.firstSeenAt, cutoff)
      )
    );

  return computeBaseline(
    rows.map((r) => Number(r.price)),
    minSamples
  );
};
