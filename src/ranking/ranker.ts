import type { AppConfig } from "../config/schema";
import type { FullyEvaluatedCandidate } from "../transit/types";

export type RankingConfig = Pick<AppConfig, "maxCandidatesReturned">;
// Narrowed per the REV-011 pattern already established across every other
// module in src/ (AuthGate, RadiusValidator, CandidateGenerator,
// DetourEvaluator, ShortlistSelector, TransitEvaluator all narrow their
// `config` parameter to a Pick<AppConfig, ...> rather than the full
// AppConfig design.md section 5.1 literally shows) -- same reviewer-endorsed
// rationale (better testability, no caller-side friction since any full
// AppConfig structurally satisfies the narrower type). Flagged in
// docs/handoff.md as extending REV-011's already-tracked scope, not a new
// issue.

/**
 * Mirrors design.md section 5.1's `RankedResult` union / `Ranker.rank`
 * signature exactly.
 */
export type RankedResult =
  | { status: "ranked"; results: FullyEvaluatedCandidate[] }
  | { status: "fallback"; results: [FullyEvaluatedCandidate]; warning: string }
  | { status: "no_viable_option" };

function byPassengerTimeThenRouteOrder(a: FullyEvaluatedCandidate, b: FullyEvaluatedCandidate): number {
  if (a.passengerTotalTimeMinutes !== b.passengerTotalTimeMinutes) {
    return a.passengerTotalTimeMinutes - b.passengerTotalTimeMinutes;
  }
  // FR-010/OQ-2: among equal passenger total times, the candidate earlier on
  // the driver's route (lower routeOrderIndex) ranks higher.
  return a.routeOrderIndex - b.routeOrderIndex;
}

/**
 * Implements design.md section 4.5's Phase 4 (FR-010, FR-011, FR-012):
 *
 * - Step 14: among candidates with `qualifies=true` and
 *   `noTransitAvailable=false`, sort ascending by `passengerTotalTimeMinutes`
 *   (tie-break: lower `routeOrderIndex` first), return the top
 *   `maxCandidatesReturned` as `status: "ranked"`.
 * - Step 15: if that qualifying set is empty, pick the single smallest
 *   `passengerTotalTimeMinutes` among *all* candidates (qualifying or not)
 *   with `noTransitAvailable=false`, and return it alone as
 *   `status: "fallback"` with a warning naming the threshold and the actual
 *   detour (FR-011, resolved OQ-3).
 * - Step 16: if there is no candidate at all with `noTransitAvailable=false`
 *   (every candidate has no viable transit, or never had a viable driving
 *   route to begin with -- design.md section 4.4 step 13 / DEC-3), return
 *   `status: "no_viable_option"` with no candidates.
 *
 * Implemented as a single `viable = !noTransitAvailable` filter checked
 * first (short-circuiting straight to step 16 if it's empty) rather than
 * three sequential passes -- this is a faithful refactor of the same
 * algorithm, not a behavioral deviation: if no candidate is viable, no
 * candidate can qualify either, so steps 14/15 would find nothing regardless
 * of check order.
 */
export const Ranker = {
  rank(
    fullyEvaluated: FullyEvaluatedCandidate[],
    maxDetourMinutes: number,
    config: RankingConfig,
  ): RankedResult {
    const viable = fullyEvaluated.filter((candidate) => !candidate.noTransitAvailable);

    if (viable.length === 0) {
      return { status: "no_viable_option" };
    }

    const qualifyingViable = [...viable]
      .filter((candidate) => candidate.qualifies)
      .sort(byPassengerTimeThenRouteOrder);

    if (qualifyingViable.length > 0) {
      return { status: "ranked", results: qualifyingViable.slice(0, config.maxCandidatesReturned) };
    }

    const sortedViable = [...viable].sort(byPassengerTimeThenRouteOrder);
    // Safe: viable.length > 0 is already established above.
    const best = sortedViable[0]!;

    const threshold = Math.round(maxDetourMinutes);
    const actualDetour = Math.round(best.detourMinutes);
    const warning =
      `None of the drop-off points found keep your detour under ${threshold} minutes. ` +
      `Here's the option that gets your passenger there fastest anyway — it adds ${actualDetour} minutes.`;

    return { status: "fallback", results: [best], warning };
  },
};
