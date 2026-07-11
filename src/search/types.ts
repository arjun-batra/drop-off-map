/**
 * Shared request/response shapes for `POST /api/drop-off-search`
 * (design.md section 5.2). Framework-agnostic so both the backend handler
 * (api/drop-off-search.ts) and the frontend (src/frontend/api.ts,
 * SearchFlow.tsx, ResultsScreen.tsx) import the same types rather than
 * redeclaring them independently (the REV-007 duplication risk this project
 * already had to fix once for MIN_QUERY_LENGTH/DEBOUNCE_MS).
 */

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
 * than imply the trip itself has no viable drop-off point.
 */
export type DropOffSearchStatus =
  | "ranked"
  | "fallback"
  | "no_viable_option"
  | "out_of_service_area"
  | "invalid_input"
  | "timeout";

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
  /** Present for out_of_service_area / no_viable_option / invalid_input / timeout (FR-004, FR-012, FR-003, INC-7). */
  message?: string;
  /** FR-014 (INC-7): present exactly when candidates.length > 0 ("ranked"/"fallback"). */
  disclaimer?: string;
  requestId: string;
  /** For QA to verify NFR-004 empirically. */
  timingMs: number;
}
