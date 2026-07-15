/**
 * Shared request/response shapes for `POST /api/drop-off-search`
 * (design.md section 5.2). Framework-agnostic so both the backend handler
 * (api/drop-off-search.ts) and the frontend (src/frontend/api.ts,
 * SearchFlow.tsx, ResultsScreen.tsx) import the same types rather than
 * redeclaring them independently (the REV-007 duplication risk this project
 * already had to fix once for MIN_QUERY_LENGTH/DEBOUNCE_MS).
 */

import type { TransitStopDetail } from "../transit/types.js";

export interface DropOffSearchLocation {
  lat: number;
  lng: number;
  label: string;
}

export interface DropOffSearchRequest {
  start: DropOffSearchLocation;
  driverDestination: DropOffSearchLocation;
  passengerDestination: DropOffSearchLocation;
  /** FR-002, user-entered, no server default and no upper bound (design.md section 1.3). */
  maxDetourMinutes: number;
  /**
   * FR-018 (2026-07-12, INC-13, design.md section 5.2): the "avoid tolls"
   * checkbox value. Per-session/per-request user input (design.md section
   * 5.2's "no server default/config" comment means this value is never
   * sourced from `AppConfig`, not that the field is hard-required -- see
   * `src/search/parseSearchRequest.ts`'s `parseAvoidTolls` for the actual
   * validation rule and its reasoning).
   *
   * **Actual server behavior (REV-024, INC-14 -- corrected from a prior
   * version of this comment that asserted the opposite):** a request that
   * omits this field entirely defaults to `false` (the checkbox's own
   * unchecked default, ux-spec.md section 4.2a), so every pre-INC-13 request
   * shape remains valid. Only a field that IS present but is not a boolean
   * (a genuine shape violation, e.g. a string or number) fails validation as
   * `invalid_input`.
   */
  avoidTolls: boolean;
}

/**
 * Mirrors design.md section 5.2's `DropOffSearchResponse.status` union.
 * "ranked"/"fallback"/"no_viable_option" come from Ranker.rank (FR-010/011/012);
 * "out_of_service_area"/"invalid_input" come from this endpoint's own
 * pre-algorithm validation (FR-003/FR-004); "timeout" (INC-7, design.md
 * section 6.3/8) is returned when the overall per-request orchestration
 * deadline is exceeded before any candidate's transit evaluation could
 * complete -- distinct from `no_viable_option` (a genuine "nothing is
 * reachable" business outcome) so the frontend can invite a retry rather
 * than imply the trip itself has no viable drop-off point. "no_toll_free_route"
 * (2026-07-12, FR-018/OQ-9, INC-13, design.md section 4.1a) is a
 * message-only/empty-result outcome, same shape as `no_viable_option`,
 * returned only when `avoidTolls === true` and even Google's best-effort
 * toll-avoiding baseline route still traverses a known toll road (section
 * 4.7's `analyzeTollUsage`) -- a short-circuit before Phase 1 ever runs, not
 * a fallback to a toll-inclusive result.
 */
export type DropOffSearchStatus =
  | "ranked"
  | "fallback"
  | "no_viable_option"
  | "out_of_service_area"
  | "invalid_input"
  | "timeout"
  | "no_toll_free_route";

/** One candidate as shown to the end user -- design.md section 5.2, FR-013. */
export interface DropOffSearchCandidate {
  rank: number;
  location: { lat: number; lng: number };
  /** Reverse-geocoded, nearest-match label (design.md section 3.1b) -- "near ___" phrasing, not a guaranteed exact address. */
  label: string;
  routeOrderIndex: number;
  driveTimeToDropoffMinutes: number;
  detourMinutes: number;
  walkTimeMinutes: number;
  waitTimeMinutes: number;
  transitTimeMinutes: number;
  passengerTotalTimeMinutes: number;
  driverTotalTimeMinutes: number;
  /** True when this candidate's detourMinutes exceeds the user's requested maxDetourMinutes (only possible on the single "fallback" candidate). */
  exceedsThreshold: boolean;
  /**
   * FR-021 (INC-12, design.md section 5.2): the drop-off boarding stop
   * (name/location/line/direction) and the passenger's destination arrival
   * stop, present for **every** candidate in the response (not only rank 1)
   * -- both `undefined` for a walking-only candidate (DEC-3, FR-021's own
   * text that line/direction don't apply when no transit line exists).
   */
  boardingStop?: TransitStopDetail;
  arrivalStop?: TransitStopDetail;
  /**
   * FR-019 (2026-07-12, INC-14, design.md section 4.6/5.2): present (`true`)
   * only when `avoidTolls === false` and this candidate's actual driven route
   * (`start -> candidate -> driverDestination`, not the non-stop baseline)
   * exits and later re-enters a toll road within the trip
   * (`analyzeTollUsage`'s `hasExitReentry`, design.md section 4.7).
   * `undefined` for every other candidate -- both "never checked because
   * `avoidTolls === true`" and "checked, no re-entry pattern found" collapse
   * to the same `undefined`, since the frontend only needs to distinguish
   * "needs a yes/no answer or carries the round-cap disclosure" from
   * "nothing to say," not those two negative cases from each other.
   *
   * There is no separate top-level `DropOffSearchResponse` flag summarizing
   * "some candidate needs confirmation" (judgment call, INC-14): design.md's
   * documented response contract (section 5.2) only defines this
   * per-candidate field, not a response-level one, and ux-spec.md section
   * 5a.0 itself derives "show Screen 2a" from scanning
   * `response.candidates` for this flag ("the search response flags one or
   * more final candidates with `needsTollReentryConfirmation: true`") rather
   * than naming a separate summary field -- so the frontend computes
   * `response.candidates.some(c => c.needsTollReentryConfirmation)` itself
   * (see `src/frontend/components/SearchFlow.tsx`) rather than this type
   * inventing an undocumented field.
   */
  needsTollReentryConfirmation?: boolean;
  /** FR-019 (INC-14): factual pattern description, e.g. "Highway 407 — exits and re-enters it during this trip" (design.md section 4.6 step 2). Present only alongside `needsTollReentryConfirmation: true`. */
  tollReentryDescription?: string;
}

