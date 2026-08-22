import type { AlertView } from "@craigsnotice/client";
import type { FeedbackVerdict } from "@craigsnotice/types";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export interface AlertCardProps {
  alert: AlertView;
  onFeedback(verdict: FeedbackVerdict): void;
}

export const AlertCard = ({ alert, onFeedback }: AlertCardProps) => {
  const voted = alert.userFeedback !== null;
  const delta = Math.round(alert.priceVsMedian * 100);
  const deltaLabel = `${delta > 0 ? "+" : ""}${delta}%`;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a
            href={alert.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate font-medium text-slate-900 hover:underline"
          >
            {alert.title}
          </a>
          <p className="mt-1 text-sm text-slate-600">
            {alert.price === null ? "No price" : money.format(alert.price)}
            <span
              className={
                delta < 0
                  ? "ml-2 font-medium text-emerald-700"
                  : "ml-2 font-medium text-slate-500"
              }
            >
              {deltaLabel} vs median
            </span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
          {alert.score}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-700">{alert.reasoning}</p>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={voted}
          onClick={() => onFeedback("good")}
          aria-label="Good deal"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        >
          👍 Good deal
        </button>
        <button
          type="button"
          disabled={voted}
          onClick={() => onFeedback("bad")}
          aria-label="Not a good deal"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        >
          👎 Not a good deal
        </button>
        {voted && (
          <span className="self-center text-sm text-slate-500">
            Thanks — this tunes the next run.
          </span>
        )}
      </div>
    </article>
  );
};
