import { describe, it, expect } from "vitest";
import { searchResultRowSchema } from "@craigsnotice/types";
import { parseRows, isDegraded } from "../src/services/parse";

const good = (id: string) => ({
  post_id: id,
  title: `Item ${id}`,
  price: "$100",
  url: `https://sfbay.craigslist.org/x/${id}.html`,
});

const broken = { title: "no id", url: "https://sfbay.craigslist.org/x/z.html" };

describe("parseRows", () => {
  it("keeps every valid row and reports a zero violation rate", () => {
    const r = parseRows([good("1"), good("2")], searchResultRowSchema);
    expect(r.rows).toHaveLength(2);
    expect(r.violations).toBe(0);
    expect(r.violationRate).toBe(0);
    expect(r.sampleViolation).toBeNull();
  });

  it("drops invalid rows and computes the violation rate", () => {
    const r = parseRows(
      [good("1"), broken, broken, broken],
      searchResultRowSchema
    );
    expect(r.rows).toHaveLength(1);
    expect(r.violations).toBe(3);
    expect(r.total).toBe(4);
    expect(r.violationRate).toBeCloseTo(0.75);
  });

  it("captures the first violation message as a heal hint", () => {
    const r = parseRows([broken], searchResultRowSchema);
    expect(r.sampleViolation).toMatch(/post_id/);
  });

  it("returns a zero rate for an empty payload rather than NaN", () => {
    const r = parseRows([], searchResultRowSchema);
    expect(r.violationRate).toBe(0);
    expect(r.total).toBe(0);
  });

  it("treats every row as a violation when failure is injected", () => {
    const r = parseRows([good("1"), good("2")], searchResultRowSchema, true);
    expect(r.rows).toHaveLength(0);
    expect(r.violationRate).toBe(1);
    expect(r.sampleViolation).toMatch(/injected failure/);
  });
});

describe("isDegraded", () => {
  it("is false below the threshold", () =>
    expect(isDegraded(0.29, 0.3)).toBe(false));
  it("is false exactly at the threshold", () =>
    expect(isDegraded(0.3, 0.3)).toBe(false));
  it("is true above the threshold", () =>
    expect(isDegraded(0.31, 0.3)).toBe(true));
});
