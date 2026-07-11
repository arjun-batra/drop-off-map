import type { LatLng } from "./types";

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance between two points, in kilometers. Pure function so
 * both the backend (future /api/drop-off-search, INC-4+) and the frontend
 * (immediate field-level radius feedback, ux-spec.md section 4.1) can share
 * one implementation rather than duplicating the math or round-tripping to
 * the server just to check a distance -- GEOGRAPHIC_CENTER/RADIUS_KM are
 * already public (see config/publicConfig.ts), so no secret is at risk.
 */
export function haversineDistanceKm(a: LatLng, b: LatLng): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mirrors design.md section 5.1's `RadiusValidator` interface. */
export interface RadiusServiceAreaConfig {
  geographicCenter: LatLng;
  geographicRadiusKm: number;
}

export const RadiusValidator = {
  isWithinServiceArea(point: LatLng, config: RadiusServiceAreaConfig): boolean {
    return haversineDistanceKm(point, config.geographicCenter) <= config.geographicRadiusKm;
  },
};
