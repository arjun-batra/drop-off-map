import { locationKey } from "../geo/locationKey.js";
import type { LatLng } from "../geo/types.js";
import { checkTollReentryForCandidates } from "../routing/tollReentryChecker.js";
import type { RoutingService } from "../routing/types.js";

export interface TollReentryFlags {
  needsTollReentryConfirmation: boolean;
  tollReentryDescription?: string;
}

/**
 * Implements design.md section 4.6's Phase 5 (FR-019, INC-14) over an
 * arbitrary set of "candidates that need checking" -- deliberately generic
 * over which candidates that is, since the two call sites need different
 * subsets: `api/drop-off-search.ts` checks *every* final candidate (nothing
 * has been asked about yet), while
 * `api/drop-off-search/confirm-toll-reentry.ts` checks only newly-promoted
 * candidates the user was never shown (section 4.6 step 4 / ux-spec.md
 * section 5a.4 -- "do not re-ask" a candidate the user already answered).
 *
 * Returns a `Map` keyed by `locationKey` (not an array parallel to the input)
 * so callers can merge flags onto a differently-shaped candidate list (e.g.
 * the reverse-geocoded/labeled `DropOffSearchCandidate[]`) by location,
 * without needing the two arrays to stay index-aligned through an
 * intermediate labeling step.
 */
export async function computeTollReentryFlags(
  routingService: RoutingService,
  start: LatLng,
  driverDestination: LatLng,
  candidatePoints: LatLng[],
  providerConcurrencyLimit: number,
): Promise<Map<string, TollReentryFlags>> {
  const flagsByKey = new Map<string, TollReentryFlags>();
  if (candidatePoints.length === 0) return flagsByKey;

  const results = await checkTollReentryForCandidates(
    routingService,
    start,
    driverDestination,
    candidatePoints,
    providerConcurrencyLimit,
  );

  candidatePoints.forEach((point, index) => {
    const result = results[index]!;
    if (result.needsTollReentryConfirmation) {
      flagsByKey.set(locationKey(point), {
        needsTollReentryConfirmation: true,
        tollReentryDescription: result.description,
      });
    }
  });

  return flagsByKey;
}
