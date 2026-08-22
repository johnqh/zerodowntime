import { and, eq } from "drizzle-orm";
import type { FeedbackVerdict } from "@craigsnotice/types";
import type { Db } from "../db";
import { alertFeedback, dealAlerts, watches } from "../db/schema";
import type { PortClient } from "./port/client";
import { safeMirror } from "./port/mirror";

/**
 * Returns null when the alert does not belong to this user.
 * Re-submitting replaces the previous verdict rather than stacking duplicates,
 * so changing your mind does not double-weight recentFeedback.
 */
export const recordFeedback = async (
  db: Db,
  port: PortClient,
  userId: string,
  alertId: string,
  verdict: FeedbackVerdict
) => {
  const owned = await db
    .select({ alertId: dealAlerts.id })
    .from(dealAlerts)
    .innerJoin(watches, eq(dealAlerts.watchId, watches.id))
    .where(and(eq(dealAlerts.id, alertId), eq(watches.userId, userId)));

  if (owned.length === 0) return null;

  await db
    .delete(alertFeedback)
    .where(
      and(eq(alertFeedback.alertId, alertId), eq(alertFeedback.userId, userId))
    );

  const [row] = await db
    .insert(alertFeedback)
    .values({ alertId, userId, verdict })
    .returning();

  await safeMirror(() =>
    port.patchEntity("craigsnotice_deal_alert", alertId, {
      userFeedback: verdict,
    })
  );

  return row!;
};
