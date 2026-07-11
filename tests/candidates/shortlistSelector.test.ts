import { describe, expect, it } from "vitest";
import { ShortlistSelector } from "../../src/candidates/shortlistSelector";
import type { EvaluatedCandidate } from "../../src/candidates/detourEvaluator";

function candidate(overrides: Partial<EvaluatedCandidate> & { routeOrderIndex: number }): EvaluatedCandidate {
  return {
    point: { lat: 43.6, lng: -79.3 },
    driveTimeToCandidateMinutes: 5,
    driveTimeFromCandidateMinutes: 5,
    detourMinutes: 0,
    qualifies: true,
    ...overrides,
  };
}

describe("ShortlistSelector.select -- design.md section 4.4 step 9", () => {
  it("selects qualifying candidates ascending by detourMinutes, up to the cap, when enough qualify", () => {
    const evaluated = [
      candidate({ routeOrderIndex: 0, detourMinutes: 5, qualifies: true }),
      candidate({ routeOrderIndex: 1, detourMinutes: 1, qualifies: true }),
      candidate({ routeOrderIndex: 2, detourMinutes: 3, qualifies: true }),
      candidate({ routeOrderIndex: 3, detourMinutes: 9, qualifies: true }),
    ];
    const shortlist = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 2 });
    expect(shortlist.map((c) => c.routeOrderIndex)).toEqual([1, 2]); // detour 1, then 3
  });

  it("fills remaining slots with next-smallest-detour NON-qualifying candidates when fewer than the cap qualify", () => {
    const evaluated = [
      candidate({ routeOrderIndex: 0, detourMinutes: 2, qualifies: true }),
      candidate({ routeOrderIndex: 1, detourMinutes: 20, qualifies: false }),
      candidate({ routeOrderIndex: 2, detourMinutes: 15, qualifies: false }),
      candidate({ routeOrderIndex: 3, detourMinutes: 30, qualifies: false }),
    ];
    const shortlist = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 3 });
    // 1 qualifying (index 0), then 2 smallest non-qualifying by detour: index 2 (15), index 1 (20)
    expect(shortlist.map((c) => c.routeOrderIndex)).toEqual([0, 2, 1]);
  });

  it("zero qualifying candidates -> still returns a full ascending-detour pool up to the cap (FR-011 fallback readiness)", () => {
    const evaluated = [
      candidate({ routeOrderIndex: 0, detourMinutes: 40, qualifies: false }),
      candidate({ routeOrderIndex: 1, detourMinutes: 10, qualifies: false }),
      candidate({ routeOrderIndex: 2, detourMinutes: 25, qualifies: false }),
    ];
    const shortlist = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 2 });
    expect(shortlist).toHaveLength(2);
    expect(shortlist.map((c) => c.routeOrderIndex)).toEqual([1, 2]); // 10, then 25
  });

  it("Infinity-detour candidates (no viable drive route) sort last within their group", () => {
    const evaluated = [
      candidate({ routeOrderIndex: 0, detourMinutes: Infinity, qualifies: false }),
      candidate({ routeOrderIndex: 1, detourMinutes: 5, qualifies: false }),
    ];
    const shortlist = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 2 });
    expect(shortlist.map((c) => c.routeOrderIndex)).toEqual([1, 0]);
  });

  it("configurability: raising maxTransitEvaluationsPerRequest returns more shortlisted candidates from the same pool", () => {
    const evaluated = Array.from({ length: 10 }, (_, i) =>
      candidate({ routeOrderIndex: i, detourMinutes: i, qualifies: true }),
    );
    const small = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 2 });
    const large = ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 8 });
    expect(small).toHaveLength(2);
    expect(large).toHaveLength(8);
  });

  it("does not mutate the input array", () => {
    const evaluated = [
      candidate({ routeOrderIndex: 0, detourMinutes: 5, qualifies: true }),
      candidate({ routeOrderIndex: 1, detourMinutes: 1, qualifies: true }),
    ];
    const copy = [...evaluated];
    ShortlistSelector.select(evaluated, { maxTransitEvaluationsPerRequest: 1 });
    expect(evaluated).toEqual(copy);
  });

  it("empty input -> empty output", () => {
    expect(ShortlistSelector.select([], { maxTransitEvaluationsPerRequest: 8 })).toEqual([]);
  });
});
