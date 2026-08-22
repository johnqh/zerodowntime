import { useNavigate } from "react-router-dom";
import {
  useCreateWatch,
  useDeleteWatch,
  useWatches,
  type WatchView,
} from "@craigsnotice/client";
import { getCategory, getSite } from "@craigsnotice/types";
import { Button, EmptyState, Heading, Text } from "@sudobility/components";
import { WatchForm } from "../components/WatchForm";
import { DealImageStack } from "../components/DealImageStack";
import { useClientContext } from "../hooks/useClientContext";

const relativeTime = (iso: string | null): string => {
  if (!iso) return "queued";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

const WatchRow = ({ watch }: { watch: WatchView }) => {
  const ctx = useClientContext();
  const remove = useDeleteWatch(ctx);
  const navigate = useNavigate();

  const everyLabel =
    watch.intervalSec % 3600 === 0
      ? `${watch.intervalSec / 3600}h`
      : `${Math.round(watch.intervalSec / 60)}m`;

  const site = getSite(watch.siteCode);
  const category = getCategory(watch.categoryCode);
  const active = watch.status === "active";

  return (
    <li className="border-b border-rule/25 last:border-b-0">
      {/* The whole row opens the results for this watch. */}
      <div
        role="link"
        tabIndex={0}
        onClick={() => navigate(`/watches/${watch.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate(`/watches/${watch.id}`);
        }}
        className="grid cursor-pointer grid-cols-[1fr_auto] items-start gap-4 px-2 py-5 transition-colors hover:bg-paper-deep"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="text-xl font-bold tracking-title">
              {watch.query}
            </span>
            <span className="eyebrow text-ink-faint">
              {site?.name ?? watch.siteCode} · {category?.label ?? watch.categoryCode}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span
                className={
                  active
                    ? "inline-block h-2 w-2 rounded-full bg-accent"
                    : "inline-block h-2 w-2 rounded-full bg-ink-faint"
                }
              />
              <span className="eyebrow">
                {active ? `Watching every ${everyLabel}` : "Paused"}
              </span>
            </span>

            <span className="eyebrow text-ink-faint">
              Checked {relativeTime(watch.lastRunAt)}
            </span>

            {watch.runCount > 0 && (
              <span className="eyebrow text-ink-faint">
                {watch.runCount} runs
              </span>
            )}

            {watch.targetPrice !== null && (
              <span className="eyebrow text-ink-faint">
                Under ${watch.targetPrice}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <DealImageStack images={watch.dealImages} total={watch.dealCount} />
          <span className="eyebrow text-ink-faint">Results →</span>
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (
                window.confirm(
                  `Delete the watch for "${watch.query}"? Its alerts go too.`
                )
              ) {
                remove.mutate(watch.id);
              }
            }}
            disabled={remove.isPending}
            className="eyebrow border border-rule/50 bg-paper px-3 py-1.5 text-ink hover:bg-accent hover:text-paper disabled:opacity-40"
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </li>
  );
};

export const Watches = () => {
  const ctx = useClientContext();
  const watches = useWatches(ctx);
  const create = useCreateWatch(ctx);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="grid gap-10 md:grid-cols-[320px_1fr]">
        <section>
          <WatchForm
            pending={create.isPending}
            onSubmit={(input) => create.mutate(input)}
          />
          {create.isError && (
            <Text size="sm" className="mt-3 block font-medium text-accent">
              {create.error.message}
            </Text>
          )}
        </section>

        <section>
          <div className="rule-double flex items-baseline justify-between pb-2">
            <Heading level={2} className="text-title font-bold tracking-title">
              Watches
            </Heading>
            <span className="eyebrow text-ink-faint">
              Checked automatically
            </span>
          </div>

          {watches.isLoading && (
            <Text className="mt-6 block text-ink-muted">Loading…</Text>
          )}

          {watches.data?.length === 0 && (
            <EmptyState
              title="No watches yet"
              description="Create one and it starts checking Craigslist on its own within seconds."
              className="mt-10"
            />
          )}

          <ul>
            {watches.data?.map((w) => (
              <WatchRow key={w.id} watch={w} />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default Watches;
