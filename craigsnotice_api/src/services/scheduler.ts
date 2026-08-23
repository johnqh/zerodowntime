import { and, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "../db";
import {
  listings,
  scrapeRuns,
  scraperConfigs,
  watches,
} from "../db/schema";
import { ingestWatch, type IngestDeps } from "./ingest";
import { judgeListing } from "./judgment";
import { isDegraded } from "./parse";
import type { PortClient } from "./port/client";
import { titleCouldMatchQuery } from "@craigsnotice/types";
import type { AlertPayload } from "./notify/dispatcher";
import type { DegradedInfo } from "./selfheal";
import { withSpan } from "../telemetry";

export interface CycleDeps extends IngestDeps {
  port: PortClient;
  agentId: string;
  minBaselineSamples: number;
  violationRateThreshold: number;
  dispatcher: { dispatch(userId: string, alert: AlertPayload): Promise<void> };
  onDegraded?: (info: DegradedInfo) => Promise<void>;
  /** Agent calls are metered, so one huge search cannot drain the quota. */
  maxJudgementsPerCycle?: number;
  judgementConcurrency?: number;
}

export interface CycleResult {
  runId: string;
  scrapedCount: number;
  judged: number;
  alerted: number;
  degraded: boolean;
}

export const runWatchCycle = (
  deps: CycleDeps,
  watchId: string
): Promise<CycleResult> =>
  withSpan("watch.tick", { "watch.id": watchId }, async (span) => {
    const [watch] = await deps.db
      .select()
      .from(watches)
      .where(eq(watches.id, watchId));
    if (!watch) throw new Error(`watch ${watchId} not found`);

    const [config] = await deps.db
      .select()
      .from(scraperConfigs)
      .where(
        and(
          eq(scraperConfigs.kind, "search"),
          eq(scraperConfigs.bdCollectorId, deps.searchCollectorId)
        )
      );
    if (!config) throw new Error("search scraper config not registered");

    const ingest = await ingestWatch(deps, watch, config.id);

    if (isDegraded(ingest.violationRate, deps.violationRateThreshold)) {
      await deps.onDegraded?.({
        scraperConfigId: config.id,
        violationRate: ingest.violationRate,
        sampleViolation: ingest.sampleViolation,
      });
      return {
        runId: ingest.runId,
        scrapedCount: ingest.scrapedCount,
        judged: 0,
        alerted: 0,
        degraded: true,
      };
    }

    /**
     * Craigslist category search is loose: a "Mac mini" search returns Dell
     * laptops, projectors and monitors. Asking the agent about each one is
     * slow and burns a metered quota to be told the obvious, so a local title
     * check settles the clear rejections first. Anything plausible still goes
     * to the agent, which makes the real call.
     */
    const candidates: string[] = [];
    const prefiltered: string[] = [];

    for (const listingId of ingest.newListingIds) {
      const [listing] = await deps.db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId));
      if (!listing) continue;

      if (titleCouldMatchQuery(watch.query, listing.title)) {
        candidates.push(listingId);
      } else {
        prefiltered.push(listingId);
      }
    }

    if (prefiltered.length > 0) {
      // Irrelevant at no cost, and kept out of the price baseline.
      await deps.db
        .update(listings)
        .set({ matchesQuery: false })
        .where(inArray(listings.id, prefiltered));
    }

    if (candidates.length > 0) {
      // Marked relevant before judging so the very first run already has a
      // real baseline to compare against. The agent can still downgrade them.
      await deps.db
        .update(listings)
        .set({ matchesQuery: true })
        .where(inArray(listings.id, candidates));
    }

    const budget = deps.maxJudgementsPerCycle ?? 25;
    const toJudge = candidates.slice(0, budget);
    const deferred = candidates.length - toJudge.length;
    if (deferred > 0) {
      console.warn(
        `[cycle] ${watchId}: judging ${toJudge.length} of ${candidates.length} candidates, ${deferred} deferred to the next run`
      );
    }

    span.setAttribute("cycle.scraped", ingest.newListingIds.length);
    span.setAttribute("cycle.prefiltered_out", prefiltered.length);
    span.setAttribute("cycle.candidates", candidates.length);

    const judgeOne = async (listingId: string): Promise<boolean> => {
      const outcome = await judgeListing(
        {
          db: deps.db,
          port: deps.port,
          agentId: deps.agentId,
          minBaselineSamples: deps.minBaselineSamples,
        },
        watchId,
        listingId
      );
      if (!outcome.alertId || !outcome.verdict) return false;

      const [listing] = await deps.db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId));

      await deps.dispatcher.dispatch(watch.userId, {
        alertId: outcome.alertId,
        watchId,
        title: listing!.title,
        price: listing!.price === null ? null : Number(listing!.price),
        url: listing!.url,
        score: outcome.verdict.score,
        reasoning: outcome.verdict.reasoning,
        priceVsMedian: outcome.verdict.priceVsMedian,
      });
      return true;
    };

    // A bounded pool. Serial judging took ~30s per listing, so a large search
    // never finished; the cap keeps us inside the agent's rate limit.
    const concurrency = deps.judgementConcurrency ?? 4;
    let alerted = 0;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < toJudge.length) {
        const listingId = toJudge[cursor++]!;
        try {
          if (await judgeOne(listingId)) alerted += 1;
        } catch (err) {
          console.warn(
            `[cycle] judging ${listingId} failed: ${(err as Error).message}`
          );
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, toJudge.length) }, worker)
    );

    span.setAttribute("cycle.judged", toJudge.length);
    span.setAttribute("cycle.alerted", alerted);

    return {
      runId: ingest.runId,
      scrapedCount: ingest.scrapedCount,
      judged: toJudge.length,
      alerted,
      degraded: false,
    };
  });

