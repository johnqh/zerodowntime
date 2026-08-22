import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const base = { DATABASE_URL: "postgres://localhost/craigsnotice_test" };

  it("applies documented defaults", () => {
    const c = loadConfig(base);
    expect(c.port).toBe(8022);
    expect(c.watchDefaultIntervalSec).toBe(300);
    expect(c.minBaselineSamples).toBe(5);
    expect(c.violationRateThreshold).toBe(0.3);
    expect(c.demoMode).toBe("live");
  });

  it("reads numeric overrides from the environment", () => {
    const c = loadConfig({
      ...base,
      PORT: "9000",
      VIOLATION_RATE_THRESHOLD: "0.5",
    });
    expect(c.port).toBe(9000);
    expect(c.violationRateThreshold).toBe(0.5);
  });

  it("throws when DATABASE_URL is absent", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects an unrecognised DEMO_MODE", () => {
    expect(() => loadConfig({ ...base, DEMO_MODE: "sometimes" })).toThrow(
      /DEMO_MODE/
    );
  });
});
