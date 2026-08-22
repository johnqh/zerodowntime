import { z } from "zod";

export const agentRequestSchema = z.object({
  /** What the buyer actually asked for. Craigslist search is loose — a query
   *  for "Mac Studio" returns MacBooks, trackpads and iMacs — so relevance is
   *  the agent's first job, before price ever matters. */
  want: z.object({
    query: z.string(),
    categoryLabel: z.string(),
  }),
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
  /** Is this actually the item the buyer asked for? A cheap wrong thing is
   *  not a deal, and a mismatched listing must never enter the baseline. */
  matchesQuery: z.boolean(),
  isGoodDeal: z.boolean(),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  priceVsMedian: z.number(),
});

export type AgentVerdict = z.infer<typeof agentVerdictSchema>;
