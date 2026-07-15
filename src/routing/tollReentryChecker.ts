import type { LatLng } from "../geo/types.js";
import { analyzeTollUsage, describeTollRoadReentry } from "./tollHighwayRules.js";
import type { RoutingService } from "./types.js";

/** Mirrors design.md section 5.1's `TollReentryCheckResult` (FR-019, INC-14). */
export interface TollReentryCheckResult {
  needsTollReentryConfirmation: boolean;
  /** Factual, e.g. "Highway 407 — exits and re-enters it during this trip" (section 4.6 step 2). */
  description?: string;
}

/**
 * Implements design.md section 5.1's `checkTollReentry` / section 4.6 Phase
 * 5, step 1-2 (FR-019, INC-14): for a single final (ranked/fallback)
 * candidate, issues 2 Directions-with-steps calls -- `start -> candidate` and
 * `candidate -> driverDestination` -- and concatenates the two step lists in
 * route order. This is the actual as-driven route via the stop, which can
 * differ from Phase 0's non-stop baseline route (section 4.1a) -- precisely
 * why a via-point-specific check is needed rather than reusing the baseline's
 * steps.
 *
 * Both calls pass `avoidTolls: false` unconditionally, never a parameter --
 * design.md section 5.1 documents this phase as running "WITHOUT avoid=tolls
 * -- this phase only runs when avoidTolls===false per FR-019's own scope," so
 * there is only ever one legitimate value here; a caller-supplied parameter
 * would just be dead surface area for a value that can never legitimately be
 * anything else at this call site.
 */
export async function checkTollReentry(
  routingService: RoutingService,
  start: LatLng,
  candidate: LatLng,
  driverDestination: LatLng,
): Promise<TollReentryCheckResult> {
  const [toCandidate, fromCandidate] = await Promise.all([
    routingService.getDirectRoute(start, candidate, false),
    routingService.getDirectRoute(candidate, driverDestination, false),
  ]);

  const concatenatedSteps = [...toCandidate.steps, ...fromCandidate.steps];
  const { hasExitReentry } = analyzeTollUsage(concatenatedSteps);

  if (!hasExitReentry) {
    return { needsTollReentryConfirmation: false };
  }

  return {
    needsTollReentryConfirmation: true,
    description: describeTollRoadReentry(concatenatedSteps),
  };
}

/**
 * Fans `checkTollReentry` out across a small set of final candidates, bounded
 * by `providerConcurrencyLimit` (the same `PROVIDER_CONCURRENCY_LIMIT` config
 * value every other provider-call fan-out in this codebase already reads --
 * design.md section 6.1's "run in parallel across the small final candidate
 * set (bounded by PROVIDER_CONCURRENCY_LIMIT like every other fan-out in this
 * design)"). Reuses the same worker-pool shape as
 * `src/transit/evaluateShortlist.ts` for consistency, even though the final
 * candidate set is always small (at most `MAX_CANDIDATES_RETURNED`, or 1 for
 * a fallback) -- honoring the configured bound here rather than an unbounded
 * `Promise.all` keeps this call site auditable against the same tunable,
 * not a second, silently-uncapped fan-out.
 *
 * Order-preserving: `results[i]` corresponds to `candidatePoints[i]`.
 */
export async function checkTollReentryForCandidates(
  routingService: RoutingService,
  start: LatLng,
  driverDestination: LatLng,
  candidatePoints: LatLng[],
  providerConcurrencyLimit: number,
): Promise<TollReentryCheckResult[]> {
  const results: TollReentryCheckResult[] = new Array(candidatePoints.length);

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= candidatePoints.length) return;
      results[i] = await checkTollReentry(routingService, start, candidatePoints[i]!, driverDestination);
    }
  }

  const workerCount = Math.max(0, Math.min(providerConcurrencyLimit, candidatePoints.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
