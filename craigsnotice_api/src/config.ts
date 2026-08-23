export type DemoMode = "live" | "fixtures";

export interface Config {
  port: number;
  databaseUrl: string;
  demoMode: DemoMode;
  watchDefaultIntervalSec: number;
  minBaselineSamples: number;
  violationRateThreshold: number;
  debugToken: string | null;
  /** How long to wait for a Bright Data snapshot before giving up. */
  brightDataTimeoutMs: number;
  /** How many watch cycles may run at once. */
  maxConcurrentCycles: number;
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
    // Bright Data queues collections, so a job can sit well past the 30-90s
    // typical case when other runs are ahead of it. Five minutes was too
    // aggressive: snapshots were timing out and then completing moments later.
    brightDataTimeoutMs:
      num(env, "BRIGHTDATA_TIMEOUT_SEC", 900) * 1000,
    maxConcurrentCycles: num(env, "MAX_CONCURRENT_CYCLES", 1),
    debugToken: env.DEBUG_TOKEN ?? null,
  });
};
