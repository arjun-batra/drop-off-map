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

/**
 * QA (INC-12 independent verification): a TRANSIT step with full FR-021
 * `transit_details` (line/headsign/departure_stop/arrival_stop), for testing
 * `parseTransitRoute`'s `boardingStop`/`arrivalStop` capture directly --
 * dev's own equivalent fixture was a temporary, uncommitted smoke test
 * (docs/handoff.md's INC-12 section), so this is QA's own from-scratch build,
 * not a copy of dev's.
 */
function transitStepWithStops(
  departureSeconds: number,
  arrivalSeconds: number,
  opts: {
    line?: { name?: string; short_name?: string };
    headsign?: string;
    departureStop?: { name?: string; location?: { lat: number; lng: number } };
    arrivalStop?: { name?: string; location?: { lat: number; lng: number } };
  },
) {
  return {
    travel_mode: "TRANSIT",
    duration: { value: arrivalSeconds - departureSeconds },
    transit_details: {
      departure_time: { value: departureSeconds },
      arrival_time: { value: arrivalSeconds },
      line: opts.line,
      headsign: opts.headsign,
      departure_stop: opts.departureStop,
      arrival_stop: opts.arrivalStop,
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

describe("parseTransitRoute -- FR-021 boardingStop/arrivalStop capture (QA-independent fixtures, INC-12)", () => {
  it("multi-transfer (3 TRANSIT legs, 2 intermediate transfer stops): boardingStop is the FIRST step's departure stop, arrivalStop is the LAST step's arrival stop -- never an intermediate transfer stop", () => {
    // Leg shape: walk -> Transit A (Stop Alpha -> Stop Beta) -> transfer walk
    // -> Transit B (Stop Beta -> Stop Gamma) -> transfer walk -> Transit C
    // (Stop Gamma -> Stop Delta) -> walk. "Stop Beta"/"Stop Gamma" are the
    // two intermediate transfer stops that must NOT leak into either field.
    const route = {
      legs: [
        {
          steps: [
            walkingStep(300),
            transitStepWithStops(600, 1500, {
              line: { name: "Route 1 Local", short_name: "1" },
              headsign: "North Terminal",
              departureStop: { name: "Stop Alpha", location: { lat: 1, lng: 1 } },
              arrivalStop: { name: "Stop Beta", location: { lat: 2, lng: 2 } },
            }),
            walkingStep(60),
            transitStepWithStops(1620, 2400, {
              line: { name: "Route 2 Express", short_name: "2" },
              headsign: "East Loop",
              departureStop: { name: "Stop Beta", location: { lat: 2, lng: 2 } },
              arrivalStop: { name: "Stop Gamma", location: { lat: 3, lng: 3 } },
            }),
            walkingStep(90),
            transitStepWithStops(2500, 3200, {
              line: { name: "Subway Line 3", short_name: "3" },
              headsign: "South Yard",
              departureStop: { name: "Stop Gamma", location: { lat: 3, lng: 3 } },
              arrivalStop: { name: "Stop Delta", location: { lat: 4, lng: 4 } },
            }),
            walkingStep(120),
          ],
        },
      ],
    };
    const result = parseTransitRoute(route, 0);

    expect(result.boardingStop).toEqual({
      name: "Stop Alpha",
      location: { lat: 1, lng: 1 },
      lineName: "1",
      headsign: "North Terminal",
    });
    expect(result.arrivalStop).toEqual({
      name: "Stop Delta",
      location: { lat: 4, lng: 4 },
      lineName: "3",
      headsign: "South Yard",
    });
    // Explicit "not an intermediate transfer stop" checks.
    expect(result.boardingStop!.name).not.toBe("Stop Beta");
    expect(result.boardingStop!.name).not.toBe("Stop Gamma");
    expect(result.arrivalStop!.name).not.toBe("Stop Beta");
    expect(result.arrivalStop!.name).not.toBe("Stop Gamma");
  });

  it("a single-TRANSIT-leg route: boardingStop and arrivalStop are the same one step's departure/arrival stop (sanity check distinct from the multi-transfer case)", () => {
    const route = {
      legs: [
        {
          steps: [
            walkingStep(240),
            transitStepWithStops(500, 1300, {
              line: { short_name: "506" },
              headsign: "Downtown Loop",
              departureStop: { name: "Oak Ave & Main St", location: { lat: 43.66, lng: -79.4 } },
              arrivalStop: { name: "Bay St Station", location: { lat: 43.7, lng: -79.38 } },
            }),
          ],
        },
      ],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.boardingStop).toEqual({
      name: "Oak Ave & Main St",
      location: { lat: 43.66, lng: -79.4 },
      lineName: "506",
      headsign: "Downtown Loop",
    });
    expect(result.arrivalStop).toEqual({
      name: "Bay St Station",
      location: { lat: 43.7, lng: -79.38 },
      lineName: "506",
      headsign: "Downtown Loop",
    });
  });

  it("walking-only route (DEC-3): boardingStop/arrivalStop are both undefined -- never empty strings or placeholder objects", () => {
    const route = { legs: [{ steps: [walkingStep(180)] }] };
    const result = parseTransitRoute(route, 0);
    expect(result.boardingStop).toBeUndefined();
    expect(result.arrivalStop).toBeUndefined();
    // Explicitly rule out the empty-string/placeholder failure mode.
    expect(result.boardingStop).not.toEqual({ name: "", location: expect.anything(), lineName: "", headsign: "" });
  });

  it("FR-021b: lineName prefers line.short_name over line.name when both are present", () => {
    const route = {
      legs: [
        {
          steps: [
            transitStepWithStops(0, 600, {
              line: { name: "Route 506 Local Downtown", short_name: "506" },
              headsign: "Downtown Loop",
              departureStop: { name: "A", location: { lat: 0, lng: 0 } },
              arrivalStop: { name: "B", location: { lat: 1, lng: 1 } },
            }),
          ],
        },
      ],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.boardingStop!.lineName).toBe("506");
  });

  it("lineName falls back to the full line.name when short_name is absent, and headsign falls back to '' (not undefined/crash) when absent", () => {
    const route = {
      legs: [
        {
          steps: [
            transitStepWithStops(0, 600, {
              line: { name: "Subway Line 2" },
              departureStop: { name: "A", location: { lat: 0, lng: 0 } },
              arrivalStop: { name: "B", location: { lat: 1, lng: 1 } },
            }),
          ],
        },
      ],
    };
    const result = parseTransitRoute(route, 0);
    expect(result.boardingStop!.lineName).toBe("Subway Line 2");
    expect(result.boardingStop!.headsign).toBe("");
  });

  describe("buildStopDetail's fail-open behavior against deliberately malformed provider data (dev's claim, independently verified)", () => {
    it("a TRANSIT step with a departure_stop missing its `name` field: boardingStop is undefined, not a half-populated object", () => {
      const route = {
        legs: [
          {
            steps: [
              transitStepWithStops(0, 600, {
                line: { short_name: "1" },
                headsign: "North",
                departureStop: { location: { lat: 1, lng: 1 } }, // name omitted
                arrivalStop: { name: "B", location: { lat: 2, lng: 2 } },
              }),
            ],
          },
        ],
      };
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeUndefined();
      expect(result.arrivalStop).toBeDefined();
    });

    it("a TRANSIT step with an arrival_stop missing its `location` field entirely: arrivalStop is undefined, not a half-populated object", () => {
      const route = {
        legs: [
          {
            steps: [
              transitStepWithStops(0, 600, {
                line: { short_name: "1" },
                departureStop: { name: "A", location: { lat: 1, lng: 1 } },
                arrivalStop: { name: "B" }, // location omitted
              }),
            ],
          },
        ],
      };
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeDefined();
      expect(result.arrivalStop).toBeUndefined();
    });

    it("a TRANSIT step whose departure_stop is entirely null: boardingStop is undefined, no crash", () => {
      // Deliberately violates the hand-typed GoogleTransitStep shape (`null`
      // where the interface says `undefined`) to simulate a genuinely
      // malformed real-world provider response TypeScript wouldn't otherwise
      // let us construct -- exactly the case buildStopDetail's defensive
      // check needs to survive.
      const route = {
        legs: [
          {
            steps: [
              {
                ...transitStepWithStops(0, 600, {
                  line: { short_name: "1" },
                  arrivalStop: { name: "B", location: { lat: 2, lng: 2 } },
                }),
                transit_details: {
                  departure_time: { value: 0 },
                  arrival_time: { value: 600 },
                  line: { short_name: "1" },
                  departure_stop: null,
                  arrival_stop: { name: "B", location: { lat: 2, lng: 2 } },
                },
              },
            ],
          },
        ],
      } as unknown as Parameters<typeof parseTransitRoute>[0];
      expect(() => parseTransitRoute(route, 0)).not.toThrow();
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeUndefined();
    });

    it("a stop's location has only a lat, no lng (partial/malformed coordinate): that stop is undefined, not a half-coordinate object", () => {
      const route = {
        legs: [
          {
            steps: [
              transitStepWithStops(0, 600, {
                line: { short_name: "1" },
                departureStop: { name: "A", location: { lat: 1 } as unknown as { lat: number; lng: number } },
                arrivalStop: { name: "B", location: { lat: 2, lng: 2 } },
              }),
            ],
          },
        ],
      };
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeUndefined();
    });

    it("a stop's location has non-numeric lat/lng (e.g. a string coordinate from a malformed response): that stop is undefined, no crash", () => {
      const route = {
        legs: [
          {
            steps: [
              transitStepWithStops(0, 600, {
                line: { short_name: "1" },
                departureStop: {
                  name: "A",
                  location: { lat: "43.66", lng: -79.4 } as unknown as { lat: number; lng: number },
                },
                arrivalStop: { name: "B", location: { lat: 2, lng: 2 } },
              }),
            ],
          },
        ],
      };
      expect(() => parseTransitRoute(route, 0)).not.toThrow();
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeUndefined();
    });

    it("a TRANSIT step with no `line` field at all: lineName falls back to '' (empty string), not a crash, and the stop is still otherwise valid (name/location present)", () => {
      const route = {
        legs: [
          {
            steps: [
              transitStepWithStops(0, 600, {
                departureStop: { name: "A", location: { lat: 1, lng: 1 } },
                arrivalStop: { name: "B", location: { lat: 2, lng: 2 } },
              }),
            ],
          },
        ],
      };
      const result = parseTransitRoute(route, 0);
      expect(result.boardingStop).toBeDefined();
      expect(result.boardingStop!.lineName).toBe("");
      expect(result.boardingStop!.headsign).toBe("");
    });

    it("a TRANSIT step whose entire transit_details is missing (defensive belt-and-suspenders, should never happen per the type but the runtime check must not crash): boardingStop/arrivalStop undefined for that step", () => {
      const route = {
        legs: [
          {
            steps: [
              { travel_mode: "TRANSIT", duration: { value: 600 } }, // no transit_details at all
            ],
          },
        ],
      };
      expect(() => parseTransitRoute(route, 0)).not.toThrow();
    });
  });
});

describe("createGoogleTransitService.evaluate -- FR-006c/d/e, FR-008, and the walking-only DEC-3 fix", () => {
  it("sends mode=transit and the candidate-specific departure_time (FR-008 live-schedule requirement)", async () => {
    const fetchImpl = vi.fn(async (_url: string) =>
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
    const fetchImpl = vi.fn(async (_url: string) => directionsResponse({ status: "ZERO_RESULTS", routes: [] }));
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
