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
   * (section 4.2a) and, since INC-13, FR-018's toll-free-baseline
   * verification (`analyzeTollUsage(steps)`, section 4.1a/4.7).
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
   *
   * `avoidTolls` (2026-07-12, FR-018/INC-13, design.md section 5.1): the
   * per-request "avoid tolls" checkbox value (never an AppConfig field, same
   * per-request-input precedent as `maxDetourMinutes`). When true, the
   * implementation requests the provider's `avoid=tolls` parameter -- a
   * best-effort preference, not a hard guarantee (DEC-5) -- on this call.
   */
  getDirectRoute(start: LatLng, dest: LatLng, avoidTolls: boolean): Promise<DirectRouteResult>;
}
