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
import type { StreamTicketStore } from "../services/streamTickets";

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
  imageUrl: string | null;
}

export const createAlertsRouter = (
  db: Db,
  tickets: StreamTicketStore
): Hono => {
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
        imageUrl: listings.imageUrl,
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
      imageUrl: r.imageUrl,
    }));

    return c.json(successResponse(view));
  });

  /** Authenticated: exchange a real bearer token for a single-use ticket. */
  router.post("/stream/ticket", (c) =>
    c.json(successResponse(tickets.issue(c.get("userId"))))
  );

  return router;
};

/**
 * Unauthenticated route: the ticket IS the credential. It is opaque,
 * single-use, expires in 30s and is bound to one user, so putting it in the
 * query string does not leak anything reusable — unlike the Firebase ID token
 * this used to accept there.
 */
export const createAlertStreamRouter = (
  hub: SseHub,
  tickets: StreamTicketStore
): Hono => {
  const router = new Hono();

  router.get("/", (c) => {
    const ticket = new URL(c.req.raw.url).searchParams.get("ticket");
    if (!ticket) return c.json(errorResponse("missing stream ticket"), 401);

    const userId = tickets.consume(ticket);
    if (!userId) {
      return c.json(errorResponse("invalid or expired stream ticket"), 401);
    }

    return new Response(hub.subscribe(userId), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  return router;
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
