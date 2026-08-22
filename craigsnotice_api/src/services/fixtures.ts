import searchResults from "../fixtures/search-results.json" with { type: "json" };
import listingDetails from "../fixtures/listing-details.json" with { type: "json" };
import agentVerdicts from "../fixtures/agent-verdicts.json" with { type: "json" };
import type { BrightDataClient } from "./brightdata/client";
import type { Blueprint, PortClient } from "./port/client";
import type { TokenVerifier } from "../middleware/firebaseAuth";
import type { NotificationChannel } from "./notify/dispatcher";

/**
 * DEMO_MODE=fixtures swaps only the two external boundaries. The entire
 * pipeline — ingest, baseline, judgment, alerts, notifications, spans,
 * metrics, self-heal — runs identically with zero network calls.
 */
export const createFixtureBrightData = (): BrightDataClient => {
  const snapshots = new Map<string, unknown[]>();
  let counter = 0;

  return {
    async trigger(collectorId) {
      const id = `fixture_${++counter}`;
      snapshots.set(
        id,
        collectorId.includes("detail")
          ? (listingDetails as unknown[])
          : (searchResults as unknown[])
      );
      return id;
    },

    async fetchSnapshot(snapshotId) {
      const rows = snapshots.get(snapshotId);
      return rows ? { status: "ready", rows } : { status: "building", rows: null };
    },

    async heal(collectorId, prompt) {
      console.log(`[fixtures] heal ${collectorId}: ${prompt}`);
    },
  };
};

export const createFixturePort = (): PortClient => {
  const verdicts = agentVerdicts as unknown[];
  let index = 0;

  return {
    async upsertEntity(blueprint: string, identifier: string) {
      console.log(`[fixtures] port upsert ${blueprint}/${identifier}`);
    },

    async patchEntity(blueprint: string, identifier: string) {
      console.log(`[fixtures] port patch ${blueprint}/${identifier}`);
    },

    async invokeAgent() {
      const verdict = verdicts[index % verdicts.length];
      index += 1;
      // Shaped like a real agent reply: fenced JSON inside the execution stream.
      return "```json\n" + JSON.stringify(verdict) + "\n```";
    },

    async upsertBlueprint(blueprint: Blueprint) {
      console.log(`[fixtures] port blueprint ${blueprint.identifier}`);
    },
  };
};

/**
 * Accepts any bearer token and maps it to one demo user, so the whole app is
 * reachable with no Firebase project. Never reachable outside DEMO_MODE=fixtures.
 */
export const createFixtureVerifier = (): TokenVerifier => ({
  verify: async (idToken) => {
    if (!idToken) throw new Error("missing token");
    return { uid: "fixture-user", email: "demo@craigsnotice.dev" };
  },
});

/** Logs instead of calling FCM, so no Firebase credentials are needed. */
export const createFixtureFcmChannel = (): NotificationChannel => ({
  name: "fcm",
  async send(userId, alert) {
    console.log(`[fixtures] fcm -> ${userId}: ${alert.title}`);
  },
});

export const FIXTURE_SEARCH_COLLECTOR = "fixture-search-collector";
export const FIXTURE_DETAIL_COLLECTOR = "fixture-detail-collector";
