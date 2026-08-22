import { useCallback, useState } from "react";
import { nearestSite, type Site } from "@craigsnotice/types";

export type GeoStatus =
  | "idle"
  | "locating"
  | "resolved"
  | "denied"
  | "unsupported";

export interface GeoState {
  status: GeoStatus;
  site: Site | null;
  error: string | null;
}

/**
 * Permission denial is never a hard failure — status becomes "denied" and the
 * UI falls back to the manual dropdown.
 */
export const useGeoSite = (
  geolocation: Geolocation | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.geolocation
) => {
  const [state, setState] = useState<GeoState>({
    status: "idle",
    site: null,
    error: null,
  });

  const locate = useCallback(() => {
    if (!geolocation) {
      setState({
        status: "unsupported",
        site: null,
        error: "geolocation unavailable",
      });
      return;
    }

    setState({ status: "locating", site: null, error: null });
    geolocation.getCurrentPosition(
      (position) => {
        const site = nearestSite({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setState({ status: "resolved", site, error: null });
      },
      (err) => setState({ status: "denied", site: null, error: err.message })
    );
  }, [geolocation]);

  return { ...state, locate };
};
