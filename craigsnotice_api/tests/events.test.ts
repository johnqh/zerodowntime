import { describe, it, expect, vi } from "vitest";
import { createSelfHealEmitter, severityFor } from "../src/telemetry/events";

describe("severityFor", () => {
  it("maps triggered to WARN", () =>
    expect(severityFor("scraper.selfheal.triggered")).toBe("WARN"));
  it("maps succeeded to INFO", () =>
    expect(severityFor("scraper.selfheal.succeeded")).toBe("INFO"));
  it("maps failed to ERROR", () =>
    expect(severityFor("scraper.selfheal.failed")).toBe("ERROR"));
});

describe("createSelfHealEmitter", () => {
  it("writes a structured log line carrying the heal prompt", () => {
    const sink = vi.fn();
    const emit = createSelfHealEmitter(sink);

    emit("scraper.selfheal.triggered", {
      collectorId: "c1",
      violationRate: 0.75,
      healPrompt: "re-derive price",
    });

    expect(sink).toHaveBeenCalledOnce();
    const record = sink.mock.calls[0]![0] as Record<string, unknown>;
    expect(record.event).toBe("scraper.selfheal.triggered");
    expect(record.severity).toBe("WARN");
    expect(record.healPrompt).toBe("re-derive price");
    expect(record.collectorId).toBe("c1");
  });

  it("does not throw when there is no active span", () => {
    expect(() =>
      createSelfHealEmitter(vi.fn())("scraper.selfheal.failed", {})
    ).not.toThrow();
  });
});
