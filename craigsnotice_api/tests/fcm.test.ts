import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Messaging } from "firebase-admin/messaging";
import { eq } from "drizzle-orm";
import { db, resetDb } from "./setup";
import { createFcmChannel } from "../src/services/notify/fcm";
import type { AlertPayload } from "../src/services/notify/dispatcher";
import { users } from "../src/db/schema";

const alert: AlertPayload = {
  alertId: "a1",
  watchId: "w1",
  title: "Mac Studio M2 Max",
  price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html",
  score: 88,
  reasoning: "34% under median",
  priceVsMedian: -0.34,
};

interface MulticastMessage {
  tokens: string[];
  notification: { title: string; body: string };
  data: Record<string, string>;
  webpush: { fcmOptions: { link: string } };
}

const fakeMessaging = () => {
  const sendEachForMulticast = vi.fn(async (_msg: MulticastMessage) => ({
    successCount: 1,
    failureCount: 0,
    responses: [],
  }));
  return {
    messaging: { sendEachForMulticast } as unknown as Messaging,
    sendEachForMulticast,
  };
};

const seedUser = async (fcmTokens: string[]) => {
  const [u] = await db
    .insert(users)
    .values({ firebaseUid: "u1", email: "a@b.c", fcmTokens })
    .returning();
  return u!;
};

describe("createFcmChannel", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is named fcm", () => {
    expect(createFcmChannel(fakeMessaging().messaging, db).name).toBe("fcm");
  });

  it("sends nothing when the user has no registered tokens", async () => {
    const user = await seedUser([]);
    const { messaging, sendEachForMulticast } = fakeMessaging();

    await createFcmChannel(messaging, db).send(user.id, alert);

    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("sends nothing for an unknown user rather than throwing", async () => {
    const { messaging, sendEachForMulticast } = fakeMessaging();

    await expect(
      createFcmChannel(messaging, db).send(
        "00000000-0000-0000-0000-000000000000",
        alert
      )
    ).resolves.toBeUndefined();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("multicasts to every registered token with the deal in the body", async () => {
    const user = await seedUser(["tok-a", "tok-b"]);
    const { messaging, sendEachForMulticast } = fakeMessaging();

    await createFcmChannel(messaging, db).send(user.id, alert);

    const msg = sendEachForMulticast.mock.calls[0]![0];

    expect(msg.tokens).toEqual(["tok-a", "tok-b"]);
    expect(msg.notification.title).toContain("Mac Studio M2 Max");
    expect(msg.notification.body).toContain("$1200");
    expect(msg.notification.body).toContain("34% under median");
    expect(msg.data.alertId).toBe("a1");
    expect(msg.data.url).toBe(alert.url);
    // Clicking the notification must open the listing.
    expect(msg.webpush.fcmOptions.link).toBe(alert.url);
  });

  it("says 'no price' instead of rendering a null price", async () => {
    const user = await seedUser(["tok-a"]);
    const { messaging, sendEachForMulticast } = fakeMessaging();

    await createFcmChannel(messaging, db).send(user.id, {
      ...alert,
      price: null,
    });

    const msg = sendEachForMulticast.mock.calls[0]![0];
    expect(msg.notification.body).toContain("no price");
    expect(msg.notification.body).not.toContain("null");
  });

  it("propagates a send failure so the dispatcher can log and continue", async () => {
    const user = await seedUser(["tok-a"]);
    const messaging = {
      sendEachForMulticast: vi.fn(async (_msg: MulticastMessage) => {
        throw new Error("SenderId mismatch");
      }),
    } as unknown as Messaging;

    await expect(
      createFcmChannel(messaging, db).send(user.id, alert)
    ).rejects.toThrow(/SenderId mismatch/);

    // The user row is untouched by a delivery failure.
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.fcmTokens).toEqual(["tok-a"]);
  });
});
