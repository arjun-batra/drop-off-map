import { describe, expect, it } from "vitest";
import { toDropOffSearchCandidates } from "../../src/search/buildCandidates";
import { locationKey } from "../../src/geo/locationKey";
import type { LabeledFullyEvaluatedCandidate } from "../../src/search/buildCandidates";

function baseCandidate(overrides: Partial<LabeledFullyEvaluatedCandidate> = {}): LabeledFullyEvaluatedCandidate {
  return {
    point: { lat: 43.66, lng: -79.39 },
    routeOrderIndex: 0,
    driveTimeToCandidateMinutes: 8,
    driveTimeFromCandidateMinutes: 6,
    detourMinutes: 2,
    qualifies: true,
    walkTimeMinutes: 4,
    waitTimeMinutes: 5,
    transitTimeMinutes: 17,
    passengerTotalTimeMinutes: 26,
    noTransitAvailable: false,
    label: "Oak Ave & Main St",
    ...overrides,
  };
}

describe("toDropOffSearchCandidates -- design.md section 5.2's wire shape, shared by both endpoints (FR-019/INC-14)", () => {
  it("assigns rank as 1-based array position, not routeOrderIndex", () => {
    const candidates = [baseCandidate({ routeOrderIndex: 4 }), baseCandidate({ routeOrderIndex: 1 })];
    const result = toDropOffSearchCandidates(candidates, new Map());
    expect(result[0]!.rank).toBe(1);
    expect(result[1]!.rank).toBe(2);
  });

  it("computes driverTotalTimeMinutes as the trivial sum (FR-006f)", () => {
    const candidate = baseCandidate({ driveTimeToCandidateMinutes: 10, driveTimeFromCandidateMinutes: 7 });
    const [result] = toDropOffSearchCandidates([candidate], new Map());
    expect(result!.driverTotalTimeMinutes).toBe(17);
  });

  it("exceedsThreshold is the negation of qualifies", () => {
    const qualifying = baseCandidate({ qualifies: true });
    const nonQualifying = baseCandidate({ qualifies: false });
    const [r1, r2] = toDropOffSearchCandidates([qualifying, nonQualifying], new Map());
    expect(r1!.exceedsThreshold).toBe(false);
    expect(r2!.exceedsThreshold).toBe(true);
  });

  it("a candidate present in tollFlagsByKey gets both fields populated", () => {
    const candidate = baseCandidate();
    const flags = new Map([
      [locationKey(candidate.point), { needsTollReentryConfirmation: true, tollReentryDescription: "Highway 407 — exits and re-enters it during this trip" }],
    ]);
    const [result] = toDropOffSearchCandidates([candidate], flags);
    expect(result!.needsTollReentryConfirmation).toBe(true);
    expect(result!.tollReentryDescription).toBe("Highway 407 — exits and re-enters it during this trip");
  });

  it("a candidate ABSENT from tollFlagsByKey gets undefined for both fields, not false/omitted-with-a-default", () => {
    const candidate = baseCandidate();
    const [result] = toDropOffSearchCandidates([candidate], new Map());
    expect(result!.needsTollReentryConfirmation).toBeUndefined();
    expect(result!.tollReentryDescription).toBeUndefined();
    // Also verify this is genuinely absent on the wire (JSON), not merely
    // `undefined` in-memory -- design.md section 5.2's "present only when...".
    const wireShape = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(wireShape, "needsTollReentryConfirmation")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(wireShape, "tollReentryDescription")).toBe(false);
  });

  it("looks candidates up by locationKey, not array index -- flags for candidate B never leak onto candidate A even if B comes first in the map", () => {
    const candidateA = baseCandidate({ point: { lat: 43.66, lng: -79.39 } });
    const candidateB = baseCandidate({ point: { lat: 43.67, lng: -79.38 } });
    const flags = new Map([
      [locationKey(candidateB.point), { needsTollReentryConfirmation: true, tollReentryDescription: "Highway 407 — exits and re-enters it during this trip" }],
    ]);
    const [resultA, resultB] = toDropOffSearchCandidates([candidateA, candidateB], flags);
    expect(resultA!.needsTollReentryConfirmation).toBeUndefined();
    expect(resultB!.needsTollReentryConfirmation).toBe(true);
  });

  it("threads FR-021 boarding/arrival stop fields straight through unchanged", () => {
    const stop = { name: "Main St Stop", location: { lat: 43.66, lng: -79.39 }, lineName: "506", headsign: "Downtown" };
    const candidate = baseCandidate({ boardingStop: stop, arrivalStop: stop });
    const [result] = toDropOffSearchCandidates([candidate], new Map());
    expect(result!.boardingStop).toEqual(stop);
    expect(result!.arrivalStop).toEqual(stop);
  });

  it("a walking-only candidate (DEC-3, no boarding/arrival stop) keeps both undefined", () => {
    const candidate = baseCandidate({ boardingStop: undefined, arrivalStop: undefined });
    const [result] = toDropOffSearchCandidates([candidate], new Map());
    expect(result!.boardingStop).toBeUndefined();
    expect(result!.arrivalStop).toBeUndefined();
  });
});
