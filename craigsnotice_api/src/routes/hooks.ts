import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { successResponse, errorResponse } from "@craigsnotice/types";
import type { DegradedInfo, HealResult } from "../services/selfheal";
import type { WebhookStore } from "../services/brightdata/delivery";

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
/**
 * Bright Data's delivery callback. It POSTs when a collection finishes, so we
 * never poll: /dca/trigger carries an `endpoint=` param pointing here.
 */
const brightDataSchema = z
  .object({
    collection_id: z.string().optional(),
    snapshot_id: z.string().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
    result_url: z.string().optional(),
  })
  .passthrough();

export interface BrightDataHookDeps {
  store: WebhookStore;
  /** Fetches the rows for a finished collection. */
  fetchRows(snapshotId: string): Promise<unknown[]>;
}

export const createHooksRouter = (
  onHeal: HealHandler,
  webhookSecret: string,
  brightData?: BrightDataHookDeps
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

  if (brightData) {
    router.post("/brightdata", async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(errorResponse("invalid json"), 400);
      }

      if (Array.isArray(body)) {
        return c.json(
          successResponse({ accepted: false, reason: "no collection id" }),
          202
        );
      }

      const parsed = brightDataSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(errorResponse("unrecognised payload"), 400);
      }

      const snapshotId =
        parsed.data.collection_id ?? parsed.data.snapshot_id ?? null;
      if (!snapshotId) {
        return c.json(errorResponse("missing collection id"), 400);
      }

      if (parsed.data.error || parsed.data.status === "failed") {
        const failed = brightData.store.fail(
          snapshotId,
          parsed.data.error ?? "failed"
        );
        return c.json(successResponse({ accepted: failed }));
      }

      let rows: unknown[];
      try {
        rows = await brightData.fetchRows(snapshotId);
      } catch (err) {
        brightData.store.fail(snapshotId, (err as Error).message);
        return c.json(errorResponse((err as Error).message), 502);
      }

      // An unmatched id is normal: a retriggered or already-timed-out run.
      const accepted = brightData.store.resolve(snapshotId, rows);
      return c.json(successResponse({ accepted, rows: rows.length }));
    });
  }

  return router;
};
