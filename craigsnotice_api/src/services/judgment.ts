import { desc, eq } from "drizzle-orm";
import {
  agentVerdictSchema,
  getCategory,
  type AgentRequest,
  type AgentVerdict,
} from "@craigsnotice/types";
import type { Db } from "../db";
import { alertFeedback, dealAlerts, listings, watches } from "../db/schema";
import type { PortClient } from "./port/client";
import { watchBaseline } from "./baseline";
import { extractJsonObject } from "./port/sse";
import { withSpan } from "../telemetry";
import { metrics } from "../telemetry/metrics";

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

/**
 * Port agents take a prompt string, not a JSON body, so the structured payload
 * is serialised into one. The trailing instruction repeats the output contract
 * because the agent's system prompt alone is not always enough to suppress
 * prose around the JSON.
 */
export const buildAgentPrompt = (payload: AgentRequest): string =>
  [
    `The buyer is looking for: "${payload.want.query}" (category: ${payload.want.categoryLabel}).`,
    "",
    "STEP 1 - Relevance. Craigslist search is loose and returns related but",
    "wrong items. Decide whether this listing IS the thing the buyer asked",
    "for. Accessories, different product lines, and merely similar brands do",
    "NOT count. If it is not the item, set matchesQuery=false, isGoodDeal=false",
    "and score=0, and say what it actually is. A cheap wrong thing is not a deal.",
    "",
    "STEP 2 - Only if it IS the right item, judge the price.",
    "",
    "Input:",
    JSON.stringify(payload, null, 2),
    "",
    'Reply with ONLY this JSON object and no prose: {"matchesQuery": boolean, "isGoodDeal": boolean, "score": 0-100, "reasoning": "one sentence", "priceVsMedian": number}',
  ].join("\n");

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
    return {
      listingId,
      verdict: null,
      alertId: null,
      error: "listing not found",
    };
  }

  const [watch] = await deps.db
    .select()
    .from(watches)
    .where(eq(watches.id, watchId));
  if (!watch) {
    return {
      listingId,
      verdict: null,
      alertId: null,
      error: "watch not found",
    };
  }

  const baseline = await withSpan(
    "baseline.compute",
    { "watch.id": watchId },
    async (span) => {
      const b = await watchBaseline(deps.db, watchId, deps.minBaselineSamples);
      span.setAttribute("baseline.cold_start", b === null);
      if (b) span.setAttribute("baseline.count", b.count);
      return b;
    }
  );

  const category = getCategory(watch.categoryCode);

  const payload: AgentRequest = {
    want: {
      query: watch.query,
      categoryLabel: category?.label ?? watch.categoryCode,
    },
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

  const attrs = { "watch.id": watchId, "listing.id": listingId };
  metrics.agentInvocations.add(1, attrs);
  const invokedAt = Date.now();

  let raw: unknown;
  try {
    const reply = await withSpan("agent.invoke", attrs, () =>
      deps.port.invokeAgent(deps.agentId, buildAgentPrompt(payload))
    );
    raw = extractJsonObject(reply);
  } catch (err) {
    metrics.agentFailures.add(1, { ...attrs, reason: "threw" });
    return {
      listingId,
      verdict: null,
      alertId: null,
      error: (err as Error).message,
    };
  } finally {
    metrics.agentLatency.record(Date.now() - invokedAt, attrs);
  }

  const parsed = agentVerdictSchema.safeParse(raw);
  if (!parsed.success) {
    metrics.agentFailures.add(1, { ...attrs, reason: "malformed" });
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

  // Record relevance on the listing: it gates alerts AND keeps irrelevant
  // prices out of this watch's baseline.
  await deps.db
    .update(listings)
    .set({ matchesQuery: verdict.matchesQuery })
    .where(eq(listings.id, listingId));

  if (!verdict.matchesQuery || !verdict.isGoodDeal) {
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
