import { describe, it, expect, vi } from "vitest";
import { createFakeBrightData } from "../src/services/brightdata/fake";
import {
  createPollingDelivery,
  SnapshotTimeoutError,
} from "../src/services/brightdata/delivery";

const noSleep = async (): Promise<void> => {};

describe("createPollingDelivery", () => {
  it("returns rows immediately when the snapshot is already ready", async () => {
    const bd = createFakeBrightData();
    bd.queue("snap_1", [{ post_id: "1" }]);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);

    const rows = await createPollingDelivery(bd, { sleep: noSleep }).await(id);
    expect(rows).toEqual([{ post_id: "1" }]);
  });

  it("polls until the snapshot stops building", async () => {
    const bd = createFakeBrightData();
    bd.queue("ignored", [{ post_id: "9" }], 3);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);
    const sleep = vi.fn(noSleep);

    const rows = await createPollingDelivery(bd, { sleep }).await(id);
    expect(rows).toEqual([{ post_id: "9" }]);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("throws SnapshotTimeoutError once the deadline passes", async () => {
    const bd = createFakeBrightData();
    bd.queue("ignored", [{ post_id: "9" }], 1000);
    const id = await bd.trigger("c1", [{ url: "https://a.b/c" }]);

    const delivery = createPollingDelivery(bd, {
      sleep: noSleep,
      intervalMs: 5000,
      timeoutMs: 20000,
    });
    await expect(delivery.await(id)).rejects.toThrow(SnapshotTimeoutError);
  });
});
