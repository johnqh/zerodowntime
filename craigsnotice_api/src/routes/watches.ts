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
import {
  createWatch,
  deleteWatch,
  getWatch,
  listWatches,
} from "../services/watches";

export const createWatchesRouter = (db: Db, port?: PortClient): Hono => {
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
      const watch = await getWatch(db, c.get("userId"), c.req.valid("param").id);
      return watch
        ? c.json(successResponse(watch))
        : c.json(errorResponse("watch not found"), 404);
    }
  );

  router.delete(
    "/:id",
    zValidator("param", z.object({ id: z.uuid() })),
    async (c) => {
      const ok = await deleteWatch(db, c.get("userId"), c.req.valid("param").id);
      return ok
        ? c.json(successResponse({ deleted: true }))
        : c.json(errorResponse("watch not found"), 404);
    }
  );

  return router;
};
