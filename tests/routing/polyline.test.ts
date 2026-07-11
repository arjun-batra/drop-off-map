import { describe, expect, it } from "vitest";
import { decodePolyline } from "../../src/routing/polyline";

describe("decodePolyline -- pure encoded-polyline decoding (precision 5)", () => {
  it("decodes Google's own documented sample string to the exact documented coordinates", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const points = decodePolyline(encoded);

    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lng).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[1].lng).toBeCloseTo(-120.95, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lng).toBeCloseTo(-126.453, 5);
  });

  it("edge case: an empty string decodes to an empty array, not a crash", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("handles a single-point polyline (no deltas beyond the first point)", () => {
    // A single encoded pair representing (0,0): both values are zero deltas.
    const points = decodePolyline("??");
    expect(points).toEqual([{ lat: 0, lng: 0 }]);
  });
});
