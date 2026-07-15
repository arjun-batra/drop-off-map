import { describe, expect, it, vi } from "vitest";
import { createDetourEvaluator, type DetourEvaluationConfig } from "../../src/candidates/detourEvaluator";
import type { RawCandidate } from "../../src/candidates/candidateGenerator";
import type { DistanceMatrixService, ElementDurationMinutes } from "../../src/routing/googleDistanceMatrixService";
import { RoutingProviderError } from "../../src/routing/errors";

const START = { lat: 43.6532, lng: -79.3832 };
const DEST = { lat: 43.7, lng: -79.4 };

function makeCandidates(n: number): RawCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ point: { lat: 43.6 + i * 0.001, lng: -79.4 }, routeOrderIndex: i }));
}

function config(distanceMatrixBatchSize: number): DetourEvaluationConfig {
  return { distanceMatrixBatchSize };
}

/** A fake DistanceMatrixService returning a flat N-minute duration for every element. */
function flatDurationService(minutes: number): DistanceMatrixService & { getDurationsMinutes: ReturnType<typeof vi.fn> } {
  const fn = vi.fn(async (origins: unknown[], destinations: unknown[]): Promise<ElementDurationMinutes[][]> => {
    // Mirrors Google's rows x elements shape for 1xN or Nx1 calls.
    if (origins.length === 1) {
      return [destinations.map(() => minutes)];
    }
    return origins.map(() => [minutes]);
  });
  return { getDurationsMinutes: fn };
}

