import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../src/config/loader";
import { validEnv, validPaidTierEnv, withoutKey } from "../helpers/testEnv";

// design.md section 7 / section 7.1 (REV-006/REV-007): 14 original keys plus
// MIN_GEOCODE_QUERY_LENGTH/GEOCODE_DEBOUNCE_MS, promoted from hardcoded
// constants during the INC-2 follow-up fix pass, plus SESSION_LIFETIME_SECONDS
// (REV-002/INC-8 session-cookie hardening key).
const ALL_17_KEYS = [
  "MAP_ROUTING_PROVIDER",
  "MAP_API_KEY",
  "GEOGRAPHIC_CENTER",
  "GEOGRAPHIC_RADIUS_KM",
  "MAX_CANDIDATES_RETURNED",
  "APP_MODE",
  "PAID_TIER_ACCESS_PASSWORD",
  "RESPONSE_TIME_TARGET_SECONDS",
  "TRANSIT_MODES_INCLUDED",
  "CANDIDATE_SPACING_METERS",
  "MAX_RAW_CANDIDATES_SAMPLED",
  "MAX_TRANSIT_EVALUATIONS_PER_REQUEST",
  "DISTANCE_MATRIX_BATCH_SIZE",
  "REQUEST_TIMEOUT_MS",
  "PROVIDER_CONCURRENCY_LIMIT",
  "MIN_GEOCODE_QUERY_LENGTH",
  "GEOCODE_DEBOUNCE_MS",
  "SESSION_LIFETIME_SECONDS",
];