/**
 * A cycle polls Bright Data in-process, so if the process dies mid-run the
 * scrape_run row is left "collecting" forever with nothing to recover it —
 * and the watch looks like it is working when it is not. Sweep them at boot.
 */
export const reconcileStaleRuns = async (
  db: Db,
  staleAfterMs = 15 * 60 * 1000,
  now: Date = new Date()
): Promise<number> => {
  const cutoff = new Date(now.getTime() - staleAfterMs);

  const swept = await db
    .update(scrapeRuns)
    .set({
      status: "failed",
      finishedAt: now,
      error: "abandoned: the process died before this run completed",
    })
    .where(
      and(eq(scrapeRuns.status, "collecting"), lt(scrapeRuns.startedAt, cutoff))
    )
    .returning({ id: scrapeRuns.id });

  return swept.length;
};

export interface Scheduler {
  start(): void;
  stop(): void;
}

/**
 * One interval that sweeps active watches. A watch never has two cycles in
 * flight at once. For the demo the Run-now button is the primary path — a
 * 300s interval is realistic but unusable on stage.
 */
export const createScheduler = (
  deps: CycleDeps,
  db: Db,
  opts: { tickMs?: number; maxConcurrent?: number } = {}
): Scheduler => {
  const tickMs = opts.tickMs ?? 15_000;
  /**
   * Bright Data queues collections per account, so firing every watch at once
   * makes them all wait behind one another until they time out. Run a small
   * number of cycles at a time instead. On restart, when every watch is due at
   * once, this is the difference between working and a pile-up.
   */
  const maxConcurrent = opts.maxConcurrent ?? 1;
  const inFlight = new Set<string>();
  const lastRunAt = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    const active = await db
      .select()
      .from(watches)
      .where(eq(watches.status, "active"));

    const now = Date.now();

    /**
     * Least-recently-run first. With a small concurrency cap the list order
     * would otherwise favour the same watches every tick, and a newly created
     * watch could sit behind older ones indefinitely.
     */
    const byStaleness = [...active].sort(
      (a, b) => (lastRunAt.get(a.id) ?? 0) - (lastRunAt.get(b.id) ?? 0)
    );

    for (const watch of byStaleness) {
      if (inFlight.size >= maxConcurrent) break;
      if (inFlight.has(watch.id)) continue;

      const last = lastRunAt.get(watch.id) ?? 0;
      if (now - last < watch.intervalSec * 1000) continue;

      inFlight.add(watch.id);
      lastRunAt.set(watch.id, now);
      runWatchCycle(deps, watch.id)
        .catch((err) =>
          console.warn(
            `[scheduler] cycle failed for ${watch.id}: ${(err as Error).message}`
          )
        )
        .finally(() => inFlight.delete(watch.id));
    }
  };

  return {
    start() {
      timer ??= setInterval(() => void tick(), tickMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
};
