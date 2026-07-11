import type { Env } from "../../src/config/loader";

/**
 * A complete, valid environment covering all 16 config keys from
 * design.md section 7 / docs/runbook.md section 4 (14 original keys plus
 * MIN_GEOCODE_QUERY_LENGTH/GEOCODE_DEBOUNCE_MS, promoted per REV-006/REV-007
 * -- design.md section 7.1, defaults 3/300 matching the schema defaults).
 * Individual tests should spread this and override/delete specific keys
 * rather than hand-rolling a partial env, so every test starts from a
 * known-good baseline.
 */
export function validEnv(overrides: Partial<Env> = {}): Env {
  const base: Env = {
    MAP_ROUTING_PROVIDER: "google_maps_platform",
    MAP_API_KEY: "test-api-key-value",
    GEOGRAPHIC_CENTER: '{"lat":43.6532,"lng":-79.3832,"label":"Toronto, ON"}',
    GEOGRAPHIC_RADIUS_KM: "200",
    MAX_CANDIDATES_RETURNED: "3",
    APP_MODE: "free_tier",
    PAID_TIER_ACCESS_PASSWORD: "",
    RESPONSE_TIME_TARGET_SECONDS: "5",
    TRANSIT_MODES_INCLUDED: "all",
    CANDIDATE_SPACING_METERS: "1000",
    MAX_RAW_CANDIDATES_SAMPLED: "20",
    MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "8",
    DISTANCE_MATRIX_BATCH_SIZE: "25",
    REQUEST_TIMEOUT_MS: "4000",
    PROVIDER_CONCURRENCY_LIMIT: "10",
    MIN_GEOCODE_QUERY_LENGTH: "3",
    GEOCODE_DEBOUNCE_MS: "300",
  };
  return { ...base, ...overrides };
}

export function validPaidTierEnv(password = "correct-horse-battery-staple", overrides: Partial<Env> = {}): Env {
  return validEnv({ APP_MODE: "paid_tier", PAID_TIER_ACCESS_PASSWORD: password, ...overrides });
}

/** Removes a key entirely (as opposed to setting it to ""), simulating an operator never setting it. */
export function withoutKey(env: Env, key: string): Env {
  const clone = { ...env };
  delete clone[key];
  return clone;
}
