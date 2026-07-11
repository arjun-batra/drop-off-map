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
}
