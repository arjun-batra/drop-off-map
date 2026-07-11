import { describe, expect, it } from "vitest";
import { Ranker, type RankingConfig } from "../../src/ranking/ranker";
import type { FullyEvaluatedCandidate } from "../../src/transit/types";

/**
 * Independent verification of design.md section 4.5 (Phase 4) / FR-010,
 * FR-011, FR-012, resolved OQ-2 (tie-break) and OQ-3 (fallback pick), and
 * DEC-3 (walking-only candidates rank normally). Tested directly against
 * `Ranker.rank`, not against dev's own self-described scenarios in
 * handoff.md -- built independently from requirements.md/design.md's text.
 */

function candidate(overrides: Partial<FullyEvaluatedCandidate> = {}): FullyEvaluatedCandidate {
  return {
    point: { lat: 43.6, lng: -79.4 },
    routeOrderIndex: 0,
    driveTimeToCandidateMinutes: 5,
    driveTimeFromCandidateMinutes: 5,
    detourMinutes: 2,
    qualifies: true,
    walkTimeMinutes: 3,
    waitTimeMinutes: 4,
    transitTimeMinutes: 10,
    passengerTotalTimeMinutes: 17,
    noTransitAvailable: false,
    ...overrides,
  };
}

const config: RankingConfig = { maxCandidatesReturned: 3 };

describe("Ranker.rank -- FR-010 (ranking + tie-break)", () => {
  it("sorts qualifying candidates ascending by passengerTotalTimeMinutes", () => {
    const a = candidate({ routeOrderIndex: 0, passengerTotalTimeMinutes: 30 });
    const b = candidate({ routeOrderIndex: 1, passengerTotalTimeMinutes: 10 });
    const c = candidate({ routeOrderIndex: 2, passengerTotalTimeMinutes: 20 });

    const result = Ranker.rank([a, b, c], 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results.map((r) => r.passengerTotalTimeMinutes)).toEqual([10, 20, 30]);
  });

  it("tie-break: equal passengerTotalTimeMinutes sorts by ascending routeOrderIndex (earlier on route wins)", () => {
    const a = candidate({ routeOrderIndex: 5, passengerTotalTimeMinutes: 20 });
    const b = candidate({ routeOrderIndex: 2, passengerTotalTimeMinutes: 20 });
    const c = candidate({ routeOrderIndex: 8, passengerTotalTimeMinutes: 20 });

    const result = Ranker.rank([a, b, c], 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results.map((r) => r.routeOrderIndex)).toEqual([2, 5, 8]);
  });

  it("routeOrderIndex is only a tie-break, not a secondary weight: a faster-but-later candidate still beats a slower-but-earlier one", () => {
    const fasterButLater = candidate({ routeOrderIndex: 9, passengerTotalTimeMinutes: 12 });
    const slowerButEarlier = candidate({ routeOrderIndex: 0, passengerTotalTimeMinutes: 25 });

    const result = Ranker.rank([slowerButEarlier, fasterButLater], 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results[0]!.routeOrderIndex).toBe(9);
    expect(result.results[1]!.routeOrderIndex).toBe(0);
  });

  it("respects maxCandidatesReturned cap even when more candidates qualify", () => {
    const candidates = [0, 1, 2, 3, 4].map((i) =>
      candidate({ routeOrderIndex: i, passengerTotalTimeMinutes: 10 + i }),
    );

    const result = Ranker.rank(candidates, 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results).toHaveLength(3);
  });

  it("configurability: a different maxCandidatesReturned value changes how many results come back for the identical candidate set", () => {
    const candidates = [0, 1, 2, 3, 4].map((i) =>
      candidate({ routeOrderIndex: i, passengerTotalTimeMinutes: 10 + i }),
    );

    const capped1 = Ranker.rank(candidates, 15, { maxCandidatesReturned: 1 });
    const capped5 = Ranker.rank(candidates, 15, { maxCandidatesReturned: 5 });

    expect(capped1.status).toBe("ranked");
    expect(capped5.status).toBe("ranked");
    if (capped1.status !== "ranked" || capped5.status !== "ranked") throw new Error("unreachable");
    expect(capped1.results).toHaveLength(1);
    expect(capped5.results).toHaveLength(5);
  });

  it("only qualifying (qualifies:true) candidates are considered for the ranked path -- a non-qualifying candidate with a great time is excluded", () => {
    const nonQualifyingButFast = candidate({ qualifies: false, passengerTotalTimeMinutes: 1, routeOrderIndex: 0 });
    const qualifying = candidate({ qualifies: true, passengerTotalTimeMinutes: 20, routeOrderIndex: 1 });

    const result = Ranker.rank([nonQualifyingButFast, qualifying], 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(20);
  });
});

describe("Ranker.rank -- FR-011 (fallback) / OQ-3 (smallest passenger time, not smallest detour)", () => {
  it("falls back when zero candidates qualify, picking smallest passengerTotalTimeMinutes regardless of detour size", () => {
    const worseDetourFasterPassenger = candidate({
      qualifies: false,
      detourMinutes: 40,
      passengerTotalTimeMinutes: 8,
      routeOrderIndex: 0,
    });
    const betterDetourSlowerPassenger = candidate({
      qualifies: false,
      detourMinutes: 18,
      passengerTotalTimeMinutes: 25,
      routeOrderIndex: 1,
    });

    const result = Ranker.rank([betterDetourSlowerPassenger, worseDetourFasterPassenger], 15, config);

    expect(result.status).toBe("fallback");
    if (result.status !== "fallback") throw new Error("unreachable");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.detourMinutes).toBe(40);
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(8);
  });

  it("fallback warning names both the configured threshold and the actual (rounded) detour", () => {
    const only = candidate({ qualifies: false, detourMinutes: 39.6, passengerTotalTimeMinutes: 8 });

    const result = Ranker.rank([only], 14.8, config);

    expect(result.status).toBe("fallback");
    if (result.status !== "fallback") throw new Error("unreachable");
    expect(result.warning).toContain("15 minutes"); // 14.8 rounds to 15
    expect(result.warning).toContain("40 minutes"); // 39.6 rounds to 40
  });

  it("fallback pool considers ALL viable candidates (qualifying or not), not just non-qualifying ones", () => {
    // Contrived: nothing in this set has qualifies:true, so it's a fallback
    // scenario regardless -- but confirms the fallback search isn't
    // restricted only to candidates that were shortlisted as non-qualifying.
    const a = candidate({ qualifies: false, passengerTotalTimeMinutes: 50 });
    const b = candidate({ qualifies: false, passengerTotalTimeMinutes: 5 });

    const result = Ranker.rank([a, b], 15, config);

    expect(result.status).toBe("fallback");
    if (result.status !== "fallback") throw new Error("unreachable");
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(5);
  });

  it("a noTransitAvailable:true candidate is NEVER selectable for fallback, even with a deceptively tiny passengerTotalTimeMinutes", () => {
    const deceptivelyGoodButNoTransit = candidate({
      qualifies: false,
      noTransitAvailable: true,
      passengerTotalTimeMinutes: 1,
    });
    const genuinelyViable = candidate({ qualifies: false, noTransitAvailable: false, passengerTotalTimeMinutes: 45 });

    const result = Ranker.rank([deceptivelyGoodButNoTransit, genuinelyViable], 15, config);

    expect(result.status).toBe("fallback");
    if (result.status !== "fallback") throw new Error("unreachable");
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(45);
    expect(result.results[0]!.noTransitAvailable).toBe(false);
  });
});

