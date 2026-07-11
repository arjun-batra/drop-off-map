import { describe, expect, it, vi } from "vitest";
import {
  createGoogleTransitService,
  parseTransitRoute,
} from "../../src/transit/googleTransitDirectionsService";
import { RoutingProviderError } from "../../src/routing/errors";
import type { EvaluatedCandidate } from "../../src/candidates/detourEvaluator";

const CANDIDATE: EvaluatedCandidate = {
  point: { lat: 43.7, lng: -79.4 },
  routeOrderIndex: 3,
  driveTimeToCandidateMinutes: 12,
  driveTimeFromCandidateMinutes: 8,
  detourMinutes: 2,
  qualifies: true,
};

const PASSENGER_DEST = { lat: 43.75, lng: -79.45 };
const DEPARTURE = new Date("2026-07-11T12:00:00.000Z");

function walkingStep(seconds: number) {
  return { travel_mode: "WALKING", duration: { value: seconds } };
}

function transitStep(departureSeconds: number, arrivalSeconds: number) {
  return {
    travel_mode: "TRANSIT",
    duration: { value: arrivalSeconds - departureSeconds },
    transit_details: {
      departure_time: { value: departureSeconds },
      arrival_time: { value: arrivalSeconds },
    },
  };
}

function directionsResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("parseTransitRoute -- design.md section 4.4 step 11 formulas (pure, no HTTP)", () => {
  it("computes walk/wait/transit for a single transit leg with a wait gap", () => {
    // clock starts at t=0. Walk 5 min (300s) -> clock=300. Bus departs at
    // t=600 (5 min wait) and arrives t=1500 (15 min ride).
    const route = {
      legs: [{ steps: [walkingStep(300), transitStep(600, 1500)] }],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.walkTimeMinutes).toBe(5);
    expect(result.waitTimeMinutes).toBe(5);
    expect(result.transitTimeMinutes).toBe(15);
    expect(result.passengerTotalTimeMinutes).toBe(25);
    expect(result.sawTransitStep).toBe(true);
  });

  it("hand-computed 2-transfer itinerary: walk 5min + transfer walk 1min, wait 2min + 3min, ride 10min + 15min = 36min total", () => {
    // t=0 start. Walk 300s -> clock=300 (5 min walk so far).
    // Transit 1: departs t=420 (wait 2min=120s), arrives t=1020 (ride 10min=600s). clock=1020.
    // Transfer walk 60s (1 min) -> clock=1080.
    // Transit 2: departs t=1260 (wait 3min=180s), arrives t=2160 (ride 15min=900s). clock=2160.
    const route = {
      legs: [
        {
          steps: [
            walkingStep(300),
            transitStep(420, 1020),
            walkingStep(60),
            transitStep(1260, 2160),
          ],
        },
      ],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.walkTimeMinutes).toBe(6); // 5 + 1 transfer walk
    expect(result.waitTimeMinutes).toBe(5); // 2 + 3
    expect(result.transitTimeMinutes).toBe(25); // 10 + 15
    expect(result.passengerTotalTimeMinutes).toBe(36);
    expect(result.sawTransitStep).toBe(true);
  });

  it("a walking-only route (zero TRANSIT steps) has sawTransitStep:false and zero wait/transit time by construction", () => {
    const route = { legs: [{ steps: [walkingStep(180)] }] };
    const result = parseTransitRoute(route, 0);
    expect(result.sawTransitStep).toBe(false);
    expect(result.walkTimeMinutes).toBe(3);
    expect(result.waitTimeMinutes).toBe(0);
    expect(result.transitTimeMinutes).toBe(0);
    expect(result.passengerTotalTimeMinutes).toBe(3);
  });

  it("clamps a negative wait/ride time to 0 (defensive against clock-skew/rounding)", () => {
    // transit step whose departure is *before* the running clock.
    const route = {
      legs: [{ steps: [walkingStep(600), transitStep(0, -100)] }],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.waitTimeMinutes).toBe(0);
    expect(result.transitTimeMinutes).toBe(0);
  });
});

