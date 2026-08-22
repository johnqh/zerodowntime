import { metrics as otelMetrics } from "@opentelemetry/api";

const meter = otelMetrics.getMeter("craigsnotice-api");

/** scraper_config_id -> state, read by the observable gauge below. */
const scraperHealth = new Map<
  string,
  { collectorId: string; healthy: boolean }
>();

const healthGauge = meter.createObservableGauge("scraper.health", {
  description: "1 when the scraper is healthy, 0 when degraded",
});

// The series the SigNoz alert rule fires on. Label names are load-bearing:
// signoz/alerts/scraper-degraded.json groups by exactly these.
healthGauge.addCallback((observer) => {
  for (const [scraperConfigId, state] of scraperHealth) {
    observer.observe(state.healthy ? 1 : 0, {
      scraper_config_id: scraperConfigId,
      collector_id: state.collectorId,
    });
  }
});

export const metrics = {
  listingsIngested: meter.createCounter("craigsnotice.listings.ingested", {
    description: "New listings stored",
  }),
  alertsSent: meter.createCounter("craigsnotice.alerts.sent", {
    description: "Deal alerts dispatched",
  }),
  agentInvocations: meter.createCounter("craigsnotice.agent.invocations", {
    description: "Port agent invocations",
  }),
  agentFailures: meter.createCounter("craigsnotice.agent.failures", {
    description: "Agent errors or malformed verdicts",
  }),
  scrapeViolations: meter.createCounter("craigsnotice.scrape.violations", {
    description: "Rows failing schema validation",
  }),
  selfhealEvents: meter.createCounter("craigsnotice.selfheal.events", {
    description: "Self-heal lifecycle events",
  }),
  agentLatency: meter.createHistogram("craigsnotice.agent.latency", {
    unit: "ms",
    description: "Agent invocation latency",
  }),
  scrapeDuration: meter.createHistogram("craigsnotice.scrape.duration", {
    unit: "ms",
    description: "Trigger-to-ready duration",
  }),

  recordScraperHealth(
    scraperConfigId: string,
    collectorId: string,
    healthy: boolean
  ): void {
    scraperHealth.set(scraperConfigId, { collectorId, healthy });
  },
};
