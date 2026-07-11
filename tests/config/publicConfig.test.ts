import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loader";
import { toPublicConfig } from "../../src/config/publicConfig";
import { validPaidTierEnv } from "../helpers/testEnv";

describe("toPublicConfig", () => {
  it("returns exactly the 8 fields design.md section 5.2 specifies (5 original + minGeocodeQueryLength/geocodeDebounceMs per REV-006/REV-007 + responseTimeTargetSeconds per INC-7), no more no less", () => {
    const config = loadConfig(validPaidTierEnv("super-secret-password"));
    const publicConfig = toPublicConfig(config);
    expect(Object.keys(publicConfig).sort()).toEqual(
      [
        "appMode",
        "geographicCenter",
        "geographicRadiusKm",
        "maxCandidatesReturned",
        "transitModesIncluded",
        "minGeocodeQueryLength",
        "geocodeDebounceMs",
        "responseTimeTargetSeconds",
      ].sort(),
    );
  });

  it("configurability: reflects a changed MIN_GEOCODE_QUERY_LENGTH/GEOCODE_DEBOUNCE_MS rather than fixed values (REV-006/REV-007)", () => {
    const config = loadConfig(
      validPaidTierEnv("super-secret-password", { MIN_GEOCODE_QUERY_LENGTH: "5", GEOCODE_DEBOUNCE_MS: "750" }),
    );
    const publicConfig = toPublicConfig(config);
    expect(publicConfig.minGeocodeQueryLength).toBe(5);
    expect(publicConfig.geocodeDebounceMs).toBe(750);
  });

  it("configurability: reflects a changed RESPONSE_TIME_TARGET_SECONDS rather than a fixed value (INC-7, NFR-004)", () => {
    const config = loadConfig(validPaidTierEnv("super-secret-password", { RESPONSE_TIME_TARGET_SECONDS: "9" }));
    const publicConfig = toPublicConfig(config);
    expect(publicConfig.responseTimeTargetSeconds).toBe(9);
  });

  it("never includes mapApiKey or paidTierAccessPassword, even serialized", () => {
    const config = loadConfig(validPaidTierEnv("super-secret-password"));
    // Sanity: the secret really is in the source config we're about to strip.
    expect(config.mapApiKey).toBe("test-api-key-value");
    expect(config.paidTierAccessPassword).toBe("super-secret-password");

    const publicConfig = toPublicConfig(config);
    expect(publicConfig).not.toHaveProperty("mapApiKey");
    expect(publicConfig).not.toHaveProperty("paidTierAccessPassword");

    const serialized = JSON.stringify(publicConfig);
    expect(serialized).not.toContain("test-api-key-value");
    expect(serialized).not.toContain("super-secret-password");
  });
});
