import { Hono } from "hono";
import { cors } from "hono/cors";
import health from "./routes/health";
import {
  createFirebaseAuth,
  type TokenVerifier,
} from "./middleware/firebaseAuth";
import { createWatchesRouter } from "./routes/watches";
import {
  createAlertsRouter,
  createAlertStreamRouter,
  createUsersRouter,
} from "./routes/alerts";
import {
  createStreamTicketStore,
  type StreamTicketStore,
} from "./services/streamTickets";
import { createFeedbackRouter } from "./routes/feedback";
import { createDebugRouter } from "./routes/debug";
import { createHooksRouter, type HealHandler } from "./routes/hooks";
import { createSseHub, type SseHub } from "./services/notify/dispatcher";
import type { CycleDeps } from "./services/scheduler";
import type { FailureInjector } from "./services/selfheal";
import type { Db } from "./db";
import type { PortClient } from "./services/port/client";

export interface AppDeps {
  db?: Db;
  verifier?: TokenVerifier;
  port?: PortClient;
  hub?: SseHub;
  cycleDeps?: CycleDeps;
  injector?: FailureInjector;
  debugToken?: string | null;
  onHeal?: HealHandler;
  webhookSecret?: string | null;
  tickets?: StreamTicketStore;
  /** Browser origins allowed to call the API. */
  appOrigins?: string[];
}

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono();

  /**
   * The app is served from a different origin than the API (5173 vs 8022), so
   * every browser call — including the EventSource stream — is cross-origin.
   * Without this the entire frontend fails at the preflight.
   *
   * Credentials are not used: auth travels in an Authorization header and the
   * SSE stream uses a ticket, so no cookies are involved.
   */
  app.use(
    "/api/*",
    cors({
      origin: deps.appOrigins ?? ["http://localhost:5173"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type", "x-debug-token"],
      maxAge: 600,
    })
  );

  app.route("/health", health);
  app.route("/", health);

  // Mounted only with a shared secret: this endpoint triggers a real,
  // billable Bright Data heal, and the demo runbook exposes it via a tunnel.
  if (deps.onHeal && deps.webhookSecret) {
    app.route(
      "/api/v1/hooks",
      createHooksRouter(deps.onHeal, deps.webhookSecret)
    );
  } else if (deps.onHeal) {
    console.warn(
      "[craigsnotice] SIGNOZ_WEBHOOK_SECRET unset — /api/v1/hooks not mounted"
    );
  }

  if (deps.injector) {
    app.route(
      "/api/v1/debug",
      createDebugRouter(deps.injector, deps.debugToken ?? null)
    );
  }

  if (deps.db && deps.verifier) {
    const auth = createFirebaseAuth(deps.verifier, deps.db);
    const hub = deps.hub ?? createSseHub();

    app.use("/api/v1/watches", auth);
    app.use("/api/v1/watches/*", auth);
    app.route(
      "/api/v1/watches",
      createWatchesRouter(deps.db, deps.port, deps.cycleDeps)
    );

    // The stream authenticates with a single-use ticket, not a bearer token,
    // so it is mounted before the auth middleware and outside its scope.
    const tickets = deps.tickets ?? createStreamTicketStore();
    app.route("/api/v1/alerts/stream", createAlertStreamRouter(hub, tickets));

    app.use("/api/v1/alerts", auth);
    app.use("/api/v1/alerts/*", auth);
    app.route("/api/v1/alerts", createAlertsRouter(deps.db, tickets));

    if (deps.port) {
      app.route("/api/v1/alerts", createFeedbackRouter(deps.db, deps.port));
    }

    app.use("/api/v1/users/*", auth);
    app.route("/api/v1/users", createUsersRouter(deps.db));
  }

  return app;
};
