const BASE = "https://api.brightdata.com";

export interface Snapshot {
  status: "building" | "ready";
  rows: unknown[] | null;
}

export interface BrightDataClient {
  trigger(collectorId: string, inputs: Array<{ url: string }>): Promise<string>;
  fetchSnapshot(snapshotId: string): Promise<Snapshot>;
  heal(collectorId: string, prompt: string): Promise<void>;
}

/**
 * Scraper Studio's REST surface: POST /dca/trigger queues inputs and returns a
 * snapshot id; GET /dca/dataset?id= returns {status:"building"} until the rows
 * are ready, then a plain JSON array.
 */
export const createBrightDataClient = (
  token: string,
  fetchImpl: typeof fetch = fetch
): BrightDataClient => {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  return {
    async trigger(collectorId, inputs) {
      const res = await fetchImpl(
        `${BASE}/dca/trigger?collector=${collectorId}&queue_next=1`,
        { method: "POST", headers: authHeaders, body: JSON.stringify(inputs) }
      );
      if (!res.ok) {
        throw new Error(`bright data trigger failed: ${res.status}`);
      }

      const body = (await res.json()) as { collection_id?: string };
      if (!body.collection_id) {
        throw new Error("bright data trigger returned no collection_id");
      }
      return body.collection_id;
    },

    async fetchSnapshot(snapshotId) {
      const res = await fetchImpl(`${BASE}/dca/dataset?id=${snapshotId}`, {
        headers: authHeaders,
      });
      if (!res.ok) {
        throw new Error(`bright data snapshot fetch failed: ${res.status}`);
      }

      const body = (await res.json()) as unknown;
      if (Array.isArray(body)) return { status: "ready", rows: body };
      return { status: "building", rows: null };
    },

    /**
     * Plain-language self-heal. If the REST endpoint proves unavailable, swap
     * this one method's body for `bdata scraper heal <id> --prompt "..."` via
     * Bun.$ — callers only ever see the interface.
     */
    async heal(collectorId, prompt) {
      const res = await fetchImpl(`${BASE}/dca/collector/${collectorId}/heal`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`bright data heal failed: ${res.status}`);
    },
  };
};
