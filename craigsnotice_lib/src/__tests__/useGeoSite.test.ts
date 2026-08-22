import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGeoSite } from "../hooks/useGeoSite";

const geoWith = (impl: Geolocation["getCurrentPosition"]): Geolocation =>
  ({
    getCurrentPosition: impl,
    watchPosition: vi.fn(),
    clearWatch: vi.fn(),
  }) as unknown as Geolocation;

describe("useGeoSite", () => {
  it("starts idle with no site", () => {
    const { result } = renderHook(() => useGeoSite(geoWith(vi.fn())));
    expect(result.current.status).toBe("idle");
    expect(result.current.site).toBeNull();
  });

  it("resolves San Francisco coordinates to sfbay", async () => {
    const geo = geoWith((ok) =>
      ok({
        coords: { latitude: 37.7749, longitude: -122.4194 },
      } as GeolocationPosition)
    );
    const { result } = renderHook(() => useGeoSite(geo));

    act(() => result.current.locate());

    await waitFor(() => expect(result.current.status).toBe("resolved"));
    expect(result.current.site!.code).toBe("sfbay");
  });

  it("reports denied without throwing when permission is refused", async () => {
    const geo = geoWith((_ok, fail) =>
      fail!({ code: 1, message: "denied" } as GeolocationPositionError)
    );
    const { result } = renderHook(() => useGeoSite(geo));

    act(() => result.current.locate());

    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.site).toBeNull();
  });

  it("reports unsupported when no geolocation object is available", () => {
    const { result } = renderHook(() => useGeoSite(undefined));
    act(() => result.current.locate());
    expect(result.current.status).toBe("unsupported");
  });
});
