import type { PortClient } from "./client";

/** Port is a catalog, not a dependency. A mirror failure must never fail the pipeline. */
export const safeMirror = async (fn: () => Promise<void>): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    console.warn(`[port] mirror failed: ${(err as Error).message}`);
  }
};

export interface WatchMirror {
  id: string;
  siteCode: string;
  subarea: string | null;
  categoryCode: string;
  query: string;
  targetPrice: string | null;
  intervalSec: number;
  status: string;
  searchUrl: string;
}

export const mirrorWatch = (
  port: PortClient,
  watch: WatchMirror,
  ownerEmail: string
): Promise<void> =>
  port.upsertEntity("craigsnotice_watch", watch.id, watch.query, {
    siteCode: watch.siteCode,
    subarea: watch.subarea,
    categoryCode: watch.categoryCode,
    query: watch.query,
    targetPrice: watch.targetPrice === null ? null : Number(watch.targetPrice),
    intervalSec: watch.intervalSec,
    status: watch.status,
    searchUrl: watch.searchUrl,
    ownerEmail,
  });

export interface ScrapeRunMirror {
  id: string;
  watchId: string | null;
  scraperConfigId: string;
  snapshotId: string;
  status: string;
  rowCount: number;
  violationCount: number;
  durationMs: number | null;
}

export const mirrorScrapeRun = (
  port: PortClient,
  run: ScrapeRunMirror
): Promise<void> =>
  port.upsertEntity(
    "craigsnotice_scrape_run",
    run.id,
    `${run.status} · ${run.snapshotId}`,
    {
      snapshotId: run.snapshotId,
      status: run.status,
      rowCount: run.rowCount,
      violationCount: run.violationCount,
      durationMs: run.durationMs,
    },
    run.watchId
      ? { watch: run.watchId, scraper: run.scraperConfigId }
      : { scraper: run.scraperConfigId }
  );

export interface ListingMirror {
  id: string;
  watchId: string;
  title: string;
  price: string | null;
  url: string;
  postedAt: Date | null;
  condition: string | null;
  location: string | null;
}

export const mirrorListing = (
  port: PortClient,
  listing: ListingMirror
): Promise<void> =>
  port.upsertEntity(
    "craigsnotice_listing",
    listing.id,
    listing.title,
    {
      price: listing.price === null ? null : Number(listing.price),
      url: listing.url,
      postedAt: listing.postedAt?.toISOString() ?? null,
      condition: listing.condition,
      location: listing.location,
    },
    { watch: listing.watchId }
  );

export interface ScraperConfigMirror {
  id: string;
  kind: string;
  bdCollectorId: string;
  health: string;
  violationRate: string | number;
  lastHealedAt: Date | null;
  healPrompt: string | null;
}

export const mirrorScraperConfig = (
  port: PortClient,
  cfg: ScraperConfigMirror
): Promise<void> =>
  port.upsertEntity(
    "craigsnotice_scraper_config",
    cfg.id,
    `${cfg.kind} scraper`,
    {
      kind: cfg.kind,
      collectorId: cfg.bdCollectorId,
      health: cfg.health,
      violationRate: Number(cfg.violationRate),
      lastHealedAt: cfg.lastHealedAt?.toISOString() ?? null,
      healPrompt: cfg.healPrompt,
    }
  );
