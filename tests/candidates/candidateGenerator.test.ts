import { describe, expect, it } from "vitest";
import { CandidateGenerator, type CandidateSamplingConfig } from "../../src/candidates/candidateGenerator";
import { haversineDistanceKm } from "../../src/geo/radiusValidator";
import type { LatLng } from "../../src/geo/types";
import type { DirectionStep } from "../../src/routing/types";

// Includes `label` so this same constant can double as both a plain LatLng
// (e.g. polyline vertices) and a GeoPoint (CandidateSamplingConfig's
// `geographicCenter`, which requires `label`) without a second constant.
const TORONTO = { lat: 43.6532, lng: -79.3832, label: "Toronto, ON" };
const EARTH_RADIUS_KM = 6371;

/**
 * A point exactly `km` due north of `origin` (same longitude). For
 * same-longitude pairs, haversine reduces to `R * dLatRadians` exactly (no
 * approximation), so this is the exact inverse of haversineDistanceKm for
 * this specific case -- lets tests assert precise candidate counts/positions
 * without re-implementing the sampling algorithm itself.
 */
function northOf(origin: LatLng, km: number): LatLng {
  const degLat = (km / EARTH_RADIUS_KM) * (180 / Math.PI);
  return { lat: origin.lat + degLat, lng: origin.lng };
}

function baseConfig(overrides: Partial<CandidateSamplingConfig> = {}): CandidateSamplingConfig {
  return {
    candidateSpacingMeters: 1000,
    maxRawCandidatesSampled: 20,
    geographicCenter: TORONTO,
    geographicRadiusKm: 200,
    ...overrides,
  };
}

