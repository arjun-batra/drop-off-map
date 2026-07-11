import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/candidates/transit";
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
 * Router serving Directions (driving), Distance Matrix, and Directions
 * (transit) shapes off a single mocked global fetch -- extends the pattern
 * tests/api/candidates-evaluate.test.ts established for a 2-provider
 * endpoint to this 3-provider one. `transitResponder` lets each test control
 * exactly what the transit-mode call returns per candidate.
 */
function makeFetchRouter(
  encodedPolyline: string,
  directDurationSeconds: number,
  transitResponder: (url: URL) => { ok: boolean; status: number; json: () => Promise<unknown> },
) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit") {
      return transitResponder(u);
    }
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

function okTransit() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      routes: [{ legs: [{ steps: [{ travel_mode: "WALKING", duration: { value: 300 } }] }] }],
    }),
  };
}

function zeroResultsTransit() {
  return { ok: true, status: 200, json: async () => ({ status: "ZERO_RESULTS", routes: [] }) };
}

function walkingOnlyTransit(seconds = 180) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: "OK",
      routes: [{ legs: [{ steps: [{ travel_mode: "WALKING", duration: { value: seconds } }] }] }],
    }),
  };
}

function errorTransit(status: string, error_message?: string) {
  return { ok: true, status: 200, json: async () => ({ status, error_message, routes: [] }) };
}

const QUERY = {
  startLat: String(START.lat),
  startLng: String(START.lng),
  destLat: "43.7",
  destLng: "-79.4",
  passengerDestLat: "43.75",
  passengerDestLng: "-79.45",
  maxDetourMinutes: "10",
};

