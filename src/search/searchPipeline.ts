import { CandidateGenerator } from "../candidates/candidateGenerator.js";
import type { DetourEvaluator } from "../candidates/detourEvaluator.js";
import { ShortlistSelector } from "../candidates/shortlistSelector.js";
import type { AppConfig } from "../config/schema.js";
import type { LatLng } from "../geo/types.js";
import { Ranker, type RankedResult } from "../ranking/ranker.js";
import { analyzeTollUsage } from "../routing/tollHighwayRules.js";
import type { RoutingService } from "../routing/types.js";
import { evaluateShortlist } from "../transit/evaluateShortlist.js";
import type { FullyEvaluatedCandidate, TransitEvaluator } from "../transit/types.js";

export interface SearchPipelineDeps {
  routingService: RoutingService;
  detourEvaluator: DetourEvaluator;
  transitEvaluator: TransitEvaluator;
}

export interface SearchPipelineParams {
  start: LatLng;
  driverDestination: LatLng;
  passengerDestination: LatLng;
  maxDetourMinutes: number;
  avoidTolls: boolean;
  config: AppConfig;
  /** design.md section 6.3 (NFR-004/INC-7): the overall per-request orchestration deadline. */
  orchestrationDeadline: Date;
}

export type SearchPipelineOutcome =
  | { kind: "no_toll_free_route" }
  | {
      kind: "computed";
      /** The direct-baseline route's decoded polyline (INC-9's `route` response field). */
      route: LatLng[];
      /**
       * The whole transit-evaluated shortlist pool (Phase 3's output, pre-
       * ranking) -- design.md section 4.6 step 4 needs this "already computed
       * and available to reconstruct" pool so the confirm-toll-reentry
       * endpoint can exclude rejected candidates and re-rank without
       * re-fetching driving/transit data for candidates already evaluated.
       */
      fullyEvaluated: FullyEvaluatedCandidate[];
      /** Phase 4's ranking/fallback/no-viable-option output (design.md section 4.5) over the full (unfiltered) pool. */
      ranked: RankedResult;
      /**
       * True when `ranked.status === "no_viable_option"` specifically
       * because the orchestration deadline was exceeded before any
       * shortlisted candidate's transit call could even start (design.md
       * section 6.3) -- distinct from a genuine "nothing is reachable"
       * business outcome.
       */
      timedOut: boolean;
    };

/**
 * Implements design.md section 4's Phases 0-4 (FR-005 through FR-013,
 * FR-018, FR-020) as a single, reusable function -- extracted (INC-14) from
 * `api/drop-off-search.ts` so `api/drop-off-search/confirm-toll-reentry.ts`
 * (design.md section 5.2, FR-019/OQ-10) can "re-derive the search
 * deterministically from `originalRequest`" (section 4.6 step 4's own words)
 * by calling the exact same pipeline, rather than a second, drifting copy of
 * this orchestration.
 *
 * Deliberately stops at Phase 4 (ranking) -- section 4.6's Phase 5 (toll
 * re-entry detection, FR-019) and section 3.1b's reverse-geocode labeling
 * both need endpoint-specific handling (the confirm endpoint's exclusion/
 * re-rank step sits *between* this function's output and Phase 5; the two
 * endpoints also attach toll-reentry flags to different subsets of the final
 * candidates -- see `src/search/tollReentryPhase.ts`), so those stay in each
 * endpoint's own orchestration rather than being folded into this shared
 * function.
 */
export async function runSearchPipeline(
  deps: SearchPipelineDeps,
  params: SearchPipelineParams,
): Promise<SearchPipelineOutcome> {
  const { routingService, detourEvaluator, transitEvaluator } = deps;
  const { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls, config, orchestrationDeadline } =
    params;

  const directRoute = await routingService.getDirectRoute(start, driverDestination, avoidTolls);

  // FR-018/OQ-9, design.md section 4.1a (INC-13): when "avoid tolls" is
  // checked, verify the best-effort avoid=tolls baseline route actually
  // cleared a known toll road (DEC-5 -- Google's avoid=tolls is a
  // preference, not a guarantee). If it still uses one, no reasonably
  // toll-free route exists at all -- short-circuit before Phase 1 ever runs.
  if (avoidTolls && analyzeTollUsage(directRoute.steps).usesTollRoad) {
    return { kind: "no_toll_free_route" };
  }

  const rawCandidates = CandidateGenerator.sampleAlongPolyline(directRoute.polyline, directRoute.steps, config);
  const evaluatedCandidates = await detourEvaluator.batchEvaluate(
    start,
    driverDestination,
    directRoute.durationMinutes,
    rawCandidates,
    maxDetourMinutes,
    avoidTolls,
    config,
  );
  const shortlist = ShortlistSelector.select(evaluatedCandidates, config);

  let skippedDueToTimeout = 0;
  const fullyEvaluated = await evaluateShortlist(transitEvaluator, shortlist, passengerDestination, config, {
    deadline: orchestrationDeadline,
    onSkippedDueToDeadline: () => {
      skippedDueToTimeout++;
    },
  });

  const ranked = Ranker.rank(fullyEvaluated, maxDetourMinutes, config);
  const timedOut =
    ranked.status === "no_viable_option" && shortlist.length > 0 && skippedDueToTimeout === shortlist.length;

  return { kind: "computed", route: directRoute.polyline, fullyEvaluated, ranked, timedOut };
}
