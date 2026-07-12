import type { AppConfig } from "../config/schema.js";
import type { LatLng } from "../geo/types.js";
import type { EvaluatedCandidate } from "../candidates/detourEvaluator.js";

/** Mirrors design.md section 5.1's `TransitResult`. */
export interface TransitResult {
  walkTimeMinutes: number;
  waitTimeMinutes: number;
  transitTimeMinutes: number;
  passengerTotalTimeMinutes: number;
  /**
   * True when the shortlisted candidate has genuinely no viable route at all
   * to the passenger's destination (design.md section 4.4 step 13 -- e.g.
   * Google's Directions API returns `ZERO_RESULTS` or an empty route list)
   * -- distinct from a whole-request provider failure (RoutingProviderError,
   * thrown, never reaches this shape). A candidate with
   * `noTransitAvailable: true` is excluded from INC-6's ranking/fallback
   * consideration but retained for FR-012's "no viable option at all" check.
   *
   * A walking-only route (Google returns a route with no TRANSIT-mode steps
   * because the candidate is already close enough to the passenger's
   * destination) is NOT this case -- per the user's resolution of the
   * judgment call originally flagged in docs/handoff.md's INC-5 section, it
   * is a genuinely good, valid result (near-zero `transitTimeMinutes`,
   * `waitTimeMinutes: 0`, `walkTimeMinutes`/`passengerTotalTimeMinutes`
   * equal to the full walk) and is reported with `noTransitAvailable: false`
   * so it ranks normally alongside real-transit candidates.
   */
  noTransitAvailable: boolean;
}

export type TransitEvaluationConfig = Pick<AppConfig, "transitModesIncluded">;

/**
 * Mirrors design.md section 5.1's `TransitEvaluator` interface: evaluates a
 * single shortlisted candidate's transit journey to the passenger's
 * destination, given an explicit `departureTime` (the caller -- see
 * evaluateShortlist.ts -- is responsible for computing this as
 * `now + driveTimeToCandidateMinutes` per section 4.4 step 10, since that is
 * a per-candidate value this interface has no way to derive on its own).
 */
export interface TransitEvaluator {
  evaluate(
    candidate: EvaluatedCandidate,
    passengerDestination: LatLng,
    departureTime: Date,
    config: TransitEvaluationConfig,
  ): Promise<TransitResult>;
}

/**
 * design.md section 5.1 references `FullyEvaluatedCandidate[]` in the
 * `Ranker.rank` signature but never defines the type itself -- the only
 * sensible definition, matching what section 4.4 steps 10-13 actually
 * produce per candidate, is Phase 2's `EvaluatedCandidate` merged with
 * Phase 3's `TransitResult`. Added here to make `Ranker`'s (INC-6) signature
 * computable, following the same "complete an apparent drafting gap rather
 * than silently guess" precedent as INC-4's `maxDetourMinutes` addition --
 * flagged to tech-lead in docs/handoff.md for confirmation, not silently
 * assumed.
 */
export interface FullyEvaluatedCandidate extends EvaluatedCandidate, TransitResult {}
