import { describe, it, expect } from "vitest";
import {
  buildCraigslistSearchUrl,
  InvalidWatchTargetError,
} from "../craigslist/url";

describe("buildCraigslistSearchUrl", () => {
  const cases: Array<
    [string, Parameters<typeof buildCraigslistSearchUrl>[0], string]
  > = [
    [
      "site + category + query",
      { siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio" },
      "https://sfbay.craigslist.org/search/sya?query=Mac+Studio",
    ],
    [
      "subarea is inserted before the category",
      {
        siteCode: "sfbay",
        subarea: "sfc",
        categoryCode: "sya",
        query: "Mac Studio",
      },
      "https://sfbay.craigslist.org/search/sfc/sya?query=Mac+Studio",
    ],
    [
      "special characters are percent-encoded",
      { siteCode: "newyork", categoryCode: "ela", query: "Sony A7 & lens" },
      "https://newyork.craigslist.org/search/ela?query=Sony+A7+%26+lens",
    ],
    [
      "query whitespace is trimmed and collapsed",
      { siteCode: "sfbay", categoryCode: "sss", query: "  herman   miller  " },
      "https://sfbay.craigslist.org/search/sss?query=herman+miller",
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => expect(buildCraigslistSearchUrl(input)).toBe(expected));
  }

  it("rejects an unknown site", () => {
    expect(() =>
      buildCraigslistSearchUrl({
        siteCode: "atlantis",
        categoryCode: "sya",
        query: "x",
      })
    ).toThrow(InvalidWatchTargetError);
  });

  it("rejects an unknown category", () => {
    expect(() =>
      buildCraigslistSearchUrl({
        siteCode: "sfbay",
        categoryCode: "zzz",
        query: "x",
      })
    ).toThrow(InvalidWatchTargetError);
  });

  it("rejects a subarea that does not belong to the site", () => {
    expect(() =>
      buildCraigslistSearchUrl({
        siteCode: "newyork",
        subarea: "sfc",
        categoryCode: "sya",
        query: "x",
      })
    ).toThrow(InvalidWatchTargetError);
  });

  it("rejects an empty query", () => {
    expect(() =>
      buildCraigslistSearchUrl({
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "   ",
      })
    ).toThrow(InvalidWatchTargetError);
  });
});
