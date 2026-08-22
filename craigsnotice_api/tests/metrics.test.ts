import { describe, it, expect } from "vitest";
import { metrics } from "../src/telemetry/metrics";

describe("metrics", () => {
  it("exposes every counter and histogram named in the spec", () => {
    for (const key of [
      "listingsIngested",
      "alertsSent",
      "agentInvocations",
      "agentFailures",
      "scrapeViolations",
      "selfhealEvents",
      "agentLatency",
      "scrapeDuration",
    ]) {
      expect(
        metrics[key as keyof typeof metrics],
        `missing metric ${key}`
      ).toBeDefined();
    }
  });

  it("records scraper health without throwing", () => {
    expect(() =>
      metrics.recordScraperHealth("cfg-1", "collector-1", false)
    ).not.toThrow();
    expect(() =>
      metrics.recordScraperHealth("cfg-1", "collector-1", true)
    ).not.toThrow();
  });

  it("accepts counter increments with attributes", () => {
    expect(() =>
      metrics.listingsIngested.add(3, { "watch.id": "w1" })
    ).not.toThrow();
    expect(() =>
      metrics.agentLatency.record(412, { "watch.id": "w1" })
    ).not.toThrow();
  });
});
