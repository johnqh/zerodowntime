import { getMessaging } from "firebase-admin/messaging";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { createFirebaseVerifier } from "./services/firebase";
import { createBrightDataClient } from "./services/brightdata/client";
import { createPollingDelivery } from "./services/brightdata/delivery";
import { createPortClient } from "./services/port/client";
import {
  createDispatcher,
  createSseChannel,
  createSseHub,
} from "./services/notify/dispatcher";
import { createFcmChannel } from "./services/notify/fcm";
import {
  createFailureInjector,
  handleDegraded,
  type DegradedInfo,
} from "./services/selfheal";
import { createScheduler, type CycleDeps } from "./services/scheduler";
import { createSelfHealEmitter } from "./telemetry/events";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const verifier = createFirebaseVerifier();

const bd = createBrightDataClient(process.env.BRIGHTDATA_API_TOKEN ?? "");
const port = createPortClient({
  clientId: process.env.PORT_CLIENT_ID ?? "",
  clientSecret: process.env.PORT_CLIENT_SECRET ?? "",
});

const hub = createSseHub();
const dispatcher = createDispatcher([
  createFcmChannel(getMessaging(), db),
  createSseChannel(hub),
]);

const injector = createFailureInjector();

// Span event + severity-tagged log record + counter, all three.
const emit = createSelfHealEmitter();

const onHeal = (info: DegradedInfo) =>
  handleDegraded({ db, bd, port, emit }, info);

const cycleDeps: CycleDeps = {
  db,
  bd,
  port,
  delivery: createPollingDelivery(bd),
  searchCollectorId: process.env.BRIGHTDATA_SEARCH_COLLECTOR ?? "",
  detailCollectorId: process.env.BRIGHTDATA_DETAIL_COLLECTOR ?? "",
  agentId: process.env.PORT_DEAL_AGENT_ID ?? "",
  minBaselineSamples: config.minBaselineSamples,
  violationRateThreshold: config.violationRateThreshold,
  dispatcher,
  injector,
  onDegraded: async (info) => {
    await onHeal(info);
  },
};

const app = createApp({
  db,
  verifier,
  port,
  hub,
  cycleDeps,
  injector,
  debugToken: config.debugToken,
  onHeal,
});

const scheduler = createScheduler(cycleDeps, db);
scheduler.start();

const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(
  `craigsnotice_api listening on :${config.port} (${config.demoMode})`
);

const shutdown = async (): Promise<void> => {
  scheduler.stop();
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
