import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { scraperConfigs } from "../db/schema";
import type { BrightDataClient } from "./brightdata/client";
import type { PortClient } from "./port/client";
import { safeMirror } from "./port/mirror";
import { metrics } from "../telemetry/metrics";

export interface DegradedInfo {
  scraperConfigId: string;
  violationRate: number;
  sampleViolation: string | null;
}

export type SelfHealEvent =
  | "scraper.selfheal.triggered"
  | "scraper.selfheal.succeeded"
  | "scraper.selfheal.failed";

export interface SelfHealDeps {
  db: Db;
  bd: BrightDataClient;
  port: PortClient;
  emit: (event: SelfHealEvent, attrs: Record<string, unknown>) => void;
}

export interface HealResult {
  healed: boolean;
  prompt: string;
  error: string | null;
}

export const buildHealPrompt = (
  kind: string,
  sampleViolation: string | null
): string => {
  const target =
    kind === "detail"
      ? "Craigslist listing detail page"
      : "Craigslist search results page";

  if (!sampleViolation) {
    return (
      `The ${target} scraper is returning rows that no longer match its ` +
      `output schema. Re-derive the selectors for every field in the schema.`
    );
  }

  return (
    `The ${target} scraper is returning rows that no longer match its ` +
    `output schema. Validation reports: ${sampleViolation}. Re-derive the ` +
    `selectors for those fields, keeping the existing output schema unchanged.`
  );
};

export const handleDegraded = async (
  deps: SelfHealDeps,
  info: DegradedInfo
): Promise<HealResult> => {
  const [config] = await deps.db
    .select()
    .from(scraperConfigs)
    .where(eq(scraperConfigs.id, info.scraperConfigId));
  if (!config) {
    throw new Error(`scraper config ${info.scraperConfigId} not found`);
  }

  const prompt = buildHealPrompt(config.kind, info.sampleViolation);

  await deps.db
    .update(scraperConfigs)
    .set({
      health: "degraded",
      violationRate: String(info.violationRate),
      healPrompt: prompt,
    })
    .where(eq(scraperConfigs.id, config.id));

  await safeMirror(() =>
    deps.port.patchEntity("craigsnotice_scraper_config", config.id, {
      health: "degraded",
      violationRate: info.violationRate,
      healPrompt: prompt,
    })
  );

  metrics.recordScraperHealth(config.id, config.bdCollectorId, false);

  deps.emit("scraper.selfheal.triggered", {
    collectorId: config.bdCollectorId,
    scraperConfigId: config.id,
    violationRate: info.violationRate,
    sampleViolation: info.sampleViolation,
    healPrompt: prompt,
  });

  try {
    await deps.bd.heal(config.bdCollectorId, prompt);
  } catch (err) {
    const error = (err as Error).message;
    deps.emit("scraper.selfheal.failed", {
      collectorId: config.bdCollectorId,
      scraperConfigId: config.id,
      error,
    });
    return { healed: false, prompt, error };
  }

  const healedAt = new Date();
  await deps.db
    .update(scraperConfigs)
    .set({ health: "healthy", violationRate: "0", lastHealedAt: healedAt })
    .where(eq(scraperConfigs.id, config.id));

  await safeMirror(() =>
    deps.port.patchEntity("craigsnotice_scraper_config", config.id, {
      health: "healthy",
      violationRate: 0,
      lastHealedAt: healedAt.toISOString(),
    })
  );

  metrics.recordScraperHealth(config.id, config.bdCollectorId, true);

  deps.emit("scraper.selfheal.succeeded", {
    collectorId: config.bdCollectorId,
    scraperConfigId: config.id,
    healPrompt: prompt,
  });

  return { healed: true, prompt, error: null };
};

/**
 * Staged-failure trigger for the demo. Arming it makes the NEXT search parse
 * treat every row as a schema violation, which drives the real detection ->
 * heal -> recovery chain above. The break is synthetic; nothing downstream
 * of it is. See README.
 */
export interface FailureInjector {
  arm(): void;
  consume(): boolean;
}

export const createFailureInjector = (): FailureInjector => {
  let armed = false;
  return {
    arm() {
      armed = true;
    },
    consume() {
      if (!armed) return false;
      armed = false;
      return true;
    },
  };
};
