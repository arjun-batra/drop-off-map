import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/drop-off-search";
import { createMock } from "../helpers/mockVercel";
import { validSessionToken } from "../helpers/sessionToken";
import { validEnv, validPaidTierEnv } from "../helpers/testEnv";
import type { DropOffSearchResponse } from "../../src/search/types";
import { DISCLAIMER_TEXT } from "../../src/search/types";

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

const START = { lat: 43.6532, lng: -79.3832, label: "123 Elm St, Toronto, ON" };
const DEST = { lat: 43.75, lng: -79.4, label: "456 Bay St, Toronto, ON" };
const PASSENGER_DEST = { lat: 43.78, lng: -79.42, label: "789 King St, Toronto, ON" };
const LONDON_UK = { lat: 51.5072, lng: -0.1276, label: "London, UK" };

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

const ENCODED_POLYLINE = encodePolyline([
  { lat: START.lat, lng: START.lng },
  { lat: DEST.lat, lng: DEST.lng },
]);

type TransitBehavior = (callIndex: number) => { status: string; routes: unknown[]; error_message?: string };

/** Router serving Directions (driving), Distance Matrix, Directions (transit), and Geocoding (reverse) off one mocked fetch. */
function makeFetchRouter(opts: {
  directDurationSeconds?: number;
  transitBehavior?: TransitBehavior;
  reverseGeocodeBehavior?: () => { status: string; results: unknown[] };
}) {
  const { directDurationSeconds = 480, transitBehavior, reverseGeocodeBehavior } = opts;
  let transitCallIndex = 0;

  return vi.fn(async (url: string) => {
    const u = new URL(url);

    if (u.pathname.includes("/geocode/")) {
      const behavior = reverseGeocodeBehavior ?? (() => ({ status: "OK", results: [{ formatted_address: "Near Oak Ave & Main St" }] }));
      const result = behavior();
      return { ok: true, status: 200, json: async () => result };
    }
    if (u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit") {
      const behavior = transitBehavior ?? (() => okTransitBody());
      const result = behavior(transitCallIndex++);
      return { ok: true, status: 200, json: async () => result };
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
              overview_polyline: { points: ENCODED_POLYLINE },
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

function okTransitBody() {
  const now = Math.floor(Date.now() / 1000);
  return {
    status: "OK",
    routes: [
      {
        legs: [
          {
            steps: [
              { travel_mode: "WALKING", duration: { value: 240 } },
              {
                travel_mode: "TRANSIT",
                duration: { value: 900 },
                transit_details: {
                  departure_time: { value: now },
                  arrival_time: { value: now + 900 },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function zeroResultsTransitBody() {
  return { status: "ZERO_RESULTS", routes: [] };
}

function requestBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    start: START,
    driverDestination: DEST,
    passengerDestination: PASSENGER_DEST,
    maxDetourMinutes: 30,
    ...overrides,
  };
}

describe("POST /api/drop-off-search -- FR-006f, FR-010, FR-011, FR-012, FR-013", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("business-outcome statuses", () => {
    it("ranked: normal case returns candidates with the full FR-013 breakdown, correct rank ordering, requestId/timingMs present", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      expect(body.candidates.length).toBeGreaterThan(0);
      expect(body.candidates[0]!.rank).toBe(1);
      for (const c of body.candidates) {
        expect(c.exceedsThreshold).toBe(false);
        expect(typeof c.driverTotalTimeMinutes).toBe("number");
        expect(typeof c.walkTimeMinutes).toBe("number");
        expect(typeof c.waitTimeMinutes).toBe("number");
        expect(typeof c.transitTimeMinutes).toBe("number");
        expect(typeof c.passengerTotalTimeMinutes).toBe("number");
        expect(c.label).toBeTruthy();
      }
      expect(body.requestId).toBeTruthy();
      expect(typeof body.timingMs).toBe("number");
    });

    it("configurability: raising MAX_CANDIDATES_RETURNED returns more ranked candidates for the identical scenario", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "1" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));
      const low = createMock({ method: "POST", body: requestBody() });
      await handler(low.req, low.res);
      const lowBody = low.jsonBody() as DropOffSearchResponse;

      vi.unstubAllGlobals();
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "5" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));
      const high = createMock({ method: "POST", body: requestBody() });
      await handler(high.req, high.res);
      const highBody = high.jsonBody() as DropOffSearchResponse;

      expect(lowBody.status).toBe("ranked");
      expect(highBody.status).toBe("ranked");
      expect(lowBody.candidates).toHaveLength(1);
      expect(highBody.candidates.length).toBeGreaterThan(lowBody.candidates.length);
    });

    it("fallback: maxDetourMinutes set below every candidate's actual detour returns exactly one candidate with exceedsThreshold:true and a warning", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ maxDetourMinutes: 0.001 }),
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("fallback");
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0]!.exceedsThreshold).toBe(true);
      expect(body.warning).toBeTruthy();
      expect(body.warning).toContain("minutes");
    });

    it("no_viable_option: every candidate's transit call returns ZERO_RESULTS", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({ transitBehavior: () => zeroResultsTransitBody() }));

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("no_viable_option");
      expect(body.candidates).toEqual([]);
      expect(body.message).toBeTruthy();
    });

    it("walking-only transit response (DEC-3) flows through the full pipeline as status:ranked, not fallback/no_viable_option", async () => {
      applyEnv(validEnv());
      vi.stubGlobal(
        "fetch",
        makeFetchRouter({
          transitBehavior: () => ({
            status: "OK",
            routes: [{ legs: [{ steps: [{ travel_mode: "WALKING", duration: { value: 180 } }] }] }],
          }),
        }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      expect(body.candidates[0]!.waitTimeMinutes).toBe(0);
      expect(body.candidates[0]!.transitTimeMinutes).toBe(0);
    });

    it("invalid_input: missing passengerDestination", async () => {
      applyEnv(validEnv());
      const { start, driverDestination, maxDetourMinutes } = requestBody();
      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: { start, driverDestination, maxDetourMinutes },
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("invalid_input");
      expect(body.candidates).toEqual([]);
      expect(body.message).toBeTruthy();
    });

    it("invalid_input: non-numeric maxDetourMinutes", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ maxDetourMinutes: "not-a-number" }),
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      expect((jsonBody() as DropOffSearchResponse).status).toBe("invalid_input");
    });

    it("invalid_input: zero/negative maxDetourMinutes rejected (no upper bound, but must be positive)", async () => {
      applyEnv(validEnv());
      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody({ maxDetourMinutes: 0 }) });
      await handler(req, res);
      expect((jsonBody() as DropOffSearchResponse).status).toBe("invalid_input");
    });

    it("out_of_service_area: driverDestination outside the configured radius", async () => {
      applyEnv(validEnv());
      const fetchSpy = makeFetchRouter({});
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ driverDestination: LONDON_UK }),
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("out_of_service_area");
      expect(body.message).toContain("200 km");
      // Radius failure short-circuits before any provider call.
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("out_of_service_area: start outside the configured radius", async () => {
      applyEnv(validEnv());
      const fetchSpy = makeFetchRouter({});
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody({ start: LONDON_UK }) });
      await handler(req, res);

      expect((jsonBody() as DropOffSearchResponse).status).toBe("out_of_service_area");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("DQ-1 exemption re-verified at the real endpoint: a far-away passengerDestination does NOT trigger out_of_service_area when start/driverDestination are in-radius", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ passengerDestination: LONDON_UK }),
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).not.toBe("out_of_service_area");
    });
  });

  describe("AuthGate wiring -- same pattern as every prior endpoint", () => {
    it("paid_tier, no cookie: 401 unauthorized, zero provider calls", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter({});
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, wrong/garbage cookie: 401 unauthorized, zero provider calls", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter({});
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode } = createMock({
        method: "POST",
        body: requestBody(),
        cookie: "dropspot_session=garbage",
      });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("paid_tier, valid session cookie: passes AuthGate, providers called, 200", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      vi.stubGlobal("fetch", makeFetchRouter({}));
      const token = validSessionToken("correct-password");

      const { req, res, statusCode } = createMock({
        method: "POST",
        body: requestBody(),
        cookie: `dropspot_session=${token}`,
      });
      await handler(req, res);

      expect(statusCode()).toBe(200);
    });

    it("AuthGate is checked before request-body validation", async () => {
      applyEnv(validPaidTierEnv("correct-password"));
      const fetchSpy = makeFetchRouter({});
      vi.stubGlobal("fetch", fetchSpy);

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: { garbage: true } });
      await handler(req, res);

      expect(statusCode()).toBe(401);
      expect((jsonBody() as { error: string }).error).toBe("unauthorized");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("REV-009-pattern error sanitization", () => {
    it("config-load failure -> 500 config_error, raw ConfigError text absent from client body, present in server log", async () => {
      const env = validEnv();
      delete env.MAP_API_KEY;
      applyEnv(env);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
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
      applyEnv(validEnv());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        makeFetchRouter({
          transitBehavior: () => ({ status: "REQUEST_DENIED", routes: [], error_message: "bad key" }),
        }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as { error: string; message?: string };
      expect(JSON.stringify(body)).not.toContain("bad key");
      expect(body.error).toBe("provider_error");
      expect(body.message).toBe("Unable to reach the routing provider right now.");

      const loggedText = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedText).toContain("bad key");
      consoleErrorSpy.mockRestore();
    });

    it("reverse-geocode failure for a final candidate does not fail the whole request -- falls back to distance phrasing", async () => {
      applyEnv(validEnv());
      vi.stubGlobal(
        "fetch",
        makeFetchRouter({ reverseGeocodeBehavior: () => ({ status: "ZERO_RESULTS", results: [] }) }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      expect(body.candidates[0]!.label).toMatch(/km into your route/);
    });
  });

  describe("request shape / method handling", () => {
    it("rejects non-POST methods with 405", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode, jsonBody } = createMock({ method: "GET", body: requestBody() });
      await handler(req, res);
      expect(statusCode()).toBe(405);
      expect((jsonBody() as { error: string }).error).toBe("method_not_allowed");
    });
  });

  describe("FR-014 disclaimer field (INC-7, resolves REV-012)", () => {
    it("ranked response includes the disclaimer, with the exact ux-spec.md section 6.2 copy", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      expect(body.disclaimer).toBe(DISCLAIMER_TEXT);
      expect(body.disclaimer).toBe(
        "This is an estimated drop-off point only. Before stopping, confirm it's safe and legal to pull over here.",
      );
    });

    it("fallback response includes the disclaimer", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ maxDetourMinutes: 0.001 }),
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("fallback");
      expect(body.disclaimer).toBe(DISCLAIMER_TEXT);
    });

    it("no_viable_option response omits the disclaimer (no candidates)", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({ transitBehavior: () => zeroResultsTransitBody() }));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("no_viable_option");
      expect(body.disclaimer).toBeUndefined();
    });

    it("out_of_service_area response omits the disclaimer", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ driverDestination: LONDON_UK }),
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("out_of_service_area");
      expect(body.disclaimer).toBeUndefined();
    });

    it("invalid_input response omits the disclaimer", async () => {
      applyEnv(validEnv());
      const { start, driverDestination, maxDetourMinutes } = requestBody();
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { start, driverDestination, maxDetourMinutes },
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("invalid_input");
      expect(body.disclaimer).toBeUndefined();
    });

    it("timeout response omits the disclaimer (no candidates)", async () => {
      applyEnv(validEnv({ RESPONSE_TIME_TARGET_SECONDS: "0.0001" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("timeout");
      expect(body.disclaimer).toBeUndefined();
    });
  });

  describe("INC-9 'route' field (design-doc gap flagged by dev, ux-spec.md section 6.7 / design.md section 3.1a)", () => {
    it("ranked response includes the direct route's decoded polyline, matching the direct-route call's own points", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      expect(Array.isArray(body.route)).toBe(true);
      expect(body.route!.length).toBeGreaterThan(0);
      // Decoded from ENCODED_POLYLINE (START -> DEST), precision-5 rounding.
      expect(body.route![0]!.lat).toBeCloseTo(START.lat, 4);
      expect(body.route![0]!.lng).toBeCloseTo(START.lng, 4);
      expect(body.route![body.route!.length - 1]!.lat).toBeCloseTo(DEST.lat, 4);
      expect(body.route![body.route!.length - 1]!.lng).toBeCloseTo(DEST.lng, 4);
    });

    it("fallback response includes the route field too", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ maxDetourMinutes: 0.001 }),
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("fallback");
      expect(Array.isArray(body.route)).toBe(true);
      expect(body.route!.length).toBeGreaterThan(0);
    });

    it("no_viable_option response omits the route field (no candidates, nothing to plot)", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({ transitBehavior: () => zeroResultsTransitBody() }));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("no_viable_option");
      expect(body.route).toBeUndefined();
    });

    it("out_of_service_area response omits the route field", async () => {
      applyEnv(validEnv());
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: requestBody({ driverDestination: LONDON_UK }),
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("out_of_service_area");
      expect(body.route).toBeUndefined();
    });

    it("invalid_input response omits the route field", async () => {
      applyEnv(validEnv());
      const { start, driverDestination, maxDetourMinutes } = requestBody();
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { start, driverDestination, maxDetourMinutes },
      });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("invalid_input");
      expect(body.route).toBeUndefined();
    });

    it("timeout response omits the route field", async () => {
      applyEnv(validEnv({ RESPONSE_TIME_TARGET_SECONDS: "0.0001" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("timeout");
      expect(body.route).toBeUndefined();
    });

    it("adds no new provider call: `route` is populated from the same single driving-Directions call the FR-006a/b baseline already made, not a second fetch", async () => {
      applyEnv(validEnv());
      const router = makeFetchRouter({});
      vi.stubGlobal("fetch", router);

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.route).toBeTruthy();

      const calls = (router as unknown as { mock: { calls: [string][] } }).mock.calls;
      const drivingDirectionsCalls = calls.filter(([url]) => {
        const u = new URL(url);
        return u.pathname.includes("/directions/") && u.searchParams.get("mode") !== "transit";
      });
      // Exactly one driving-Directions call (the FR-006a/b direct-route
      // baseline, INC-3) -- if INC-9 had added a second call anywhere to
      // populate `route` independently, this would be 2, not 1.
      expect(drivingDirectionsCalls).toHaveLength(1);
    });
  });

  describe("NFR-004 orchestration deadline / timeout status (INC-7, design.md section 6.3)", () => {
    it("an already-elapsed RESPONSE_TIME_TARGET_SECONDS with a nonempty shortlist yields status:timeout, not no_viable_option", async () => {
      applyEnv(validEnv({ RESPONSE_TIME_TARGET_SECONDS: "0.0001" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(200);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("timeout");
      expect(body.candidates).toEqual([]);
      expect(body.message).toBeTruthy();
    });

    it("a generous RESPONSE_TIME_TARGET_SECONDS with fast mocked providers still returns ranked, not timeout (no false positive)", async () => {
      applyEnv(validEnv({ RESPONSE_TIME_TARGET_SECONDS: "30" }));
      vi.stubGlobal("fetch", makeFetchRouter({}));

      const { req, res, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
    });

    it("configurability: a real provider timeout (REQUEST_TIMEOUT_MS) is enforced end-to-end through the handler -- a hung transit call is aborted and surfaces as a sanitized 502, not a hang or a leaked internal message", async () => {
      applyEnv(validEnv({ REQUEST_TIMEOUT_MS: "30" }));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
          const u = new URL(url);
          if (u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit") {
            // Simulate a hung provider call: never resolves on its own, only
            // rejects if the AbortSignal actually fires -- proves
            // REQUEST_TIMEOUT_MS is a genuine abort, not just a theoretical
            // bound.
            return new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            });
          }
          return makeFetchRouter({}).getMockImplementation()!(url);
        }),
      );

      const { req, res, statusCode, jsonBody } = createMock({ method: "POST", body: requestBody() });
      await handler(req, res);

      expect(statusCode()).toBe(502);
      const body = jsonBody() as Record<string, unknown>;
      expect(body.error).toBe("provider_error");
      // Sanitized: no raw AbortError/timeout-internals string reaches the client.
      expect(JSON.stringify(body)).not.toMatch(/abort/i);
      expect(JSON.stringify(body)).not.toMatch(/timed out after/i);

      // The detailed timeout message is logged server-side only.
      const loggedMessages = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(loggedMessages).toMatch(/timed out after 30ms/i);

      consoleErrorSpy.mockRestore();
    });
  });
});
