import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/candidates/evaluate";
import { createSessionToken } from "../../src/auth/session";
import { createMock } from "../helpers/mockVercel";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

const START = { lat: 43.6532, lng: -79.3832 };
const EARTH_RADIUS_KM = 6371;

function northOf(origin: { lat: number; lng: number }, km: number) {
  const degLat = (km / EARTH_RADIUS_KM) * (180 / Math.PI);
  return { lat: origin.lat + degLat, lng: origin.lng };
}

/** Standard Google encoded-polyline encoder (precision 5) -- inverse of src/routing/polyline.ts's decoder. */
function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let output = "";
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  output += String.fromCharCode(v + 63);
  return output;
}

function encodePolyline(points: Array<{ lat: number; lng: number }>): string {
  let output = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    output += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return output;
}

/**
 * A fetch router that serves both Directions-shaped and Distance-Matrix-
 * shaped responses depending on the requested endpoint path, so the full
 * handler (not just its individual services) can be exercised end to end
 * with a single mocked global `fetch` -- matching the pattern
 * tests/api/route-direct.test.ts already established for a single-service
 * endpoint, extended here for an endpoint that calls two provider services.
 */
function makeFetchRouter(encodedPolyline: string, directDurationSeconds: number) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes("/directions/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          routes: [
            {
              legs: [{ duration: { value: directDurationSeconds } }],
              overview_polyline: { points: encodedPolyline },
            },
          ],
        }),
      };
    }
    if (u.pathname.includes("/distancematrix/")) {
      const origins = (u.searchParams.get("origins") ?? "").split("|").filter(Boolean);
      const destinations = (u.searchParams.get("destinations") ?? "").split("|").filter(Boolean);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          rows: origins.map(() => ({
            elements: destinations.map(() => ({ status: "OK", duration: { value: 300 } })),
          })),
        }),
      };
    }
    throw new Error(`unexpected fetch URL in test: ${url}`);
  });
}

function directionsStatus(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, routes: [] }) };
}

const QUERY = {
  startLat: String(START.lat),
  startLng: String(START.lng),
  destLat: "43.7",
  destLng: "-79.4",
  maxDetourMinutes: "10",
};

