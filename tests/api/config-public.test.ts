import { afterEach, describe, expect, it } from "vitest";
import handler from "../../api/config/public";
import { createMock } from "../helpers/mockVercel";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

describe("GET /api/config/public", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("happy path: free_tier returns 200 with the correct non-secret shape", () => {
    applyEnv(validEnv());
    const { req, res, statusCode, jsonBody } = createMock({ method: "GET" });
    handler(req, res);

    expect(statusCode()).toBe(200);
    expect(jsonBody()).toEqual({
      appMode: "free_tier",
      geographicCenter: { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" },
      geographicRadiusKm: 200,
      maxCandidatesReturned: 3,
      transitModesIncluded: "all",
      minGeocodeQueryLength: 3,
      geocodeDebounceMs: 300,
      responseTimeTargetSeconds: 5,
    });
  });

  it("configurability: reflects changed MIN_GEOCODE_QUERY_LENGTH/GEOCODE_DEBOUNCE_MS rather than fixed values (REV-006/REV-007)", () => {
    applyEnv(validEnv({ MIN_GEOCODE_QUERY_LENGTH: "5", GEOCODE_DEBOUNCE_MS: "750" }));
    const { req, res, jsonBody } = createMock({ method: "GET" });
    handler(req, res);
    expect((jsonBody() as { minGeocodeQueryLength: number }).minGeocodeQueryLength).toBe(5);
    expect((jsonBody() as { geocodeDebounceMs: number }).geocodeDebounceMs).toBe(750);
  });

  it("never leaks MAP_API_KEY or PAID_TIER_ACCESS_PASSWORD in the response body", () => {
    applyEnv(validPaidTierEnv("super-secret-pw"));
    const { req, res, jsonBody } = createMock({ method: "GET" });
    handler(req, res);

    const serialized = JSON.stringify(jsonBody());
    expect(serialized).not.toContain("super-secret-pw");
    expect(serialized).not.toContain("test-api-key-value");
    expect(jsonBody()).not.toHaveProperty("mapApiKey");
    expect(jsonBody()).not.toHaveProperty("paidTierAccessPassword");
  });

  it("configurability: reflects a changed GEOGRAPHIC_RADIUS_KM rather than a fixed value", () => {
    applyEnv(validEnv({ GEOGRAPHIC_RADIUS_KM: "42" }));
    const { req, res, jsonBody } = createMock({ method: "GET" });
    handler(req, res);
    expect((jsonBody() as { geographicRadiusKm: number }).geographicRadiusKm).toBe(42);
  });

  it("edge case: config-loader failure (missing MAP_API_KEY) returns 500 config_error, not a crash", () => {
    const env = validEnv();
    delete env.MAP_API_KEY;
    applyEnv(env);
    const { req, res, statusCode, jsonBody } = createMock({ method: "GET" });
    handler(req, res);

    expect(statusCode()).toBe(500);
    expect((jsonBody() as { error: string }).error).toBe("config_error");
  });

  it(
    "invalid input / config: paid_tier with no PAID_TIER_ACCESS_PASSWORD fails fast with 500, " +
      "per design.md section 10 INC-1 requirement",
    () => {
      const env = validEnv({ APP_MODE: "paid_tier" });
      delete env.PAID_TIER_ACCESS_PASSWORD;
      applyEnv(env);
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET" });
      handler(req, res);

      expect(statusCode()).toBe(500);
      const body = jsonBody() as { error: string; message: string };
      expect(body.error).toBe("config_error");
      expect(body.message).toContain("PAID_TIER_ACCESS_PASSWORD");
    },
  );

  it("rejects non-GET methods with 405", () => {
    applyEnv(validEnv());
    const { req, res, statusCode, jsonBody } = createMock({ method: "POST" });
    handler(req, res);
    expect(statusCode()).toBe(405);
    expect((jsonBody() as { error: string }).error).toBe("method_not_allowed");
  });

  describe("dev-flagged item: unauthenticated access in paid_tier mode", () => {
    it("returns 200 in paid_tier mode with NO session cookie present at all", () => {
      applyEnv(validPaidTierEnv("super-secret-pw"));
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET" }); // no cookie
      handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as { appMode: string }).appMode).toBe("paid_tier");
    });
  });
});
