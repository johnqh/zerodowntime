import type { BrightDataClient } from "./client";

export class SnapshotTimeoutError extends Error {
  constructor(snapshotId: string, timeoutMs: number) {
    super(`snapshot ${snapshotId} not ready after ${timeoutMs}ms`);
    this.name = "SnapshotTimeoutError";
  }
}

export interface ResultDelivery {
  await(snapshotId: string): Promise<unknown[]>;
}

export interface PollingOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const createPollingDelivery = (
  client: BrightDataClient,
  opts: PollingOptions = {}
): ResultDelivery => {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 300000;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);

  return {
    async await(snapshotId) {
      for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
        const snap = await client.fetchSnapshot(snapshotId);
        if (snap.status === "ready" && snap.rows) return snap.rows;
        await sleep(intervalMs);
      }
      throw new SnapshotTimeoutError(snapshotId, timeoutMs);
    },
  };
};

/**
 * Bright Data pushes results to us instead of us polling: /dca/trigger takes
 * an `endpoint=` param and POSTs to it when the run finishes. Bright Data
 * drives the flow; we only say what to scrape.
 */
export interface WebhookStore {
  waitFor(snapshotId: string, timeoutMs: number): Promise<unknown[]>;
  /** Called by the webhook route when Bright Data reports a run finished. */
  resolve(snapshotId: string, rows: unknown[]): boolean;
  fail(snapshotId: string, reason: string): boolean;
  pending(): number;
}

interface Waiter {
  resolve(rows: unknown[]): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export const createWebhookStore = (): WebhookStore => {
  const waiters = new Map<string, Waiter>();

  return {
    waitFor(snapshotId, timeoutMs) {
      return new Promise<unknown[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(snapshotId);
          reject(new SnapshotTimeoutError(snapshotId, timeoutMs));
        }, timeoutMs);
        // Never hold the process open waiting on a webhook.
        (timer as unknown as { unref?: () => void }).unref?.();

        waiters.set(snapshotId, { resolve, reject, timer });
      });
    },

    resolve(snapshotId, rows) {
      const waiter = waiters.get(snapshotId);
      if (!waiter) return false;
      clearTimeout(waiter.timer);
      waiters.delete(snapshotId);
      waiter.resolve(rows);
      return true;
    },

    fail(snapshotId, reason) {
      const waiter = waiters.get(snapshotId);
      if (!waiter) return false;
      clearTimeout(waiter.timer);
      waiters.delete(snapshotId);
      waiter.reject(new Error(`bright data reported failure: ${reason}`));
      return true;
    },

    pending: () => waiters.size,
  };
};

export const createWebhookDelivery = (
  store: WebhookStore,
  timeoutMs = 600000
): ResultDelivery => ({
  await: (snapshotId) => store.waitFor(snapshotId, timeoutMs),
});
