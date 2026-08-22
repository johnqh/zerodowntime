import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

/** "signoz-ingestion-key=abc,other=1" -> { "signoz-ingestion-key": "abc", other: "1" } */
const headers = Object.fromEntries(
  (process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "")
    .split(",")
    .filter(Boolean)
    .map((pair) => {
      const [k, ...rest] = pair.split("=");
      return [k!.trim(), rest.join("=").trim()];
    })
);

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.name": process.env.OTEL_SERVICE_NAME ?? "craigsnotice-api",
    "service.version": "0.1.0",
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      headers,
    }),
    exportIntervalMillis: 10_000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

const shutdown = (): void => {
  void sdk.shutdown();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
