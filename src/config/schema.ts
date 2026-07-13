export type AppMode = "free_tier" | "paid_tier";

export type MapRoutingProvider = "google_maps_platform";

export type TransitModesIncluded = string[] | "all";

export interface GeoPoint {
  lat: number;
  lng: number;
  label: string;
}

/**
 * Mirrors design.md section 5.1's `AppConfig` interface. Every field is
 * sourced from an environment variable at request time (see loader.ts) --
 * none of these values are ever hardcoded as defaults in code, per the
 * project's no-hardcoded-tunables rule. Operators set defaults by setting
 * the corresponding env var (see docs/runbook.md section 4).
 */
export interface AppConfig {
  mapRoutingProvider: MapRoutingProvider;
  mapApiKey: string;
  geographicCenter: GeoPoint;
  geographicRadiusKm: number;
  maxCandidatesReturned: number;
  appMode: AppMode;
  paidTierAccessPassword: string | null;
  responseTimeTargetSeconds: number;
  transitModesIncluded: TransitModesIncluded;
  candidateSpacingMeters: number;
  maxRawCandidatesSampled: number;
  maxTransitEvaluationsPerRequest: number;
  distanceMatrixBatchSize: number;
  requestTimeoutMs: number;
  providerConcurrencyLimit: number;
  minGeocodeQueryLength: number;
  geocodeDebounceMs: number;
  /**
   * REV-002 (INC-8): lifetime, in seconds, of the session cookie issued by
   * POST /api/auth/verify-password. Embedded (signed) into the token itself
   * by src/auth/session.ts, so the session genuinely expires server-side --
   * not just via the cookie's own Max-Age, which the browser could ignore.
   * Required whenever `paidTierAccessPassword` is used, same as every other
   * numeric tunable in this schema: no hardcoded fallback exists anywhere in
   * code, per the project's no-hardcoded-tunables rule.
   */
  sessionLifetimeSeconds: number;
  /**
   * INC-10 (FR-022, design.md section 7.2): loads Google's Maps JavaScript
   * API client-side for the Results-screen map, replacing INC-9's Leaflet +
   * `mapTileUrlTemplate`/`mapTileAttribution` implementation (both retired
   * by this increment -- see design.md section 7.2's "Cleanup" note).
   *
   * **Deliberately a distinct key from `mapApiKey`** (DEC-7, requirements.md
   * section 5) -- this credential is loaded via a client-side script tag and
   * is therefore necessarily visible to anyone who opens dev tools/views
   * source. That is expected/normal for this specific Google product (Maps
   * JS API keys are designed to be used client-side, restricted in Google
   * Cloud Console via HTTP-referrer + "Maps JavaScript API only" scoping,
   * an operator/runbook concern, not a code mechanism), but it is a
   * materially different threat model from `mapApiKey`, which is called
   * exclusively server-side and must never reach the browser. Reusing one
   * key for both would mean a leaked/scraped browser key could call
   * Directions/Distance Matrix/Geocoding directly, bypassing every cost
   * control this app relies on (radius gating, APP_MODE, candidate-count
   * limits, etc.) -- see design.md section 7.2 for the full rationale.
   *
   * **Intentionally included in `PublicConfig`** (unlike `mapApiKey`) --
   * this is the first and only Google credential in this app designed to
   * reach the browser; see design.md section 7.2's explicit note that this
   * does not weaken the "provider calls happen server-side" architecture
   * principle for every other Google API this app calls.
   *
   * **Optional, `null` when unset** -- same "conditionally present" pattern
   * INC-9's tile config used: the frontend omits the map panel entirely
   * (ux-spec.md section 6.7's "fail silently, simply omit the panel"
   * requirement) rather than the config loader hard-failing, since designer/
   * pm may still want the map view to degrade gracefully in an environment
   * where this key hasn't been provisioned yet.
   */
  googleMapsJsApiKey: string | null;
}

/**
 * The subset of AppConfig safe to expose to the browser, per design.md
 * section 5.2's `GET /api/config/public` contract. Never include
 * `mapApiKey` or `paidTierAccessPassword` here.
 */
export interface PublicConfig {
  appMode: AppMode;
  geographicCenter: GeoPoint;
  geographicRadiusKm: number;
  maxCandidatesReturned: number;
  transitModesIncluded: TransitModesIncluded;
  minGeocodeQueryLength: number;
  geocodeDebounceMs: number;
  /**
   * design.md section 6.3/7 (INC-7) -- the soft latency target (seconds),
   * not a secret. The frontend's Loading screen (ux-spec.md section 5) uses
   * this to know when to swap to "Still working..." copy, coordinated with
   * the same value the backend's orchestration deadline is derived from
   * (api/drop-off-search.ts), so the two stay in lockstep without a second
   * hardcoded threshold.
   */
  responseTimeTargetSeconds: number;
  /** INC-10: see AppConfig's field of the same name -- intentionally exposed here (DEC-7/design.md section 7.2). Optional/`null` when the map view isn't configured. */
  googleMapsJsApiKey: string | null;
}
