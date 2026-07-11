import type { LatLng } from "../geo/types";
import { fetchWithTimeout, ProviderTimeoutError, type TimeoutAwareFetch } from "../http/fetchWithTimeout";
import { RoutingProviderError } from "../routing/errors";
import type { TransitEvaluationConfig, TransitEvaluator, TransitResult } from "./types";

const GOOGLE_TRANSIT_DIRECTIONS_ENDPOINT = "https://maps.googleapis.com/maps/api/directions/json";

type FetchLike = TimeoutAwareFetch;

interface GoogleTransitStep {
  travel_mode: string; // "WALKING" | "TRANSIT" (Google's transit-mode routes only ever contain these two)
  duration: { value: number };
  transit_details?: {
    departure_time: { value: number };
    arrival_time: { value: number };
  };
}

interface GoogleTransitLeg {
  steps: GoogleTransitStep[];
}

interface GoogleTransitRoute {
  legs: GoogleTransitLeg[];
}

interface GoogleDirectionsTransitResponse {
  status: string;
  error_message?: string;
  routes: GoogleTransitRoute[];
}

export interface GoogleTransitServiceOptions {
  /** design.md section 7's MAP_API_KEY -- server-side only, never sent to the browser. */
  apiKey: string;
  /** Injectable for testability; defaults to the global fetch (Node 18+/Vercel runtime). */
  fetchImpl?: FetchLike;
  /** Injectable so tests don't hit the real Google endpoint. */
  endpoint?: string;
  /**
   * design.md section 6.3/7's REQUEST_TIMEOUT_MS -- hard per-call timeout
   * (INC-7/NFR-004). Optional so existing unit tests that construct this
   * service without a timeout keep working unmodified (see
   * src/http/fetchWithTimeout.ts); every production caller always supplies
   * `config.requestTimeoutMs`. Transit calls are the slowest/most variable
   * leg per design.md section 6.1 -- this is the single most important call
   * site for this timeout to actually bind.
   */
  timeoutMs?: number;
}

const NO_TRANSIT_RESULT: TransitResult = {
  walkTimeMinutes: 0,
  waitTimeMinutes: 0,
  transitTimeMinutes: 0,
  passengerTotalTimeMinutes: 0,
  noTransitAvailable: true,
};

function isGoogleDirectionsTransitResponse(body: unknown): body is GoogleDirectionsTransitResponse {
  return typeof body === "object" && body !== null && "status" in body;
}

