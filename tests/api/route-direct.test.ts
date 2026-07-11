import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/route/direct";
import { AuthGate } from "../../src/auth/authGate";
import { createSessionToken } from "../../src/auth/session";
import { createMock } from "../helpers/mockVercel";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

const START_QUERY = { startLat: "43.6532", startLng: "-79.3832", destLat: "43.7", destLng: "-79.4" };

function directionsOk(overrides: { duration: number; durationInTraffic?: number }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      routes: [
        {
          legs: [
            {
              duration: { value: overrides.duration },
              ...(overrides.durationInTraffic !== undefined
                ? { duration_in_traffic: { value: overrides.durationInTraffic } }
                : {}),
            },
          ],
          overview_polyline: { points: "??" },
        },
      ],
    }),
  };
}

function directionsStatus(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, routes: [] }) };
}

describe("GET /api/route/direct -- FR-002/FR-006a/FR-006b(baseline)/FR-007, AuthGate wiring", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("AuthGate wiring -- same pattern the orchestrator flagged for /api/geocode (INC-2)", () => {
    it("free_tier: no cookie needed, request reaches the provider and succeeds", async () => {
      applyEnv(validEnv({ APP_MODE: "free_tier" }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(directionsOk({ duration: 600, durationInTraffic: 900 })));
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);
      expect(statusCode()).toBe(200);
      expect((jsonBody() as { durationMinutes: number }).durationMinutes).toBe(15);
    });

    it("paid_tier, no cookie at all: 401 unauthorized, and the provider is NEVER called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(directionsOk({ duration: 600 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, wrong/garbage cookie: 401 unauthorized, provider never called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(directionsOk({ duration: 600 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: START_QUERY,
        cookie: "dropspot_session=not-a-real-token",
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, valid session cookie: passes AuthGate and reaches the provider (200)", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(directionsOk({ duration: 600, durationInTraffic: 900 })));

      const token = createSessionToken("correct-password");
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: START_QUERY,
        cookie: `dropspot_session=${token}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as { durationMinutes: number }).durationMinutes).toBe(15);
    });

    it("a cookie valid under a previously-rotated password is rejected after rotation (401), provider not called", async () => {
      const staleToken = createSessionToken("old-password");
      applyEnv(validPaidTierEnv("new-password"));
      const fetchSpy = vi.fn().mockResolvedValue(directionsOk({ duration: 600 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode } = createMock({
        method: "GET",
        query: START_QUERY,
        cookie: `dropspot_session=${staleToken}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("AuthGate is checked even before coordinate-shape validation (unauthenticated caller learns nothing about input validity)", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = vi.fn().mockResolvedValue(directionsOk({ duration: 600 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { startLat: "not-a-number" },
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("FR-007: live traffic -- duration_in_traffic preferred over static duration", () => {
    it("returns the traffic-aware duration when both are present in the provider response", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(directionsOk({ duration: 600, durationInTraffic: 900 })));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as { durationMinutes: number }).durationMinutes).toBe(15);
    });

    it("falls back to the static duration when duration_in_traffic is absent", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(directionsOk({ duration: 600 })));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as { durationMinutes: number }).durationMinutes).toBe(10);
    });

    it("every request sent to the provider includes departure_time (checked via the fetch spy's URL)", async () => {
      applyEnv(validEnv());
      const fetchSpy = vi.fn().mockResolvedValue(directionsOk({ duration: 600 }));
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.has("departure_time")).toBe(true);
      expect(calledUrl.searchParams.get("mode")).toBe("driving");
    });
  });

  describe("REV-009-pattern error sanitization", () => {
    it("a real provider error (e.g. invalid API key) does not leak the raw provider message to the client, but is still logged server-side", async () => {
      applyEnv(validEnv());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(directionsStatus("REQUEST_DENIED", "The provided API key is invalid.")));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("The provided API key is invalid");
      expect(serialized).not.toContain("API key");
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("The provided API key is invalid.");

      consoleErrorSpy.mockRestore();
    });

    it("config-load failure does not leak the raw ConfigError validation text to the client, but is still logged server-side", async () => {
      const env = validEnv();
      delete env.MAP_API_KEY;
      applyEnv(env);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(500);
      const body = jsonBody() as { error: string; message?: string };
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("MAP_API_KEY");
      expect(serialized).not.toContain("is required but was not set");
      expect(body.error).toBe("config_error");
      expect(body.message).toBe("The service is temporarily unavailable.");

      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("MAP_API_KEY");

      consoleErrorSpy.mockRestore();
    });

    it("network failure calling the provider surfaces as 502 provider_error, not a crash, and is not leaked verbatim", async () => {
      applyEnv(validEnv());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down, real cause XYZ")));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");
      expect(JSON.stringify(body)).not.toContain("real cause XYZ");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("real cause XYZ");
      consoleErrorSpy.mockRestore();
    });
  });

  describe("request shape / method handling", () => {
    it("missing coordinates returns 400 invalid_point", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: {} });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_point");
    });

    it("non-numeric coordinates return 400 invalid_point", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { startLat: "abc", startLng: "-79.3832", destLat: "43.7", destLng: "-79.4" },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_point");
    });

    it("partially-missing coordinates (only 3 of 4 provided) return 400 invalid_point", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { startLat: "43.6532", startLng: "-79.3832", destLat: "43.7" },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_point");
    });

    it("rejects non-GET methods with 405", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", query: START_QUERY });
      await handler(req, res);
      expect(statusCode()).toBe(405);
      expect((jsonBody() as { error: string }).error).toBe("method_not_allowed");
    });

    it("config-load failure (missing MAP_API_KEY) returns 500 config_error, checked before AuthGate", async () => {
      const env = validPaidTierEnv("correct-password");
      delete env.MAP_API_KEY;
      applyEnv(env);
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: START_QUERY });
      await handler(req, res);
      expect(statusCode()).toBe(500);
      expect((jsonBody() as { error: string }).error).toBe("config_error");
    });
  });
});

describe("sanity: AuthGate.check itself still gates as expected (regression guard for this suite's mocks)", () => {
  it("paid_tier blocks with no cookie", () => {
    expect(AuthGate.check({ headers: {} }, { appMode: "paid_tier", paidTierAccessPassword: "x" })).toBe(false);
  });
});
