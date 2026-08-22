import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface WatchDraft {
  siteCode: string;
  subarea: string;
  categoryCode: string;
  query: string;
  targetPrice: string;
}

export const EMPTY_DRAFT: WatchDraft = {
  siteCode: "",
  subarea: "",
  categoryCode: "sss",
  query: "",
  targetPrice: "",
};

export interface WatchDraftState extends WatchDraft {
  set<K extends keyof WatchDraft>(key: K, value: WatchDraft[K]): void;
  reset(): void;
}

export const WATCH_DRAFT_KEY = "craigsnotice.watchDraft.v1";

export const useWatchDraftStore = create<WatchDraftState>()(
  persist(
    (set) => ({
      ...EMPTY_DRAFT,
      set: (key, value) => set({ [key]: value } as Partial<WatchDraftState>),
      reset: () => set({ ...EMPTY_DRAFT }),
    }),
    {
      name: WATCH_DRAFT_KEY,
      partialize: (s) => ({
        siteCode: s.siteCode,
        subarea: s.subarea,
        categoryCode: s.categoryCode,
        query: s.query,
        targetPrice: s.targetPrice,
      }),
      // A corrupt or half-written value must not take the form down.
      onRehydrateStorage: () => (_state, error) => {
        if (error) {
          console.warn("[craigsnotice] discarding corrupt watch draft", error);
        }
      },
    }
  )
);
