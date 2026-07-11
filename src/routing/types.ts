import type { LatLng } from "../geo/types";

/** Mirrors design.md section 5.1's `RoutingService` interface. */
export interface DirectRouteResult {
  durationMinutes: number;
  polyline: LatLng[];
}

/**
 * Mirrors design.md section 5.1's `RoutingService` interface. Implementations
 * are provider-specific (see googleRoutingService.ts) but this interface is
 * what any caller (api/drop-off-search.ts, plus the candidate/detour
 * generation pipeline it orchestrates) depends on, so the provider can be
 * swapped without touching call sites.
 */
export interface RoutingService {
  /**
   * design.md section 4.1 step 2 / FR-006a / FR-007: the direct, no-stop
   * driving route from `start` to `dest`, using live traffic conditions.
   * `durationMinutes` is this design's FR-006b "direct drive time" baseline
   * (the value later subtracted from the via-dropoff route time to compute
   * detour, in INC-4's DetourEvaluator).
   */
  getDirectRoute(start: LatLng, dest: LatLng): Promise<DirectRouteResult>;
}
