import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { successResponse } from "@craigsnotice/types";
import type { DegradedInfo, HealResult } from "../services/selfheal";

const signozAlertSchema = z.object({
  alerts: z
    .array(
      z.object({
        status: z.string(),
        labels: z.object({
          scraper_config_id: z.string(),
          collector_id: z.string().optional(),
        }),
      })
    )
    .min(1),
});

export type HealHandler = (info: DegradedInfo) => Promise<HealResult>;

/**
 * Closes the observability loop: a SigNoz alert on scraper.health == 0 posts
 * here, and the API runs a real Bright Data heal. Observability does not just
 * watch the pipeline, it repairs it.
 */
export const createHooksRouter = (onHeal: HealHandler): Hono => {
  const router = new Hono();

  router.post("/signoz/heal", zValidator("json", signozAlertSchema), async (c) => {
    const healed: string[] = [];

    for (const alert of c.req.valid("json").alerts) {
      if (alert.status !== "firing") continue;

      const result = await onHeal({
        scraperConfigId: alert.labels.scraper_config_id,
        violationRate: 1,
        sampleViolation: "SigNoz alert: scraper.health reported degraded",
      });
      if (result.healed) healed.push(alert.labels.scraper_config_id);
    }

    return c.json(successResponse({ healed }));
  });

  return router;
};
