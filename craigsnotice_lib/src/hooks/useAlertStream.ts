import { useEffect, useRef, useState } from "react";
import type { AlertView } from "@craigsnotice/client";

export interface AlertStreamState {
  alerts: AlertView[];
  connected: boolean;
}

/**
 * The in-app half of the notification story. It exists so a denied browser
 * notification permission cannot swallow the alert entirely.
 */
export const useAlertStream = (
  baseUrl: string,
  token: string,
  EventSourceImpl: typeof EventSource | undefined = typeof EventSource ===
  "undefined"
    ? undefined
    : EventSource
): AlertStreamState => {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token || !EventSourceImpl) return;

    const url = `${baseUrl}/api/v1/alerts/stream?token=${encodeURIComponent(token)}`;
    const source = new EventSourceImpl(url);
    sourceRef.current = source;

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("deal-alert", (event) => {
      try {
        const alert = JSON.parse((event as MessageEvent).data) as AlertView;
        setAlerts((prev) =>
          prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]
        );
      } catch {
        // A malformed frame is dropped; the polled list still has the alert.
      }
    });

    return () => {
      source.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [baseUrl, token, EventSourceImpl]);

  return { alerts, connected };
};
