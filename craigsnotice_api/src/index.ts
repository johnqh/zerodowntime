import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { createFirebaseVerifier } from "./services/firebase";

const config = loadConfig();

const app = createApp({
  db: createDb(config.databaseUrl),
  verifier: createFirebaseVerifier(),
});

const server = Bun.serve({ port: config.port, fetch: app.fetch });
console.log(
  `craigsnotice_api listening on :${config.port} (${config.demoMode})`
);

const shutdown = async (): Promise<void> => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
