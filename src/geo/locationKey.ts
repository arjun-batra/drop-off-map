import type { LatLng } from "./types.js";

/**
 * Stable string key for comparing `LatLng` points across the two toll-reentry
 * endpoints (design.md section 4.6 step 4 / 5.2's `confirm-toll-reentry`
 * contract, FR-019/INC-14). Both `rejectedCandidateLocations` (client-
 * submitted, round-tripped through JSON) and the re-derived candidate pool
 * (server-recomputed from `originalRequest`) need to be compared by location
 * rather than by any server-side candidate ID, since neither endpoint keeps a
 * session (NFR-003, statelessness) -- there is no ID to compare instead.
 *
 * Rounded to 6 decimal places (~11cm at the equator) to tolerate any
 * floating-point serialization noise from a JSON round-trip without
 * over-matching two genuinely distinct sampled points.
 */
export function locationKey(point: LatLng): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}
