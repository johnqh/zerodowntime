import { useCallback, useState } from "react";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { firebaseApp, firebaseConfig, VAPID_KEY } from "../firebase";

export type PushStatus =
  | "idle"
  | "granted"
  | "denied"
  | "unsupported"
  | "unconfigured";

export interface PushRegistration {
  status: PushStatus;
  enable(): Promise<void>;
}

/**
 * The service worker cannot read import.meta.env, so the Firebase config
 * rides along in the registration URL.
 */
const registerWorker = (): Promise<ServiceWorkerRegistration> => {
  const params = new URLSearchParams({
    apiKey: firebaseConfig.apiKey,
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket,
    messagingSenderId: firebaseConfig.messagingSenderId,
    appId: firebaseConfig.appId,
  });
  return navigator.serviceWorker.register(
    `/firebase-messaging-sw.js?${params.toString()}`
  );
};

/**
 * Every failure path is silent and non-blocking: the in-app SSE feed already
 * guarantees the alert is visible, so push is strictly additive. Call enable()
 * from a user gesture — browsers reject permission prompts that are not.
 */
export const usePushRegistration = (
  apiToken: string | null,
  register: (fcmToken: string) => Promise<void>
): PushRegistration => {
  const [status, setStatus] = useState<PushStatus>("idle");

  const enable = useCallback(async () => {
    if (!apiToken) return;

    // Web push needs a VAPID key pair; without one there is nothing to do.
    if (!VAPID_KEY) {
      setStatus("unconfigured");
      return;
    }

    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !(await isSupported())
    ) {
      setStatus("unsupported");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("denied");
      return;
    }

    try {
      const serviceWorkerRegistration = await registerWorker();
      const fcmToken = await getToken(getMessaging(firebaseApp()), {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration,
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
