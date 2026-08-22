import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { successResponse, errorResponse } from "@craigsnotice/types";
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
/** Length-independent, constant-time string comparison. */
const secretsMatch = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

/**
 * The heal this triggers costs money and mutates a live scraper, so the
 * endpoint requires a shared secret. `createApp` refuses to mount it when
 * SIGNOZ_WEBHOOK_SECRET is unset rather than exposing it unauthenticated —
 * which matters because the demo runbook puts this behind a public tunnel.
 */
export const createHooksRouter = (
  onHeal: HealHandler,
  webhookSecret: string
): Hono => {
  const router = new Hono();

  if (!webhookSecret) {
    throw new Error("refusing to mount /hooks without a webhook secret");
  }

  router.use("*", async (c, next) => {
    const provided = c.req.header("x-signoz-token");
    if (!provided || !secretsMatch(provided, webhookSecret)) {
      return c.json(errorResponse("forbidden"), 401);
    }
    await next();
  });

  router.post(
    "/signoz/heal",
    zValidator("json", signozAlertSchema),
    async (c) => {
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
    }
  );

  return router;
};
