import type { LatLng } from "../geo/types.js";
import type { AppConfig } from "../config/schema.js";
import type { EvaluatedCandidate } from "../candidates/detourEvaluator.js";
import type { FullyEvaluatedCandidate, TransitEvaluator } from "./types.js";

export type ShortlistTransitEvaluationConfig = Pick<
  AppConfig,
  "transitModesIncluded" | "providerConcurrencyLimit"
>;

export interface EvaluateShortlistOptions {
  /** Injectable clock, purely for deterministic tests of the departure-time computation below. */
  now?: () => Date;
  /**
   * design.md section 6.3 (NFR-004/INC-7): an overall per-request deadline.
   * Once this instant has passed, the worker pool stops *dispatching new*
   * transit-evaluation calls and reports any not-yet-started candidate as
   * `noTransitAvailable: true` -- a graceful degraded result (whatever
   * candidates already completed are still returned and can still rank/
   * fallback normally) rather than blocking the whole request until every
   * candidate's transit call resolves. Already-in-flight calls are not
   * aborted here (each one is already bounded by its own
   * `REQUEST_TIMEOUT_MS`, see googleTransitDirectionsService.ts), so the
   * worst-case overrun past `deadline` is one more per-call timeout, not an
   * unbounded hang. Optional -- omitted entirely by every existing caller/
   * test that doesn't care about the orchestration-level deadline.
   */
  deadline?: Date;
  /**
   * Invoked once per candidate skipped specifically because `deadline` had
   * already passed when its turn came up -- lets the caller (api/drop-off-
   * search.ts) distinguish "we ran out of time before checking" (design.md
   * section 6.3's graceful-timeout path) from "no candidate had viable
   * transit" (a genuine FR-012 business outcome), without changing this
   * function's return shape (still a plain FullyEvaluatedCandidate[], so
   * every existing caller/test is unaffected).
   */
  onSkippedDueToDeadline?: () => void;
}

const DEADLINE_SKIPPED_RESULT = {
  walkTimeMinutes: 0,
  waitTimeMinutes: 0,
  transitTimeMinutes: 0,
  passengerTotalTimeMinutes: 0,
  noTransitAvailable: true as const,
};

/**
 * Orchestrates design.md section 4.4 steps 10-13 across the bounded
 * shortlist ShortlistSelector.select produces. This fan-out function itself
 * is not named in design.md section 5.1 (the design only specifies the
 * single-candidate `TransitEvaluator.evaluate`) -- transit Directions calls
 * cannot be batched into one request the way Distance Matrix calls can
 * (section 4.4's own stated rationale, each candidate needs a *different*
 * departure_time), so *something* has to fan the shortlist out across
 * parallel calls bounded by `PROVIDER_CONCURRENCY_LIMIT` (section 4.4 step
 * 10's explicit requirement). Implemented as its own small, pure,
 * dependency-injected module (rather than inlined in the API handler) so
 * QA can unit test the concurrency bound and the per-candidate
 * departure-time formula without mocking HTTP.
 *
 * For each candidate: `departureTime = requestNow + driveTimeToCandidateMinutes`
 * (section 4.4 step 10 -- the time the driver will actually arrive at that
 * drop-off point, computed once per request from a single `now()` call so
 * every candidate's departure time is anchored to the same reference
 * instant, not one clock reading per candidate).
 *
 * A candidate whose own driving legs had no viable route (`detourMinutes`/
 * `driveTimeToCandidateMinutes` both `Infinity`, from detourEvaluator.ts's
 * per-element-failure handling) has no meaningful arrival time to evaluate
 * transit from -- skipped without spending a provider call, returned
 * directly as `noTransitAvailable: true`.
 */
export async function evaluateShortlist(
  transitEvaluator: TransitEvaluator,
  shortlist: EvaluatedCandidate[],
  passengerDestination: LatLng,
  config: ShortlistTransitEvaluationConfig,
  options: EvaluateShortlistOptions = {},
): Promise<FullyEvaluatedCandidate[]> {
  const now = options.now ?? (() => new Date());
  const requestNow = now();
  const { deadline, onSkippedDueToDeadline } = options;
  const results: FullyEvaluatedCandidate[] = new Array(shortlist.length);

  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= shortlist.length) return;
      const candidate = shortlist[i]!;

      if (!Number.isFinite(candidate.driveTimeToCandidateMinutes)) {
        results[i] = { ...candidate, ...DEADLINE_SKIPPED_RESULT };
        continue;
      }

      if (deadline && Date.now() >= deadline.getTime()) {
        results[i] = { ...candidate, ...DEADLINE_SKIPPED_RESULT };
        onSkippedDueToDeadline?.();
        continue;
      }

      const departureTime = new Date(requestNow.getTime() + candidate.driveTimeToCandidateMinutes * 60_000);
      const transitResult = await transitEvaluator.evaluate(candidate, passengerDestination, departureTime, config);
      results[i] = { ...candidate, ...transitResult };
    }
  }

  const workerCount = Math.max(0, Math.min(config.providerConcurrencyLimit, shortlist.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
