import { z } from "zod";

/**
 * Scraper Studio returns price as an object, e.g.
 *   { "value": 2029, "currency": "USD", "symbol": "$" }
 * but a hand-built or re-healed scraper may emit a plain string or number
 * instead. Accept all three and normalise to a number or null.
 */
const priceField = z
  .union([
    z.string(),
    z.number(),
    z.object({ value: z.union([z.number(), z.string()]).nullish() }).loose(),
    z.null(),
  ])
  .optional()
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;

    if (typeof raw === "object") {
      const v = (raw as { value?: number | string | null }).value;
      if (v === null || v === undefined) return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
    }

    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

    const digits = raw.replace(/[^0-9.]/g, "");
    if (digits === "") return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  });

/**
 * Craigslist rows carry a concatenated run of timestamps — posted, updated and
 * reposted all in one string:
 *   "2026-07-06 14:32 2026-07-06 14:32 2026-08-04 18:23"
 * Keep the first, which is the original posting time.
 */
const firstTimestamp = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const match = trimmed.match(
    /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/
  );
  return match ? match[0].replace(" ", "T") : trimmed;
};

const dateField = z
  .string()
  .nullish()
  .transform((v) => firstTimestamp(v));

export const searchResultRowSchema = z
  .object({
    post_id: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    price: priceField,
    posted_at: dateField,
    location: z.string().nullish(),
  })
  .transform((r) => ({
    postId: r.post_id,
    title: r.title,
    url: r.url,
    price: r.price,
    postedAt: r.posted_at,
    location: r.location ?? null,
  }));

export type SearchResultRow = z.infer<typeof searchResultRowSchema>;

export const listingDetailRowSchema = z
  .object({
    post_id: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    price: priceField,
    description: z.string().nullish(),
    condition: z.string().nullish(),
    image_count: z.number().int().nonnegative().nullish(),
    posted_at: dateField,
    location: z.string().nullish(),
  })
  .transform((r) => ({
    postId: r.post_id,
    title: r.title,
    url: r.url,
    price: r.price,
    description: r.description ?? null,
    condition: r.condition ?? null,
    imageCount: r.image_count ?? 0,
    postedAt: r.posted_at,
    location: r.location ?? null,
  }));

export type ListingDetailRow = z.infer<typeof listingDetailRowSchema>;
