/** A deal counts as new if the most recent run surfaced it, or it is very recent. */
export const NEW_DEAL_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface FreshnessInput {
  createdAt: string;
  /** Start of the watch's most recent run, when known. */
  lastRunAt?: string | null;
  now?: number;
}

export const isNewDeal = ({
  createdAt,
  lastRunAt = null,
  now = Date.now(),
}: FreshnessInput): boolean => {
  const found = new Date(createdAt).getTime();
  if (Number.isNaN(found)) return false;

  if (now - found <= NEW_DEAL_WINDOW_MS) return true;

  if (lastRunAt) {
    const runStarted = new Date(lastRunAt).getTime();
    if (!Number.isNaN(runStarted) && found >= runStarted) return true;
  }

  return false;
};

/** "just now", "12m ago", "3h ago", "2d ago" — never a raw timestamp. */
export const relativeTime = (iso: string | null, now = Date.now()): string => {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
};

/** An absolute stamp for the deal card, e.g. "22 Aug, 14:05". */
export const foundAtLabel = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};
