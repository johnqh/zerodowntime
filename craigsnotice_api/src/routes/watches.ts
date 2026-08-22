import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  createWatchSchema,
  successResponse,
  errorResponse,
  InvalidWatchTargetError,
} from "@craigsnotice/types";
import type { Db } from "../db";
import type { PortClient } from "../services/port/client";
import { runWatchCycle, type CycleDeps } from "../services/scheduler";
import {
  createWatch,
  deleteWatch,
  getWatch,
  listWatches,
} from "../services/watches";

export const createWatchesRouter = (
  db: Db,
  port?: PortClient,
  cycleDeps?: CycleDeps
): Hono => {
  const router = new Hono();

  router.post("/", zValidator("json", createWatchSchema), async (c) => {
    try {
      const watch = await createWatch(
        db,
        c.get("userId"),
        c.req.valid("json"),
        port,
        c.get("userEmail")
      );
      return c.json(successResponse(watch), 201);
    } catch (err) {
      if (err instanceof InvalidWatchTargetError) {
        return c.json(errorResponse(err.message), 400);
      }
      throw err;
    }
  });

  router.get("/", async (c) =>
    c.json(successResponse(await listWatches(db, c.get("userId"))))
  );

  router.get(
    "/:id",
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      const watch = await getWatch(
        db,
        c.get("userId"),
        c.req.valid("param").id
      );
      return watch
        ? c.json(successResponse(watch))
        : c.json(errorResponse("watch not found"), 404);
    }
  );

  router.delete(
    "/:id",
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      const ok = await deleteWatch(
        db,
        c.get("userId"),
        c.req.valid("param").id
      );
      return ok
        ? c.json(successResponse({ deleted: true }))
        : c.json(errorResponse("watch not found"), 404);
    }
  );

  // The demo button. A 300s interval is realistic but unusable on stage.
  router.post(
    "/:id/run",
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      if (!cycleDeps) {
        return c.json(errorResponse("pipeline not configured"), 503);
      }
      const watch = await getWatch(
        db,
        c.get("userId"),
        c.req.valid("param").id
      );
      if (!watch) return c.json(errorResponse("watch not found"), 404);

      // A live cycle takes minutes (a Bright Data scrape plus one agent call
      // per new listing), so it runs detached and alerts arrive over SSE.
      // Awaiting it here held the HTTP response open past the idle timeout.
      setTimeout(() => {
        void runWatchCycle(cycleDeps, watch.id).catch((err) =>
          console.warn(
            `[watches] run-now failed for ${watch.id}: ${(err as Error).message}`
          )
        );
      }, 0);

      return c.json(successResponse({ started: true, watchId: watch.id }), 202);
    }
  );

  return router;
};
