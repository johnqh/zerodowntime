import { describe, it, expect, vi } from "vitest";
import { CraigsnoticeClient, type NetworkClient } from "../craigsnotice-client";

const netWith = (
  payload: unknown
): NetworkClient & { request: ReturnType<typeof vi.fn> } => ({
  request: vi.fn().mockResolvedValue({ success: true, data: payload }),
});

describe("CraigsnoticeClient", () => {
  it("lists watches with a bearer token", async () => {
    const net = netWith([{ id: "w1" }]);
    const out = await new CraigsnoticeClient(
      net,
      "http://localhost:8022"
    ).listWatches("tok");

    expect(out).toEqual([{ id: "w1" }]);
    const [url, init] = net.request.mock.calls[0]!;
    expect(url).toBe("http://localhost:8022/api/v1/watches");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });

  it("posts a create-watch body", async () => {
    const net = netWith({ id: "w1" });
    await new CraigsnoticeClient(net, "http://localhost:8022").createWatch(
      "tok",
      {
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "Mac Studio",
        intervalSec: 300,
      }
    );

    const [url, init] = net.request.mock.calls[0]!;
    expect(url).toBe("http://localhost:8022/api/v1/watches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).query).toBe("Mac Studio");
  });

  it("posts feedback to the alert-scoped path", async () => {
    const net = netWith({});
    await new CraigsnoticeClient(net, "http://localhost:8022").sendFeedback(
      "tok",
      "a1",
      "bad"
    );

    expect(net.request.mock.calls[0]![0]).toBe(
      "http://localhost:8022/api/v1/alerts/a1/feedback"
    );
    expect(JSON.parse(net.request.mock.calls[0]![1].body as string)).toEqual({
      verdict: "bad",
    });
  });

  it("forces a cycle via run-now", async () => {
    const net = netWith({ runId: "r1", alerted: 1 });
    await new CraigsnoticeClient(net, "http://x").runWatch("tok", "w1");

    expect(net.request.mock.calls[0]![0]).toBe("http://x/api/v1/watches/w1/run");
    expect(net.request.mock.calls[0]![1].method).toBe("POST");
  });

  it("throws when the envelope reports failure", async () => {
    const net: NetworkClient = {
      request: vi
        .fn()
        .mockResolvedValue({ success: false, error: "watch not found" }),
    };
    await expect(
      new CraigsnoticeClient(net, "http://x").listWatches("tok")
    ).rejects.toThrow("watch not found");
  });
});
