import type { LatLng } from "../geo/types.js";

/** Mirrors design.md section 5.1's `GeoResult`. */
export interface GeoResult {
  lat: number;
  lng: number;
  label: string;
  placeId?: string;
}

/**
 * Mirrors design.md section 5.1's `GeocodingService` interface. Implementations
 * are provider-specific (see googleGeocodingService.ts) but this interface is
 * what the API handler and any future caller depend on, so the provider can
 * be swapped without touching call sites.
 */
export interface GeocodingService {
  resolve(query: string): Promise<GeoResult[]>;
  reverseGeocode(point: LatLng): Promise<string>;
}
