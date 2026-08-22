import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAlerts, useSendFeedback, useWatches } from "@craigsnotice/client";
import { AlertCard } from "../components/AlertCard";
import { useClientContext } from "../hooks/useClientContext";

export const WatchDetail = () => {
  const { id = "" } = useParams();
  const ctx = useClientContext();
  const watches = useWatches(ctx);
  const alerts = useAlerts(ctx);
  const feedback = useSendFeedback(ctx);

  const watch = useMemo(
    () => watches.data?.find((w) => w.id === id) ?? null,
    [watches.data, id]
  );
  const mine = useMemo(
    () => (alerts.data ?? []).filter((a) => a.watchId === id),
    [alerts.data, id]
  );

  if (watches.isLoading) {
    return <p className="px-6 py-8 text-slate-500">Loading…</p>;
  }

  if (!watch) {
    return (
      <div className="px-6 py-8">
        <p className="text-slate-500">Watch not found.</p>
        <Link to="/watches" className="text-slate-900 underline">
          Back to watches
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to="/watches" className="text-sm text-slate-500 hover:underline">
        ← Watches
      </Link>

      <h2 className="mt-2 text-xl font-semibold text-slate-900">
        {watch.query}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        {watch.siteCode} · {watch.categoryCode} · every {watch.intervalSec}s
        {watch.targetPrice !== null && ` · under $${watch.targetPrice}`}
      </p>
      <a
        href={watch.searchUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-1 block break-all text-xs text-slate-400 hover:underline"
      >
        {watch.searchUrl}
      </a>

      <h3 className="mb-3 mt-6 font-semibold text-slate-900">Alerts</h3>
      {mine.length === 0 ? (
        <p className="text-slate-500">No alerts for this watch yet.</p>
      ) : (
        <div className="space-y-3">
          {mine.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onFeedback={(verdict) =>
                feedback.mutate({ alertId: a.id, verdict })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default WatchDetail;