describe("loadConfig -- happy path", () => {
  it("loads a fully-specified free_tier environment into the exact AppConfig shape", () => {
    const config = loadConfig(validEnv());
    expect(config).toEqual({
      mapRoutingProvider: "google_maps_platform",
      mapApiKey: "test-api-key-value",
      geographicCenter: { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" },
      geographicRadiusKm: 200,
      maxCandidatesReturned: 3,
      appMode: "free_tier",
      paidTierAccessPassword: null,
      responseTimeTargetSeconds: 5,
      transitModesIncluded: "all",
      candidateSpacingMeters: 1000,
      maxRawCandidatesSampled: 20,
      maxTransitEvaluationsPerRequest: 8,
      distanceMatrixBatchSize: 25,
      requestTimeoutMs: 4000,
      providerConcurrencyLimit: 10,
      minGeocodeQueryLength: 3,
      geocodeDebounceMs: 300,
      sessionLifetimeSeconds: 3600,
    });
  });

  it("loads a fully-specified paid_tier environment, keeping the password", () => {
    const config = loadConfig(validPaidTierEnv("s3cret-pw"));
    expect(config.appMode).toBe("paid_tier");
    expect(config.paidTierAccessPassword).toBe("s3cret-pw");
  });

  it("parses TRANSIT_MODES_INCLUDED as a trimmed comma-separated list when not 'all'", () => {
    const config = loadConfig(validEnv({ TRANSIT_MODES_INCLUDED: "bus, subway ,tram" }));
    expect(config.transitModesIncluded).toEqual(["bus", "subway", "tram"]);
  });

  it("treats TRANSIT_MODES_INCLUDED case-insensitively for the 'all' sentinel", () => {
    const config = loadConfig(validEnv({ TRANSIT_MODES_INCLUDED: "ALL" }));
    expect(config.transitModesIncluded).toBe("all");
  });
});

describe("loadConfig -- configurability (catches hardcoded values)", () => {
  it("reflects a changed GEOGRAPHIC_RADIUS_KM value rather than a fixed default", () => {
    const config = loadConfig(validEnv({ GEOGRAPHIC_RADIUS_KM: "75" }));
    expect(config.geographicRadiusKm).toBe(75);
  });

  it("reflects a changed MAX_CANDIDATES_RETURNED value rather than the design doc's default of 3", () => {
    const config = loadConfig(validEnv({ MAX_CANDIDATES_RETURNED: "7" }));
    expect(config.maxCandidatesReturned).toBe(7);
  });

  it("reflects a changed GEOGRAPHIC_CENTER value rather than a fixed Toronto default", () => {
    const config = loadConfig(
      validEnv({ GEOGRAPHIC_CENTER: '{"lat":51.5074,"lng":-0.1278,"label":"London, UK"}' }),
    );
    expect(config.geographicCenter).toEqual({ lat: 51.5074, lng: -0.1278, label: "London, UK" });
  });

  it("reflects every numeric tunable independently (no cross-wired/copy-pasted values)", () => {
    const config = loadConfig(
      validEnv({
        CANDIDATE_SPACING_METERS: "500",
        MAX_RAW_CANDIDATES_SAMPLED: "12",
        MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "4",
        DISTANCE_MATRIX_BATCH_SIZE: "10",
        REQUEST_TIMEOUT_MS: "9999",
        PROVIDER_CONCURRENCY_LIMIT: "2",
        RESPONSE_TIME_TARGET_SECONDS: "8",
      }),
    );
    expect(config.candidateSpacingMeters).toBe(500);
    expect(config.maxRawCandidatesSampled).toBe(12);
    expect(config.maxTransitEvaluationsPerRequest).toBe(4);
    expect(config.distanceMatrixBatchSize).toBe(10);
    expect(config.requestTimeoutMs).toBe(9999);
    expect(config.providerConcurrencyLimit).toBe(2);
    expect(config.responseTimeTargetSeconds).toBe(8);
  });

  it("reflects a changed MIN_GEOCODE_QUERY_LENGTH value rather than a hardcoded 3 (REV-006/REV-007)", () => {
    const config = loadConfig(validEnv({ MIN_GEOCODE_QUERY_LENGTH: "5" }));
    expect(config.minGeocodeQueryLength).toBe(5);
  });

  it("reflects a changed GEOCODE_DEBOUNCE_MS value rather than a hardcoded 300 (REV-006/REV-007)", () => {
    const config = loadConfig(validEnv({ GEOCODE_DEBOUNCE_MS: "750" }));
    expect(config.geocodeDebounceMs).toBe(750);
  });

  it("reflects a changed SESSION_LIFETIME_SECONDS value rather than a hardcoded lifetime (REV-002)", () => {
    const config = loadConfig(validEnv({ SESSION_LIFETIME_SECONDS: "60" }));
    expect(config.sessionLifetimeSeconds).toBe(60);
  });
});

describe("loadConfig -- fails fast, listing every problem (not just the first)", () => {
  it("throws ConfigError when every key is missing, listing a problem per missing key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const problems = (err as ConfigError).problems;
      // At minimum, every required key without a value should surface a problem.
      for (const key of ALL_17_KEYS) {
        if (key === "PAID_TIER_ACCESS_PASSWORD") continue; // only required when APP_MODE=paid_tier
        expect(problems.some((p) => p.includes(key)), `expected a problem mentioning ${key}`).toBe(true);
      }
    }
  });

  it("lists multiple simultaneous problems in one thrown error, not just the first encountered", () => {
    const env = withoutKey(withoutKey(validEnv(), "MAP_API_KEY"), "GEOGRAPHIC_RADIUS_KM");
    try {
      loadConfig(env);
      expect.unreachable();
    } catch (err) {
      const problems = (err as ConfigError).problems;
      expect(problems.length).toBeGreaterThanOrEqual(2);
      expect(problems.some((p) => p.includes("MAP_API_KEY"))).toBe(true);
      expect(problems.some((p) => p.includes("GEOGRAPHIC_RADIUS_KM"))).toBe(true);
    }
  });

  for (const key of ALL_17_KEYS) {
    if (key === "PAID_TIER_ACCESS_PASSWORD") continue; // covered separately below
    it(`fails when only ${key} is missing`, () => {
      expect(() => loadConfig(withoutKey(validEnv(), key))).toThrow(ConfigError);
    });
  }

  it("fails fast when APP_MODE=paid_tier and PAID_TIER_ACCESS_PASSWORD is unset", () => {
    const env = validEnv({ APP_MODE: "paid_tier" });
    delete env.PAID_TIER_ACCESS_PASSWORD;
    try {
      loadConfig(env);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const problems = (err as ConfigError).problems;
      expect(problems.some((p) => p.includes("PAID_TIER_ACCESS_PASSWORD"))).toBe(true);
    }
  });

  it("fails fast when APP_MODE=paid_tier and PAID_TIER_ACCESS_PASSWORD is set to an empty string", () => {
    expect(() => loadConfig(validEnv({ APP_MODE: "paid_tier", PAID_TIER_ACCESS_PASSWORD: "" }))).toThrow(
      ConfigError,
    );
  });

  it("does NOT require PAID_TIER_ACCESS_PASSWORD when APP_MODE=free_tier", () => {
    const env = validEnv({ APP_MODE: "free_tier" });
    delete env.PAID_TIER_ACCESS_PASSWORD;
    expect(() => loadConfig(env)).not.toThrow();
  });

  it("rejects an invalid APP_MODE value", () => {
    expect(() => loadConfig(validEnv({ APP_MODE: "some_other_mode" }))).toThrow(ConfigError);
  });

  it("rejects a non-numeric GEOGRAPHIC_RADIUS_KM", () => {
    expect(() => loadConfig(validEnv({ GEOGRAPHIC_RADIUS_KM: "not-a-number" }))).toThrow(ConfigError);
  });

  it("rejects a negative or zero GEOGRAPHIC_RADIUS_KM", () => {
    expect(() => loadConfig(validEnv({ GEOGRAPHIC_RADIUS_KM: "0" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ GEOGRAPHIC_RADIUS_KM: "-5" }))).toThrow(ConfigError);
  });

  it("rejects a non-integer value for an integer-only key (MAX_CANDIDATES_RETURNED)", () => {
    expect(() => loadConfig(validEnv({ MAX_CANDIDATES_RETURNED: "3.5" }))).toThrow(ConfigError);
  });

  it("rejects a non-integer or non-positive MIN_GEOCODE_QUERY_LENGTH (REV-006/REV-007)", () => {
    expect(() => loadConfig(validEnv({ MIN_GEOCODE_QUERY_LENGTH: "2.5" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ MIN_GEOCODE_QUERY_LENGTH: "0" }))).toThrow(ConfigError);
  });

  it("rejects a non-integer or non-positive GEOCODE_DEBOUNCE_MS (REV-006/REV-007)", () => {
    expect(() => loadConfig(validEnv({ GEOCODE_DEBOUNCE_MS: "150.5" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ GEOCODE_DEBOUNCE_MS: "-100" }))).toThrow(ConfigError);
  });

  it("rejects malformed JSON for GEOGRAPHIC_CENTER", () => {
    expect(() => loadConfig(validEnv({ GEOGRAPHIC_CENTER: "{not json" }))).toThrow(ConfigError);
  });

  it("rejects GEOGRAPHIC_CENTER JSON missing required fields", () => {
    expect(() => loadConfig(validEnv({ GEOGRAPHIC_CENTER: '{"lat":1,"lng":2}' }))).toThrow(ConfigError);
  });

  it("rejects an unsupported MAP_ROUTING_PROVIDER", () => {
    expect(() => loadConfig(validEnv({ MAP_ROUTING_PROVIDER: "mapbox" }))).toThrow(ConfigError);
  });

  it("rejects TRANSIT_MODES_INCLUDED set to only commas/whitespace", () => {
    expect(() => loadConfig(validEnv({ TRANSIT_MODES_INCLUDED: " , , " }))).toThrow(ConfigError);
  });

  it("rejects a non-integer or non-positive SESSION_LIFETIME_SECONDS (REV-002)", () => {
    expect(() => loadConfig(validEnv({ SESSION_LIFETIME_SECONDS: "60.5" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ SESSION_LIFETIME_SECONDS: "0" }))).toThrow(ConfigError);
    expect(() => loadConfig(validEnv({ SESSION_LIFETIME_SECONDS: "-1" }))).toThrow(ConfigError);
  });
});
