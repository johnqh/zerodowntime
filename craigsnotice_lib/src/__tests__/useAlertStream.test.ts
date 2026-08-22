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

const okTicket = async (): Promise<string> => "tkt-abc";

describe("useAlertStream", () => {
  it("does not connect without a token", () => {
    FakeEventSource.last = null;
    renderHook(() => useAlertStream("http://x", "", Impl, okTicket));
    expect(FakeEventSource.last).toBeNull();
  });

  it("connects with a single-use ticket, never the bearer token", async () => {
    FakeEventSource.last = null;
    renderHook(() => useAlertStream("http://x", "tok", Impl, okTicket));

    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    expect(FakeEventSource.last!.url).toBe(
      "http://x/api/v1/alerts/stream?ticket=tkt-abc"
    );
    expect(FakeEventSource.last!.url).not.toContain("tok");
  });

  it("does not connect when the ticket exchange fails", async () => {
    FakeEventSource.last = null;
    const failing = async (): Promise<string> => {
      throw new Error("401");
    };
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, failing)
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(FakeEventSource.last).toBeNull();
    expect(result.current.connected).toBe(false);
  });

  it("prepends an incoming alert and marks the stream connected", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, okTicket)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

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
      useAlertStream("http://x", "tok", Impl, okTicket)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    act(() => {
      FakeEventSource.last!.emit("deal-alert", alert);
      FakeEventSource.last!.emit("deal-alert", alert);
    });

    await waitFor(() => expect(result.current.alerts).toHaveLength(1));
  });

  it("drops a malformed frame without throwing", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, okTicket)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    act(() => {
      FakeEventSource.last!.emit("deal-alert", "{not json");
    });

    expect(result.current.alerts).toHaveLength(0);
  });

  it("closes the source on unmount", async () => {
    const { unmount } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, okTicket)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    const source = FakeEventSource.last!;
    unmount();
    expect(source.closed).toBe(true);
  });
});
