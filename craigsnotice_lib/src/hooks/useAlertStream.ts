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
export type TicketFetcher = (token: string) => Promise<string>;

const defaultTicketFetcher =
  (baseUrl: string): TicketFetcher =>
  async (token) => {
    const res = await fetch(`${baseUrl}/api/v1/alerts/stream/ticket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = (await res.json()) as {
      success: boolean;
      data?: { ticket: string };
      error?: string;
    };
    if (!body.success || !body.data) {
      throw new Error(body.error ?? "could not obtain a stream ticket");
    }
    return body.data.ticket;
  };

export const useAlertStream = (
  baseUrl: string,
  token: string,
  EventSourceImpl: typeof EventSource | undefined = typeof EventSource ===
  "undefined"
    ? undefined
    : EventSource,
  getTicket: TicketFetcher = defaultTicketFetcher(baseUrl)
): AlertStreamState => {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!token || !EventSourceImpl) return;

    let cancelled = false;

    const connect = async (): Promise<void> => {
      // Exchange the bearer token for a single-use ticket over an
      // authenticated request. The token itself must never reach a URL.
      let ticket: string;
      try {
        ticket = await getTicket(token);
      } catch {
        setConnected(false);
        return;
      }
      if (cancelled) return;

      const url = `${baseUrl}/api/v1/alerts/stream?ticket=${encodeURIComponent(ticket)}`;
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
          // A malformed frame is dropped; the polled list still has it.
        }
      });
    };

    void connect();

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [baseUrl, token, EventSourceImpl, getTicket]);

  return { alerts, connected };
};