describe("GET /api/candidates/transit -- FR-006c/d/e, FR-008", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("AuthGate wiring -- same pattern as every prior endpoint", () => {
    it("free_tier: no cookie needed, request reaches all three providers and succeeds", async () => {
      applyEnv(validEnv({ APP_MODE: "free_tier" }));
      const end = northOf(START, 9.5);
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480, okTransit));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { directDriveTimeMinutes: number; shortlistedCount: number; candidates: unknown[] };
      expect(body.directDriveTimeMinutes).toBe(8);
      expect(body.shortlistedCount).toBeGreaterThan(0);
      expect(body.candidates).toHaveLength(body.shortlistedCount);
    });

    it("paid_tier, no cookie at all: 401 unauthorized, no provider ever called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480, okTransit);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, wrong/garbage cookie: 401 unauthorized, no provider ever called", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480, okTransit);
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

    it("paid_tier, valid session cookie: passes AuthGate, providers called, 200", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480, okTransit));

      const token = createSessionToken("correct-password");
      const { req, res, statusCode } = createMock({
        method: "GET",
        query: QUERY,
        cookie: `dropspot_session=${token}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
    });

    it("AuthGate is checked even before input-shape validation", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter(encodePolyline([START, northOf(START, 9.5)]), 480, okTransit);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: { startLat: "garbage" } });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("THE CRUX: walking-only transit responses flow through end-to-end as valid, normally-ranked candidates (DEC-3)", () => {
    it("a candidate whose transit call returns a walking-only route is present with noTransitAvailable:false and near-zero transit time, not excluded", async () => {
      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "1" }));
      const end = northOf(START, 9.5);
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480, () => walkingOnlyTransit(180)));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as {
        candidates: Array<{
          noTransitAvailable: boolean;
          walkTimeMinutes: number;
          waitTimeMinutes: number;
          transitTimeMinutes: number;
          passengerTotalTimeMinutes: number;
        }>;
      };
      expect(body.candidates).toHaveLength(1);
      const [candidate] = body.candidates;
      expect(candidate!.noTransitAvailable).toBe(false);
      expect(candidate!.waitTimeMinutes).toBe(0);
      expect(candidate!.transitTimeMinutes).toBe(0);
      expect(candidate!.walkTimeMinutes).toBe(3);
      expect(candidate!.passengerTotalTimeMinutes).toBe(3);
    });

    it("a candidate whose transit call returns Google ZERO_RESULTS (genuine no-route) is present with noTransitAvailable:true -- request as a whole still succeeds", async () => {
      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "1" }));
      const end = northOf(START, 9.5);
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480, zeroResultsTransit));

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { candidates: Array<{ noTransitAvailable: boolean }> };
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]!.noTransitAvailable).toBe(true);
    });
  });

  describe("shortlisting cap / configurability", () => {
    it("shortlistedCount respects MAX_TRANSIT_EVALUATIONS_PER_REQUEST even when more candidates qualify", async () => {
      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "2" }));
      const end = northOf(START, 9.5); // yields multiple qualifying candidates at default spacing
      const fetchSpy = makeFetchRouter(encodePolyline([START, end]), 480, okTransit);
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as { rawCandidateCount: number; shortlistedCount: number };
      expect(body.rawCandidateCount).toBeGreaterThan(2);
      expect(body.shortlistedCount).toBe(2);

      const transitCalls = fetchSpy.mock.calls.filter((call) => {
        const u = new URL(call[0] as string);
        return u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit";
      });
      expect(transitCalls).toHaveLength(2);
    });

    it("configurability: raising the cap increases shortlistedCount for the same route", async () => {
      const end = northOf(START, 9.5);

      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "1" }));
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480, okTransit));
      const low = createMock({ method: "GET", query: QUERY });
      await handler(low.req, low.res);
      const lowBody = low.jsonBody() as { shortlistedCount: number };

      vi.unstubAllGlobals();
      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "5" }));
      vi.stubGlobal("fetch", makeFetchRouter(encodePolyline([START, end]), 480, okTransit));
      const high = createMock({ method: "GET", query: QUERY });
      await handler(high.req, high.res);
      const highBody = high.jsonBody() as { shortlistedCount: number };

      expect(lowBody.shortlistedCount).toBe(1);
      expect(highBody.shortlistedCount).toBe(5);
    });
  });

  describe("request shape / method handling", () => {
    it("missing passengerDestLat/Lng -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: {
          startLat: QUERY.startLat,
          startLng: QUERY.startLng,
          destLat: QUERY.destLat,
          destLng: QUERY.destLng,
          maxDetourMinutes: QUERY.maxDetourMinutes,
        },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_input");
    });

    it("missing maxDetourMinutes -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { ...QUERY, maxDetourMinutes: undefined as unknown as string },
      });
      await handler(req, res);
      expect(statusCode()).toBe(400);
      expect((jsonBody() as { error: string }).error).toBe("invalid_input");
    });

    it("non-numeric coordinates -> 400 invalid_input", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "GET",
        query: { ...QUERY, passengerDestLat: "not-a-number" },
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

  describe("REV-009-pattern error sanitization", () => {
    it("config-load failure -> 500 config_error, raw ConfigError text absent from client body, present in server log", async () => {
      const env = validEnv();
      delete env.MAP_API_KEY;
      applyEnv(env);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(500);
      const body = jsonBody() as { error: string; message?: string };
      expect(JSON.stringify(body)).not.toContain("MAP_API_KEY");
      expect(body.error).toBe("config_error");
      expect(body.message).toBe("The service is temporarily unavailable.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("MAP_API_KEY");
      consoleErrorSpy.mockRestore();
    });

    it("transit-provider failure (REQUEST_DENIED) -> 502 provider_error, raw message absent from client body, present in server log", async () => {
      applyEnv(validEnv({ MAX_TRANSIT_EVALUATIONS_PER_REQUEST: "1" }));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const end = northOf(START, 9.5);
      vi.stubGlobal(
        "fetch",
        makeFetchRouter(encodePolyline([START, end]), 480, () =>
          errorTransit("REQUEST_DENIED", "The provided API key is invalid."),
        ),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", query: QUERY });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      expect(JSON.stringify(body)).not.toContain("The provided API key is invalid");
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("The provided API key is invalid.");
      consoleErrorSpy.mockRestore();
    });
  });
});