describe("CandidateGenerator.sampleAlongPolyline -- FR-005, design.md section 4.2", () => {
  describe("edge cases", () => {
    it("returns [] for a polyline with fewer than 2 points", () => {
      expect(CandidateGenerator.sampleAlongPolyline([], [], baseConfig())).toEqual([]);
      expect(CandidateGenerator.sampleAlongPolyline([TORONTO], [], baseConfig())).toEqual([]);
    });

    it("returns [] for a zero-length route (duplicate start/end point)", () => {
      const polyline = [TORONTO, { ...TORONTO }];
      expect(CandidateGenerator.sampleAlongPolyline(polyline, [], baseConfig())).toEqual([]);
    });
  });

  describe("spacing-dominated sampling (route length / cap < configured spacing)", () => {
    it("samples at exactly the configured spacing, not at an over-eager/under-eager interval", () => {
      // 9.5km route, spacing=1000m, cap=20 -> effectiveSpacing = max(1000, 9500/20=475) = 1000.
      // Deliberately NOT an exact multiple of 1000m, so this does not land on
      // the known floating-point boundary edge case (see dedicated test below).
      const end = northOf(TORONTO, 9.5);
      const polyline = [TORONTO, end];
      const config = baseConfig({ candidateSpacingMeters: 1000, maxRawCandidatesSampled: 20 });

      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, [], config);

      // targetDistance = 1000*(i+1) for i=0..8 (9000m <= 9500m); i=9 -> 10000m > 9500m, stopped.
      expect(candidates).toHaveLength(9);
      expect(candidates.map((c) => c.routeOrderIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

      // Confirm actual spacing between consecutive candidates matches the
      // configured 1000m (not some other interval), within a small tolerance.
      for (let i = 1; i < candidates.length; i++) {
        const gapKm = haversineDistanceKm(candidates[i - 1]!.point, candidates[i]!.point);
        expect(gapKm * 1000).toBeCloseTo(1000, 0);
      }
    });

    it("configurability: doubling CANDIDATE_SPACING_METERS roughly halves the candidate count for the same route", () => {
      const end = northOf(TORONTO, 9.5);
      const polyline = [TORONTO, end];

      const narrow = CandidateGenerator.sampleAlongPolyline(polyline, [], baseConfig({ candidateSpacingMeters: 1000 }));
      const wide = CandidateGenerator.sampleAlongPolyline(polyline, [], baseConfig({ candidateSpacingMeters: 2000 }));

      expect(narrow).toHaveLength(9);
      expect(wide).toHaveLength(4); // targetDistance = 2000*(i+1), i=0..3 (8000<=9500), i=4 -> 10000>9500
      expect(wide.length).toBeLessThan(narrow.length);
    });
  });

  describe("cap-dominated sampling (route far longer than spacing*cap)", () => {
    it("never exceeds MAX_RAW_CANDIDATES_SAMPLED regardless of route length", () => {
      // 501km route, spacing=1000m, cap=20 -> effectiveSpacing = max(1000, 501000/20=25050) = 25050,
      // deliberately not an exact multiple of the route length to sidestep the
      // known float-boundary edge case tested separately below.
      const end = northOf(TORONTO, 501);
      const polyline = [TORONTO, end];
      // geographicRadiusKm widened well past the route length -- this test is
      // about the cap/spacing formula, not the radius filter (that's covered
      // in its own describe block below).
      const config = baseConfig({ candidateSpacingMeters: 1000, maxRawCandidatesSampled: 20, geographicRadiusKm: 10000 });

      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, [], config);

      expect(candidates.length).toBeLessThanOrEqual(20);
      // Not degenerately small either -- confirms the cap is actually being hit,
      // not some unrelated bug silently truncating results.
      expect(candidates.length).toBeGreaterThanOrEqual(19);
      // routeOrderIndex is contiguous here (no radius filtering in play -- radius
      // is generous), confirming the cap-widening logic itself doesn't introduce
      // gaps on its own (gaps come only from the radius filter, tested below).
      expect(candidates.map((c) => c.routeOrderIndex)).toEqual(
        Array.from({ length: candidates.length }, (_, i) => i),
      );

      // Effective spacing actually widened to ~25050m (route/cap), not left at
      // the configured 1000m -- confirms the "never exceed the cap" formula,
      // not just an incidental small count.
      const gapKm = haversineDistanceKm(candidates[0]!.point, candidates[1]!.point);
      expect(gapKm * 1000).toBeCloseTo(25050, -2); // within ~50m tolerance
    });

    it("configurability: raising MAX_RAW_CANDIDATES_SAMPLED increases the candidate count for the same long route", () => {
      const end = northOf(TORONTO, 501);
      const polyline = [TORONTO, end];

      const cappedAt20 = CandidateGenerator.sampleAlongPolyline(
        polyline,
        [],
        baseConfig({ candidateSpacingMeters: 1000, maxRawCandidatesSampled: 20, geographicRadiusKm: 10000 }),
      );
      const cappedAt40 = CandidateGenerator.sampleAlongPolyline(
        polyline,
        [],
        baseConfig({ candidateSpacingMeters: 1000, maxRawCandidatesSampled: 40, geographicRadiusKm: 10000 }),
      );

      expect(cappedAt40.length).toBeGreaterThan(cappedAt20.length);
      expect(cappedAt40.length).toBeLessThanOrEqual(40);
    });
  });

  describe("known limitation: exact-boundary floating-point off-by-one (documented in handoff.md, not filed as a bug)", () => {
    it("a route length landing exactly on the spacing*cap boundary may yield cap-1 or cap candidates, never more", () => {
      // 500km route, spacing=1000, cap=20 -> effectiveSpacing = 500000/20 = 25000
      // exactly, so the last sample's target (25000*20=500000) lands exactly on
      // routeLengthMeters -- floating-point rounding in the cumulative-distance
      // walk can tip this either side of the strict `>` comparison.
      const end = northOf(TORONTO, 500);
      const polyline = [TORONTO, end];
      const config = baseConfig({
        candidateSpacingMeters: 1000,
        maxRawCandidatesSampled: 20,
        geographicRadiusKm: 10000,
      });

      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, [], config);

      // Documented, accepted behavior per handoff.md: 19 or 20, never fewer
      // than 19 and never more than the cap. Not asserting an exact count here
      // since the whole point of this test is that the boundary is
      // float-sensitive -- see docs/test-report.md for QA's assessment.
      expect([19, 20]).toContain(candidates.length);
      expect(candidates.length).toBeLessThanOrEqual(20);
    });
  });

  describe("radius filter + routeOrderIndex ordering (FR-005, design.md section 4.2 step 4, INC-6's tie-break dependency)", () => {
    it("drops out-of-radius candidates while preserving true route order among survivors (non-contiguous routeOrderIndex)", () => {
      // Route: Toronto -> 105km north (out of a 50km radius) -> back to Toronto.
      // Cumulative route length = 210km. Spacing dominates (25km configured,
      // cap=20 so route/cap=10500 < 25000 doesn't dominate).
      const far = northOf(TORONTO, 105);
      // Deliberately construct the "return leg" as an independent vertex list so
      // the polyline is a real out-and-back path (3 vertices), not a single
      // straight segment.
      const polyline = [TORONTO, far, { ...TORONTO }];
      const config = baseConfig({
        candidateSpacingMeters: 25000,
        maxRawCandidatesSampled: 20,
        geographicCenter: TORONTO,
        geographicRadiusKm: 50,
      });

      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, [], config);

      // Cumulative route length = 210km. targetDistance = 25*(i+1) km for
      // i=0..7 (200<=210); i=8 -> 225>210, stop. 8 raw samples before filtering,
      // at cumulative km: 25,50,75,100,125,150,175,200.
      // Outbound leg (cumulative 0-105km): actual distance-from-center equals
      // cumulative distance directly -> 25km(in),50km(in,boundary),75km(out),100km(out).
      // Return leg (cumulative 105-210km): actual distance-from-center = 210-cumulative
      // -> 125km->85km(out),150km->60km(out),175km->35km(in),200km->10km(in).
      // Surviving sample indices: 0 (25km), 1 (50km), 6 (175km), 7 (200km).
      expect(candidates.map((c) => c.routeOrderIndex)).toEqual([0, 1, 6, 7]);

      // routeOrderIndex is NOT contiguous/renumbered (0,1,2,3) -- this is the
      // specific, intentional behavior INC-6's tie-break rule depends on: the
      // index must reflect true position along the route, even with gaps.
      expect(candidates.map((c) => c.routeOrderIndex)).not.toEqual([0, 1, 2, 3]);

      // And routeOrderIndex is still strictly increasing in the order returned
      // (correct relative route-order is preserved for the survivors).
      const indices = candidates.map((c) => c.routeOrderIndex);
      for (let i = 1; i < indices.length; i++) {
        expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
      }

      // Sanity: none of the surviving points are actually out of radius.
      for (const c of candidates) {
        expect(haversineDistanceKm(c.point, TORONTO)).toBeLessThanOrEqual(50 + 1e-6);
      }
    });

    it("configurability: widening GEOGRAPHIC_RADIUS_KM recovers previously-dropped candidates for the same route", () => {
      const far = northOf(TORONTO, 105);
      const polyline = [TORONTO, far, { ...TORONTO }];
      const narrowConfig = baseConfig({
        candidateSpacingMeters: 25000,
        maxRawCandidatesSampled: 20,
        geographicRadiusKm: 50,
      });
      const wideConfig = baseConfig({
        candidateSpacingMeters: 25000,
        maxRawCandidatesSampled: 20,
        geographicRadiusKm: 200,
      });

      const narrow = CandidateGenerator.sampleAlongPolyline(polyline, [], narrowConfig);
      const wide = CandidateGenerator.sampleAlongPolyline(polyline, [], wideConfig);

      expect(narrow.length).toBeLessThan(wide.length);
      // At radius=200km, every sample along this route (max 105km from center) survives.
      expect(wide).toHaveLength(8);
    });
  });

  describe("FR-020 highway exclusion (design.md section 4.2a, DEC-6)", () => {
    // 9.5km route, spacing=1000m, cap=20 -> 9 raw samples at 1000,2000,...,9000m
    // (see the "spacing-dominated sampling" describe block above for the same
    // baseline route/count without any steps).
    const end = northOf(TORONTO, 9.5);
    const polyline = [TORONTO, end];
    const config = baseConfig({ candidateSpacingMeters: 1000, maxRawCandidatesSampled: 20 });

    function step(instructionsHtml: string, cumulativeDistanceMeters: number): DirectionStep {
      return { instructionsHtml, distanceMeters: cumulativeDistanceMeters, cumulativeDistanceMeters };
    }

    it("empty steps list fails open -- excludes nothing, identical to the no-steps baseline", () => {
      const withEmptySteps = CandidateGenerator.sampleAlongPolyline(polyline, [], config);
      expect(withEmptySteps).toHaveLength(9);
    });

    it("a single step spanning the whole route tagged as a limited-access highway drops every candidate", () => {
      const steps = [step("Merge onto <b>Highway 401</b> E", 9500)];
      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, steps, config);
      expect(candidates).toHaveLength(0);
    });

    it("a single step spanning the whole route tagged as an arterial road (Highway 7) drops nothing", () => {
      const steps = [step("Turn right onto Highway 7", 9500)];
      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, steps, config);
      expect(candidates).toHaveLength(9);
    });

    it("mixed route: an arterial first half survives, a limited-access-highway second half is excluded -- correct partial exclusion, not all-or-nothing", () => {
      // Step 0: 0-5000m, "Highway 7" (arterial, must survive).
      // Step 1: 5000-9500m (routeLengthMeters), "Highway 401" (must be excluded).
      const steps = [step("Continue on Highway 7", 5000), step("Merge onto Highway 401 E", 9500)];
      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, steps, config);

      // Samples at targetDistance 1000..5000 (routeOrderIndex 0-4) fall in the
      // arterial step and survive; 6000..9000 (routeOrderIndex 5-8) fall in the
      // highway step and are dropped.
      expect(candidates.map((c) => c.routeOrderIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(candidates).toHaveLength(5);
      expect(candidates.length).toBeLessThan(9); // strictly smaller than the unfiltered baseline
    });

    it("boundary case: a candidate landing exactly on the step transition is attributed to the earlier (ending) step, not the next one", () => {
      // The routeOrderIndex=4 sample (targetDistance=5000m) lands exactly on
      // step 0's cumulativeDistanceMeters boundary in the mixed-route test
      // above and is attributed to step 0 (arterial, survives) -- this test
      // isolates that exact assertion so a regression here is caught
      // specifically, not just incidentally via the mixed-route count.
      const steps = [step("Continue on Highway 7", 5000), step("Merge onto Highway 401 E", 9500)];
      const candidates = CandidateGenerator.sampleAlongPolyline(polyline, steps, config);
      const boundaryCandidate = candidates.find((c) => c.routeOrderIndex === 4);
      expect(boundaryCandidate).toBeDefined(); // survived -> attributed to step 0 (arterial), not step 1 (highway)

      // And the inverse: if the boundary step itself were the highway (not
      // the arterial), the exact-boundary candidate would still be attributed
      // to the earlier ("ending") step per the same rule -- confirm this by
      // swapping which side of the boundary is the highway.
      const swappedSteps = [step("Merge onto Highway 401 E", 5000), step("Continue on Highway 7", 9500)];
      const swappedCandidates = CandidateGenerator.sampleAlongPolyline(polyline, swappedSteps, config);
      const swappedBoundaryCandidate = swappedCandidates.find((c) => c.routeOrderIndex === 4);
      expect(swappedBoundaryCandidate).toBeUndefined(); // dropped -> attributed to step 0 (now the highway)
    });

    it("excludes highway candidates and out-of-radius candidates independently (both hard-rejection rules compose correctly)", () => {
      // Reuse the out-and-back route from the radius-filter describe block
      // above, but additionally tag the outbound leg's first quarter as a
      // limited-access highway -- confirms FR-020 exclusion and the
      // pre-existing radius exclusion don't interfere with each other.
      const far = northOf(TORONTO, 105);
      const outAndBack = [TORONTO, far, { ...TORONTO }];
      const radiusConfig = baseConfig({
        candidateSpacingMeters: 25000,
        maxRawCandidatesSampled: 20,
        geographicCenter: TORONTO,
        geographicRadiusKm: 50,
      });
      // Baseline (no steps) survivors per the earlier test: routeOrderIndex [0, 1, 6, 7]
      // at cumulative km 25, 50, 175, 200 respectively (total route length 210km).
      const highwaySteps = [step("Merge onto Highway 401 E", 30000), step("Continue on Highway 7", 210000)];
      const candidates = CandidateGenerator.sampleAlongPolyline(outAndBack, highwaySteps, radiusConfig);

      // routeOrderIndex 0 (25km, in the highway-tagged first 30km) is now also
      // excluded on top of the radius filter; routeOrderIndex 1 (50km) is past
      // the highway step boundary and unaffected by FR-020, but was already
      // in-radius; 6 and 7 remain in-radius and off the highway step.
      expect(candidates.map((c) => c.routeOrderIndex)).toEqual([1, 6, 7]);
    });
  });
});
