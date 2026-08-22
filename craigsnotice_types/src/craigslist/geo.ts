import { SITES, type Site } from "./reference";

export interface Coords {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineKm = (a: Coords, b: Coords): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const nearestSite = (coords: Coords): Site => {
  let best = SITES[0];
  if (!best) throw new Error("site table is empty");
  let bestDistance = haversineKm(coords, best);

  for (const site of SITES) {
    const d = haversineKm(coords, site);
    if (d < bestDistance) {
      best = site;
      bestDistance = d;
    }
  }
  return best;
};
