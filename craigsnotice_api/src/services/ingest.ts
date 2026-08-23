import { and, eq, inArray } from "drizzle-orm";
import {
  titleCouldMatchQuery,
  searchResultRowSchema,
  listingDetailRowSchema,
  type SearchResultRow,
  type ListingDetailRow,
} from "@craigsnotice/types";
import type { Db } from "../db";
import { listings, scrapeRuns } from "../db/schema";
import type { BrightDataClient } from "./brightdata/client";
import type { ResultDelivery } from "./brightdata/delivery";
import type { FailureInjector } from "./selfheal";
import type { ImageFetcher } from "./ogImage";
import type { PortClient } from "./port/client";
import { mirrorListing, mirrorScrapeRun, safeMirror } from "./port/mirror";
import { parseRows } from "./parse";
import { withSpan } from "../telemetry";
import { metrics } from "../telemetry/metrics";

export interface IngestDeps {
  db: Db;
  bd: BrightDataClient;
  delivery: ResultDelivery;
  searchCollectorId: string;
  detailCollectorId: string;
  /** Staged-break trigger for the demo; armed via the debug route. */
  injector?: FailureInjector;
  /** Optional Port catalog mirror; never load-bearing. */
  port?: PortClient;
  /** Backfills the hero image when the collector did not return one. */
  fetchImage?: ImageFetcher;
  /** When set, Bright Data POSTs finished runs here instead of us polling. */
  deliverTo?: string;
  /** The watch's search term, used to skip detail fetches for obvious misses. */
  watchQuery?: string;
}

export interface IngestResult {
  runId: string;
  scrapedCount: number;
  newListingIds: string[];
  violationRate: number;
  sampleViolation: string | null;
}

/** Rows from the watch this listing belongs to; shape mirrors the Watch domain type. */
export interface IngestWatch {
  id: string;
  searchUrl: string;
}

