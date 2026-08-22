import { useCallback, useState } from "react";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseApp } from "../firebase";

export type PushStatus = "idle" | "granted" | "denied" | "unsupported";

export interface PushRegistration {
  status: PushStatus;
  enable(): Promise<void>;
}

/**
 * Denial is silent and non-blocking: the SSE feed already guarantees the alert
 * is visible. This only adds real push on top. Call enable() from a user
 * gesture — browsers reject permission prompts that are not.
 */
export const usePushRegistration = (
  apiToken: string | null,
  register: (fcmToken: string) => Promise<void>
): PushRegistration => {
  const [status, setStatus] = useState<PushStatus>("idle");

  const enable = useCallback(async () => {
    if (!apiToken) return;

    if (!(await isSupported())) {
      setStatus("unsupported");
      return;
    }

    if (typeof Notification === "undefined") {
      setStatus("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    try {
      const fcmToken = await getToken(getMessaging(firebaseApp()), {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY ?? "",
      });
      if (!fcmToken) {
        setStatus("denied");
        return;
      }
      await register(fcmToken);
      setStatus("granted");
    } catch {
      // A failed registration must not break the page; SSE still delivers.
      setStatus("denied");
    }
  }, [apiToken, register]);

  return { status, enable };
};
