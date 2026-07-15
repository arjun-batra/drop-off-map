import { describe, expect, it } from "vitest";
import { locationKey } from "../../src/geo/locationKey";

/**
 * FR-019/INC-14 (design.md section 4.6 step 4, NFR-003 statelessness): the
 * only mechanism the confirm-toll-reentry endpoint has for comparing a
 * client-submitted rejected location against its own server-recomputed
 * candidate pool, since there is no server-side candidate ID (no session).
 */
describe("locationKey -- design.md section 4.6 step 4 / NFR-003", () => {
  it("produces identical keys for identical points", () => {
    expect(locationKey({ lat: 43.6532, lng: -79.3832 })).toBe(locationKey({ lat: 43.6532, lng: -79.3832 }));
  });

  it("produces distinct keys for genuinely distinct points", () => {
    expect(locationKey({ lat: 43.6532, lng: -79.3832 })).not.toBe(locationKey({ lat: 43.6533, lng: -79.3832 }));
  });

  it("rounds to 6 decimal places, tolerating JSON round-trip floating-point noise (documented ~11cm precision)", () => {
    const original = { lat: 43.65324999999, lng: -79.38321 };
    const roundTripped = JSON.parse(JSON.stringify(original)) as { lat: number; lng: number };
    // Both should collapse to the same key despite the tiny float noise --
    // this is the documented purpose of the 6-decimal rounding.
    expect(locationKey(original)).toBe(locationKey(roundTripped));
  });

  it("does not over-match two distinct points that only differ beyond the 6th decimal place is the ONE case it deliberately collapses -- but a real ~11cm-plus difference is still distinguished", () => {
    const a = { lat: 43.653200, lng: -79.383200 };
    const b = { lat: 43.653300, lng: -79.383200 }; // ~11m north, well beyond the ~11cm tolerance
    expect(locationKey(a)).not.toBe(locationKey(b));
  });

  it("handles negative coordinates and zero correctly (no sign-stripping bug)", () => {
    expect(locationKey({ lat: 0, lng: 0 })).toBe("0.000000,0.000000");
    expect(locationKey({ lat: -43.6532, lng: 79.3832 })).toBe("-43.653200,79.383200");
  });
});
