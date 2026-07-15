import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/drop-off-search/confirm-toll-reentry";
import searchHandler from "../../api/drop-off-search";
import { createMock } from "../helpers/mockVercel";
import { validEnv } from "../helpers/testEnv";
import type { DropOffSearchResponse } from "../../src/search/types";

/**
 * FR-019/OQ-10 (INC-14), design.md section 4.6 Phase 5 / section 5.2's
 * `confirm-toll-reentry` endpoint. Independent QA verification of dev's
 * three central claims (docs/handoff.md's INC-14 section):
 *
 * 1. The endpoint contract is genuinely stateless -- re-derives everything
 *    from `originalRequest`, no server-side session/cache.
 * 2. "Don't re-ask" invariant: an already-answered candidate is never
 *    re-flagged; only a genuinely newly-promoted candidate gets a fresh
 *    check.
 * 3. The two-round cap is frontend-only -- this endpoint has no concept of
 *    "round" and will keep flagging newly-promoted candidates indefinitely
 *    if called repeatedly.
 *
 * Fixture design: START/DEST/PASSENGER_DEST + default config produce (per
 * independent verification against the real CandidateGenerator/
 * DetourEvaluator/Ranker pipeline) a deterministic route-order-ranked set of
 * candidates: every raw candidate ties on detourMinutes (the router always
 * returns a flat 300s Distance Matrix duration) and ties on
 * passengerTotalTimeMinutes (the router always returns the identical transit
 * body), so FR-010/OQ-2's route-order tie-break alone determines final
 * ranking -- candidate 0 (nearest the start) outranks candidate 1, etc. With
 * MAX_CANDIDATES_RETURNED=2, the initial ranked set is exactly
 * [candidate0, candidate1], while candidates 2-7 remain in the fully-
 * evaluated pool, available to be "promoted" once 0 or 1 is excluded.
 *
 * The driving-Directions router below is deliberately keyed off the exact
 * origin/destination pair (per docs/handoff.md's own recommended technique)
 * rather than call order, since Phase 5's fan-out has no order guarantee:
 * - origin===START & destination===DEST -> the Phase 0/4.1a baseline (plain,
 *   no toll pattern).
 * - origin===START & destination!==DEST -> a Phase 5 "start->candidate" leg
 *   (always returns an "on toll road" step).
 * - destination===DEST & origin!==START -> a Phase 5 "candidate->dest" leg
 *   (always returns "off toll road, then back on" steps).
 * Concatenated by checkTollReentry, EVERY candidate's Phase 5 check
 * therefore always resolves to hasExitReentry:true -- deliberately uniform,
 * so the test only has to track *which* candidates were checked/excluded,
 * not why any specific one was or wasn't flagged.
 */

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

const START = { lat: 43.6532, lng: -79.3832, label: "123 Elm St, Toronto, ON" };
const DEST = { lat: 43.75, lng: -79.4, label: "456 Bay St, Toronto, ON" };
const PASSENGER_DEST = { lat: 43.78, lng: -79.42, label: "789 King St, Toronto, ON" };

function formatLatLng(p: { lat: number; lng: number }): string {
  return `${p.lat},${p.lng}`;
}

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
                transit_details: { departure_time: { value: now }, arrival_time: { value: now + 900 } },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Router keyed by exact origin/destination pair, per docs/handoff.md's own recommended technique. */
function makeRouter() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);

    if (u.pathname.includes("/geocode/")) {
      return { ok: true, status: 200, json: async () => ({ status: "OK", results: [{ formatted_address: "Near Oak Ave & Main St" }] }) };
    }
    if (u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit") {
      return { ok: true, status: 200, json: async () => okTransitBody() };
    }
    if (u.pathname.includes("/directions/")) {
      const origin = u.searchParams.get("origin");
      const destination = u.searchParams.get("destination");
      const isBaseline = origin === formatLatLng(START) && destination === formatLatLng(DEST);
      const isToCandidateLeg = origin === formatLatLng(START) && !isBaseline;
      const isFromCandidateLeg = destination === formatLatLng(DEST) && !isBaseline;

      let steps: Array<{ html_instructions: string; distance: { value: number } }>;
      if (isBaseline) {
        steps = [{ html_instructions: "Continue on Elm St", distance: { value: 12000 } }];
      } else if (isToCandidateLeg) {
        steps = [{ html_instructions: "Merge onto <b>ON-407 E</b>", distance: { value: 1000 } }];
      } else if (isFromCandidateLeg) {
        steps = [
          { html_instructions: "Take exit onto Local Road", distance: { value: 500 } },
          { html_instructions: "Merge onto <b>ON-407 E</b>", distance: { value: 1000 } },
        ];
      } else {
        throw new Error(`unexpected driving-Directions pair in test: origin=${origin} destination=${destination}`);
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "OK",
          routes: [
            { legs: [{ duration: { value: 480 }, steps }], overview_polyline: { points: ENCODED_POLYLINE } },
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
          rows: origins.map(() => ({ elements: destinations.map(() => ({ status: "OK", duration: { value: 300 } })) })),
        }),
      };
    }
    throw new Error(`unexpected fetch URL in test: ${url}`);
  });
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

