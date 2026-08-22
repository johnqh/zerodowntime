import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useAlerts, useSendFeedback, useWatches } from "@craigsnotice/client";
import { getCategory, getSite } from "@craigsnotice/types";
import { EmptyState, Heading, Text } from "@sudobility/components";
import { AlertCard } from "../components/AlertCard";
import { relativeTime } from "@craigsnotice/lib";
import { useClientContext } from "../hooks/useClientContext";

/** The results view for one watch: every deal it has surfaced. */
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
    return (
      <Text className="mx-auto block max-w-4xl px-6 py-10 text-ink-muted">
        Loading…
      </Text>
    );
  }

  if (!watch) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <EmptyState
          title="Watch not found"
          description="It may have been deleted."
          action={
            <Link to="/watches" className="eyebrow underline">
              Back to watches
            </Link>
          }
        />
      </div>
    );
  }

  const site = getSite(watch.siteCode);
  const category = getCategory(watch.categoryCode);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link to="/watches" className="eyebrow text-ink-faint no-underline hover:text-accent">
        ← Watches
      </Link>

      <div className="rule-double mt-4 pb-5">
        <Heading level={1} className="text-display font-bold leading-none tracking-title">
          {watch.query}
        </Heading>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-5">
          {[
            ["Location", site?.name ?? watch.siteCode],
            ["Category", category?.label ?? watch.categoryCode],
            [
              "Target",
              watch.targetPrice !== null ? `$${watch.targetPrice}` : "—",
            ],
            ["Status", watch.status],
            ["Updated", relativeTime(watch.lastRunAt)],
            ["Deals found", String(mine.length)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="eyebrow text-ink-faint">{label}</dt>
              <dd className="figure mt-1 text-base font-medium">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <a
          href={watch.searchUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-5 block break-all text-xs text-ink-faint hover:text-accent"
        >
          {watch.searchUrl}
        </a>
      </div>

      <div className="mt-10 flex items-baseline justify-between border-b border-rule/40 pb-2">
        <Heading level={2} className="text-xl font-bold tracking-title">
          Results
        </Heading>
        <span className="eyebrow text-ink-faint">
          {mine.length} {mine.length === 1 ? "deal" : "deals"}
        </span>
      </div>

      {mine.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="This watch is checking on its own. Good deals appear here as they are found."
          className="mt-10"
        />
      ) : (
        <div className="mt-6 space-y-4">
          {mine.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              lastRunAt={watch.lastRunAt}
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
