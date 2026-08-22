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
