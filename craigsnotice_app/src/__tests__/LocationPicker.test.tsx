import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LocationPicker } from "../components/LocationPicker";
import { getSite } from "@craigsnotice/types";

const installGeolocation = (impl: Geolocation["getCurrentPosition"]): void => {
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition: impl, watchPosition: vi.fn(), clearWatch: vi.fn() },
    configurable: true,
  });
};

describe("LocationPicker", () => {
  beforeEach(() => {
    installGeolocation(vi.fn());
  });

  it("applies the resolved site after the user allows location", async () => {
    // Regression: this used to call onChange during render, so React discarded
    // it and allowing location appeared to do nothing.
    installGeolocation((ok) =>
      ok({
        coords: { latitude: 37.7749, longitude: -122.4194 },
      } as GeolocationPosition)
    );
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /locate me/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0]![0].code).toBe("sfbay");
  });

  it("fills the text field with the resolved city name", async () => {
    installGeolocation((ok) =>
      ok({
        coords: { latitude: 40.7128, longitude: -74.006 },
      } as GeolocationPosition)
    );
    render(<LocationPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /locate me/i }));

    await waitFor(() =>
      expect(
        (screen.getByLabelText(/location/i) as HTMLInputElement).value
      ).toBe("new york city")
    );
  });

  it("shows the saved location on first render", () => {
    render(<LocationPicker value={getSite("sfbay")!} onChange={vi.fn()} />);
    expect(
      (screen.getByLabelText(/location/i) as HTMLInputElement).value
    ).toBe("SF bay area");
  });

  it("surfaces a denial instead of failing silently", async () => {
    installGeolocation((_ok, fail) =>
      fail!({ code: 1, message: "denied" } as GeolocationPositionError)
    );
    render(<LocationPicker value={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /locate me/i }));

    await waitFor(() =>
      expect(screen.getByText(/permission denied/i)).toBeTruthy()
    );
  });
});
