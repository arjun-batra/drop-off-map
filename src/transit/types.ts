import type { AppConfig } from "../config/schema";
import type { LatLng } from "../geo/types";
import type { EvaluatedCandidate } from "../candidates/detourEvaluator";

/** Mirrors design.md section 5.1's `TransitResult`. */
export interface TransitResult {
  walkTimeMinutes: number;
  waitTimeMinutes: number;
  transitTimeMinutes: number;
  passengerTotalTimeMinutes: number;
  /**
   * True when the shortlisted candidate has no viable transit itinerary at
   * all (design.md section 4.4 step 13) -- distinct from a whole-request
   * provider failure (RoutingProviderError, thrown, never reaches this
   * shape). A candidate with `noTransitAvailable: true` is excluded from
   * INC-6's ranking/fallback consideration but retained for FR-012's
   * "no viable option at all" check.
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