describe("GET /api/candidates/evaluate -- FR-005, FR-006b, FR-009", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("AuthGate wiring -- same pattern as /api/geocode, /api/route/direct", () => {
    it("free_tier: no cookie needed, request reaches both providers and succeeds", async () => {
      applyEnv(validEnv({ APP_MODE: "free_tier" }));
      const end = northOf(START, 9.5);
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { directDriveTimeMinutes: number; rawCandidateCount: number; candidates: unknown[] };
      expect(body.directDriveTimeMinutes).toBe(8);
      expect(body.rawCandidateCount).toBeGreaterThan(0);
      expect(body.candidates).toHaveLength(body.rawCandidateCount);
    });

    it("paid_tier, no cookie at all: 401 unauthorized, provider NEVER called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, wrong/garbage cookie: 401 unauthorized, provider never called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode } = createMock({
        method: "GET",
        query: QUERY,
        cookie: "dropspot_session=not-a-real-token",
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, valid session cookie: passes AuthGate, both providers called, 200", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480));

      const token = createSessionToken("correct-password");
      const { req, res, statusCode } = createMock({
        method: "GET",
        query: QUERY,
        cookie: `dropspot_session=${token}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
    });

    it("AuthGate is checked even before input-shape validation (unauthenticated caller learns nothing about input validity)", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { startLat: "garbage" } });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Distance Matrix batching cost formula, end to end: 1 (directions) + 2*ceil(N/B)", () => {
    it("default config (spacing=1000m, cap=20, batch=25): 9 candidates from a 9.5km route -> exactly 1 total fetch call for Directions + 2 for Distance Matrix = 3", async () => {
      applyEnv(validEnv());
      const end = northOf(START, 9.5);
      const fetchSpy = makeFetchRouter(encodePolyline([START, end]), 480);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { rawCandidateCount: number };
      expect(body.rawCandidateCount).toBe(9);
      expect(fetchSpy).toHaveBeenCalledTimes(3); // 1 + 2*ceil(9/25) = 3
    });

    it("configurability: raising MAX_RAW_CANDIDATES_SAMPLED / lowering DISTANCE_MATRIX_BATCH_SIZE produces multiple Distance Matrix batches, and the total call count still matches the formula", async () => {
      applyEnv(
        validEnv({
          MAX_RAW_CANDIDATES_SAMPLED: "47",
          DISTANCE_MATRIX_BATCH_SIZE: "25",
          CANDIDATE_SPACING_METERS: "1000",
        }),
      );
      const end = northOf(START, 46.5); // spacing-dominated -> 46 candidates
      const fetchSpy = makeFetchRouter(encodePolyline([START, end]), 480);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { rawCandidateCount: number };
      expect(body.rawCandidateCount).toBe(46);
      expect(fetchSpy).toHaveBeenCalledTimes(5); // 1 + 2*ceil(46/25) = 1 + 4 = 5
    });
  });

  describe("request shape / method handling", () => {
    it("missing coordinates -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: {} });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_input");
    });

    it("missing maxDetourMinutes -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { startLat: "43.6", startLng: "-79.3", destLat: "43.7", destLng: "-79.4" },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_input");
    });

    it("non-positive maxDetourMinutes (0 or negative) -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const zero = createMock({ method: "GET", query: { ...QUERY, maxDetourMinutes: "0" } });
      await handler(zero.req, zero.res);
      expect(zero.statusCode()).toBe(400);

      const negative = createMock({ method: "GET", query: { ...QUERY, maxDetourMinutes: "-5" } });
      await handler(negative.req, negative.res);
      expect(negative.statusCode()).toBe(400);
    });

    it("non-numeric coordinates -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { ...QUERY, startLat: "not-a-number" },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_input");
    });

    it("rejects non-GET methods with 405", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", query: QUERY });
      await handler(req, res);
      expect(statusCode()).toBe(405);
      expect((jsonBody() as { error: string }).error).toBe("method_not_allowed");
    });
  });

  describe("REV-009-pattern error sanitization (config + both provider failure modes)", () => {
    it("config-load failure -> 500 config_error, raw ConfigError text absent from client body, present in server log", async () => {
      const env = validEnv();
      delete env.MAP_API_KEY;
      applyEnv(env);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(500);
      const body = jsonBody() as { error: string; message?: string };
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("MAP_API_KEY");
      expect(body.error).toBe("config_error");
      expect(body.message).toBe("The service is temporarily unavailable.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("MAP_API_KEY");
      consoleErrorSpy.mockRestore();
    });

    it("Directions provider failure -> 502 provider_error, raw message absent from client body, present in server log", async () => {
      applyEnv(validEnv());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const u = new URL(url);
          if (u.pathname.includes("/directions/")) {
            return directionsStatus("REQUEST_DENIED", "The provided API key is invalid.");
          }
          throw new Error("distance matrix should not be called if directions failed");
        }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("The provided API key is invalid");
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("The provided API key is invalid.");
      consoleErrorSpy.mockRestore();
    });

    it("Distance Matrix provider failure (whole-request) -> 502 provider_error, raw message absent from client body", async () => {
      applyEnv(validEnv());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const end = northOf(START, 9.5);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const u = new URL(url);
          if (u.pathname.includes("/directions/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                status: "OK",
                routes: [{ legs: [{ duration: { value: 480 } }], overview_polyline: { points: encodePolyline([START, end]) } }],
              }),
            };
          }
          if (u.pathname.includes("/distancematrix/")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({ status: "OVER_QUERY_LIMIT", error_message: "You have exceeded your quota.", rows: [] }),
            };
          }
          throw new Error("unexpected url");
        }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      expect(JSON.stringify(body)).not.toContain("exceeded your quota");
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("exceeded your quota");
      consoleErrorSpy.mockRestore();
    });
  });

  describe("qualifies flag reaches the response body unfiltered (end-to-end FR-009/FR-011-readiness check)", () => {
    it("candidates whose detour exceeds maxDetourMinutes are present in the response with qualifies:false, not omitted", async () => {
      applyEnv(validEnv());
      const end = northOf(START, 9.5);
      // directDurationSeconds huge relative to the flat 300s (5min) per-leg mock
      // durations used by makeFetchRouter -> detour will be very negative... to
      // force a *high* detour instead, use a tiny direct duration.
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 60)); // 1 min direct

      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { ...QUERY, maxDetourMinutes: "1" }, // detour will be (5+5)-1=9, > 1
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as {
        candidates: Array<{ qualifies: boolean; detourMinutes: number }>;
        rawCandidateCount: number;
      };
      expect(body.candidates).toHaveLength(body.rawCandidateCount);
      expect(body.candidates.every((c) => c.qualifies === false)).toBe(true);
      expect(body.candidates.every((c) => c.detourMinutes === 9)).toBe(true);
    });
  });
});
