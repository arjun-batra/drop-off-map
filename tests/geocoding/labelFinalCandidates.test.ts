import { describe, expect, it, vi } from "vitest";
import { labelFinalCandidates } from "../../src/geocoding/labelFinalCandidates";
import type { GeocodingService } from "../../src/geocoding/types";

/**
 * design.md section 3.1b: reverse-geocodes only the final returned
 * candidates, with a per-candidate fallback to a distance-based label
 * (ux-spec.md section 6.4) rather than failing the whole request.
 */

const START = { lat: 43.6532, lng: -79.3832 };

function fakeGeocodingService(behavior: (point: { lat: number; lng: number }) => Promise<string>): GeocodingService {
  return {
    resolve: vi.fn(async () => []),
    reverseGeocode: vi.fn(behavior),
  };
}

describe("labelFinalCandidates -- design.md section 3.1b", () => {
  it("happy path: each candidate gets its reverse-geocoded label", async () => {
    const service = fakeGeocodingService(async (point) => `Near ${point.lat},${point.lng}`);
    const candidates = [{ point: { lat: 43.66, lng: -79.4 } }, { point: { lat: 43.67, lng: -79.41 } }];

    const labeled = await labelFinalCandidates(service, START, candidates);

    expect(labeled).toHaveLength(2);
    expect(labeled[0]!.label).toBe("Near 43.66,-79.4");
    expect(labeled[1]!.label).toBe("Near 43.67,-79.41");
  });

  it("per-candidate reverse-geocode failure falls back to a haversine distance-from-start label, not a blank/unlabeled candidate", async () => {
    const service = fakeGeocodingService(async () => {
      throw new Error("ZERO_RESULTS");
    });
    // Roughly 1 degree of latitude north of start ~ 111km -- exact value not
    // the point, just confirming a real positive distance is substituted in.
    const candidates = [{ point: { lat: START.lat + 1, lng: START.lng } }];

    const labeled = await labelFinalCandidates(service, START, candidates);

    expect(labeled).toHaveLength(1);
    expect(labeled[0]!.label).toMatch(/^~\d+(\.\d+)? km into your route$/);
  });

  it("a mix of success and failure across candidates -- one bad reverse-geocode does not affect the other candidates' labels", async () => {
    const service = fakeGeocodingService(async (point) => {
      if (point.lat === 43.66) throw new Error("no match");
      return "Good Label";
    });
    const candidates = [{ point: { lat: 43.66, lng: -79.4 } }, { point: { lat: 43.7, lng: -79.42 } }];

    const labeled = await labelFinalCandidates(service, START, candidates);

    expect(labeled[0]!.label).toMatch(/km into your route/);
    expect(labeled[1]!.label).toBe("Good Label");
  });

  it("empty candidate list resolves to an empty array without calling the geocoding service", async () => {
    const service = fakeGeocodingService(async () => "unused");
    const labeled = await labelFinalCandidates(service, START, []);
    expect(labeled).toEqual([]);
    expect(service.reverseGeocode).not.toHaveBeenCalled();
  });
});
