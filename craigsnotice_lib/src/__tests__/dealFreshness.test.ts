import { describe, it, expect } from "vitest";
import {
  isNewDeal,
  relativeTime,
  foundAtLabel,
  NEW_DEAL_WINDOW_MS,
} from "../utils/dealFreshness";

const NOW = new Date("2026-08-22T20:00:00Z").getTime();
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isNewDeal", () => {
  it("is new when found within the last two hours", () => {
    expect(isNewDeal({ createdAt: iso(60 * 60 * 1000), now: NOW })).toBe(true);
  });

  it("is not new when found long ago and no run info is available", () => {
    expect(
      isNewDeal({ createdAt: iso(NEW_DEAL_WINDOW_MS + 60_000), now: NOW })
    ).toBe(false);
  });

  it("is new when the most recent run surfaced it, even if older than two hours", () => {
    expect(
      isNewDeal({
        createdAt: iso(5 * 60 * 60 * 1000),
        lastRunAt: iso(6 * 60 * 60 * 1000),
        now: NOW,
      })
    ).toBe(true);
  });

  it("is not new when it predates the most recent run and the window", () => {
    expect(
      isNewDeal({
        createdAt: iso(9 * 60 * 60 * 1000),
        lastRunAt: iso(6 * 60 * 60 * 1000),
        now: NOW,
      })
    ).toBe(false);
  });

  it("is exactly at the boundary inclusive", () => {
    expect(
      isNewDeal({ createdAt: iso(NEW_DEAL_WINDOW_MS), now: NOW })
    ).toBe(true);
  });

  it("never throws on an unparseable timestamp", () => {
    expect(isNewDeal({ createdAt: "not-a-date", now: NOW })).toBe(false);
  });
});

describe("relativeTime", () => {
  it.each([
    [30 * 1000, "just now"],
    [12 * 60 * 1000, "12m ago"],
    [3 * 60 * 60 * 1000, "3h ago"],
    [2 * 86400 * 1000, "2d ago"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(relativeTime(iso(ms), NOW)).toBe(expected);
  });

  it("handles a null timestamp", () => {
    expect(relativeTime(null, NOW)).toBe("unknown");
  });
});

describe("foundAtLabel", () => {
  it("renders an absolute stamp", () => {
    expect(foundAtLabel("2026-08-22T14:05:00Z")).toMatch(/Aug/);
  });

  it("returns empty for an invalid date rather than 'Invalid Date'", () => {
    expect(foundAtLabel("nope")).toBe("");
  });
});
