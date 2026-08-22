import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  feedbackSchema,
  successResponse,
  errorResponse,
} from "@craigsnotice/types";
import type { Db } from "../db";
import type { PortClient } from "../services/port/client";
import { recordFeedback } from "../services/feedback";

export const createFeedbackRouter = (db: Db, port: PortClient): Hono => {
  const router = new Hono();

  router.post(
    "/:id/feedback",
    zValidator("param", z.object({ id: z.uuid() })),
    zValidator("json", feedbackSchema),
    async (c) => {
      const row = await recordFeedback(
        db,
        port,
        c.get("userId"),
        c.req.valid("param").id,
        c.req.valid("json").verdict
      );
      return row
        ? c.json(successResponse(row))
        : c.json(errorResponse("alert not found"), 404);
    }
  );

  return router;
};
