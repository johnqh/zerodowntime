import { Hono } from "hono";
import health from "./routes/health";
import {
  createFirebaseAuth,
  type TokenVerifier,
} from "./middleware/firebaseAuth";
import { createWatchesRouter } from "./routes/watches";
import type { Db } from "./db";

export interface AppDeps {
  db?: Db;
  verifier?: TokenVerifier;
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  app.route("/health", health);
  app.route("/", health);

  if (deps.db && deps.verifier) {
    const auth = createFirebaseAuth(deps.verifier, deps.db);
    app.use("/api/v1/watches", auth);
    app.use("/api/v1/watches/*", auth);
    app.route("/api/v1/watches", createWatchesRouter(deps.db));
  }

  return app;
};
