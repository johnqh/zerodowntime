import { describe, it, expect } from "vitest";
import {
  titleCouldMatchQuery,
  significantTokens,
} from "../craigslist/relevance";

describe("significantTokens", () => {
  it("drops stopwords and punctuation", () => {
    expect(significantTokens("Apple Mac Mini (Late 2014) – Core i5")).toEqual([
      "apple",
      "mac",
      "mini",
      "late",
      "2014",
      "core",
      "i5",
    ]);
  });

  it("drops filler that Craigslist titles are full of", () => {
    expect(significantTokens("Like new Mac mini")).toEqual(["mac", "mini"]);
  });
});

describe("titleCouldMatchQuery", () => {
  // Real titles captured from a live sfbay "Mac mini" search.
  const shouldPass = [
    "Apple Mac Mini A1347 (Late 2014) – Core i5 1.4GHz, 4GB RAM",
    "Apple Mac Mini M1 Desktop Bundle with Keyboard & Extras",
    "Mac Mini M4",
    "Apple Mac mini Late 2014 – 3.0GHz i7 / 16GB RAM / 256GB SSD",
    "2014 Mac Mini 2.6Ghz i5 8GB RAM 1TB HDD. A1347",
  ];

  const shouldReject = [
    "Dell XPS 15.6 9570 Laptop, I7-8750 16GB/512 GB SSD, 4K Display",
    "Like new Samsung Galaxy Book4 Pro 360 laptop",
    "HP Spectre X360 Convertible Laptop, i7/16GB/1TGB SSD",
    'Apple 24" Cinema Display (CD02)',
    "Christie LW502 3LCD Projector",
    "MacBook Pro 16 inch M1 Max",
  ];

  for (const title of shouldPass) {
    it(`passes: ${title.slice(0, 40)}`, () =>
      expect(titleCouldMatchQuery("Mac mini", title)).toBe(true));
  }

  for (const title of shouldReject) {
    it(`rejects: ${title.slice(0, 40)}`, () =>
      expect(titleCouldMatchQuery("Mac mini", title)).toBe(false));
  }

  it("does not let a prefix match a different product line", () => {
    // "mac" must not be satisfied by "macbook" alone without "mini".
    expect(titleCouldMatchQuery("Mac mini", "MacBook Air M2")).toBe(false);
  });

  it("allows a longer word to satisfy a query token", () => {
    expect(titleCouldMatchQuery("studio", "Mac Studio's original box")).toBe(
      true
    );
  });

  it("passes everything when the query has no significant tokens", () => {
    expect(titleCouldMatchQuery("the", "Anything at all")).toBe(true);
  });

  it("rejects an empty title", () => {
    expect(titleCouldMatchQuery("Mac mini", "")).toBe(false);
  });
});
