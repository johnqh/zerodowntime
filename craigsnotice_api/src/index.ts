import { getMessaging } from "firebase-admin/messaging";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb, scraperConfigs } from "./db";
import { mirrorScraperConfig, safeMirror } from "./services/port/mirror";
import { metrics } from "./telemetry/metrics";
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
import {
  createFixtureBrightData,
  createFixtureFcmChannel,
  createFixturePort,
  createFixtureVerifier,
  FIXTURE_DETAIL_COLLECTOR,
  FIXTURE_SEARCH_COLLECTOR,
} from "./services/fixtures";
import { createSelfHealEmitter } from "./telemetry/events";

const config = loadConfig();
const db = createDb(config.databaseUrl);

// Fixtures mode swaps only the external boundaries; everything between them
// is the same code path. It must boot with no third-party credentials at all.
const fixtures = config.demoMode === "fixtures";

/**
 * Without a Firebase project there is nothing to verify against. Outside
 * production we fall back to the fixture verifier so the pipeline can be run
 * live against real Bright Data and Port before Firebase is set up.
 */
const hasFirebase = !!process.env.FIREBASE_PROJECT_ID;
const devAuthFallback =
  !fixtures && !hasFirebase && process.env.NODE_ENV !== "production";

if (devAuthFallback) {
  console.warn(
    "[craigsnotice] no FIREBASE_PROJECT_ID — accepting any bearer token. " +
      "Never do this in production."
  );
}

const verifier =
  fixtures || devAuthFallback
    ? createFixtureVerifier()
    : createFirebaseVerifier();

const bd = fixtures
  ? createFixtureBrightData()
  : createBrightDataClient(
      process.env.BRIGHTDATA_API_TOKEN ?? process.env.BRIGHTDATA_API_KEY ?? ""
    );

const port = fixtures
  ? createFixturePort()
  : createPortClient({
      clientId: process.env.PORT_CLIENT_ID ?? "",
      clientSecret: process.env.PORT_CLIENT_SECRET ?? "",
      ...(process.env.PORT_API_BASE
        ? { baseUrl: process.env.PORT_API_BASE }
        : {}),
    });

const hub = createSseHub();
const dispatcher = createDispatcher([
  fixtures || !hasFirebase
    ? createFixtureFcmChannel()
    : createFcmChannel(getMessaging(), db),
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
  searchCollectorId: fixtures
    ? FIXTURE_SEARCH_COLLECTOR
    : (process.env.BRIGHTDATA_SEARCH_COLLECTOR ?? ""),
  detailCollectorId: fixtures
    ? FIXTURE_DETAIL_COLLECTOR
    : (process.env.BRIGHTDATA_DETAIL_COLLECTOR ?? ""),
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

/**
 * Port rejects an entity whose relation targets are missing, so the scraper
 * configs have to exist in the catalog before the first scrape run mirrors.
 */
const seedScraperEntities = async (): Promise<void> => {
  const configs = await db.select().from(scraperConfigs);
  for (const cfg of configs) {
    await safeMirror(() => mirrorScraperConfig(port, cfg));
    metrics.recordScraperHealth(
      cfg.id,
      cfg.bdCollectorId,
      cfg.health === "healthy"
    );
  }
  console.log(`[craigsnotice] seeded ${configs.length} scraper entities`);
};

await seedScraperEntities();

const scheduler = createScheduler(cycleDeps, db);
scheduler.start();

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // SSE streams must not be reaped as idle.
  idleTimeout: 255,
});
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
