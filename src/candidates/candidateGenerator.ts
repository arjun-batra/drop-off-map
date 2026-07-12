import type { AppConfig } from "../config/schema.js";
import type { LatLng } from "../geo/types.js";
import { haversineDistanceKm } from "../geo/radiusValidator.js";

/** Mirrors design.md section 5.1's `RawCandidate`. */
export interface RawCandidate {
  point: LatLng;
  routeOrderIndex: number;
}

export type CandidateSamplingConfig = Pick<
  AppConfig,
  "candidateSpacingMeters" | "maxRawCandidatesSampled" | "geographicCenter" | "geographicRadiusKm"
>;

/**
 * Implements design.md section 5.1's `CandidateGenerator` interface /
 * section 4.2's Phase 1 algorithm. Pure geo math, no provider calls -- the
 * whole point of this phase is to be "free" before the batched Distance
 * Matrix evaluation (detourEvaluator.ts) spends any budget.
 */
export const CandidateGenerator = {
  sampleAlongPolyline(polyline: LatLng[], config: CandidateSamplingConfig): RawCandidate[] {
    if (polyline.length < 2) return [];

    // Cumulative distance (meters) at each polyline vertex, used to walk the
    // route by distance rather than by vertex count. Non-null assertions
    // below are safe: the loop only ever indexes within [0, polyline.length)
    // / [0, cumulativeMeters.length), both proven by the loop bounds.
    const cumulativeMeters: number[] = [0];
    for (let i = 1; i < polyline.length; i++) {
      const segmentMeters = haversineDistanceKm(polyline[i - 1]!, polyline[i]!) * 1000;
      cumulativeMeters.push(cumulativeMeters[i - 1]! + segmentMeters);
    }
    const routeLengthMeters = cumulativeMeters[cumulativeMeters.length - 1]!;
    if (routeLengthMeters <= 0) return [];

    // design.md section 4.2 step 3: never exceed the sampled-point cap
    // regardless of how long the route is.
    const effectiveSpacingMeters = Math.max(
      config.candidateSpacingMeters,
      routeLengthMeters / config.maxRawCandidatesSampled,
    );

    const candidates: RawCandidate[] = [];
    let segmentIndex = 0;

    // sampleIndex doubles as the route-order index (design.md section 4.2
    // step 4/FR-010) -- it reflects position along the route in sampling
    // order even when a point is later dropped for being outside the
    // service radius, so relative ordering among *kept* candidates is
    // unaffected by which earlier samples were dropped.
    for (let sampleIndex = 0; sampleIndex < config.maxRawCandidatesSampled; sampleIndex++) {
      const targetDistance = effectiveSpacingMeters * (sampleIndex + 1);
      if (targetDistance > routeLengthMeters) break;

      while (segmentIndex < cumulativeMeters.length - 2 && cumulativeMeters[segmentIndex + 1]! < targetDistance) {
        segmentIndex++;
      }

      const segStart = polyline[segmentIndex]!;
      const segEnd = polyline[segmentIndex + 1]!;
      const segStartDist = cumulativeMeters[segmentIndex]!;
      const segEndDist = cumulativeMeters[segmentIndex + 1]!;
      const segLength = segEndDist - segStartDist;
      const t = segLength === 0 ? 0 : (targetDistance - segStartDist) / segLength;

      const point: LatLng = {
        lat: segStart.lat + (segEnd.lat - segStart.lat) * t,
        lng: segStart.lng + (segEnd.lng - segStart.lng) * t,
      };

      // design.md section 4.2 step 4: drop candidates that fall outside the
      // service radius even though start/driverDestination are both inside
      // it -- road geometry can briefly leave the circle.
      if (haversineDistanceKm(point, config.geographicCenter) <= config.geographicRadiusKm) {
        candidates.push({ point, routeOrderIndex: sampleIndex });
      }
    }

    return candidates;
  },
};
