import { describe, expect, it } from "vitest";
import { computeTollReentryFlags } from "../../src/search/tollReentryPhase";
import { locationKey } from "../../src/geo/locationKey";
import type { RoutingService } from "../../src/routing/types";

const START = { lat: 43.6532, lng: -79.3832 };
const DRIVER_DEST = { lat: 43.75, lng: -79.4 };

function tollRoute() {
  return {
    durationMinutes: 5,
    polyline: [],
    steps: [{ instructionsHtml: "Merge onto Highway 407", distanceMeters: 1000, cumulativeDistanceMeters: 1000 }],
  };
}
function plainRoute() {
  return {
    durationMinutes: 5,
    polyline: [],
    steps: [{ instructionsHtml: "Turn onto Elm St", distanceMeters: 1000, cumulativeDistanceMeters: 1000 }],
  };
}

/**
 * FR-019/INC-14, design.md section 4.6 Phase 5 -- the shared function both
 * `api/drop-off-search.ts` (every final candidate) and
 * `api/drop-off-search/confirm-toll-reentry.ts` (only newly-promoted
 * candidates) call over their own differently-scoped candidate subsets.
 */
describe("computeTollReentryFlags -- design.md section 4.6 Phase 5 (generic over the candidate subset)", () => {
  it("returns an empty Map with ZERO provider calls for an empty candidate list (main endpoint's own contract when nothing needs checking)", async () => {
    let calls = 0;
    const routingService: RoutingService = {
      async getDirectRoute() {
        calls++;
        return plainRoute();
      },
    };
    const result = await computeTollReentryFlags(routingService, START, DRIVER_DEST, [], 10);
    expect(result.size).toBe(0);
    expect(calls).toBe(0);
  });

  it("only includes an entry for a candidate that WAS flagged -- a not-flagged candidate has no key in the map at all (not a false-valued entry)", async () => {
    let callIndex = 0;
    const routingService: RoutingService = {
      async getDirectRoute() {
        callIndex++;
        // Candidate 0's two legs (calls 1,2): plain, no toll pattern.
        // Candidate 1's two legs (calls 3,4): on/off/on re-entry pattern.
        if (callIndex <= 2) return plainRoute();
        if (callIndex === 3) return tollRoute();
        return {
          durationMinutes: 5,
          polyline: [],
          steps: [
            { instructionsHtml: "Take exit onto Local Road", distanceMeters: 500, cumulativeDistanceMeters: 500 },
            { instructionsHtml: "Merge onto Highway 407", distanceMeters: 1000, cumulativeDistanceMeters: 1500 },
          ],
        };
      },
    };

    const notFlagged = { lat: 43.66, lng: -79.39 };
    const flagged = { lat: 43.67, lng: -79.38 };
    const result = await computeTollReentryFlags(routingService, START, DRIVER_DEST, [notFlagged, flagged], 10);

    expect(result.has(locationKey(notFlagged))).toBe(false);
    expect(result.has(locationKey(flagged))).toBe(true);
    expect(result.get(locationKey(flagged))).toEqual({
      needsTollReentryConfirmation: true,
      tollReentryDescription: "Highway 407 — exits and re-enters it during this trip",
    });
  });

  it("keys the returned Map by locationKey, not array index -- callers can merge onto a differently-ordered/shaped list", async () => {
    const routingService: RoutingService = {
      async getDirectRoute() {
        return tollRoute(); // always "on" only -- no re-entry, nothing flagged
      },
    };
    const points = [
      { lat: 43.66, lng: -79.39 },
      { lat: 43.67, lng: -79.38 },
    ];
    const result = await computeTollReentryFlags(routingService, START, DRIVER_DEST, points, 10);
    expect(result.size).toBe(0); // single continuous "on" run is not a re-entry pattern
  });
});
