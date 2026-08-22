import { describe, it, expect } from "vitest";
import {
  SITES,
  CATEGORIES,
  getSite,
  getCategory,
} from "../craigslist/reference";

describe("craigslist reference data", () => {
  it("has a realistic number of US sites", () => {
    expect(SITES.length).toBeGreaterThan(300);
  });

  it("has unique site codes", () => {
    expect(new Set(SITES.map((s) => s.code)).size).toBe(SITES.length);
  });

  it("has valid coordinates for every site", () => {
    for (const s of SITES) {
      expect(s.lat).toBeGreaterThan(17);
      expect(s.lat).toBeLessThan(72);
      expect(s.lng).toBeGreaterThan(-180);
      expect(s.lng).toBeLessThan(-64);
      expect(s.name.trim()).not.toBe("");
      expect(s.state.trim()).not.toBe("");
    }
  });

  it("includes sfbay with its subareas", () => {
    const sf = getSite("sfbay");
    expect(sf).toBeDefined();
    expect(sf!.subareas.map((a) => a.code).sort()).toEqual([
      "eby",
      "nby",
      "pen",
      "sby",
      "scz",
      "sfc",
    ]);
  });

  it("has unique category codes and includes the for-sale staples", () => {
    expect(new Set(CATEGORIES.map((c) => c.code)).size).toBe(CATEGORIES.length);
    for (const code of ["sss", "sya", "ela", "msa", "bia"]) {
      expect(getCategory(code), `missing category ${code}`).toBeDefined();
    }
  });

  it("has a non-empty label for every category", () => {
    for (const c of CATEGORIES) expect(c.label.trim()).not.toBe("");
  });
});
