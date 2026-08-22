export type WatchStatus = "active" | "paused";
export type ScrapeRunStatus = "collecting" | "ready" | "failed";
export type ScraperKind = "search" | "detail";
export type ScraperHealth = "healthy" | "degraded";
export type FeedbackVerdict = "good" | "bad";

export interface Watch {
  id: string;
  userId: string;
  siteCode: string;
  subarea: string | null;
  categoryCode: string;
  query: string;
  targetPrice: number | null;
  intervalSec: number;
  status: WatchStatus;
  searchUrl: string;
  createdAt: string;
}

export interface Listing {
  id: string;
  watchId: string;
  clPostId: string;
  title: string;
  price: number | null;
  url: string;
  postedAt: string | null;
  location: string | null;
  condition: string | null;
  description: string | null;
  imageCount: number;
  imageUrl: string | null;
  detailFetchedAt: string | null;
  firstSeenAt: string;
}

export interface DealAlert {
  id: string;
  listingId: string;
  watchId: string;
  score: number;
  isGoodDeal: boolean;
  reasoning: string;
  priceVsMedian: number;
  notifiedAt: string | null;
  createdAt: string;
}

export interface ScrapeRun {
  id: string;
  watchId: string | null;
  scraperConfigId: string;
  snapshotId: string;
  status: ScrapeRunStatus;
  rowCount: number;
  violationCount: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface ScraperConfig {
  id: string;
  kind: ScraperKind;
  bdCollectorId: string;
  health: ScraperHealth;
  violationRate: number;
  lastHealedAt: string | null;
  healPrompt: string | null;
}

export interface Comparable {
  title: string;
  price: number;
  condition: string | null;
}

/**
 * Null when fewer than MIN_BASELINE_SAMPLES priced listings exist for the
 * watch. `comparables` matters as much as the summary statistics: a median
 * across a 2012 Mac mini and an M4 is not a like-for-like comparison, so the
 * agent needs the individual listings to reason about generation and spec.
 */
export interface Baseline {
  count: number;
  median: number;
  p25: number;
  min: number;
  max: number;
  comparables: Comparable[];
}
