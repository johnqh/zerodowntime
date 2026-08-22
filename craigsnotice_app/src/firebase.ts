import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

/**
 * Firebase web config is public — it ships inside the client bundle — but it
 * is read from env so the repo carries no project-specific values.
 * messagingSenderId is required for FCM web push, not optional.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? "",
};

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8022";

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? "";

let app: FirebaseApp | null = null;

export const firebaseApp = (): FirebaseApp => {
  app ??= initializeApp(firebaseConfig);
  return app;
};

export const firebaseAuth = (): Auth => getAuth(firebaseApp());

/**
 * Dev-only affordance for automated browser testing: Google's OAuth popup
 * cannot be driven headlessly, so expose a custom-token sign-in instead. The
 * token still goes through real Firebase verification on the API. Guarded by
 * import.meta.env.DEV, so it is stripped from production builds.
 */
if (import.meta.env.DEV) {
  (globalThis as unknown as Record<string, unknown>).__craigsnotice = {
    signInWithCustomToken: async (token: string) => {
      const { signInWithCustomToken } = await import("firebase/auth");
      const cred = await signInWithCustomToken(firebaseAuth(), token);
      return cred.user.uid;
    },
  };
}
