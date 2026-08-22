export const queryKeys = {
  craigsnotice: {
    all: ["craigsnotice"] as const,
    watches: () => [...queryKeys.craigsnotice.all, "watches"] as const,
    watch: (id: string) => [...queryKeys.craigsnotice.watches(), id] as const,
    alerts: () => [...queryKeys.craigsnotice.all, "alerts"] as const,
  },
};

export const STALE_TIMES = {
  WATCHES: 30_000,
  ALERTS: 10_000,
} as const;
