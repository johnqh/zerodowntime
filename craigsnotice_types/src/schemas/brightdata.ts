import { z } from "zod";

/** "$1,200" | "1200" | "" | null | undefined  ->  1200 | null */
const priceField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const digits = raw.replace(/[^0-9.]/g, "");
    if (digits === "") return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  });

export const searchResultRowSchema = z
  .object({
    post_id: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    price: priceField,
    posted_at: z.string().nullish(),
    location: z.string().nullish(),
  })
  .transform((r) => ({
    postId: r.post_id,
    title: r.title,
    url: r.url,
    price: r.price,
    postedAt: r.posted_at ?? null,
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
    posted_at: z.string().nullish(),
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
    postedAt: r.posted_at ?? null,
    location: r.location ?? null,
  }));

export type ListingDetailRow = z.infer<typeof listingDetailRowSchema>;
