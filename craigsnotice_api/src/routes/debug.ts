import { Hono } from "hono";
import { successResponse, errorResponse } from "@craigsnotice/types";
import type { FailureInjector } from "../services/selfheal";

/**
 * Dev-only. Gated on NODE_ENV and a shared token. The endpoint stages the
 * BREAK; the detection, heal and recovery it triggers are the production
 * code path.
 */
export const createDebugRouter = (
  injector: FailureInjector,
  debugToken: string | null
): Hono => {
  const router = new Hono();

  router.use("*", async (c, next) => {
    if (process.env.NODE_ENV === "production") {
      return c.json(errorResponse("not found"), 404);
    }
    if (!debugToken || c.req.header("x-debug-token") !== debugToken) {
      return c.json(errorResponse("forbidden"), 403);
    }
    await next();
  });

  router.post("/inject-scrape-failure", (c) => {
    injector.arm();
    return c.json(
      successResponse({
        armed: true,
        note: "next scrape parse will report a total schema violation",
      })
    );
  });

  return router;
};
