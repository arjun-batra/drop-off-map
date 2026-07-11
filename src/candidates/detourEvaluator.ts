import type { AppConfig } from "../config/schema";
import type { LatLng } from "../geo/types";
import type { DistanceMatrixService } from "../routing/googleDistanceMatrixService";
import type { RawCandidate } from "./candidateGenerator";

/** Mirrors design.md section 5.1's `EvaluatedCandidate`. */
export interface EvaluatedCandidate extends RawCandidate {
  driveTimeToCandidateMinutes: number;
  driveTimeFromCandidateMinutes: number;
  detourMinutes: number;
  qualifies: boolean;
}

export type DetourEvaluationConfig = Pick<AppConfig, "distanceMatrixBatchSize">;

/**
 * Mirrors design.md section 5.1's `DetourEvaluator` interface. Note: the
 * design's section 5.1 TS listing shows `batchEvaluate(start, dest,
 * directDriveTimeMinutes, candidates, config)` with no explicit
 * `maxDetourMinutes` parameter, but section 4.3 step 8's algorithm text
 * requires the user-supplied `maxDetourMinutes` (FR-002) to compute the
 * `qualifies` flag, and `maxDetourMinutes` is per-request user input, not an
 * `AppConfig` field -- it cannot be read off `config`. Read literally, the
 * interface as drafted cannot implement its own prose. This looks like a
 * drafting gap in the interface listing rather than a business ambiguity,
 * so dev added `maxDetourMinutes` as an explicit parameter to make the
 * documented formula computable, rather than silently guessing a config
 * source for it. Flagged to tech-lead in docs/handoff.md for confirmation.
 */
export interface DetourEvaluator {
  batchEvaluate(
    start: LatLng,
    dest: LatLng,
    directDriveTimeMinutes: number,
    candidates: RawCandidate[],
    maxDetourMinutes: number,
    config: DetourEvaluationConfig,
  ): Promise<EvaluatedCandidate[]>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Implements design.md section 4.3's Phase 2: batches raw candidates into
 * groups of `DISTANCE_MATRIX_BATCH_SIZE` and issues exactly 2 Distance
 * Matrix calls per batch in parallel (start->batch, batch->dest), computing
 * `detourMinutes = (driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes)
 * - directDriveTimeMinutes` and the FR-009 `qualifies` flag. This costs
 * exactly `2 * ceil(candidates.length / distanceMatrixBatchSize)` provider
 * calls, matching design.md section 4.3's cost accounting.
 *
 * A candidate whose pair has no viable driving route on either leg (Google's
 * per-element status isn't OK) is kept in the result (not thrown away) with
 * `qualifies: false` and `detourMinutes: Infinity` -- FR-011's fallback
 * (INC-6) needs visibility into every evaluated candidate, qualifying or
 * not, and Infinity sorts last by construction rather than needing special
 * handling downstream.
 */
export function createDetourEvaluator(distanceMatrixService: DistanceMatrixService): DetourEvaluator {
  return {
    async batchEvaluate(start, dest, directDriveTimeMinutes, candidates, maxDetourMinutes, config) {
      const batches = chunk(candidates, config.distanceMatrixBatchSize);
      const evaluated: EvaluatedCandidate[] = [];

      for (const batch of batches) {
        const points = batch.map((candidate) => candidate.point);

        const [toMatrix, fromMatrix] = await Promise.all([
          distanceMatrixService.getDurationsMinutes([start], points),
          distanceMatrixService.getDurationsMinutes(points, [dest]),
        ]);

        const toRow = toMatrix[0] ?? [];

        for (const [i, candidate] of batch.entries()) {
          const driveTimeToCandidateMinutes = toRow[i] ?? null;
          const driveTimeFromCandidateMinutes = fromMatrix[i]?.[0] ?? null;

          if (driveTimeToCandidateMinutes === null || driveTimeFromCandidateMinutes === null) {
            evaluated.push({
              ...candidate,
              driveTimeToCandidateMinutes: Number.POSITIVE_INFINITY,
              driveTimeFromCandidateMinutes: Number.POSITIVE_INFINITY,
              detourMinutes: Number.POSITIVE_INFINITY,
              qualifies: false,
            });
            continue;
          }

          const detourMinutes = driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes - directDriveTimeMinutes;

          evaluated.push({
            ...candidate,
            driveTimeToCandidateMinutes,
            driveTimeFromCandidateMinutes,
            detourMinutes,
            qualifies: detourMinutes <= maxDetourMinutes,
          });
        }
      }

      return evaluated;
    },
  };
}
