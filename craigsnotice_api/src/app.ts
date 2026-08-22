import { Hono } from "hono";
import health from "./routes/health";
import {
  createFirebaseAuth,
  type TokenVerifier,
} from "./middleware/firebaseAuth";
import { createWatchesRouter } from "./routes/watches";
import {
  createAlertsRouter,
  createUsersRouter,
  promoteQueryToken,
} from "./routes/alerts";
import { createFeedbackRouter } from "./routes/feedback";
import { createSseHub, type SseHub } from "./services/notify/dispatcher";
import type { Db } from "./db";
import type { PortClient } from "./services/port/client";

export interface AppDeps {
  db?: Db;
  verifier?: TokenVerifier;
  port?: PortClient;
  hub?: SseHub;
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();
  app.route("/health", health);
  app.route("/", health);

  if (deps.db && deps.verifier) {
    const auth = createFirebaseAuth(deps.verifier, deps.db);
    const hub = deps.hub ?? createSseHub();

    app.use("/api/v1/watches", auth);
    app.use("/api/v1/watches/*", auth);
    app.route("/api/v1/watches", createWatchesRouter(deps.db, deps.port));

    // EventSource cannot send headers; promote ?token= before auth runs.
    app.use("/api/v1/alerts/stream", promoteQueryToken);
    app.use("/api/v1/alerts", auth);
    app.use("/api/v1/alerts/*", auth);
    app.route("/api/v1/alerts", createAlertsRouter(deps.db, hub));

    if (deps.port) {
      app.route("/api/v1/alerts", createFeedbackRouter(deps.db, deps.port));
    }

    app.use("/api/v1/users/*", auth);
    app.route("/api/v1/users", createUsersRouter(deps.db));
  }

  return app;
};
