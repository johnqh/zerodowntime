import { describe, it, expect } from "vitest";
import { successResponse, errorResponse } from "../response";

describe("response envelope", () => {
  it("wraps data in a success envelope", () => {
    expect(successResponse({ id: "w1" })).toEqual({
      success: true,
      data: { id: "w1" },
    });
  });

  it("wraps a message in an error envelope with no data key", () => {
    const r = errorResponse("watch not found");
    expect(r).toEqual({ success: false, error: "watch not found" });
    expect("data" in r).toBe(false);
  });
});
