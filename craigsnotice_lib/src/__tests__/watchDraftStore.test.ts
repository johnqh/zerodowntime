import { describe, it, expect, beforeEach } from "vitest";
import {
  useWatchDraftStore,
  WATCH_DRAFT_KEY,
  EMPTY_DRAFT,
} from "../stores/watchDraftStore";

describe("watchDraftStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useWatchDraftStore.getState().reset();
  });

  it("starts from the empty draft", () => {
    const s = useWatchDraftStore.getState();
    expect(s.siteCode).toBe("");
    expect(s.categoryCode).toBe(EMPTY_DRAFT.categoryCode);
  });

  it("persists a field to localStorage under the versioned key", async () => {
    useWatchDraftStore.getState().set("query", "Mac Studio");

    expect(useWatchDraftStore.getState().query).toBe("Mac Studio");
    await new Promise((r) => setTimeout(r, 0));

    const raw = localStorage.getItem(WATCH_DRAFT_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.query).toBe("Mac Studio");
  });

  it("clears the draft on reset", () => {
    const store = useWatchDraftStore.getState();
    store.set("query", "Herman Miller");
    store.set("siteCode", "sfbay");

    useWatchDraftStore.getState().reset();

    expect(useWatchDraftStore.getState().query).toBe("");
    expect(useWatchDraftStore.getState().siteCode).toBe("");
  });

  it("falls back to the empty draft when stored JSON is corrupt", async () => {
    localStorage.setItem(WATCH_DRAFT_KEY, "{not json");

    await expect(
      useWatchDraftStore.persist.rehydrate()
    ).resolves.not.toThrow();
    expect(useWatchDraftStore.getState().query).toBe("");
  });
});
