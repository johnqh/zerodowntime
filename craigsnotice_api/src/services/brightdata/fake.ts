import type { BrightDataClient, Snapshot } from "./client";

export interface FakeBrightData extends BrightDataClient {
  readonly healCalls: Array<{ collectorId: string; prompt: string }>;
  /** Rows the next trigger() will resolve to, after `buildingTicks` polls. */
  queue(snapshotId: string, rows: unknown[], buildingTicks?: number): void;
}

export const createFakeBrightData = (): FakeBrightData => {
  const queued = new Map<string, { rows: unknown[]; ticksLeft: number }>();
  const healCalls: Array<{ collectorId: string; prompt: string }> = [];
  let counter = 0;
  let pendingRows: unknown[] = [];
  let pendingTicks = 0;

  return {
    healCalls,

    queue(snapshotId, rows, buildingTicks = 0) {
      queued.set(snapshotId, { rows, ticksLeft: buildingTicks });
      pendingRows = rows;
      pendingTicks = buildingTicks;
    },

    async trigger() {
      const id = `snap_${++counter}`;
      queued.set(id, { rows: pendingRows, ticksLeft: pendingTicks });
      return id;
    },

    async fetchSnapshot(snapshotId): Promise<Snapshot> {
      const entry = queued.get(snapshotId);
      if (!entry) return { status: "building", rows: null };
      if (entry.ticksLeft > 0) {
        entry.ticksLeft -= 1;
        return { status: "building", rows: null };
      }
      return { status: "ready", rows: entry.rows };
    },

    async heal(collectorId, prompt) {
      healCalls.push({ collectorId, prompt });
    },
  };
};
