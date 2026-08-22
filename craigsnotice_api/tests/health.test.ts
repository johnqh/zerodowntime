import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

describe("GET /health", () => {
  it("returns a success envelope with status ok", async () => {
    const res = await createApp({}).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { status: "ok" },
    });
  });
});
