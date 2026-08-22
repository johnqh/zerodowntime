import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { useWatches, useCreateWatch, useSendFeedback } from "../use-craigsnotice";
import type { NetworkClient } from "../../network/craigsnotice-client";

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
};

const ctxWith = (net: NetworkClient, token = "tok") => ({
  network: net,
  baseUrl: "http://localhost:8022",
  token,
});

describe("useWatches", () => {
  it("fetches the watch list", async () => {
    const net: NetworkClient = {
      request: vi
        .fn()
        .mockResolvedValue({ success: true, data: [{ id: "w1" }] }),
    };

    const { result } = renderHook(() => useWatches(ctxWith(net)), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "w1" }]);
  });

  it("does not fetch without a token", async () => {
    const net: NetworkClient = { request: vi.fn() };
    const { result } = renderHook(() => useWatches(ctxWith(net, "")), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(net.request).not.toHaveBeenCalled();
  });

  it("surfaces an error envelope as a query error", async () => {
    const net: NetworkClient = {
      request: vi.fn().mockResolvedValue({ success: false, error: "nope" }),
    };
    const { result } = renderHook(() => useWatches(ctxWith(net)), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("nope");
  });
});

describe("useCreateWatch", () => {
  it("posts the watch and resolves", async () => {
    const net: NetworkClient = {
      request: vi.fn().mockResolvedValue({ success: true, data: { id: "w1" } }),
    };
    const { result } = renderHook(() => useCreateWatch(ctxWith(net)), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "Mac Studio",
        intervalSec: 300,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "w1" });
  });
});

describe("useSendFeedback", () => {
  it("sends the verdict for the given alert", async () => {
    const net: NetworkClient = {
      request: vi.fn().mockResolvedValue({ success: true, data: {} }),
    };
    const { result } = renderHook(() => useSendFeedback(ctxWith(net)), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ alertId: "a1", verdict: "good" });
    });

    const [url, init] = (net.request as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("/api/v1/alerts/a1/feedback");
    expect(JSON.parse(init.body as string)).toEqual({ verdict: "good" });
  });
});
