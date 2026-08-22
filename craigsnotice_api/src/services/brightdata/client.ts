const BASE = "https://api.brightdata.com";

export interface Snapshot {
  status: "building" | "ready";
  rows: unknown[] | null;
}

export interface BrightDataClient {
  /**
   * `deliverTo` makes Bright Data POST the finished rows to that URL instead
   * of us polling for them.
   */
  trigger(
    collectorId: string,
    inputs: Array<{ url: string }>,
    deliverTo?: string
  ): Promise<string>;
  fetchSnapshot(snapshotId: string): Promise<Snapshot>;
  heal(collectorId: string, prompt: string): Promise<void>;
}

/**
 * Scraper Studio's REST surface: POST /dca/trigger queues inputs and returns a
 * snapshot id; GET /dca/dataset?id= returns {status:"building"} until the rows
 * are ready, then a plain JSON array.
 */
export interface HealResultRaw {
  exitCode: number;
  output: string;
}

/** Injected so tests never shell out. */
export type HealRunner = (
  collectorId: string,
  prompt: string
) => Promise<HealResultRaw>;

/**
 * `bdata scraper heal <collector_id> <prompt>` — the AI re-derives selectors
 * from a plain-language description of what broke.
 */
export const cliHealRunner: HealRunner = async (collectorId, prompt) => {
  const proc = Bun.spawn(["bdata", "scraper", "heal", collectorId, prompt], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  return { exitCode, output: `${stdout}\n${stderr}`.trim() };
};

export const createBrightDataClient = (
  token: string,
  fetchImpl: typeof fetch = fetch,
  healRunner: HealRunner = cliHealRunner
): BrightDataClient => {
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  return {
    async trigger(collectorId, inputs, deliverTo) {
      const params = new URLSearchParams({
        collector: collectorId,
        queue_next: "1",
      });
      if (deliverTo) params.set("endpoint", deliverTo);

      const res = await fetchImpl(`${BASE}/dca/trigger?${params.toString()}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(inputs),
      });
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
     * Self-heal has no REST surface — POST /dca/collector/:id/heal 404s. The
     * real mechanism is the CLI, so this shells out. Callers only ever see the
     * interface, so nothing downstream changes.
     */
    async heal(collectorId, prompt) {
      const result = await healRunner(collectorId, prompt);
      if (result.exitCode !== 0) {
        throw new Error(
          `bright data heal failed (exit ${result.exitCode}): ${result.output.slice(0, 300)}`
        );
      }
    },
  };
};
