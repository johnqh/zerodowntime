import { z } from "zod";

export const agentRequestSchema = z.object({
  listing: z.object({
    title: z.string(),
    price: z.number().nullable(),
    condition: z.string().nullable(),
    description: z.string().nullable(),
    imageCount: z.number().int(),
    postedAt: z.string().nullable(),
    location: z.string().nullable(),
  }),
  baseline: z
    .object({
      count: z.number().int(),
      median: z.number(),
      p25: z.number(),
      min: z.number(),
      max: z.number(),
    })
    .nullable(),
  targetPrice: z.number().nullable(),
  recentFeedback: z.array(
    z.object({
      title: z.string(),
      price: z.number().nullable(),
      priceVsMedian: z.number(),
      verdict: z.enum(["good", "bad"]),
    })
  ),
});

export type AgentRequest = z.infer<typeof agentRequestSchema>;

export const agentVerdictSchema = z.object({
  isGoodDeal: z.boolean(),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  priceVsMedian: z.number(),
});

export type AgentVerdict = z.infer<typeof agentVerdictSchema>;
