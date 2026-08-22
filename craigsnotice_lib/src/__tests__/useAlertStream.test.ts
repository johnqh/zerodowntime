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

  it("reconnects with a NEW ticket after an error, never replaying the old one", async () => {
    // Tickets are single use, so EventSource's built-in retry would replay a
    // spent ticket and 401 forever.
    FakeEventSource.last = null;
    let issued = 0;
    const ticketing = async (): Promise<string> => `tkt-${++issued}`;

    renderHook(() => useAlertStream("http://x", "tok", Impl, ticketing));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    const first = FakeEventSource.last!;
    expect(first.url).toContain("ticket=tkt-1");

    act(() => {
      first.onerror?.();
    });
    expect(first.closed).toBe(true);

    await waitFor(
      () => {
        expect(FakeEventSource.last!.url).toContain("ticket=tkt-2");
      },
      { timeout: 4000 }
    );
    expect(issued).toBe(2);
  });

  it("marks itself disconnected as soon as the stream errors", async () => {
    const { result } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, okTicket)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    act(() => {
      FakeEventSource.last!.onopen?.();
    });
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      FakeEventSource.last!.onerror?.();
    });
    expect(result.current.connected).toBe(false);
  });

  it("opens exactly one connection across many re-renders", async () => {
    // Regression: defaulting the ticket fetcher inline made a new closure per
    // render, so the effect re-ran every render and reconnected in a loop.
    FakeEventSource.last = null;
    let opened = 0;
    const counting = async (): Promise<string> => {
      opened += 1;
      return `tkt-${opened}`;
    };

    const { rerender } = renderHook(() =>
      useAlertStream("http://x", "tok", Impl, counting)
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());

    for (let i = 0; i < 10; i += 1) rerender();
    await new Promise((r) => setTimeout(r, 50));

    expect(opened).toBe(1);
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
