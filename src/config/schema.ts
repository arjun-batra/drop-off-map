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
   * INC-9 (design.md section 3.1a/10): Leaflet tile-layer URL template for
   * the optional map view (e.g. `https://{s}.example.com/{z}/{x}/{y}.png`,
   * with any provider API key already embedded in the string by the
   * operator if their chosen tile provider requires one). Deliberately not
   * hardcoded to any single vendor -- see docs/handoff.md's INC-9 section
   * for the tile-provider choice/rationale and how to switch providers by
   * changing only this env var, no code change. Non-secret: this URL is
   * requested directly by the browser (Leaflet has no server-side proxy),
   * so it is exposed via PublicConfig the same way GEOGRAPHIC_CENTER is.
   *
   * **Optional, `null` when unset** (same "conditionally present" pattern
   * already used for `paidTierAccessPassword`) -- deliberately not a
   * required-with-no-fallback key like this schema's other ~20 entries,
   * because design.md section 10/1.3 frames the whole map view as a
   * conditional/optional enhancement no FR/NFR depends on ("every FR/NFR is
   * already satisfied by the text/card-based output of INC-1..8"). Requiring
   * every existing/future deployment to configure a tile provider just to
   * avoid a config-load failure would contradict that "optional" framing.
   * When either this or `mapTileAttribution` is `null`, the frontend omits
   * the map panel entirely (ux-spec.md section 6.7's own "fail silently,
   * simply omit the panel" requirement) -- the same graceful-degradation
   * behavior as a tile-load failure, just triggered by absent config instead
   * of a network error.
   */
  mapTileUrlTemplate: string | null;
  /**
   * INC-9: attribution text/HTML required by OSM-family tile providers'
   * license terms, rendered in Leaflet's built-in attribution control.
   * Configurable (not hardcoded) because it must match whichever tile
   * provider `mapTileUrlTemplate` points at. Optional/`null` for the same
   * reason as `mapTileUrlTemplate` above.
   */
  mapTileAttribution: string | null;
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
  /** INC-9: see AppConfig's field of the same name -- needed client-side so Leaflet can request tiles directly. Optional/`null` when the map view isn't configured. */
  mapTileUrlTemplate: string | null;
  /** INC-9: see AppConfig's field of the same name. Optional/`null` when the map view isn't configured. */
  mapTileAttribution: string | null;
}
