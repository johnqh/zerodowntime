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
  getTicket?: TicketFetcher
): AlertStreamState => {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  /**
   * Held in a ref, never a dependency. Defaulting it inline built a new
   * closure every render, which changed the effect's identity every render,
   * which tore down and rebuilt the stream in a loop — and setConnected
   * re-rendered, feeding it. That produced thousands of connections a minute.
   */
  const fetcherRef = useRef<TicketFetcher>(defaultTicketFetcher(baseUrl));
  fetcherRef.current = getTicket ?? defaultTicketFetcher(baseUrl);

  useEffect(() => {
    if (!token || !EventSourceImpl) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = async (): Promise<void> => {
      if (cancelled) return;

      // Exchange the bearer token for a single-use ticket over an
      // authenticated request. The token itself must never reach a URL.
      let ticket: string;
      try {
        ticket = await fetcherRef.current(token);
      } catch {
        setConnected(false);
        scheduleRetry();
        return;
      }
      if (cancelled) return;

      const url = `${baseUrl}/api/v1/alerts/stream?ticket=${encodeURIComponent(ticket)}`;
      const source = new EventSourceImpl(url);
      sourceRef.current = source;

      source.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      /**
       * Tickets are single-use, so EventSource's own retry would replay a
       * spent ticket and get 401 forever. Close it and reconnect with a
       * freshly minted one instead.
       */
      source.onerror = () => {
        setConnected(false);
        source.close();
        if (sourceRef.current === source) sourceRef.current = null;
        scheduleRetry();
      };

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

    function scheduleRetry(): void {
      if (cancelled) return;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
      retryTimer = setTimeout(() => void connect(), delay);
    }

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [baseUrl, token, EventSourceImpl]);

  return { alerts, connected };
};
