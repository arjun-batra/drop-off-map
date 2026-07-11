import { describe, expect, it } from "vitest";
import { evaluateShortlist } from "../../src/transit/evaluateShortlist";
import type { EvaluatedCandidate } from "../../src/candidates/detourEvaluator";
import type { TransitEvaluator, TransitResult } from "../../src/transit/types";

const PASSENGER_DEST = { lat: 43.75, lng: -79.45 };

function candidate(routeOrderIndex: number, driveTimeToCandidateMinutes = 10): EvaluatedCandidate {
  return {
    point: { lat: 43.6 + routeOrderIndex * 0.01, lng: -79.3 },
    routeOrderIndex,
    driveTimeToCandidateMinutes,
    driveTimeFromCandidateMinutes: 5,
    detourMinutes: 1,
    qualifies: true,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const OK_RESULT: TransitResult = {
  walkTimeMinutes: 1,
  waitTimeMinutes: 2,
  transitTimeMinutes: 3,
  passengerTotalTimeMinutes: 6,
  noTransitAvailable: false,
};

describe("evaluateShortlist -- design.md section 4.4 steps 10-13 orchestration", () => {
  it("computes each candidate's departureTime as exactly now + driveTimeToCandidateMinutes, from a single shared clock reading", async () => {
    const fixedNow = new Date("2026-07-11T12:00:00.000Z");
    const calls: Array<{ candidateIndex: number; departureTime: Date }> = [];
    const evaluator: TransitEvaluator = {
      async evaluate(candidate, _dest, departureTime) {
        calls.push({ candidateIndex: candidate.routeOrderIndex, departureTime });
        return { ...OK_RESULT };
      },
    };

    const shortlist = [candidate(0, 10), candidate(1, 25)];
    await evaluateShortlist(
      evaluator,
      shortlist,
      PASSENGER_DEST,
      { transitModesIncluded: "all", providerConcurrencyLimit: 5 },
      { now: () => fixedNow },
    );

    const call0 = calls.find((c) => c.candidateIndex === 0)!;
    const call1 = calls.find((c) => c.candidateIndex === 1)!;
    expect(call0.departureTime.getTime()).toBe(fixedNow.getTime() + 10 * 60_000);
    expect(call1.departureTime.getTime()).toBe(fixedNow.getTime() + 25 * 60_000);
  });

  it("skips a candidate with non-finite driveTimeToCandidateMinutes WITHOUT spending a provider call, returning noTransitAvailable:true directly", async () => {
    let calls = 0;
    const evaluator: TransitEvaluator = {
      async evaluate() {
        calls++;
        return { ...OK_RESULT };
      },
    };

    const shortlist = [candidate(0, Number.POSITIVE_INFINITY), candidate(1, 10)];
    const results = await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
      transitModesIncluded: "all",
      providerConcurrencyLimit: 5,
    });

    expect(calls).toBe(1); // only candidate 1 spent a real call
    const infCandidateResult = results.find((r) => r.routeOrderIndex === 0)!;
    expect(infCandidateResult.noTransitAvailable).toBe(true);
    expect(infCandidateResult.walkTimeMinutes).toBe(0);
    expect(infCandidateResult.waitTimeMinutes).toBe(0);
    expect(infCandidateResult.transitTimeMinutes).toBe(0);
    expect(infCandidateResult.passengerTotalTimeMinutes).toBe(0);
  });

  it("preserves each candidate's original fields (spread) alongside its transit result", async () => {
    const evaluator: TransitEvaluator = { async evaluate() { return { ...OK_RESULT }; } };
    const shortlist = [candidate(4, 10)];
    const [result] = await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
      transitModesIncluded: "all",
      providerConcurrencyLimit: 5,
    });
    expect(result.routeOrderIndex).toBe(4);
    expect(result.detourMinutes).toBe(1);
    expect(result.qualifies).toBe(true);
    expect(result.passengerTotalTimeMinutes).toBe(6);
  });

  describe("concurrency bounding -- PROVIDER_CONCURRENCY_LIMIT is genuinely enforced, not just requested", () => {
    it("with limit=3 over 12 candidates, max observed concurrent calls never exceeds 3 but does exceed 1 (real parallelism, not serial)", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const evaluator: TransitEvaluator = {
        async evaluate() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await delay(15);
          inFlight--;
          return { ...OK_RESULT };
        },
      };

      const shortlist = Array.from({ length: 12 }, (_, i) => candidate(i));
      await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
        transitModesIncluded: "all",
        providerConcurrencyLimit: 3,
      });

      expect(maxInFlight).toBeLessThanOrEqual(3);
      expect(maxInFlight).toBeGreaterThan(1);
    });

    it("configurability: raising providerConcurrencyLimit raises the observed max concurrency for the same shortlist", async () => {
      async function runWithLimit(limit: number): Promise<number> {
        let inFlight = 0;
        let maxInFlight = 0;
        const evaluator: TransitEvaluator = {
          async evaluate() {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await delay(15);
            inFlight--;
            return { ...OK_RESULT };
          },
        };
        const shortlist = Array.from({ length: 12 }, (_, i) => candidate(i));
        await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
          transitModesIncluded: "all",
          providerConcurrencyLimit: limit,
        });
        return maxInFlight;
      }

      const lowMax = await runWithLimit(2);
      const highMax = await runWithLimit(6);
      expect(lowMax).toBeLessThanOrEqual(2);
      expect(highMax).toBeLessThanOrEqual(6);
      expect(highMax).toBeGreaterThan(lowMax);
    });

    it("never spawns more workers than there are shortlisted candidates", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const evaluator: TransitEvaluator = {
        async evaluate() {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await delay(10);
          inFlight--;
          return { ...OK_RESULT };
        },
      };
      const shortlist = [candidate(0), candidate(1)];
      await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
        transitModesIncluded: "all",
        providerConcurrencyLimit: 10,
      });
      expect(maxInFlight).toBeLessThanOrEqual(2);
    });
  });

  describe("deadline / onSkippedDueToDeadline (design.md section 6.3, NFR-004, INC-7)", () => {
    it("a deadline already in the past skips every candidate with zero real provider calls made", async () => {
      let calls = 0;
      const evaluator: TransitEvaluator = {
        async evaluate() {
          calls++;
          return { ...OK_RESULT };
        },
      };
      const shortlist = [candidate(0), candidate(1), candidate(2)];
      let skippedCount = 0;

      const results = await evaluateShortlist(
        evaluator,
        shortlist,
        PASSENGER_DEST,
        { transitModesIncluded: "all", providerConcurrencyLimit: 5 },
        { deadline: new Date(Date.now() - 1000), onSkippedDueToDeadline: () => skippedCount++ },
      );

      expect(calls).toBe(0);
      expect(skippedCount).toBe(3);
      for (const result of results) {
        expect(result.noTransitAvailable).toBe(true);
        expect(result.walkTimeMinutes).toBe(0);
        expect(result.waitTimeMinutes).toBe(0);
        expect(result.transitTimeMinutes).toBe(0);
        expect(result.passengerTotalTimeMinutes).toBe(0);
      }
    });

    it("a deadline exceeded partway through a concurrency-limited fan-out yields SOME completed and SOME skipped candidates (graceful partial degradation)", async () => {
      const evaluator: TransitEvaluator = {
        async evaluate() {
          await delay(15);
          return { ...OK_RESULT };
        },
      };
      const shortlist = Array.from({ length: 6 }, (_, i) => candidate(i));
      let skippedCount = 0;

      const results = await evaluateShortlist(
        evaluator,
        shortlist,
        PASSENGER_DEST,
        { transitModesIncluded: "all", providerConcurrencyLimit: 2 },
        { deadline: new Date(Date.now() + 20), onSkippedDueToDeadline: () => skippedCount++ },
      );

      const completed = results.filter((r) => !r.noTransitAvailable);
      const skipped = results.filter((r) => r.noTransitAvailable);
      expect(completed.length).toBeGreaterThan(0);
      expect(skipped.length).toBeGreaterThan(0);
      expect(skippedCount).toBe(skipped.length);
    });

    it("a deadline far in the future never skips any candidate", async () => {
      let calls = 0;
      const evaluator: TransitEvaluator = {
        async evaluate() {
          calls++;
          return { ...OK_RESULT };
        },
      };
      const shortlist = [candidate(0), candidate(1)];
      let skippedCount = 0;

      await evaluateShortlist(
        evaluator,
        shortlist,
        PASSENGER_DEST,
        { transitModesIncluded: "all", providerConcurrencyLimit: 5 },
        { deadline: new Date(Date.now() + 60_000), onSkippedDueToDeadline: () => skippedCount++ },
      );

      expect(calls).toBe(2);
      expect(skippedCount).toBe(0);
    });

    it("omitting deadline entirely is backward compatible -- no skipping behavior at all", async () => {
      let calls = 0;
      const evaluator: TransitEvaluator = {
        async evaluate() {
          calls++;
          return { ...OK_RESULT };
        },
      };
      const shortlist = [candidate(0), candidate(1)];

      const results = await evaluateShortlist(evaluator, shortlist, PASSENGER_DEST, {
        transitModesIncluded: "all",
        providerConcurrencyLimit: 5,
      });

      expect(calls).toBe(2);
      expect(results.every((r) => !r.noTransitAvailable)).toBe(true);
    });
  });

  it("empty shortlist -> empty result, no provider calls", async () => {
    let calls = 0;
    const evaluator: TransitEvaluator = {
      async evaluate() {
        calls++;
        return { ...OK_RESULT };
      },
    };
    const results = await evaluateShortlist(evaluator, [], PASSENGER_DEST, {
      transitModesIncluded: "all",
      providerConcurrencyLimit: 5,
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });
});
