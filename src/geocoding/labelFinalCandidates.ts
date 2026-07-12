import type { LatLng } from "../geo/types.js";
import { haversineDistanceKm } from "../geo/radiusValidator.js";
import type { GeocodingService } from "./types.js";

export interface LabelableCandidate {
  point: LatLng;
}

/**
 * Implements design.md section 3.1b: generates a human-readable "near ___"
 * label for each of the small set of *final* returned candidates only
 * (bounded by MAX_CANDIDATES_RETURNED, or 1 for the fallback case) -- never
 * the full raw/shortlist pool, to keep Geocoding API cost bounded per
 * design.md section 4.5's cost accounting.
 *
 * ux-spec.md section 6.4 explicitly anticipates reverse geocoding failing
 * for some candidate points ("falls back to a distance-along-route
 * phrasing, e.g. '~2.1 km into your route'") -- a per-candidate failure
 * (no matchable address, or a transient provider error) is handled with
 * that fallback rather than leaving the candidate unlabeled or failing the
 * whole search over one label. The fallback distance is straight-line
 * (haversine) from `start`, not true along-route distance -- the exact
 * along-route distance isn't retained by this point in the pipeline
 * (CandidateGenerator only keeps `routeOrderIndex`, not cumulative meters
 * downstream). This is a reasonable approximation for a rarely-hit fallback
 * path, flagged in docs/handoff.md for tech-lead awareness.
 */
export async function labelFinalCandidates<T extends LabelableCandidate>(
  geocodingService: GeocodingService,
  start: LatLng,
  candidates: T[],
): Promise<(T & { label: string })[]> {
  return Promise.all(
    candidates.map(async (candidate) => {
      try {
        const label = await geocodingService.reverseGeocode(candidate.point);
        return { ...candidate, label };
      } catch {
        const distanceKm = haversineDistanceKm(start, candidate.point);
        return { ...candidate, label: `~${distanceKm.toFixed(1)} km into your route` };
      }
    }),
  );
}
