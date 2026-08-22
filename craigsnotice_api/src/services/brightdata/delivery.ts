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
 * Same interface, fed by POST /api/v1/hooks/brightdata instead of polling.
 * Enable by constructing this instead of createPollingDelivery in index.ts;
 * no caller changes.
 */
export interface WebhookStore {
  waitFor(snapshotId: string, timeoutMs: number): Promise<unknown[]>;
  resolve(snapshotId: string, rows: unknown[]): void;
}

export const createWebhookDelivery = (
  store: WebhookStore,
  timeoutMs = 300000
): ResultDelivery => ({
  await: (snapshotId) => store.waitFor(snapshotId, timeoutMs),
});
