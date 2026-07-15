import { locationKey } from "../geo/locationKey.js";
import type { FullyEvaluatedCandidate } from "../transit/types.js";
import type { TollReentryFlags } from "./tollReentryPhase.js";
import type { DropOffSearchCandidate } from "./types.js";

export type LabeledFullyEvaluatedCandidate = FullyEvaluatedCandidate & { label: string };

/**
 * Maps Phase 4's ranked/fallback `FullyEvaluatedCandidate`s (already
 * reverse-geocode-labeled, design.md section 3.1b) into the wire shape
 * `DropOffSearchResponse.candidates` documents (section 5.2). Extracted
 * (INC-14) from `api/drop-off-search.ts` so
 * `api/drop-off-search/confirm-toll-reentry.ts` builds an identical shape
 * from its own re-derived/re-ranked candidate set, rather than a second,
 * drifting copy of this mapping.
 *
 * `tollFlagsByKey` (FR-019, INC-14): looked up by `locationKey`, not array
 * index, since the two endpoints run Phase 5 (design.md section 4.6) over
 * different subsets of `labeled` (every candidate on the first search vs.
 * only newly-promoted candidates on the confirm endpoint) -- a candidate
 * with no entry in the map simply gets `needsTollReentryConfirmation:
 * undefined`, matching section 5.2's "present only when ... found an
 * exit/re-entry pattern" contract.
 */
export function toDropOffSearchCandidates(
  labeled: LabeledFullyEvaluatedCandidate[],
  tollFlagsByKey: Map<string, TollReentryFlags>,
): DropOffSearchCandidate[] {
  return labeled.map((candidate, index) => {
    const flags = tollFlagsByKey.get(locationKey(candidate.point));
    return {
      rank: index + 1,
      location: candidate.point,
      label: candidate.label,
      routeOrderIndex: candidate.routeOrderIndex,
      driveTimeToDropoffMinutes: candidate.driveTimeToCandidateMinutes,
      detourMinutes: candidate.detourMinutes,
      walkTimeMinutes: candidate.walkTimeMinutes,
      waitTimeMinutes: candidate.waitTimeMinutes,
      transitTimeMinutes: candidate.transitTimeMinutes,
      passengerTotalTimeMinutes: candidate.passengerTotalTimeMinutes,
      // FR-006f: trivial sum.
      driverTotalTimeMinutes: candidate.driveTimeToCandidateMinutes + candidate.driveTimeFromCandidateMinutes,
      exceedsThreshold: !candidate.qualifies,
      // FR-021 (INC-12): threaded straight through from FullyEvaluatedCandidate.
      boardingStop: candidate.boardingStop,
      arrivalStop: candidate.arrivalStop,
      // FR-019 (INC-14): present only when this candidate's own Phase 5 check
      // (this search, or a prior confirm round) found an exit/re-entry
      // pattern -- undefined for every candidate not in `tollFlagsByKey`.
      needsTollReentryConfirmation: flags?.needsTollReentryConfirmation,
      tollReentryDescription: flags?.tollReentryDescription,
    };
  });
}
