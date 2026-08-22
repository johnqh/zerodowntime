/**
 * Craigslist always sets an og:image meta tag, but the Scraper Studio
 * collector returns image_url only intermittently — its heal validator passes
 * on the sample it tests, then deployed runs come back empty. This backfills
 * the hero image directly for listings the scraper left without one.
 *
 * It is a fallback, not a replacement: when the collector does supply
 * image_url, that value wins and this never runs.
 */
export type ImageFetcher = (url: string) => Promise<string | null>;

const OG_IMAGE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
const OG_IMAGE_REVERSED =
  /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i;
const CL_IMAGE = /https:\/\/images\.craigslist\.org\/[A-Za-z0-9_\-]+\.jpg/i;

export const createOgImageFetcher = (
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): ImageFetcher => {
  return async (url) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetchImpl(url, {
        signal: controller.signal,
        headers: { "User-Agent": "craigsnotice/0.1 (hackathon project)" },
      });
      clearTimeout(timer);
      if (!res.ok) return null;

      const html = await res.text();
      const match =
        html.match(OG_IMAGE) ?? html.match(OG_IMAGE_REVERSED) ?? html.match(CL_IMAGE);
      if (!match) return null;

      const found = match[1] ?? match[0];
      return found.startsWith("http") ? found : null;
    } catch {
      // A missing image is never worth failing an ingest over.
      return null;
    }
  };
};