describe("Ranker.rank -- FR-012 (no viable option)", () => {
  it("returns no_viable_option only when EVERY candidate has noTransitAvailable:true", () => {
    const all = [
      candidate({ noTransitAvailable: true }),
      candidate({ noTransitAvailable: true }),
      candidate({ noTransitAvailable: true }),
    ];

    const result = Ranker.rank(all, 15, config);

    expect(result.status).toBe("no_viable_option");
  });

  it("does NOT return no_viable_option when at least one candidate has noTransitAvailable:false, even if the rest do not", () => {
    const mixed = [
      candidate({ noTransitAvailable: true }),
      candidate({ noTransitAvailable: true }),
      candidate({ noTransitAvailable: false, qualifies: false, passengerTotalTimeMinutes: 33 }),
    ];

    const result = Ranker.rank(mixed, 15, config);

    expect(result.status).not.toBe("no_viable_option");
    expect(result.status).toBe("fallback");
  });

  it("empty candidate list also resolves to no_viable_option (edge case)", () => {
    const result = Ranker.rank([], 15, config);
    expect(result.status).toBe("no_viable_option");
  });
});

describe("Ranker.rank -- DEC-3 (walking-only candidates are valid, rank normally)", () => {
  it("a walking-only candidate (near-zero transit time, noTransitAvailable:false) wins the ranked slot against a normal-transit candidate with a worse time", () => {
    const walkingOnly = candidate({
      routeOrderIndex: 4,
      qualifies: true,
      noTransitAvailable: false,
      walkTimeMinutes: 3,
      waitTimeMinutes: 0,
      transitTimeMinutes: 0,
      passengerTotalTimeMinutes: 3,
    });
    const normalTransit = candidate({
      routeOrderIndex: 0,
      qualifies: true,
      noTransitAvailable: false,
      passengerTotalTimeMinutes: 30,
    });

    const result = Ranker.rank([normalTransit, walkingOnly], 15, config);

    expect(result.status).toBe("ranked");
    if (result.status !== "ranked") throw new Error("unreachable");
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(3);
    expect(result.results[0]!.waitTimeMinutes).toBe(0);
    expect(result.results[0]!.transitTimeMinutes).toBe(0);
  });

  it("a walking-only candidate can also win the fallback slot when nothing qualifies", () => {
    const walkingOnly = candidate({
      qualifies: false,
      noTransitAvailable: false,
      passengerTotalTimeMinutes: 2,
    });
    const normalTransit = candidate({ qualifies: false, noTransitAvailable: false, passengerTotalTimeMinutes: 50 });

    const result = Ranker.rank([normalTransit, walkingOnly], 15, config);

    expect(result.status).toBe("fallback");
    if (result.status !== "fallback") throw new Error("unreachable");
    expect(result.results[0]!.passengerTotalTimeMinutes).toBe(2);
  });
});