/**
 * FR-014's exact required disclaimer copy (ux-spec.md section 6.2 -- "do not
 * soften or shorten"). Defined once, here, in the framework-agnostic shared
 * types module both the backend (api/drop-off-search.ts) and the frontend
 * (DisclaimerBanner.tsx) import, rather than letting the same literal string
 * drift independently in two files -- the exact REV-007 duplication risk
 * this project already had to fix once (MIN_QUERY_LENGTH/DEBOUNCE_MS).
 */
export const DISCLAIMER_TEXT =
  "This is an estimated drop-off point only. Before stopping, confirm it's safe and legal to pull over here.";

/**
 * Mirrors design.md section 5.2's `DropOffSearchResponse`. `disclaimer`
 * (FR-014, INC-7) is present exactly when `candidates.length > 0` (i.e.
 * status is "ranked" or "fallback"), per design.md's own documented
 * contract -- see api/drop-off-search.ts for where it's populated.
 */
export interface DropOffSearchResponse {
  status: DropOffSearchStatus;
  candidates: DropOffSearchCandidate[];
  /** Present when status === "fallback" (FR-011). */
  warning?: string;
  /** Present for out_of_service_area / no_viable_option / invalid_input / timeout / no_toll_free_route (FR-004, FR-012, FR-003, INC-7, FR-018). */
  message?: string;
  /** FR-014 (INC-7): present exactly when candidates.length > 0 ("ranked"/"fallback"). */
  disclaimer?: string;
  requestId: string;
  /** For QA to verify NFR-004 empirically. */
  timingMs: number;
  /**
   * INC-9 (design.md section 3.1a/10, ux-spec.md section 6.7): the driver's
   * direct-route polyline, already decoded server-side by INC-3's
   * `RoutingService.getDirectRoute` for the same request -- this field adds
   * no new provider call, it just carries data the backend already computed
   * out to the frontend for the optional map view. **Design-doc gap**:
   * design.md section 5.2's `DropOffSearchResponse` listing predates INC-9
   * and never defines a route field, even though section 3.1a/10's own text
   * requires this exact data ("render the route polyline... using data
   * already fetched") reach the frontend -- same category of gap as INC-4's
   * `maxDetourMinutes` and INC-5's `FullyEvaluatedCandidate` (an omission in
   * an otherwise-unambiguous spec, not a business ambiguity). Added here as
   * the literal completion of that requirement; flagged to tech-lead for
   * design.md section 5.2 confirmation. Present exactly when
   * candidates.length > 0 ("ranked"/"fallback"), mirroring `disclaimer`'s own
   * presence rule, so the frontend can use its presence as the same signal
   * it already uses to decide whether to render the map panel at all
   * (ux-spec.md section 6.7: omitted gracefully on
   * no_viable_option/out_of_service_area/invalid_input/timeout).
   */
  route?: Array<{ lat: number; lng: number }>;
}

/**
 * Mirrors design.md section 5.2's `ConfirmTollReentryRequest` (FR-019/OQ-10,
 * INC-14) -- the request body for the new, stateless
 * `POST /api/drop-off-search/confirm-toll-reentry` endpoint.
 */
export interface ConfirmTollReentryRequest {
  /**
   * The identical original search request -- this app remains fully
   * stateless (NFR-003); no server-side candidate-pool session is kept
   * between the initial search and this confirm call. ux-spec.md section
   * 5a.4: on a second confirmation round, this is still the *original*
   * request the user first submitted, not the previous round's response.
   */
  originalRequest: DropOffSearchRequest;
  /**
   * The candidate location(s) the user found the toll re-entry pattern
   * unacceptable for (OQ-10: excluded entirely, no targeted recalculation).
   * ux-spec.md section 5a.4: on a second confirmation round, this is the
   * full *cumulative* rejection set (round 1's "No" answers plus round 2's),
   * not just the newest round's answers -- this endpoint re-derives the
   * whole search deterministically from `originalRequest` every time, so
   * there is no partial/incremental state to track server-side.
   */
  rejectedCandidateLocations: Array<{ lat: number; lng: number }>;
}

/**
 * Mirrors design.md section 5.2: "Same shape as `DropOffSearchResponse`
 * above (including the possibility that a newly-promoted candidate now
 * itself carries `needsTollReentryConfirmation: true`...)."
 */
export type ConfirmTollReentryResponse = DropOffSearchResponse;