const toDate = (raw: string | null): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const ingestWatch = async (
  deps: IngestDeps,
  watch: IngestWatch,
  scraperConfigId: string
): Promise<IngestResult> => {
  const snapshotId = await withSpan(
    "scrape.trigger",
    { "watch.id": watch.id, collector: deps.searchCollectorId },
    () =>
      deps.bd.trigger(
        deps.searchCollectorId,
        [{ url: watch.searchUrl }],
        deps.deliverTo
      )
  );

  const [run] = await deps.db
    .insert(scrapeRuns)
    .values({
      watchId: watch.id,
      scraperConfigId,
      snapshotId,
      status: "collecting",
    })
    .returning();
  const runId = run!.id;
  const startedAt = Date.now();

  const mirrorRun = async (
    status: string,
    rowCount: number,
    violationCount: number,
    finished: boolean
  ): Promise<void> => {
    if (!deps.port) return;
    await safeMirror(() =>
      mirrorScrapeRun(deps.port!, {
        id: runId,
        watchId: watch.id,
        scraperConfigId,
        snapshotId,
        status,
        rowCount,
        violationCount,
        durationMs: finished ? Date.now() - startedAt : null,
      })
    );
  };

  await mirrorRun("collecting", 0, 0, false);

  const failRun = async (err: unknown): Promise<never> => {
    await deps.db
      .update(scrapeRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: (err as Error).message,
      })
      .where(eq(scrapeRuns.id, runId));
    await mirrorRun("failed", 0, 0, true);
    throw err;
  };

  let raw: unknown[];
  try {
    raw = await withSpan(
      "scrape.poll",
      { "watch.id": watch.id, "run.id": runId, "snapshot.id": snapshotId },
      () => deps.delivery.await(snapshotId)
    );
  } catch (err) {
    return failRun(err);
  }

  // The injector fires on the search parse only; firing on the detail parse
  // too would make one injection look like two independent breakages.
  const forceFailure = deps.injector?.consume() ?? false;
  const parsed = await withSpan(
    "scrape.parse",
    { "watch.id": watch.id, "run.id": runId },
    async (span) => {
      const p = parseRows<SearchResultRow>(
        raw,
        searchResultRowSchema,
        forceFailure
      );
      span.setAttribute("scrape.violation_rate", p.violationRate);
      span.setAttribute("scrape.row_count", p.total);
      return p;
    }
  );

  metrics.scrapeViolations.add(parsed.violations, { "watch.id": watch.id });

  const scrapedIds = parsed.rows.map((r) => r.postId);
  const existing = scrapedIds.length
    ? await deps.db
        .select({ clPostId: listings.clPostId })
        .from(listings)
        .where(
          and(
            eq(listings.watchId, watch.id),
            inArray(listings.clPostId, scrapedIds)
          )
        )
    : [];

  const seen = new Set(existing.map((e) => e.clPostId));
  const unseen = parsed.rows.filter((r) => !seen.has(r.postId));

  /**
   * Filter by title BEFORE fetching detail pages. A Craigslist "Mac Studio"
   * search returns ~85 results of which ~25 are actually Mac Studios, and
   * fetching detail for all 85 made the detail collection several times
   * larger and slower than it needed to be — the run sat in "collecting" for
   * minutes fetching pages that were about to be discarded anyway.
   */
  const fresh = deps.watchQuery
    ? unseen.filter((r) => titleCouldMatchQuery(deps.watchQuery!, r.title))
    : unseen;

  const skipped = unseen.length - fresh.length;
  if (skipped > 0) {
    console.log(
      `[ingest] ${watch.id}: ${fresh.length} of ${unseen.length} new listings look relevant; skipping detail for ${skipped}`
    );
  }

  const details = new Map<string, ListingDetailRow>();
  if (fresh.length > 0) {
    try {
      await withSpan(
        "listing.detail.fetch",
        { "watch.id": watch.id, "listing.count": fresh.length },
        async () => {
          const detailSnapshot = await deps.bd.trigger(
            deps.detailCollectorId,
            fresh.map((r) => ({ url: r.url })),
            deps.deliverTo
          );
          const detailRaw = await deps.delivery.await(detailSnapshot);
          for (const d of parseRows<ListingDetailRow>(
            detailRaw,
            listingDetailRowSchema
          ).rows) {
            details.set(d.postId, d);
          }
        }
      );
    } catch (err) {
      return failRun(err);
    }
  }

  const newListingIds: string[] = [];
  for (const row of fresh) {
    const detail = details.get(row.postId);
    const price = detail?.price ?? row.price;

    // Scraper first; only fall back to the page's own og:image if it gave none.
    let imageUrl = detail?.imageUrl ?? row.imageUrl;
    if (!imageUrl && deps.fetchImage) {
      imageUrl = await deps.fetchImage(row.url);
    }

    const [inserted] = await deps.db
      .insert(listings)
      .values({
        watchId: watch.id,
        clPostId: row.postId,
        title: detail?.title ?? row.title,
        price: price === null ? null : String(price),
        url: row.url,
        postedAt: toDate(detail?.postedAt ?? row.postedAt),
        location: detail?.location ?? row.location,
        condition: detail?.condition ?? null,
        description: detail?.description ?? null,
        imageCount: detail?.imageCount ?? 0,
        imageUrl,
        detailFetchedAt: detail ? new Date() : null,
      })
      .onConflictDoNothing({
        target: [listings.watchId, listings.clPostId],
      })
      .returning();

    if (inserted) {
      newListingIds.push(inserted.id);
      if (deps.port) {
        await safeMirror(() => mirrorListing(deps.port!, inserted));
      }
    }
  }

  await deps.db
    .update(scrapeRuns)
    .set({
      status: "ready",
      rowCount: parsed.total,
      violationCount: parsed.violations,
      finishedAt: new Date(),
    })
    .where(eq(scrapeRuns.id, runId));

  await mirrorRun("ready", parsed.total, parsed.violations, true);

  metrics.listingsIngested.add(newListingIds.length, { "watch.id": watch.id });
  metrics.scrapeDuration.record(Date.now() - startedAt, {
    "watch.id": watch.id,
  });

  return {
    runId,
    scrapedCount: parsed.total,
    newListingIds,
    violationRate: parsed.violationRate,
    sampleViolation: parsed.sampleViolation,
  };
};
