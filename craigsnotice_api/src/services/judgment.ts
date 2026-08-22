import { desc, eq } from "drizzle-orm";
import { agentVerdictSchema, type AgentVerdict } from "@craigsnotice/types";
import type { Db } from "../db";
import { alertFeedback, dealAlerts, listings, watches } from "../db/schema";
import type { PortClient } from "./port/client";
import { watchBaseline } from "./baseline";

export interface JudgmentDeps {
  db: Db;
  port: PortClient;
  agentId: string;
  minBaselineSamples: number;
}

export interface FeedbackContext {
  title: string;
  price: number | null;
  priceVsMedian: number;
  verdict: "good" | "bad";
}

export interface JudgmentOutcome {
  listingId: string;
  verdict: AgentVerdict | null;
  alertId: string | null;
  error: string | null;
}

export const recentFeedback = async (
  db: Db,
  watchId: string,
  limit = 10
): Promise<FeedbackContext[]> => {
  const rows = await db
    .select({
      title: listings.title,
      price: listings.price,
      priceVsMedian: dealAlerts.priceVsMedian,
      verdict: alertFeedback.verdict,
    })
    .from(alertFeedback)
    .innerJoin(dealAlerts, eq(alertFeedback.alertId, dealAlerts.id))
    .innerJoin(listings, eq(dealAlerts.listingId, listings.id))
    .where(eq(dealAlerts.watchId, watchId))
    .orderBy(desc(alertFeedback.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    title: r.title,
    price: r.price === null ? null : Number(r.price),
    priceVsMedian: Number(r.priceVsMedian),
    verdict: r.verdict as "good" | "bad",
  }));
};

/**
 * A malformed or throwing agent response must not stall the pipeline: the
 * listing stays stored, no alert is raised, and the reason comes back on
 * `error`. The system degrades to a data collector rather than halting.
 */
export const judgeListing = async (
  deps: JudgmentDeps,
  watchId: string,
  listingId: string
): Promise<JudgmentOutcome> => {
  const [listing] = await deps.db
    .select()
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) {
    return { listingId, verdict: null, alertId: null, error: "listing not found" };
  }

  const [watch] = await deps.db
    .select()
    .from(watches)
    .where(eq(watches.id, watchId));
  if (!watch) {
    return { listingId, verdict: null, alertId: null, error: "watch not found" };
  }

  const baseline = await watchBaseline(
    deps.db,
    watchId,
    deps.minBaselineSamples
  );

  const payload = {
    listing: {
      title: listing.title,
      price: listing.price === null ? null : Number(listing.price),
      condition: listing.condition,
      description: listing.description,
      imageCount: listing.imageCount,
      postedAt: listing.postedAt?.toISOString() ?? null,
      location: listing.location,
    },
    baseline,
    targetPrice: watch.targetPrice === null ? null : Number(watch.targetPrice),
    recentFeedback: await recentFeedback(deps.db, watchId),
  };

  let raw: unknown;
  try {
    raw = await deps.port.invokeAgent(deps.agentId, payload);
  } catch (err) {
    return {
      listingId,
      verdict: null,
      alertId: null,
      error: (err as Error).message,
    };
  }

  const parsed = agentVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      listingId,
      verdict: null,
      alertId: null,
      error: `malformed agent verdict: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    };
  }

  const verdict = parsed.data;
  if (!verdict.isGoodDeal) {
    return { listingId, verdict, alertId: null, error: null };
  }

  const [alert] = await deps.db
    .insert(dealAlerts)
    .values({
      listingId,
      watchId,
      score: Math.round(verdict.score),
      isGoodDeal: true,
      reasoning: verdict.reasoning,
      priceVsMedian: String(verdict.priceVsMedian),
    })
    .returning();

  await deps.port.upsertEntity(
    "craigsnotice_deal_alert",
    alert!.id,
    listing.title,
    {
      score: verdict.score,
      isGoodDeal: true,
      reasoning: verdict.reasoning,
      priceVsMedian: verdict.priceVsMedian,
      userFeedback: "none",
    },
    { listing: listing.id, watch: watchId }
  );

  return { listingId, verdict, alertId: alert!.id, error: null };
};
