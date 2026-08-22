import { describe, it, expect } from "vitest";
import { createWatchSchema } from "../schemas/requests";
import { searchResultRowSchema } from "../schemas/brightdata";
import { agentVerdictSchema } from "../schemas/agent";

describe("createWatchSchema", () => {
  const valid = { siteCode: "sfbay", categoryCode: "sya", query: "Mac Studio" };

  it("accepts a minimal watch", () => {
    expect(createWatchSchema.parse(valid)).toMatchObject(valid);
  });

  it("defaults intervalSec to 300", () => {
    expect(createWatchSchema.parse(valid).intervalSec).toBe(300);
  });

  it("accepts an optional target price", () => {
    expect(
      createWatchSchema.parse({ ...valid, targetPrice: 1200 }).targetPrice
    ).toBe(1200);
  });

  it("rejects a negative target price", () => {
    expect(
      createWatchSchema.safeParse({ ...valid, targetPrice: -1 }).success
    ).toBe(false);
  });

  it("rejects an empty query", () => {
    expect(createWatchSchema.safeParse({ ...valid, query: "" }).success).toBe(
      false
    );
  });

  it("rejects an interval below 60 seconds", () => {
    expect(
      createWatchSchema.safeParse({ ...valid, intervalSec: 5 }).success
    ).toBe(false);
  });
});

describe("searchResultRowSchema", () => {
  it("accepts a well-formed scraped row", () => {
    const row = {
      post_id: "77",
      title: "Mac Studio M2",
      price: "$1,200",
      url: "https://sfbay.craigslist.org/x/77.html",
    };
    const parsed = searchResultRowSchema.parse(row);
    expect(parsed.postId).toBe("77");
    expect(parsed.price).toBe(1200);
  });

  it("accepts a row with no price and yields null", () => {
    const row = {
      post_id: "78",
      title: "Free monitor",
      price: null,
      url: "https://sfbay.craigslist.org/x/78.html",
    };
    expect(searchResultRowSchema.parse(row).price).toBeNull();
  });

  it("rejects a row missing post_id", () => {
    expect(
      searchResultRowSchema.safeParse({ title: "x", url: "https://a.b/c" })
        .success
    ).toBe(false);
  });

  it("rejects a row whose url is not a url", () => {
    expect(
      searchResultRowSchema.safeParse({
        post_id: "79",
        title: "x",
        url: "not-a-url",
      }).success
    ).toBe(false);
  });
});

describe("agentVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    const v = {
      isGoodDeal: true,
      score: 82,
      reasoning: "30% under median",
      priceVsMedian: -0.3,
    };
    expect(agentVerdictSchema.parse(v)).toEqual(v);
  });

  it("rejects a score outside 0-100", () => {
    expect(
      agentVerdictSchema.safeParse({
        isGoodDeal: true,
        score: 140,
        reasoning: "x",
        priceVsMedian: 0,
      }).success
    ).toBe(false);
  });

  it("rejects a missing reasoning field", () => {
    expect(
      agentVerdictSchema.safeParse({
        isGoodDeal: true,
        score: 50,
        priceVsMedian: 0,
      }).success
    ).toBe(false);
  });
});
