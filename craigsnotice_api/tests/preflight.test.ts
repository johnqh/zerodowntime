import { describe, it, expect, vi } from "vitest";
import { preflight } from "../src/services/preflight";

describe("preflight", () => {
  it("passes when the bdata CLI is present", async () => {
    const probe = vi.fn(async () => true);
    const result = await preflight({ fixtures: false, probe });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(probe).toHaveBeenCalledWith("bdata");
  });

  it("warns, rather than failing, when the CLI is missing", async () => {
    const result = await preflight({
      fixtures: false,
      probe: async () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/self-healing will fail/i);
    expect(result.warnings[0]).toMatch(/@brightdata\/cli/);
  });

  it("does not check the CLI in fixtures mode, which never shells out", async () => {
    const probe = vi.fn(async () => false);
    const result = await preflight({ fixtures: true, probe });

    expect(result.ok).toBe(true);
    expect(probe).not.toHaveBeenCalled();
  });
});