describe("createDetourEvaluator -- FR-006b, FR-009, design.md section 4.3", () => {
  describe("Distance Matrix batching/call-count formula: 2 * ceil(N / batchSize)", () => {
    it("N=0 candidates -> 0 Distance Matrix calls, empty result", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, [], 100, false, config(25));

      expect(service.getDurationsMinutes).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it("N=1 candidate, batchSize=25 -> exactly 1 batch, 2 calls", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(1), 100, false, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(1);
    });

    it("N=25 candidates, batchSize=25 -> exactly one full batch, 2 calls (not 4)", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(25), 100, false, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(25);
    });

    it("N=26 candidates, batchSize=25 -> 2 batches (one straggler), 4 calls", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(26), 100, false, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(4);
      expect(result).toHaveLength(26);
    });

    it("N=47 candidates, batchSize=25 -> ceil(47/25)=2 batches, 4 calls, matching the dev-claimed example exactly", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(47), 100, false, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(4);
      expect(result).toHaveLength(47); // none silently dropped
    });

    it("N=100 candidates, batchSize=30 -> ceil(100/30)=4 batches, 8 calls (non-divisible remainder)", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(100), 100, false, config(30));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(8);
      expect(result).toHaveLength(100);
    });

    it("each batch's two calls (to-leg, from-leg) are issued in parallel, not sequentially awaited one after another", async () => {
      const callOrder: string[] = [];
      let resolveTo!: () => void;
      const toPromise = new Promise<void>((resolve) => (resolveTo = resolve));

      const service: DistanceMatrixService = {
        // Two candidates so the "to" call (origins=[start], length 1) and the
        // "from" call (origins=candidates, length 2) are distinguishable.
        getDurationsMinutes: vi.fn(async (origins) => {
          if (origins.length === 1) {
            // "to" leg -- deliberately delayed to prove the "from" leg doesn't wait on it.
            callOrder.push("to-start");
            await toPromise;
            callOrder.push("to-end");
            return [[5, 5]];
          }
          callOrder.push("from-called-before-to-resolved");
          return [[5], [5]];
        }),
      };
      const evaluator = createDetourEvaluator(service);

      const evalPromise = evaluator.batchEvaluate(START, DEST, 8, makeCandidates(2), 100, false, config(25));
      // Let microtasks flush so the "from" call has a chance to run before "to" resolves.
      await Promise.resolve();
      await Promise.resolve();
      expect(callOrder).toContain("from-called-before-to-resolved");
      resolveTo();
      await evalPromise;
    });
  });

  describe("detour math -- FR-006b's exact formula", () => {
    it("detourMinutes = (driveTimeTo + driveTimeFrom) - directDriveTimeMinutes, matching a hand-computed example", async () => {
      const service = flatDurationService(5); // 5 min each leg
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(1), 100, false, config(25));

      // (5 + 5) - 8 = 2
      expect(result[0]!.driveTimeToCandidateMinutes).toBe(5);
      expect(result[0]!.driveTimeFromCandidateMinutes).toBe(5);
      expect(result[0]!.detourMinutes).toBe(2);
    });

    it("a candidate exactly on the direct route (0 added distance) yields detourMinutes 0, not a negative/NaN artifact", async () => {
      const service = flatDurationService(4); // 4+4=8, equals the direct baseline
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(1), 100, false, config(25));

      expect(result[0]!.detourMinutes).toBe(0);
    });
  });

  describe("qualifies flag (FR-009) -- candidates are retained regardless, never dropped", () => {
    it("qualifies=true when detourMinutes <= maxDetourMinutes (boundary inclusive)", async () => {
      const service = flatDurationService(5); // detour = 2
      const evaluator = createDetourEvaluator(service);

      const exactBoundary = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(1), 2, false, config(25));
      expect(exactBoundary[0]!.qualifies).toBe(true);

      const aboveThreshold = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(1), 1, false, config(25));
      expect(aboveThreshold[0]!.qualifies).toBe(false);
    });

    it("non-qualifying candidates are still present in the output, not discarded (FR-011 readiness)", async () => {
      const service = flatDurationService(5); // detour = 2, will not qualify at maxDetourMinutes=1
      const evaluator = createDetourEvaluator(service);
      const candidates = makeCandidates(5);

      const result = await evaluator.batchEvaluate(START, DEST, 8, candidates, 1, false, config(25));

      expect(result).toHaveLength(5);
      expect(result.every((c) => c.qualifies === false)).toBe(true);
      // All 5 original routeOrderIndex values must still be represented.
      expect(result.map((c) => c.routeOrderIndex).sort()).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe("per-element failure (ZERO_RESULTS/NOT_FOUND on one leg) -- design.md's 'kept, not dropped' instruction", () => {
    it("a candidate whose to-leg has no viable route (null) is kept with detourMinutes=Infinity, qualifies=false", async () => {
      const service: DistanceMatrixService = {
        getDurationsMinutes: vi.fn(async (origins) => {
          if (origins.length === 1) return [[null, 5]]; // first candidate's "to" leg fails
          return [[5], [5]];
        }),
      };
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(2), 100, false, config(25));

      expect(result).toHaveLength(2); // neither candidate dropped
      expect(result[0]!.detourMinutes).toBe(Number.POSITIVE_INFINITY);
      expect(result[0]!.qualifies).toBe(false);
      // Sibling candidate in the same batch is unaffected.
      expect(result[1]!.detourMinutes).toBe(2); // (5+5)-8
      expect(result[1]!.qualifies).toBe(true);
    });

    it("a candidate whose from-leg has no viable route (null) is also kept with detourMinutes=Infinity, qualifies=false", async () => {
      const service: DistanceMatrixService = {
        getDurationsMinutes: vi.fn(async (origins) => {
          if (origins.length === 1) return [[5, 5]];
          return [[null], [5]]; // first candidate's "from" leg fails
        }),
      };
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(2), 100, false, config(25));

      expect(result).toHaveLength(2);
      expect(result[0]!.detourMinutes).toBe(Number.POSITIVE_INFINITY);
      expect(result[0]!.qualifies).toBe(false);
      expect(result[1]!.qualifies).toBe(true);
    });

    it("Infinity sorts last under a plain ascending numeric sort, requiring no special-case handling downstream", async () => {
      const service: DistanceMatrixService = {
        getDurationsMinutes: vi.fn(async (origins) => {
          if (origins.length === 1) return [[null, 5, 3]];
          return [[5], [5], [5]];
        }),
      };
      const evaluator = createDetourEvaluator(service);

      const result = await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(3), 100, false, config(25));
      const sorted = [...result].sort((a, b) => a.detourMinutes - b.detourMinutes);

      expect(sorted[sorted.length - 1]!.detourMinutes).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe("whole-request provider failure -- distinct from a per-element failure", () => {
    it("propagates RoutingProviderError rather than silently returning empty/partial data", async () => {
      const service: DistanceMatrixService = {
        getDurationsMinutes: vi.fn().mockRejectedValue(new RoutingProviderError("REQUEST_DENIED", "bad key")),
      };
      const evaluator = createDetourEvaluator(service);

      await expect(
        evaluator.batchEvaluate(START, DEST, 8, makeCandidates(5), 100, false, config(25)),
      ).rejects.toThrow(RoutingProviderError);
    });
  });

  describe("FR-018/design.md section 4.3a (INC-13): `avoidTolls` threads to BOTH Distance Matrix legs of EVERY batch", () => {
    it("avoidTolls=true is forwarded as the 3rd argument to both the to-leg and from-leg calls, for a single batch", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(3), 100, true, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(2);
      for (const call of service.getDurationsMinutes.mock.calls) {
        expect(call[2]).toBe(true);
      }
    });

    it("avoidTolls=false is forwarded as false (not omitted/undefined) to both legs", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(3), 100, false, config(25));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(2);
      for (const call of service.getDurationsMinutes.mock.calls) {
        expect(call[2]).toBe(false);
      }
    });

    it("avoidTolls=true is forwarded to EVERY batch's two calls, not just the first batch, across multiple batches", async () => {
      const service = flatDurationService(5);
      const evaluator = createDetourEvaluator(service);

      // 3 batches of batchSize 2 (candidates=5 -> ceil(5/2)=3 batches, 6 calls).
      await evaluator.batchEvaluate(START, DEST, 8, makeCandidates(5), 100, true, config(2));

      expect(service.getDurationsMinutes).toHaveBeenCalledTimes(6);
      for (const call of service.getDurationsMinutes.mock.calls) {
        expect(call[2]).toBe(true);
      }
    });
  });
});
