import type { AppConfig } from "../config/schema";
import type { EvaluatedCandidate } from "./detourEvaluator";

export type ShortlistSelectionConfig = Pick<AppConfig, "maxTransitEvaluationsPerRequest">;

/**
 * Implements design.md section 5.1's `ShortlistSelector` / section 4.4 step
 * 9: transit evaluation is the slowest/most expensive per-candidate call
 * (a separate Directions call each, unlike Distance Matrix's batching), so
 * this bounds it to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` candidates:
 *
 * - Take qualifying (`qualifies: true`) candidates, ascending by
 *   `detourMinutes`, up to the cap.
 * - If fewer than the cap qualify, fill the remaining slots with the
 *   next-smallest-`detourMinutes` non-qualifying candidates, so FR-011's
 *   INC-6 fallback ("closest anyway") always has a transit-evaluated pool
 *   to search even when zero candidates qualify.
 *
 * `detourMinutes: Infinity` candidates (no viable driving route on either
 * leg, from detourEvaluator.ts) sort last within their own group by
 * construction -- no special-casing needed here.
 *
 * No FR/design text specifies a tie-break among candidates with exactly
 * equal `detourMinutes` at this shortlisting step (design.md's route-order
 * tie-break, FR-010, is scoped to the *final ranking*, INC-6, not
 * shortlisting) -- Array.sort's stable-sort guarantee means equal-detour
 * candidates keep their input (route-order) relative order, a reasonable
 * default rather than an invented business rule.
 */
export const ShortlistSelector = {
  select(evaluated: EvaluatedCandidate[], config: ShortlistSelectionConfig): EvaluatedCandidate[] {
    const byAscendingDetour = (a: EvaluatedCandidate, b: EvaluatedCandidate): number => a.detourMinutes - b.detourMinutes;

    const qualifying = evaluated.filter((candidate) => candidate.qualifies).sort(byAscendingDetour);
    const nonQualifying = evaluated.filter((candidate) => !candidate.qualifies).sort(byAscendingDetour);

    const shortlist = qualifying.slice(0, config.maxTransitEvaluationsPerRequest);
    const remainingSlots = config.maxTransitEvaluationsPerRequest - shortlist.length;
    if (remainingSlots > 0) {
      shortlist.push(...nonQualifying.slice(0, remainingSlots));
    }

    return shortlist;
  },
};
