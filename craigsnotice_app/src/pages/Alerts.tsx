import { useMemo } from "react";
import {
  useAlerts,
  useSendFeedback,
  type AlertView,
} from "@craigsnotice/client";
import { useAlertStream } from "@craigsnotice/lib";
import { EmptyState, Heading, Text } from "@sudobility/components";
import { AlertCard } from "../components/AlertCard";
import { API_BASE_URL } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useClientContext } from "../hooks/useClientContext";

export const Alerts = () => {
  const { token } = useAuth();
  const ctx = useClientContext();
  const alerts = useAlerts(ctx);
  const feedback = useSendFeedback(ctx);
  const stream = useAlertStream(API_BASE_URL, token ?? "");

  // Streamed entries are newer than the polled list, so they win on id.
  const merged = useMemo<AlertView[]>(() => {
    const byId = new Map<string, AlertView>();
    for (const a of alerts.data ?? []) byId.set(a.id, a);
    for (const a of stream.alerts) byId.set(a.id, { ...byId.get(a.id), ...a });
    return [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }, [alerts.data, stream.alerts]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="rule-double flex items-baseline justify-between pb-2">
        <Heading level={1} className="text-title font-bold tracking-title">
          Deal alerts
        </Heading>
        <span className="flex items-center gap-1.5">
          <span
            className={
              stream.connected
                ? "inline-block h-2 w-2 rounded-full bg-accent"
                : "inline-block h-2 w-2 rounded-full bg-ink-faint"
            }
          />
          <span className="eyebrow text-ink-faint">
            {stream.connected ? "Live" : "Offline"}
          </span>
        </span>
      </div>

      {alerts.isLoading && (
        <Text className="mt-6 block text-ink-muted">Loading…</Text>
      )}

      {!alerts.isLoading && merged.length === 0 && (
        <EmptyState
          title="Nothing yet"
          description="Your watches are checking on their own. Good deals land here."
          className="mt-10"
        />
      )}

      <div className="mt-6 space-y-4">
        {merged.map((a) => (
          <AlertCard
            key={a.id}
            alert={a}
            onFeedback={(verdict) =>
              feedback.mutate({ alertId: a.id, verdict })
            }
          />
        ))}
      </div>
    </div>
  );
};

export default Alerts;
