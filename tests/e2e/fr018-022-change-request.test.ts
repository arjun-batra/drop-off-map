import { afterEach, describe, expect, it, vi } from "vitest";
import searchHandler from "../../api/drop-off-search";
import confirmHandler from "../../api/drop-off-search/confirm-toll-reentry";
import { createMock } from "../helpers/mockVercel";
import { validEnv } from "../helpers/testEnv";
import type { DropOffSearchResponse } from "../../src/search/types";

/**
 * Change-request-level end-to-end sanity check (2026-07-12 change request,
 * FR-018 through FR-022), analogous in spirit to the project's original
 * Phase 4 end-to-end test but scoped to this change request. Exercises a
 * SINGLE realistic search through the real backend handler stack (only the
 * Google Maps Platform HTTP layer is mocked, per the project-wide REV-010
 * sandbox limitation) that simultaneously demonstrates:
 *
 * - FR-018: avoidTolls=false (checkbox unchecked -- the default/common case).
 * - FR-020: a limited-access-highway (401) segment of the driver's baseline
 *   route genuinely excludes the raw candidates sampled along it -- proven
 *   by asserting the surviving final candidates' routeOrderIndex, not just
 *   trusting the final count.
 * - FR-019: at least one surviving final candidate is flagged for toll
 *   re-entry confirmation, and a real confirm-toll-reentry round trip
 *   correctly excludes the rejected one and promotes/re-checks only the
 *   genuinely new replacement (the "don't re-ask" invariant, exercised here
 *   in a single, more realistic fixture rather than the isolated one in
 *   tests/api/confirm-toll-reentry.test.ts).
 * - FR-021: every surviving final candidate carries a named boarding/arrival
 *   transit stop with line name + headsign.
 * - FR-022: the response carries the `route` polyline data the Google Maps
 *   JS API map view (MapView.tsx) renders from -- the actual Maps
 *   JavaScript API rendering itself has no real-credential coverage
 *   anywhere in this project (REV-010) and is unit-tested against a mocked
 *   `@googlemaps/js-api-loader` in tests/frontend/MapView.test.tsx and
 *   tests/frontend/SearchFlow.test.tsx instead.
 */

const ORIGINAL_ENV = { ...process.env };

function applyEnv(env: Record<string, string | undefined>) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

const START = { lat: 43.6532, lng: -79.3832, label: "123 Elm St, Toronto, ON" };
const DEST = { lat: 43.75, lng: -79.4, label: "456 Bay St, Toronto, ON" };
const MID = { lat: (START.lat + DEST.lat) / 2, lng: (START.lng + DEST.lng) / 2 };
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
const ENCODED_POLYLINE = encodePolyline([START, MID, DEST]);

