export type DemoMode = "live" | "fixtures";

export interface Config {
  port: number;
  databaseUrl: string;
  demoMode: DemoMode;
  watchDefaultIntervalSec: number;
  minBaselineSamples: number;
  violationRateThreshold: number;
  debugToken: string | null;
}

type Env = Record<string, string | undefined>;

const num = (env: Env, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${key} must be numeric, got "${raw}"`);
  }
  return n;
};

export const loadConfig = (env: Env = process.env): Config => {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const demoMode = (env.DEMO_MODE ?? "live") as DemoMode;
  if (demoMode !== "live" && demoMode !== "fixtures") {
    throw new Error(
      `DEMO_MODE must be "live" or "fixtures", got "${demoMode}"`
    );
  }

  return Object.freeze({
    port: num(env, "PORT", 8022),
    databaseUrl,
    demoMode,
    watchDefaultIntervalSec: num(env, "WATCH_DEFAULT_INTERVAL_SEC", 300),
    minBaselineSamples: num(env, "MIN_BASELINE_SAMPLES", 5),
    violationRateThreshold: num(env, "VIOLATION_RATE_THRESHOLD", 0.3),
    debugToken: env.DEBUG_TOKEN ?? null,
  });
};
