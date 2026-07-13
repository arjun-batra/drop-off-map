import type { LatLng } from "../geo/types.js";

/**
 * Mirrors design.md section 5.1's `DirectionStep` (added 2026-07-12,
 * section 4.1a/INC-11). This is the only route-shape data the Legacy
 * Directions API actually exposes -- no structured toll/road-classification
 * field exists (design.md section 4.7). `instructionsHtml` is Google's raw
 * (HTML-tagged) per-step instruction text; consumers (e.g.
 * tollHighwayRules.ts's `isLimitedAccessHighway`) strip tags before
 * pattern-matching it. `cumulativeDistanceMeters` is the running total
 * distance (meters) from the start of the route through the end of this
 * step, used to attribute a sampled candidate point to its enclosing step
 * (design.md section 4.2a).
 */
export interface DirectionStep {
  instructionsHtml: string;
  distanceMeters: number;
  cumulativeDistanceMeters: number;
  maneuver?: string;
}

/** Mirrors design.md section 5.1's `RoutingService` interface. */
export interface DirectRouteResult {
  durationMinutes: number;
  polyline: LatLng[];
  /**
   * design.md section 4.1a/INC-11: previously fetched by every call and
   * silently discarded; now retained as new *data capture*, not a new
   * provider call. Needed by FR-020's highway-candidate attribution
   * (section 4.2a). FR-018's `avoidTolls` parameter and its toll-usage
   * verification are INC-13 scope, not added here.
   */
  steps: DirectionStep[];
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
  // NOTE: design.md section 5.1's current listing also shows a 3rd
  // `avoidTolls: boolean` parameter here (2026-07-12, FR-018) -- that is
  // INC-13 scope (the "avoid tolls" checkbox plumbing) and is deliberately
  // NOT added by this increment (INC-11, FR-020 only). INC-10/11/12 are
  // documented as mutually independent in design.md section 10's dependency
  // note, so this increment only introduces the `steps` data capture it
  // itself needs.
}
