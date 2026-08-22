import { useMemo } from "react";
import { useAlerts, useSendFeedback, type AlertView } from "@craigsnotice/client";
import { useAlertStream } from "@craigsnotice/lib";
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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Deal alerts</h2>
        <span
          className={
            stream.connected
              ? "text-xs text-emerald-700"
              : "text-xs text-slate-400"
          }
        >
          {stream.connected ? "● live" : "○ offline"}
        </span>
      </div>

      {alerts.isLoading && <p className="text-slate-500">Loading…</p>}
      {!alerts.isLoading && merged.length === 0 && (
        <p className="text-slate-500">
          Nothing yet. Hit <strong>Run now</strong> on a watch to hunt
          immediately.
        </p>
      )}

      <div className="space-y-3">
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