function formatLatLng(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

/**
 * design.md section 4.4 step 10: filters the transit-mode call by
 * TRANSIT_MODES_INCLUDED. "all" (the config default) omits the
 * `transit_mode` parameter entirely, matching Google's own default of
 * considering every available mode -- an explicit list is joined with "|",
 * Google's documented separator for multiple transit_mode values (e.g.
 * "bus|subway"), not the comma the config's own env-var syntax uses.
 */
function transitModeParam(config: TransitEvaluationConfig): string | undefined {
  if (config.transitModesIncluded === "all") return undefined;
  if (config.transitModesIncluded.length === 0) return undefined;
  return config.transitModesIncluded.join("|");
}

/**
 * Pure parser (exported for direct QA unit testing against hand-built Google
 * response fixtures, no network/mocking needed): walks a transit route's
 * steps in order, implementing design.md section 4.4 step 11's exact
 * formulas.
 *
 * - WALKING steps accumulate `walkTimeMinutes` (this also covers "transfer"
 *   walking between two transit legs -- Google represents a transfer as an
 *   ordinary WALKING step between two TRANSIT steps, there is no distinct
 *   "transfer" step type).
 * - TRANSIT steps: `waitTimeMinutes` accumulates the gap between the
 *   "clock" (when the passenger arrived at that stop, from all prior steps)
 *   and the step's actual (live-adjusted, per FR-008) departure time;
 *   `transitTimeMinutes` accumulates in-vehicle time (arrival - departure
 *   time for that step). The running clock is then advanced to the
 *   transit step's arrival time, so a multi-transfer itinerary's wait/ride
 *   time is computed leg by leg, not just once for the whole trip.
 * - `Math.max(0, ...)` guards against a rare negative value from clock-skew/
 *   rounding in the provider's own timestamps -- a small negative wait or
 *   ride time is not a meaningful passenger-facing quantity.
 *
 * `sawTransitStep` lets the caller distinguish "a route was returned but it
 * contains zero actual transit legs" (a walking-only route -- a genuinely
 * valid, near-zero-transit-time result, see googleTransitDirectionsService's
 * `evaluate`) from a genuine multi-leg transit itinerary. Note that when
 * there are zero TRANSIT steps, `waitTimeMinutes`/`transitTimeMinutes` are
 * already correctly 0 by construction (nothing accumulates into them) and
 * `walkTimeMinutes`/`passengerTotalTimeMinutes` already equal the route's
 * full walking duration -- the formulas below need no special-casing for
 * this, only the caller's decision of what `noTransitAvailable` to report.
 */
export function parseTransitRoute(
  route: GoogleTransitRoute,
  requestedDepartureSeconds: number,
): { walkTimeMinutes: number; waitTimeMinutes: number; transitTimeMinutes: number; passengerTotalTimeMinutes: number; sawTransitStep: boolean } {
  let clock = requestedDepartureSeconds;
  let walkSeconds = 0;
  let waitSeconds = 0;
  let transitSeconds = 0;
  let sawTransitStep = false;

  for (const leg of route.legs) {
    for (const step of leg.steps) {
      if (step.travel_mode === "WALKING") {
        walkSeconds += step.duration.value;
        clock += step.duration.value;
      } else if (step.travel_mode === "TRANSIT" && step.transit_details) {
        sawTransitStep = true;
        const departureSeconds = step.transit_details.departure_time.value;
        const arrivalSeconds = step.transit_details.arrival_time.value;
        waitSeconds += Math.max(0, departureSeconds - clock);
        transitSeconds += Math.max(0, arrivalSeconds - departureSeconds);
        clock = arrivalSeconds;
      } else {
        // Defensive fallback for any step Google's docs don't lead us to
        // expect on a transit-mode route -- fold its duration into transit
        // time rather than silently dropping it from the total.
        transitSeconds += step.duration.value;
        clock += step.duration.value;
      }
    }
  }

  return {
    walkTimeMinutes: walkSeconds / 60,
    waitTimeMinutes: waitSeconds / 60,
    transitTimeMinutes: transitSeconds / 60,
    passengerTotalTimeMinutes: (walkSeconds + waitSeconds + transitSeconds) / 60,
    sawTransitStep,
  };
}

/**
 * Implements `TransitEvaluator` (design.md section 5.1) against Google Maps
 * Platform's Directions API, transit mode (design.md section 3's chosen
 * provider/SKU for FR-006c/d/e, FR-008) -- the same Directions API endpoint
 * `googleRoutingService.ts` already uses for driving, just a different
 * `mode`/response shape, so `RoutingProviderError` (src/routing/errors.ts)
 * is reused rather than inventing a new error class for the same provider
 * family (matching the precedent already set by
 * googleDistanceMatrixService.ts in INC-4). Server-side only -- `apiKey`
 * never reaches the browser.
 */
export function createGoogleTransitService(options: GoogleTransitServiceOptions): TransitEvaluator {
  const fetchImpl = options.fetchImpl ?? ((url: string, init?: { signal?: AbortSignal }) => fetch(url, init));
  const endpoint = options.endpoint ?? GOOGLE_TRANSIT_DIRECTIONS_ENDPOINT;

  return {
    async evaluate(candidate, passengerDestination, departureTime, config): Promise<TransitResult> {
      const url = new URL(endpoint);
      url.searchParams.set("origin", formatLatLng(candidate.point));
      url.searchParams.set("destination", formatLatLng(passengerDestination));
      url.searchParams.set("mode", "transit");
      // FR-008: live transit departure/schedule data, not static-only.
      // departureTime is candidate-specific (see evaluateShortlist.ts: it's
      // "now" plus this candidate's own driveTimeToCandidateMinutes, design.md
      // section 4.4 step 10) -- Google's Directions API returns live,
      // GTFS-RT-adjusted departure predictions for near-term departure_time
      // values where the transit agency provides real-time data (design.md
      // section 3's provider-capability confirmation).
      const departureSeconds = Math.floor(departureTime.getTime() / 1000);
      url.searchParams.set("departure_time", String(departureSeconds));
      const transitMode = transitModeParam(config);
      if (transitMode) url.searchParams.set("transit_mode", transitMode);
      url.searchParams.set("key", options.apiKey);

      let res: { ok: boolean; status: number; json: () => Promise<unknown> };
      try {
        res = await fetchWithTimeout(fetchImpl, url.toString(), options.timeoutMs);
      } catch (err) {
        if (err instanceof ProviderTimeoutError) {
          throw new RoutingProviderError("TIMEOUT", err.message);
        }
        throw new RoutingProviderError("NETWORK_ERROR", err instanceof Error ? err.message : "Network request failed.");
      }

      if (!res.ok) {
        throw new RoutingProviderError("HTTP_ERROR", `Transit provider HTTP ${res.status}.`);
      }

      const body = await res.json();
      if (!isGoogleDirectionsTransitResponse(body)) {
        throw new RoutingProviderError("MALFORMED_RESPONSE", "Transit provider returned an unexpected response shape.");
      }

      // design.md section 4.4 step 13 / FR-008's counterpart: ZERO_RESULTS
      // means the provider affirmatively found no transit route between this
      // candidate and the passenger's destination -- an expected, normal
      // outcome for some drop-off points (not every point along a route has
      // nearby transit access), not a provider/request failure. Distinct
      // from every other non-OK status below, which is a whole-call failure.
      if (body.status === "ZERO_RESULTS") {
        return { ...NO_TRANSIT_RESULT };
      }

      if (body.status !== "OK") {
        throw new RoutingProviderError(body.status, body.error_message);
      }

      const [route] = body.routes;
      if (!route || route.legs.length === 0) {
        return { ...NO_TRANSIT_RESULT };
      }

      const parsed = parseTransitRoute(route, departureSeconds);
      // A route with zero actual TRANSIT steps is a walking-only itinerary --
      // Google can return this for very short trips even when mode=transit
      // was requested, because the candidate is close enough to the
      // passenger's destination that no vehicle leg is needed. Per the
      // user's resolution of the judgment call flagged in docs/handoff.md's
      // INC-5 section (known limitation #3), this is a genuinely good
      // outcome -- the family member barely needs to travel -- and is
      // reported as a normal, valid result (`noTransitAvailable: false`),
      // not excluded to only the FR-011 fallback path. `sawTransitStep`
      // being false means `waitTimeMinutes`/`transitTimeMinutes` are already
      // (correctly) 0 -- no vehicle leg means nothing to wait for and no
      // in-vehicle time -- and `walkTimeMinutes`/`passengerTotalTimeMinutes`
      // already equal the route's full walking duration, since the entire
      // route IS the walk. No extra computation is needed here; only the
      // `noTransitAvailable` flag differs from a genuine transit itinerary.
      return {
        walkTimeMinutes: parsed.walkTimeMinutes,
        waitTimeMinutes: parsed.waitTimeMinutes,
        transitTimeMinutes: parsed.transitTimeMinutes,
        passengerTotalTimeMinutes: parsed.passengerTotalTimeMinutes,
        noTransitAvailable: false,
      };
    },
  };
}
