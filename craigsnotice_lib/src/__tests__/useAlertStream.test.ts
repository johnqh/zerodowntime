import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAlertStream } from "../hooks/useAlertStream";

const alert = {
  id: "a1",
  watchId: "w1",
  title: "Mac Studio M2 Max",
  price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html",
  score: 88,
  reasoning: "under median",
  priceVsMedian: -0.34,
  createdAt: "2026-08-22T12:00:00Z",
  userFeedback: null,
};

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(e: unknown) => void>>();

  constructor(public url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    const l = this.listeners.get(type) ?? [];
    l.push(fn);
    this.listeners.set(type, l);
  }

  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn({ data: typeof data === "string" ? data : JSON.stringify(data) });
    }
  }

  close(): void {
    this.closed = true;
  }
}

const Impl = FakeEventSource as unknown as typeof EventSource;

describe("useAlertStream", () => {
  it("does not connect without a token", () => {
    FakeEventSource.last = null;
    renderHook(() => useAlertStream("http://x", "", Impl));
    expect(FakeEventSource.last).toBeNull();
  });

  it("passes the token as a query param because EventSource cannot set headers", () => {
    renderHook(() => useAlertStream("http://x", "tok", Impl));
    expect(FakeEventSource.last!.url).toBe(
      "http://x/api/v1/alerts/stream?token=tok"
    );
  });

  it("prepends an incoming alert and marks the stream connected", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl)
    );

    act(() => {
      FakeEventSource.last!.onopen?.();
      FakeEventSource.last!.emit("deal-alert", alert);
    });

    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
    expect(result.current.alerts[0]!.title).toBe("Mac Studio M2 Max");
    expect(result.current.connected).toBe(true);
  });

  it("ignores a duplicate alert id", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl)
    );

    act(() => {
      FakeEventSource.last!.emit("deal-alert", alert);
      FakeEventSource.last!.emit("deal-alert", alert);
    });

    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
  });

  it("drops a malformed frame without throwing", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl)
    );

    act(() => {
      FakeEventSource.last!.emit("deal-alert", "{not json");
    });

    expect(result.current.alerts).toHaveLength(0);
  });

  it("closes the source on unmount", () => {
    const { unmount } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl)
    );
    const source = FakeEventSource.last!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
