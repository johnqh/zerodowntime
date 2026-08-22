import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertCard } from "../components/AlertCard";

const alert = {
  id: "a1",
  watchId: "w1",
  title: "Mac Studio M2 Max",
  price: 1200,
  url: "https://sfbay.craigslist.org/x/1.html",
  score: 88,
  reasoning: "34% under the median for this watch",
  priceVsMedian: -0.34,
  createdAt: "2026-08-22T12:00:00Z",
  userFeedback: null,
  imageUrl: "https://images.craigslist.org/00x0x_abc_600x450.jpg",
};

describe("AlertCard", () => {
  it("shows the title, price and agent reasoning", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    expect(screen.getByText("Mac Studio M2 Max")).toBeTruthy();
    expect(screen.getByText(/\$1,200/)).toBeTruthy();
    expect(screen.getByText(/34% under the median/)).toBeTruthy();
  });

  it("renders the median delta as a signed percentage", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    expect(screen.getByText(/-34% vs median/)).toBeTruthy();
  });

  it("reports a thumbs-down verdict", () => {
    const onFeedback = vi.fn();
    render(<AlertCard alert={alert} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole("button", { name: /not a good deal/i }));
    expect(onFeedback).toHaveBeenCalledWith("bad");
  });

  it("reports a thumbs-up verdict", () => {
    const onFeedback = vi.fn();
    render(<AlertCard alert={alert} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByRole("button", { name: /^good deal$/i }));
    expect(onFeedback).toHaveBeenCalledWith("good");
  });

  it("disables the buttons once feedback exists", () => {
    render(
      <AlertCard
        alert={{ ...alert, userFeedback: "good" }}
        onFeedback={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /^good deal$/i }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /not a good deal/i })
        .hasAttribute("disabled")
    ).toBe(true);
  });

  it("shows the listing photo", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(alert.imageUrl);
  });

  it("falls back to a placeholder when the listing has no photo", () => {
    render(<AlertCard alert={{ ...alert, imageUrl: null }} onFeedback={vi.fn()} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByText(/no photo/i).length).toBeGreaterThan(0);
  });

  it("links to the Craigslist listing explicitly", () => {
    render(<AlertCard alert={alert} onFeedback={vi.fn()} />);
    const link = screen.getByRole("link", { name: /view on craigslist/i });
    expect(link.getAttribute("href")).toBe(alert.url);
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("handles a listing with no price without rendering NaN", () => {
    render(<AlertCard alert={{ ...alert, price: null }} onFeedback={vi.fn()} />);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText(/No price/i)).toBeTruthy();
  });
});
