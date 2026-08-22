import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WatchForm } from "../components/WatchForm";
import { useWatchDraftStore } from "@craigsnotice/lib";

const pickSfBay = () => {
  fireEvent.change(screen.getByLabelText(/location/i), {
    target: { value: "SF bay" },
  });
  fireEvent.click(screen.getByText(/SF bay area/i));
};

describe("WatchForm", () => {
  beforeEach(() => {
    // The draft is persisted on purpose, so it must be cleared between cases.
    localStorage.clear();
    useWatchDraftStore.getState().reset();
  });

  it("submits location, category and query", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    pickSfBay();
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "sya" },
    });
    fireEvent.change(screen.getByLabelText(/looking for/i), {
      target: { value: "Mac Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        siteCode: "sfbay",
        categoryCode: "sya",
        query: "Mac Studio",
      })
    );
  });

  it("includes the optional target price when given", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    pickSfBay();
    fireEvent.change(screen.getByLabelText(/looking for/i), {
      target: { value: "Mac Studio" },
    });
    fireEvent.change(screen.getByLabelText(/alert me under/i), {
      target: { value: "1200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit.mock.calls[0]![0].targetPrice).toBe(1200);
  });

  it("omits targetPrice entirely when left blank", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    pickSfBay();
    fireEvent.change(screen.getByLabelText(/looking for/i), {
      target: { value: "Mac Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect("targetPrice" in onSubmit.mock.calls[0]![0]).toBe(false);
  });

  it("does not submit without a location", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/looking for/i), {
      target: { value: "Mac Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a location/i)).toBeTruthy();
  });

  it("does not submit with a location but no query", () => {
    const onSubmit = vi.fn();
    render(<WatchForm onSubmit={onSubmit} />);

    pickSfBay();
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/say what you are looking for/i)).toBeTruthy();
  });

  it("keeps the location and category after a successful submit", () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<WatchForm onSubmit={onSubmit} />);

    pickSfBay();
    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: "sya" },
    });
    fireEvent.change(screen.getByLabelText(/looking for/i), {
      target: { value: "Mac Studio" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create watch/i }));
    expect(onSubmit).toHaveBeenCalledOnce();

    // Remount, as a page reload would.
    unmount();
    render(<WatchForm onSubmit={vi.fn()} />);

    expect(
      (screen.getByLabelText(/location/i) as HTMLInputElement).value
    ).toContain("SF bay area");
    expect((screen.getByLabelText(/category/i) as HTMLSelectElement).value).toBe(
      "sya"
    );
    // The query is cleared; the next watch is usually a different item.
    expect(
      (screen.getByLabelText(/looking for/i) as HTMLInputElement).value
    ).toBe("");
  });

  it("filters the location list as the user types", () => {
    render(<WatchForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/location/i), {
      target: { value: "zzzznotacity" },
    });
    expect(screen.getByText(/no matching cities/i)).toBeTruthy();
  });
});
