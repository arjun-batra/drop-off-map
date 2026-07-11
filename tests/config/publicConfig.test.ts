import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/loader";
import { toPublicConfig } from "../../src/config/publicConfig";
import { validPaidTierEnv } from "../helpers/testEnv";

describe("toPublicConfig", () => {
  it("returns exactly the 5 fields design.md section 5.2 specifies, no more no less", () => {
    const config = loadConfig(validPaidTierEnv("super-secret-password"));
    const publicConfig = toPublicConfig(config);
    expect(Object.keys(publicConfig).sort()).toEqual(
      ["appMode", "geographicCenter", "geographicRadiusKm", "maxCandidatesReturned", "transitModesIncluded"].sort(),
    );
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
