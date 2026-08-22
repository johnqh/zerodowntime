import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { listings, scraperConfigs, watches } from "../db/schema";
import { ingestWatch, type IngestDeps } from "./ingest";
import { judgeListing } from "./judgment";
import { isDegraded } from "./parse";
import type { PortClient } from "./port/client";
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

    let alerted = 0;
    for (const listingId of ingest.newListingIds) {
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
      if (!outcome.alertId || !outcome.verdict) continue;

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
      alerted += 1;
    }

    span.setAttribute("cycle.judged", ingest.newListingIds.length);
    span.setAttribute("cycle.alerted", alerted);

    return {
      runId: ingest.runId,
      scrapedCount: ingest.scrapedCount,
      judged: ingest.newListingIds.length,
      alerted,
      degraded: false,
    };
  });

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
  opts: { tickMs?: number } = {}
): Scheduler => {
  const tickMs = opts.tickMs ?? 15_000;
  const inFlight = new Set<string>();
  const lastRunAt = new Map<string, number>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    const active = await db
      .select()
      .from(watches)
      .where(eq(watches.status, "active"));

    const now = Date.now();
    for (const watch of active) {
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
