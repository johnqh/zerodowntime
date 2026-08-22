import { describe, it, expect } from "vitest";
import {
  parseSseFrames,
  executionText,
  extractJsonObject,
  AgentStreamError,
} from "../src/services/port/sse";

// Captured verbatim from a live POST /v1/agent/:id/invoke.
const LIVE_STREAM = [
  "event: conversationIdentifier",
  "data: fd0c0ded-f2c6-44ca-9fb8-a621a9968266",
  "",
  "event: invocationIdentifier",
  "data: e6580e6d-89f0-4031-8b37-86af66c6f8e6",
  "",
  "event: thinkingDone",
  'data: {"durationMs":1331}',
  "",
  "event: execution",
  'data: ```json\\n{"isGoodD',
  "",
  "event: execution",
  'data: eal": false, "score": 40, "reasoning": "Above median.", "priceVsMedian": 0.129}\\n```',
  "",
  "event: done",
  'data: {"contextUsage":{"percentage":1.2}}',
  "",
  "",
].join("\n");

describe("parseSseFrames", () => {
  it("reads every frame from the live stream", () => {
    const names = parseSseFrames(LIVE_STREAM).map((f) => f.event);
    expect(names).toEqual([
      "conversationIdentifier",
      "invocationIdentifier",
      "thinkingDone",
      "execution",
      "execution",
      "done",
    ]);
  });

  it("returns no frames for an empty body", () => {
    expect(parseSseFrames("")).toEqual([]);
  });
});

describe("executionText", () => {
  it("concatenates chunked execution frames into one reply", () => {
    const text = executionText(LIVE_STREAM);
    expect(text).toContain('"isGoodDeal": false');
    expect(text).toContain('"score": 40');
  });

  it("unescapes the \\n that SSE data lines cannot carry raw", () => {
    expect(executionText(LIVE_STREAM)).toContain("```json\n{");
  });

  it("returns an empty string when the agent produced no execution frames", () => {
    expect(executionText("event: waiting\ndata: null\n\n")).toBe("");
  });
});

describe("extractJsonObject", () => {
  it("parses the fenced JSON a real agent replies with", () => {
    const v = extractJsonObject(executionText(LIVE_STREAM)) as {
      isGoodDeal: boolean;
      score: number;
      priceVsMedian: number;
    };
    expect(v.isGoodDeal).toBe(false);
    expect(v.score).toBe(40);
    expect(v.priceVsMedian).toBeCloseTo(0.129);
  });

  it("parses bare JSON with no fence", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("ignores prose surrounding the object", () => {
    expect(
      extractJsonObject('Sure! Here you go:\n{"a":1}\nHope that helps.')
    ).toEqual({ a: 1 });
  });

  it("throws when the reply carries no JSON object", () => {
    expect(() => extractJsonObject("I could not decide.")).toThrow(
      AgentStreamError
    );
  });

  it("throws when the object is malformed", () => {
    expect(() => extractJsonObject('```json\n{"a": }\n```')).toThrow(
      AgentStreamError
    );
  });

  it("throws on an empty reply", () => {
    expect(() => extractJsonObject("")).toThrow(AgentStreamError);
  });
});
