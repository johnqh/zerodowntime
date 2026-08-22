import { z } from "zod";

export const createWatchSchema = z.object({
  siteCode: z.string().min(1),
  subarea: z.string().min(1).optional(),
  categoryCode: z.string().min(1),
  query: z.string().trim().min(1),
  targetPrice: z.number().nonnegative().optional(),
  intervalSec: z.number().int().min(60).max(86400).default(300),
});

export type CreateWatchInput = z.infer<typeof createWatchSchema>;

export const feedbackSchema = z.object({
  verdict: z.enum(["good", "bad"]),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;
