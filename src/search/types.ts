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
 * pre-algorithm validation (FR-003/FR-004).
 */
export type DropOffSearchStatus =
  | "ranked"
  | "fallback"
  | "no_viable_option"
  | "out_of_service_area"
  | "invalid_input";

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
 * Mirrors design.md section 5.2's `DropOffSearchResponse`. Note:
 * `disclaimer` (FR-014) is intentionally NOT included here -- design.md
 * section 10 scopes the persistent safety/legality disclaimer to INC-7
 * ("Persistent FR-014 disclaimer on all candidate-bearing responses"), and
 * the traceability summary explicitly maps FR-014 -> INC-7 only. Adding the
 * field now (with content dev would have to invent the exact
 * condition/copy-ownership for) would be building ahead of that increment's
 * documented scope rather than completing an obvious drafting gap -- see
 * docs/handoff.md's INC-6 section for the full reasoning. INC-7 should add
 * this field back when it builds the actual persistent banner.
 */
export interface DropOffSearchResponse {
  status: DropOffSearchStatus;
  candidates: DropOffSearchCandidate[];
  /** Present when status === "fallback" (FR-011). */
  warning?: string;
  /** Present for out_of_service_area / no_viable_option / invalid_input (FR-004, FR-012, FR-003). */
  message?: string;
  requestId: string;
  /** For QA to verify NFR-004 empirically (full validation itself is INC-7 scope). */
  timingMs: number;
}
