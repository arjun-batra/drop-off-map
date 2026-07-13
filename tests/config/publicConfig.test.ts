import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loader";
import { toPublicConfig } from "../../src/config/publicConfig";
import { validPaidTierEnv } from "../helpers/testEnv";

describe("toPublicConfig", () => {
  it("returns exactly the 9 fields design.md section 5.2 specifies (5 original + minGeocodeQueryLength/geocodeDebounceMs per REV-006/REV-007 + responseTimeTargetSeconds per INC-7 + googleMapsJsApiKey per INC-10/FR-022, replacing INC-9's retired mapTileUrlTemplate/mapTileAttribution), no more no less", () => {
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
        "googleMapsJsApiKey",
      ].sort(),
    );
  });

  it("configurability: reflects a changed GOOGLE_MAPS_JS_API_KEY rather than a fixed/null value (INC-10, FR-022)", () => {
    const config = loadConfig(
      validPaidTierEnv("super-secret-password", { GOOGLE_MAPS_JS_API_KEY: "gmaps-js-key-xyz" }),
    );
    const publicConfig = toPublicConfig(config);
    expect(publicConfig.googleMapsJsApiKey).toBe("gmaps-js-key-xyz");
  });

  it("googleMapsJsApiKey is null when unset, not a hardcoded default (INC-10)", () => {
    const config = loadConfig(validPaidTierEnv("super-secret-password"));
    const publicConfig = toPublicConfig(config);
    expect(publicConfig.googleMapsJsApiKey).toBeNull();
  });

  it("googleMapsJsApiKey is the ONLY new client-exposed field introduced by INC-10 -- mapApiKey (the distinct server-side credential) is still never present on PublicConfig, per DEC-7's threat-model separation", () => {
    const config = loadConfig(
      validPaidTierEnv("super-secret-password", {
        MAP_API_KEY: "server-side-secret-key",
        GOOGLE_MAPS_JS_API_KEY: "browser-exposed-key",
      }),
    );
    const publicConfig = toPublicConfig(config);
    expect(publicConfig).not.toHaveProperty("mapApiKey");
    expect(JSON.stringify(publicConfig)).not.toContain("server-side-secret-key");
    expect(publicConfig.googleMapsJsApiKey).toBe("browser-exposed-key");
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
