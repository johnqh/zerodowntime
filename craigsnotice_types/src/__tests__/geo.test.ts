import { describe, it, expect } from "vitest";
import { haversineKm, nearestSite } from "../craigslist/geo";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(
      haversineKm({ lat: 37.77, lng: -122.42 }, { lat: 37.77, lng: -122.42 })
    ).toBe(0);
  });

  it("matches the known SF to NYC great-circle distance", () => {
    const d = haversineKm(
      { lat: 37.7749, lng: -122.4194 },
      { lat: 40.7128, lng: -74.006 }
    );
    expect(d).toBeGreaterThan(4120);
    expect(d).toBeLessThan(4140);
  });

  it("is symmetric", () => {
    const a = { lat: 34.05, lng: -118.24 };
    const b = { lat: 41.88, lng: -87.63 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});

describe("nearestSite", () => {
  it("resolves downtown San Francisco to sfbay", () => {
    expect(nearestSite({ lat: 37.7749, lng: -122.4194 }).code).toBe("sfbay");
  });

  it("resolves Manhattan to newyork", () => {
    expect(nearestSite({ lat: 40.7128, lng: -74.006 }).code).toBe("newyork");
  });

  it("always returns a site even for a far-offshore coordinate", () => {
    expect(nearestSite({ lat: 25.0, lng: -160.0 }).code).toBeTruthy();
  });
});