function transitBodyWithStops(callIndex: number) {
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
                  line: { short_name: "506", name: "College" },
                  headsign: "Downtown Loop",
                  departure_stop: { name: `Boarding Stop ${callIndex}`, location: { lat: 43.6 + callIndex * 0.001, lng: -79.4 } },
                  arrival_stop: { name: `Arrival Stop ${callIndex}`, location: { lat: 43.7 + callIndex * 0.001, lng: -79.41 } },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Router keyed by exact origin/destination pair (Phase 5's fan-out has no order guarantee). */
function makeRouter() {
  return vi.fn(async (url: string) => {
    const u = new URL(url);

    if (u.pathname.includes("/geocode/")) {
      return { ok: true, status: 200, json: async () => ({ status: "OK", results: [{ formatted_address: "Near Oak Ave & Main St" }] }) };
    }
    if (u.pathname.includes("/directions/") && u.searchParams.get("mode") === "transit") {
      return { ok: true, status: 200, json: async () => transitBodyWithStops(0) };
    }
    if (u.pathname.includes("/directions/")) {
      const origin = u.searchParams.get("origin");
      const destination = u.searchParams.get("destination");
      const isBaseline = origin === formatLatLng(START) && destination === formatLatLng(DEST);
      const isToCandidateLeg = origin === formatLatLng(START) && !isBaseline;
      const isFromCandidateLeg = destination === formatLatLng(DEST) && !isBaseline;

      let steps: Array<{ html_instructions: string; distance: { value: number } }>;
      if (isBaseline) {
        // FR-020: the first 5000m of the route is on a limited-access
        // highway (401, NOT tolled); the remainder is a plain local road.
        steps = [
          { html_instructions: "Merge onto <b>Highway 401</b>", distance: { value: 5000 } },
          { html_instructions: "Continue on Elm St", distance: { value: 8000 } },
        ];
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
          routes: [{ legs: [{ duration: { value: 480 }, steps }], overview_polyline: { points: ENCODED_POLYLINE } }],
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
    avoidTolls: false, // FR-018: checkbox unchecked
    ...overrides,
  };
}

describe("FR-018-022 change request -- single realistic search flow, real backend handler stack", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, ORIGINAL_ENV);
    vi.unstubAllGlobals();
  });

  it("exercises avoid-tolls-unchecked + highway exclusion + toll re-entry confirmation + transit stop detail + the map route field, all in one flow", async () => {
    applyEnv(validEnv({ MAX_CANDIDATES_RETURNED: "2" }));
    vi.stubGlobal("fetch", makeRouter());

    // --- Step 1: the initial search (FR-018 avoidTolls unchecked). ---
    const initial = createMock({ method: "POST", body: requestBody() });
    await searchHandler(initial.req, initial.res);
    const initialBody = initial.jsonBody() as DropOffSearchResponse;

    expect(initialBody.status).toBe("ranked");
    expect(initialBody.candidates).toHaveLength(2);

    // FR-020: the highway-401 segment (first 5000m) genuinely excluded the
    // earliest-sampled raw candidates -- both surviving final candidates
    // must come from AFTER that segment (routeOrderIndex reflects the
    // 1000m-spaced sample index; indices 0-4 sit inside the excluded
    // segment).
    for (const c of initialBody.candidates) {
      expect(c.routeOrderIndex).toBeGreaterThanOrEqual(5);
    }

    // FR-021: every surviving candidate has named boarding/arrival transit
    // stop detail with a line name + headsign.
    for (const c of initialBody.candidates) {
      expect(c.boardingStop).toBeDefined();
      expect(c.boardingStop!.lineName).toBe("506");
      expect(c.boardingStop!.headsign).toBe("Downtown Loop");
      expect(c.arrivalStop).toBeDefined();
    }

    // FR-019: since avoidTolls=false and the router's Phase 5 legs always
    // produce an on/off/on pattern, BOTH final candidates are flagged.
    for (const c of initialBody.candidates) {
      expect(c.needsTollReentryConfirmation).toBe(true);
      expect(c.tollReentryDescription).toBe("Highway 407 — exits and re-enters it during this trip");
    }

    // FR-022: the map view's data contract -- a non-empty route polyline.
    expect(initialBody.route).toBeDefined();
    expect(initialBody.route!.length).toBeGreaterThan(0);

    // --- Step 2: the user answers "No" to one candidate, "Yes" to the other (FR-019/OQ-10). ---
    const [rejected, accepted] = initialBody.candidates;
    const confirm = createMock({
      method: "POST",
      body: { originalRequest: requestBody(), rejectedCandidateLocations: [rejected!.location] },
    });
    await confirmHandler(confirm.req, confirm.res);
    const confirmBody = confirm.jsonBody() as DropOffSearchResponse;

    expect(confirmBody.status).toBe("ranked");
    // The rejected candidate is genuinely gone.
    expect(confirmBody.candidates.some((c) => c.location.lat === rejected!.location.lat && c.location.lng === rejected!.location.lng)).toBe(false);
    // The accepted survivor is present and NOT re-flagged (don't re-ask).
    const survivor = confirmBody.candidates.find((c) => c.location.lat === accepted!.location.lat && c.location.lng === accepted!.location.lng);
    expect(survivor).toBeDefined();
    expect(survivor!.needsTollReentryConfirmation).toBeUndefined();
    // FR-021 detail survives the confirm round-trip too.
    expect(survivor!.boardingStop).toBeDefined();
    // A genuinely new candidate was promoted into the vacated slot, also
    // still beyond the FR-020-excluded segment, and freshly flagged.
    const promoted = confirmBody.candidates.find((c) => c !== survivor);
    expect(promoted).toBeDefined();
    expect(promoted!.routeOrderIndex).toBeGreaterThanOrEqual(5);
    expect(promoted!.needsTollReentryConfirmation).toBe(true);
    // FR-022: the map route field is still present after the confirm round-trip.
    expect(confirmBody.route).toBeDefined();
  });
});
