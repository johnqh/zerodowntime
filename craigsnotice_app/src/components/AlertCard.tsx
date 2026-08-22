import type { AlertView } from "@craigsnotice/client";
import type { FeedbackVerdict } from "@craigsnotice/types";
import { Button, Text } from "@sudobility/components";
import { DealImage } from "./DealImage";

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
    <article className="panel">
      <div className="grid grid-cols-[auto_1fr_auto] gap-5 border-b border-rule/25 p-5">
        <a
          href={alert.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open "${alert.title}" on Craigslist`}
        >
          <DealImage
            src={alert.imageUrl}
            alt={alert.title}
            className="h-28 w-28 shadow-card"
          />
        </a>

        <div className="min-w-0">
          <a
            href={alert.url}
            target="_blank"
            rel="noreferrer"
            className="block text-xl font-bold leading-snug tracking-title text-ink no-underline hover:text-accent"
          >
            {alert.title}
          </a>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span className="figure text-3xl font-bold text-ink">
              {alert.price === null ? "No price" : money.format(alert.price)}
            </span>
            <span
              className={
                delta < 0
                  ? "figure eyebrow text-accent"
                  : "figure eyebrow text-ink-faint"
              }
            >
              {deltaLabel} vs median
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="eyebrow text-ink-faint">Score</div>
          <div className="figure text-4xl font-bold leading-none text-brass">
            {alert.score}
          </div>
        </div>
      </div>

      <div className="border-b border-rule/25 px-5 py-4">
        <Text size="sm" className="block leading-relaxed text-ink-muted">
          {alert.reasoning}
        </Text>
      </div>

      {/* The listing itself. Explicit, not just a linked headline. */}
      <div className="border-b border-rule/25 px-5 py-3">
        <a
          href={alert.url}
          target="_blank"
          rel="noreferrer"
          className="eyebrow inline-flex items-center gap-2 text-accent no-underline hover:underline"
        >
          <span className="ornament" />
          View on Craigslist →
        </a>
      </div>

      <div className="flex items-stretch">
        <Button
          type="button"
          disabled={voted}
          onClick={() => onFeedback("good")}
          aria-label="Good deal"
          className="eyebrow flex-1 bg-transparent py-3 text-ink hover:bg-ink hover:text-paper disabled:opacity-30"
        >
          Good deal
        </Button>
        <span className="w-px bg-rule/25" />
        <Button
          type="button"
          disabled={voted}
          onClick={() => onFeedback("bad")}
          aria-label="Not a good deal"
          className="eyebrow flex-1 bg-transparent py-3 text-ink hover:bg-accent hover:text-paper disabled:opacity-30"
        >
          Not a good deal
        </Button>
      </div>

      {voted && (
        <div className="border-t border-rule/25 px-5 py-2">
          <span className="eyebrow text-ink-faint">
            Recorded — this tunes the next run
          </span>
        </div>
      )}
    </article>
  );
};
