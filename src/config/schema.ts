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
}
