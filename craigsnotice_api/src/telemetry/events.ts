import { trace } from "@opentelemetry/api";
import type { SelfHealEvent } from "../services/selfheal";
import { metrics } from "./metrics";

export type Severity = "INFO" | "WARN" | "ERROR";

export const severityFor = (event: SelfHealEvent): Severity => {
  if (event === "scraper.selfheal.failed") return "ERROR";
  if (event === "scraper.selfheal.triggered") return "WARN";
  return "INFO";
};

export type LogSink = (record: Record<string, unknown>) => void;

const defaultSink: LogSink = (record) => {
  const line = JSON.stringify(record);
  if (record.severity === "ERROR") console.error(line);
  else if (record.severity === "WARN") console.warn(line);
  else console.log(line);
};

/**
 * Auto-repair is a first-class signal, not a log line. Each event lands three
 * ways: a span event inside the trace that detected it, a severity-tagged log
 * record searchable on its own, and a counter that is alertable and graphable.
 */
export const createSelfHealEmitter = (sink: LogSink = defaultSink) => {
  return (event: SelfHealEvent, attrs: Record<string, unknown>): void => {
    const severity = severityFor(event);

    trace
      .getActiveSpan()
      ?.addEvent(event, attrs as Record<string, string | number | boolean>);

    sink({ event, severity, ...attrs, timestamp: new Date().toISOString() });

    metrics.selfhealEvents.add(1, { event, severity });
  };
};
