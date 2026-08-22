/* eslint-disable no-undef */
/**
 * Background push handler.
 *
 * A service worker cannot read import.meta.env, and hard-coding the Firebase
 * config here would commit project-specific values to the repo. Instead the
 * app registers this worker with the config in the query string:
 *
 *   navigator.serviceWorker.register(
 *     `/firebase-messaging-sw.js?${new URLSearchParams(firebaseConfig)}`
 *   )
 */
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js"
);

const params = new URLSearchParams(self.location.search);

firebase.initializeApp({
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});

firebase.messaging().onBackgroundMessage((payload) => {
  const notification = payload.notification ?? {};
  self.registration.showNotification(notification.title ?? "CraigsNotice", {
    body: notification.body ?? "",
    data: payload.data ?? {},
  });
});

// Clicking the notification opens the listing.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (url) event.waitUntil(clients.openWindow(url));
});
