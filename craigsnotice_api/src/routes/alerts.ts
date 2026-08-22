import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { successResponse, errorResponse } from "@craigsnotice/types";
import type { Db } from "../db";
import {
  alertFeedback,
  dealAlerts,
  listings,
  users,
  watches,
} from "../db/schema";
import type { SseHub } from "../services/notify/dispatcher";

export interface AlertView {
  id: string;
  watchId: string;
  title: string;
  price: number | null;
  url: string;
  score: number;
  reasoning: string;
  priceVsMedian: number;
  createdAt: string;
  userFeedback: "good" | "bad" | null;
}

export const createAlertsRouter = (db: Db, hub: SseHub): Hono => {
  const router = new Hono();

  router.get("/", async (c) => {
    const userId = c.get("userId");

    const rows = await db
      .select({
        id: dealAlerts.id,
        watchId: dealAlerts.watchId,
        title: listings.title,
        price: listings.price,
        url: listings.url,
        score: dealAlerts.score,
        reasoning: dealAlerts.reasoning,
        priceVsMedian: dealAlerts.priceVsMedian,
        createdAt: dealAlerts.createdAt,
        userFeedback: alertFeedback.verdict,
      })
      .from(dealAlerts)
      .innerJoin(listings, eq(dealAlerts.listingId, listings.id))
      .innerJoin(watches, eq(dealAlerts.watchId, watches.id))
      .leftJoin(alertFeedback, eq(alertFeedback.alertId, dealAlerts.id))
      .where(eq(watches.userId, userId))
      .orderBy(desc(dealAlerts.createdAt))
      .limit(100);

    const view: AlertView[] = rows.map((r) => ({
      id: r.id,
      watchId: r.watchId,
      title: r.title,
      price: r.price === null ? null : Number(r.price),
      url: r.url,
      score: r.score,
      reasoning: r.reasoning,
      priceVsMedian: Number(r.priceVsMedian),
      createdAt: r.createdAt.toISOString(),
      userFeedback: (r.userFeedback as "good" | "bad" | null) ?? null,
    }));

    return c.json(successResponse(view));
  });

  router.get("/stream", (c) => {
    return new Response(hub.subscribe(c.get("userId")), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return router;
};

/**
 * EventSource cannot set an Authorization header, so /alerts/stream accepts
 * ?token=. This promotes it into the header before auth runs; every other
 * route keeps requiring a real header.
 */
export const promoteQueryToken = async (
  c: { req: { raw: Request; header: (n: string) => string | undefined } },
  next: () => Promise<void>
): Promise<void> => {
  if (!c.req.header("Authorization")) {
    const token = new URL(c.req.raw.url).searchParams.get("token");
    if (token) c.req.raw.headers.set("Authorization", `Bearer ${token}`);
  }
  await next();
};

export const createUsersRouter = (db: Db): Hono => {
  const router = new Hono();

  router.post(
    "/fcm-token",
    zValidator("json", z.object({ fcmToken: z.string().min(1) })),
    async (c) => {
      const userId = c.get("userId");
      const { fcmToken } = c.req.valid("json");

      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return c.json(errorResponse("user not found"), 404);

      if (!user.fcmTokens.includes(fcmToken)) {
        await db
          .update(users)
          .set({ fcmTokens: [...user.fcmTokens, fcmToken] })
          .where(eq(users.id, userId));
      }

      return c.json(successResponse({ registered: true }));
    }
  );

  return router;
};
