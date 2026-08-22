import { describe, it, expect, vi } from "vitest";
import {
  createSseHub,
  createDispatcher,
  type NotificationChannel,
  type AlertPayload,
} from "../src/services/notify/dispatcher";

const alert: AlertPayload = {
  alertId: "a1",
  watchId: "w1",
  title: "Mac Studio M2 Max",
  price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html",
  score: 88,
  reasoning: "34% under median",
  priceVsMedian: -0.34,
};

describe("createSseHub", () => {
  it("reports zero subscribers before anyone connects", () => {
    expect(createSseHub().subscriberCount("u1")).toBe(0);
  });

  it("delivers a published alert to a subscriber", async () => {
    const hub = createSseHub();
    const reader = hub.subscribe("u1").getReader();
    expect(hub.subscriberCount("u1")).toBe(1);

    // first frame is the ": connected" comment
    await reader.read();
    hub.publish("u1", alert);

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: deal-alert");
    expect(text).toContain("Mac Studio M2 Max");
  });

  it("does not deliver another user's alert", async () => {
    const hub = createSseHub();
    hub.subscribe("u1").getReader();
    hub.publish("u2", alert);
    expect(hub.subscriberCount("u2")).toBe(0);
  });

  it("drops only the cancelling subscriber", async () => {
    const hub = createSseHub();
    const a = hub.subscribe("u1").getReader();
    hub.subscribe("u1").getReader();
    expect(hub.subscriberCount("u1")).toBe(2);

    await a.cancel();
    expect(hub.subscriberCount("u1")).toBe(1);
  });
});

describe("createDispatcher", () => {
  it("sends through every channel", async () => {
    const calls: string[] = [];
    const chan = (name: "fcm" | "sse"): NotificationChannel => ({
      name,
      send: async () => {
        calls.push(name);
      },
    });

    await createDispatcher([chan("fcm"), chan("sse")]).dispatch("u1", alert);
    expect(calls).toEqual(["fcm", "sse"]);
  });

  it("still sends through the second channel when the first throws", async () => {
    const sse = vi.fn(async () => {});
    const channels: NotificationChannel[] = [
      {
        name: "fcm",
        send: async () => {
          throw new Error("no fcm token");
        },
      },
      { name: "sse", send: sse },
    ];

    await expect(
      createDispatcher(channels).dispatch("u1", alert)
    ).resolves.toBeUndefined();
    expect(sse).toHaveBeenCalledOnce();
  });
});
