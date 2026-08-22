import { describe, it, expect, beforeEach } from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context } from "@opentelemetry/api";
import { withSpan } from "../src/telemetry";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
trace.setGlobalTracerProvider(provider);

// Without a context manager, context.active() is always ROOT and nothing
// nests. NodeSDK registers one in production; the test needs its own.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

describe("withSpan", () => {
  beforeEach(() => exporter.reset());

  it("records a span with the given name and attributes", async () => {
    await withSpan(
      "scrape.parse",
      { "watch.id": "w1", "run.id": "r1" },
      async () => 42
    );

    const [span] = exporter.getFinishedSpans();
    expect(span!.name).toBe("scrape.parse");
    expect(span!.attributes["watch.id"]).toBe("w1");
    expect(span!.attributes["run.id"]).toBe("r1");
  });

  it("returns the callback's value", async () => {
    expect(await withSpan("x", {}, async () => "value")).toBe("value");
  });

  it("marks the span as an error and rethrows when the callback throws", async () => {
    await expect(
      withSpan("agent.invoke", { "listing.id": "l1" }, async () => {
        throw new Error("port timeout");
      })
    ).rejects.toThrow("port timeout");

    const [span] = exporter.getFinishedSpans();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("nests child spans under their parent", async () => {
    await withSpan("watch.tick", { "watch.id": "w1" }, async () => {
      await withSpan(
        "scrape.trigger",
        { "watch.id": "w1" },
        async () => undefined
      );
    });

    const spans = exporter.getFinishedSpans();
    const parent = spans.find((s) => s.name === "watch.tick")!;
    const child = spans.find((s) => s.name === "scrape.trigger")!;
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });
});