describe("createGoogleTransitService.evaluate -- FR-006c/d/e, FR-008, and the walking-only DEC-3 fix", () => {
  it("sends mode=transit and the candidate-specific departure_time (FR-008 live-schedule requirement)", async () => {
    const fetchImpl = vi.fn(async () =>
      directionsResponse({ status: "ZERO_RESULTS", routes: [] }),
    );
    const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
    await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" });

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("mode")).toBe("transit");
    expect(url.searchParams.get("departure_time")).toBe(String(Math.floor(DEPARTURE.getTime() / 1000)));
    expect(url.searchParams.has("transit_mode")).toBe(false); // "all" omits the param
  });

  it("joins an explicit TRANSIT_MODES_INCLUDED list with Google's '|' separator", async () => {
    const fetchImpl = vi.fn(async () => directionsResponse({ status: "ZERO_RESULTS", routes: [] }));
    const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
    await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
      transitModesIncluded: ["bus", "subway"],
    });

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("transit_mode")).toBe("bus|subway");
  });

  describe("THE CRUX: distinguishing walking-only (valid result) from genuine no-route (noTransitAvailable:true)", () => {
    it("walking-only route (route exists, zero TRANSIT steps) -> noTransitAvailable:false, waitTimeMinutes:0, transitTimeMinutes:0, walk/total equal the full walk duration", async () => {
      const fetchImpl = vi.fn(async () =>
        directionsResponse({
          status: "OK",
          routes: [{ legs: [{ steps: [walkingStep(180)] }] }], // 3-minute walk, no transit legs
        }),
      );
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      const result = await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
        transitModesIncluded: "all",
      });

      expect(result.noTransitAvailable).toBe(false);
      expect(result.waitTimeMinutes).toBe(0);
      expect(result.transitTimeMinutes).toBe(0);
      expect(result.walkTimeMinutes).toBe(3);
      expect(result.passengerTotalTimeMinutes).toBe(3);
    });

    it("Google ZERO_RESULTS (genuine no-route) -> noTransitAvailable:true, all zeros", async () => {
      const fetchImpl = vi.fn(async () => directionsResponse({ status: "ZERO_RESULTS", routes: [] }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      const result = await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
        transitModesIncluded: "all",
      });

      expect(result).toEqual({
        walkTimeMinutes: 0,
        waitTimeMinutes: 0,
        transitTimeMinutes: 0,
        passengerTotalTimeMinutes: 0,
        noTransitAvailable: true,
      });
    });

    it("empty routes array with status OK -> noTransitAvailable:true (defensive, no crash)", async () => {
      const fetchImpl = vi.fn(async () => directionsResponse({ status: "OK", routes: [] }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      const result = await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
        transitModesIncluded: "all",
      });
      expect(result.noTransitAvailable).toBe(true);
    });

    it("a route with zero legs -> noTransitAvailable:true (defensive, no crash)", async () => {
      const fetchImpl = vi.fn(async () => directionsResponse({ status: "OK", routes: [{ legs: [] }] }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      const result = await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
        transitModesIncluded: "all",
      });
      expect(result.noTransitAvailable).toBe(true);
    });

    it("a genuine transit itinerary (walk + transit steps) -> noTransitAvailable:false with real wait/ride figures", async () => {
      const departureSeconds = Math.floor(DEPARTURE.getTime() / 1000);
      const fetchImpl = vi.fn(async () =>
        directionsResponse({
          status: "OK",
          routes: [
            {
              legs: [
                {
                  steps: [
                    walkingStep(300),
                    transitStep(departureSeconds + 600, departureSeconds + 1500),
                  ],
                },
              ],
            },
          ],
        }),
      );
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      const result = await service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, {
        transitModesIncluded: "all",
      });

      expect(result.noTransitAvailable).toBe(false);
      expect(result.walkTimeMinutes).toBe(5);
      expect(result.waitTimeMinutes).toBe(5);
      expect(result.transitTimeMinutes).toBe(15);
      expect(result.passengerTotalTimeMinutes).toBe(25);
    });
  });

  describe("whole-call provider failures -- distinct from noTransitAvailable, must throw", () => {
    it("a non-OK, non-ZERO_RESULTS status (e.g. REQUEST_DENIED) throws RoutingProviderError with detail intact", async () => {
      const fetchImpl = vi.fn(async () =>
        directionsResponse({ status: "REQUEST_DENIED", error_message: "The provided API key is invalid." }),
      );
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow(RoutingProviderError);
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow("The provided API key is invalid.");
    });

    it("OVER_QUERY_LIMIT throws RoutingProviderError, not silently swallowed into noTransitAvailable", async () => {
      const fetchImpl = vi.fn(async () => directionsResponse({ status: "OVER_QUERY_LIMIT" }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow(RoutingProviderError);
    });

    it("a network failure throws RoutingProviderError", async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error("network down");
      });
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow(RoutingProviderError);
    });

    it("a non-ok HTTP response throws RoutingProviderError", async () => {
      const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow(RoutingProviderError);
    });

    it("a malformed response body throws RoutingProviderError", async () => {
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ notStatus: true }) }));
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });
      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toThrow(RoutingProviderError);
    });
  });

  describe("REQUEST_TIMEOUT_MS enforcement (NFR-004, INC-7) -- design.md section 6.1 names this the slowest/highest-variance leg", () => {
    it("a hung transit call is genuinely aborted at timeoutMs and surfaces as RoutingProviderError('TIMEOUT')", async () => {
      const fetchImpl = vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      );
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl: fetchImpl as never, timeoutMs: 20 });

      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).rejects.toMatchObject({ providerStatus: "TIMEOUT" });
    });

    it("omitting timeoutMs is a passthrough: a normal call still resolves", async () => {
      const fetchImpl = vi.fn(async () =>
        directionsResponse({
          status: "OK",
          routes: [{ legs: [{ steps: [walkingStep(120), transitStep(0, 600)] }] }],
        }),
      );
      const service = createGoogleTransitService({ apiKey: "k", fetchImpl });

      await expect(
        service.evaluate(CANDIDATE, PASSENGER_DEST, DEPARTURE, { transitModesIncluded: "all" }),
      ).resolves.toMatchObject({ noTransitAvailable: false });
    });
  });
});
