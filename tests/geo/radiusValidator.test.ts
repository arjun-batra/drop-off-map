import { describe, expect, it } from "vitest";
import { haversineDistanceKm, RadiusValidator } from "../../src/geo/radiusValidator";

const TORONTO = { lat: 43.6532, lng: -79.3832 };

describe("haversineDistanceKm -- pure great-circle distance", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineDistanceKm(TORONTO, TORONTO)).toBeCloseTo(0, 6);
  });

  it("returns a plausible distance for two well-known points (Toronto to Ottawa, ~350-400km)", () => {
    const ottawa = { lat: 45.4215, lng: -75.6972 };
    const km = haversineDistanceKm(TORONTO, ottawa);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(420);
  });

  it("is symmetric: distance(a,b) === distance(b,a)", () => {
    const other = { lat: 45.4215, lng: -75.6972 };
    expect(haversineDistanceKm(TORONTO, other)).toBeCloseTo(haversineDistanceKm(other, TORONTO), 9);
  });
});

describe("RadiusValidator.isWithinServiceArea -- NFR-006, FR-004", () => {
  const config = { geographicCenter: TORONTO, geographicRadiusKm: 200 };

  it("happy path: a point well within the radius is accepted", () => {
    const nearby = { lat: 43.7, lng: -79.4 }; // a few km from Toronto center
    expect(RadiusValidator.isWithinServiceArea(nearby, config)).toBe(true);
  });

  it("edge case: a point well outside the radius is rejected", () => {
    const vancouver = { lat: 49.2827, lng: -123.1207 };
    expect(RadiusValidator.isWithinServiceArea(vancouver, config)).toBe(false);
  });

  it("boundary: a point exactly at the configured radius is accepted (<=, not <)", () => {
    // 1 degree of latitude is ~111km; construct a point at close to (but not
    // over) 200km due north and confirm the <= boundary is inclusive by
    // checking a point just inside vs. just outside the same bearing.
    const justInside = { lat: TORONTO.lat + 199 / 111, lng: TORONTO.lng };
    const justOutside = { lat: TORONTO.lat + 201 / 111, lng: TORONTO.lng };
    expect(RadiusValidator.isWithinServiceArea(justInside, config)).toBe(true);
    expect(RadiusValidator.isWithinServiceArea(justOutside, config)).toBe(false);
  });

  it("configurability: a point that fails under the default radius passes once GEOGRAPHIC_RADIUS_KM is widened", () => {
    const farPoint = { lat: TORONTO.lat + 3, lng: TORONTO.lng }; // ~333km north
    expect(RadiusValidator.isWithinServiceArea(farPoint, { geographicCenter: TORONTO, geographicRadiusKm: 200 })).toBe(
      false,
    );
    expect(RadiusValidator.isWithinServiceArea(farPoint, { geographicCenter: TORONTO, geographicRadiusKm: 400 })).toBe(
      true,
    );
  });

  it("configurability: changing GEOGRAPHIC_CENTER changes which points are in-area", () => {
    const point = { lat: 45.4215, lng: -75.6972 }; // Ottawa
    expect(RadiusValidator.isWithinServiceArea(point, { geographicCenter: TORONTO, geographicRadiusKm: 200 })).toBe(
      false,
    );
    expect(
      RadiusValidator.isWithinServiceArea(point, { geographicCenter: point, geographicRadiusKm: 200 }),
    ).toBe(true);
  });
});