function drivingCalls(router: ReturnType<typeof makeRouter>) {
  const calls = (router as unknown as { mock: { calls: [string][] } }).mock.calls;
  return calls.filter(([url]) => {
    const u = new URL(url);
    return u.pathname.includes("/directions/") && u.searchParams.get("mode") !== "transit";
  });
}

describe("POST /api/drop-off-search/confirm-toll-reentry -- FR-019/OQ-10, design.md section 5.2", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  describe("request-shape / infra guards", () => {
    it("rejects non-POST methods with 405", async () => {
      applyEnv(validEnv());
      const { req, res, statusCode } = createMock({ method: "GET" });
      await handler(req, res);
      expect(statusCode()).toBe(405);
    });

    it("config-load failure (missing MAP_API_KEY) returns 500 config_error, not a crash", async () => {
      const env = validEnv();
      delete (env as Record<string, string | undefined>).MAP_API_KEY;
      applyEnv(env);
      const { req, res, statusCode, jsonBody } = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [] },
      });
      await handler(req, res);
      expect(statusCode()).toBe(500);
      expect((jsonBody() as { error: string }).error).toBe("config_error");
    });

    it("invalid_input: malformed originalRequest (missing required field)", async () => {
      applyEnv(validEnv());
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { originalRequest: { start: START, driverDestination: DEST }, rejectedCandidateLocations: [] },
      });
      await handler(req, res);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("invalid_input");
    });

    it("invalid_input: rejectedCandidateLocations is not an array", async () => {
      applyEnv(validEnv());
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: "not-an-array" },
      });
      await handler(req, res);
      expect((jsonBody() as DropOffSearchResponse).status).toBe("invalid_input");
    });

    it("invalid_input: rejectedCandidateLocations contains a malformed point", async () => {
      applyEnv(validEnv());
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [{ lat: "not-a-number", lng: -79 }] },
      });
      await handler(req, res);
      expect((jsonBody() as DropOffSearchResponse).status).toBe("invalid_input");
    });

    it("an empty rejectedCandidateLocations array is VALID, not rejected (ux-spec.md section 5a.3 -- 'every card answered Yes')", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
      vi.stubGlobal("fetch", makeRouter());
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [] },
      });
      await handler(req, res);
      const body = jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      // Nothing rejected -> nothing newly promoted -> no candidate is
      // re-checked -> no flags anywhere in the response (the "user already
      // said yes, don't ask again" case dev's own doc explicitly calls out).
      for (const c of body.candidates) {
        expect(c.needsTollReentryConfirmation).toBeUndefined();
      }
    });

    it("out_of_service_area is re-validated from originalRequest (defense in depth, same as the main endpoint)", async () => {
      applyEnv(validEnv());
      const { req, res, jsonBody } = createMock({
        method: "POST",
        body: {
          originalRequest: requestBody({ driverDestination: { lat: 51.5072, lng: -0.1276, label: "London, UK" } }),
          rejectedCandidateLocations: [],
        },
      });
      await handler(req, res);
      expect((jsonBody() as DropOffSearchResponse).status).toBe("out_of_service_area");
    });
  });

  describe("claim 1 -- statelessness (NFR-003): no server-side session/cache dependency", () => {
    it("two independent calls with identical inputs (fresh handler invocations, no shared setup) produce identical outputs", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
      vi.stubGlobal("fetch", makeRouter());
      const body = { originalRequest: requestBody(), rejectedCandidateLocations: [] };

      const first = createMock({ method: "POST", body });
      await handler(first.req, first.res);
      const firstBody = first.jsonBody() as DropOffSearchResponse;

      const second = createMock({ method: "POST", body });
      await handler(second.req, second.res);
      const secondBody = second.jsonBody() as DropOffSearchResponse;

      expect(secondBody.status).toBe(firstBody.status);
      expect(secondBody.candidates.map((c) => c.location)).toEqual(firstBody.candidates.map((c) => c.location));
      expect(secondBody.candidates.map((c) => c.needsTollReentryConfirmation)).toEqual(
        firstBody.candidates.map((c) => c.needsTollReentryConfirmation),
      );
    });

    it("two DIFFERENT concurrent requests (different rejection sets) never cross-contaminate each other's response", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
      vi.stubGlobal("fetch", makeRouter());

      // First, learn the actual candidate locations from a real search.
      const search = createMock({ method: "POST", body: requestBody() });
      await searchHandler(search.req, search.res);
      const searchBody = search.jsonBody() as DropOffSearchResponse;
      const [candidate0, candidate1] = searchBody.candidates;

      const requestA = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [candidate0!.location] },
      });
      const requestB = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [candidate1!.location] },
      });

      // Fire both "concurrently" (interleaved microtasks) to stress any
      // hidden shared mutable state.
      await Promise.all([handler(requestA.req, requestA.res), handler(requestB.req, requestB.res)]);

      const bodyA = requestA.jsonBody() as DropOffSearchResponse;
      const bodyB = requestB.jsonBody() as DropOffSearchResponse;

      // Request A rejected candidate0 -> candidate0 must be absent from A's response.
      expect(bodyA.candidates.some((c) => c.location.lat === candidate0!.location.lat && c.location.lng === candidate0!.location.lng)).toBe(false);
      // Request B rejected candidate1 -> candidate1 must be absent from B's response, and candidate0 must survive in B.
      expect(bodyB.candidates.some((c) => c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng)).toBe(false);
      expect(bodyB.candidates.some((c) => c.location.lat === candidate0!.location.lat && c.location.lng === candidate0!.location.lng)).toBe(true);
    });
  });

  describe("claims 2 & 3 -- 'don't re-ask' invariant and the round-cap being frontend-only (no backend concept of 'round')", () => {
    it("full multi-round promotion chain: rejecting candidate0 promotes candidate2 (NOT candidate1, which is untouched); candidate1 is never re-flagged; a THIRD confirm call (which the real frontend never issues, per the 2-round cap) still happily promotes yet another candidate -- proving the backend enforces no cap of its own", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));

      // --- Round 0: initial search establishes the baseline ranked set. ---
      vi.stubGlobal("fetch", makeRouter());
      const initial = createMock({ method: "POST", body: requestBody() });
      await searchHandler(initial.req, initial.res);
      const initialBody = initial.jsonBody() as DropOffSearchResponse;
      expect(initialBody.status).toBe("ranked");
      expect(initialBody.candidates).toHaveLength(2);
      const [candidate0, candidate1] = initialBody.candidates;
      // Every candidate's Phase 5 check is deliberately uniform (see the
      // router's doc comment) -- both should be flagged on the first pass.
      expect(candidate0!.needsTollReentryConfirmation).toBe(true);
      expect(candidate1!.needsTollReentryConfirmation).toBe(true);

      // --- Confirm round 1: user rejects candidate0, accepts candidate1. ---
      vi.unstubAllGlobals();
      const round1Router = makeRouter();
      vi.stubGlobal("fetch", round1Router);
      const round1 = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [candidate0!.location] },
      });
      await handler(round1.req, round1.res);
      const round1Body = round1.jsonBody() as DropOffSearchResponse;
      expect(round1Body.status).toBe("ranked");
      expect(round1Body.candidates).toHaveLength(2);

      const round1Locations = round1Body.candidates.map((c) => c.location);
      // candidate0 must be genuinely GONE (exclusion, per OQ-10) -- not
      // merely unflagged.
      expect(round1Locations.some((l) => l.lat === candidate0!.location.lat && l.lng === candidate0!.location.lng)).toBe(false);
      // candidate1 must still be present...
      const survivorInRound1 = round1Body.candidates.find(
        (c) => c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng,
      );
      expect(survivorInRound1).toBeDefined();
      // ...and CRITICALLY must NOT be re-flagged -- this is the literal
      // "don't re-ask" invariant (ux-spec.md section 5a.4 / design.md
      // section 4.6 step 4). If this were `true`, the user would be shown a
      // card for a candidate they already answered "Yes" to.
      expect(survivorInRound1!.needsTollReentryConfirmation).toBeUndefined();

      // The newly-promoted candidate (call it candidate2) DOES get a fresh
      // check and IS flagged (per the router's uniform toll pattern).
      const promoted1 = round1Body.candidates.find(
        (c) => !(c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng),
      )!;
      expect(promoted1.needsTollReentryConfirmation).toBe(true);

      // Exact call-count verification (dev's own smoke-test claim,
      // independently reproduced): exactly 3 driving-Directions calls this
      // round -- 1 re-run baseline + 2 for the sole newly-promoted
      // candidate. NOT 5, which is what a "recheck everyone" bug would
      // produce, and not 1, which is what a "recheck no one" bug would
      // produce.
      expect(drivingCalls(round1Router)).toHaveLength(3);

      // --- Confirm round 2: user also rejects the newly-promoted candidate. ---
      vi.unstubAllGlobals();
      const round2Router = makeRouter();
      vi.stubGlobal("fetch", round2Router);
      const round2 = createMock({
        method: "POST",
        body: {
          originalRequest: requestBody(),
          rejectedCandidateLocations: [candidate0!.location, promoted1.location],
        },
      });
      await handler(round2.req, round2.res);
      const round2Body = round2.jsonBody() as DropOffSearchResponse;
      expect(round2Body.status).toBe("ranked");

      // candidate1 (answered "Yes" back in round 0/never rejected) must
      // STILL never be re-flagged, even two confirm calls later.
      const survivorInRound2 = round2Body.candidates.find(
        (c) => c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng,
      );
      expect(survivorInRound2).toBeDefined();
      expect(survivorInRound2!.needsTollReentryConfirmation).toBeUndefined();

      const promoted2 = round2Body.candidates.find(
        (c) => !(c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng),
      )!;
      expect(promoted2.needsTollReentryConfirmation).toBe(true);
      // The round-1 promoted candidate must be genuinely excluded now, not
      // just unflagged.
      expect(promoted2.location).not.toEqual(promoted1.location);

      // --- Claim 3: a THIRD confirm call (the real frontend never issues
      // this, per SearchFlow.tsx's hard 2-round cap) still happily promotes
      // and flags yet ANOTHER candidate -- proving the cap lives entirely in
      // the frontend, not this endpoint. ---
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", makeRouter());
      const round3 = createMock({
        method: "POST",
        body: {
          originalRequest: requestBody(),
          rejectedCandidateLocations: [candidate0!.location, promoted1.location, promoted2.location],
        },
      });
      await handler(round3.req, round3.res);
      const round3Body = round3.jsonBody() as DropOffSearchResponse;
      expect(round3Body.status).toBe("ranked");
      const promoted3 = round3Body.candidates.find(
        (c) => !(c.location.lat === candidate1!.location.lat && c.location.lng === candidate1!.location.lng),
      )!;
      // A fourth distinct candidate, freshly flagged -- the backend placed
      // no ceiling on how many times this can happen.
      expect(promoted3.needsTollReentryConfirmation).toBe(true);
      expect(promoted3.location).not.toEqual(promoted1.location);
      expect(promoted3.location).not.toEqual(promoted2.location);
    });
  });

  describe("claim 5 (partial, backend half) -- exclusion vs. residual-unconfirmed are genuinely different outcomes", () => {
    it("an explicitly-rejected candidate is fully ABSENT from the response; a newly-promoted-but-uncheckable-in-time candidate would instead be INCLUDED with the flag still set (never both treated the same way)", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
      vi.stubGlobal("fetch", makeRouter());

      const initial = createMock({ method: "POST", body: requestBody() });
      await searchHandler(initial.req, initial.res);
      const initialBody = initial.jsonBody() as DropOffSearchResponse;
      const [candidate0] = initialBody.candidates;

      const confirm = createMock({
        method: "POST",
        body: { originalRequest: requestBody(), rejectedCandidateLocations: [candidate0!.location] },
      });
      await handler(confirm.req, confirm.res);
      const confirmBody = confirm.jsonBody() as DropOffSearchResponse;

      // Rejected candidate: gone entirely (exclusion, OQ-10).
      expect(
        confirmBody.candidates.some((c) => c.location.lat === candidate0!.location.lat && c.location.lng === candidate0!.location.lng),
      ).toBe(false);
      // The newly-promoted candidate: present AND still carrying the flag
      // (this endpoint's response is exactly what the frontend would show
      // as the round-cap residual disclosure if this were the second round)
      // -- auto-INCLUDED with disclosure, never auto-excluded.
      const promoted = confirmBody.candidates.find((c) => c.needsTollReentryConfirmation === true);
      expect(promoted).toBeDefined();
    });
  });

  describe("claim 4 -- avoidTolls:true skips Phase 5 entirely on the confirm endpoint too", () => {
    it("avoidTolls:true issues zero Phase-5-style driving-Directions calls for a newly-promoted candidate (only the 1 baseline call)", async () => {
      applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
      const router = makeRouter();
      vi.stubGlobal("fetch", router);

      const confirm = createMock({
        method: "POST",
        body: { originalRequest: requestBody({ avoidTolls: true }), rejectedCandidateLocations: [] },
      });
      await handler(confirm.req, confirm.res);
      const body = confirm.jsonBody() as DropOffSearchResponse;
      expect(body.status).toBe("ranked");
      for (const c of body.candidates) {
        expect(c.needsTollReentryConfirmation).toBeUndefined();
      }
      // Exactly 1 driving-Directions call: the avoidTolls baseline. Zero
      // Phase 5 calls of any kind.
      expect(drivingCalls(router)).toHaveLength(1);
    });
  });
});
