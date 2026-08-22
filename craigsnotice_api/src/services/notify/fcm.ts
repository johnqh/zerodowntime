import { eq } from "drizzle-orm";
import type { Messaging } from "firebase-admin/messaging";
import type { Db } from "../../db";
import { users } from "../../db/schema";
import type { NotificationChannel } from "./dispatcher";

export const createFcmChannel = (
  messaging: Messaging,
  db: Db
): NotificationChannel => ({
  name: "fcm",
  async send(userId, alert) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const tokens = user?.fcmTokens ?? [];
    if (tokens.length === 0) return;

    const priceLabel = alert.price === null ? "no price" : `$${alert.price}`;
    await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: `Good deal: ${alert.title}`,
        body: `${priceLabel} — ${alert.reasoning}`,
      },
      data: {
        alertId: alert.alertId,
        watchId: alert.watchId,
        url: alert.url,
      },
      webpush: { fcmOptions: { link: alert.url } },
    });
  },
});
