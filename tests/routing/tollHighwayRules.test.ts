import { describe, expect, it } from "vitest";
import { isLimitedAccessHighway } from "../../src/routing/tollHighwayRules";
import type { DirectionStep } from "../../src/routing/types";

/**
 * FR-020 (highway exclusion) / DEC-6 (allowlist-based text-pattern-match
 * approximation, accepted with residual false-positive/false-negative risk).
 *
 * This suite tests `isLimitedAccessHighway()` against the requirements
 * document's own text, not just dev's manual verification -- in particular
 * the false-positive guard FR-020 explicitly calls out ("Highway" appearing
 * in an arterial road's official name must NOT cause exclusion) and the
 * curated allowlist named in design.md section 4.7 (400-series highways
 * 400-407, 409, 410, 412, 416, 417, 427; QEW; DVP; Gardiner Expressway;
 * 407 ETR).
 */

function step(instructionsHtml: string, overrides: Partial<DirectionStep> = {}): DirectionStep {
  return {
    instructionsHtml,
    distanceMeters: 1000,
    cumulativeDistanceMeters: 1000,
    ...overrides,
  };
}

describe("isLimitedAccessHighway -- FR-020, design.md section 4.7, DEC-6", () => {
  describe("positive matches -- dev's claimed set", () => {
    it.each([
      ["ON-401 E", "ON-401 E"],
      ["Highway 407", "Highway 407"],
      ["407 ETR (no Highway/ON- prefix)", "407 ETR"],
      ["QEW", "QEW"],
      ["Gardiner Expressway", "Gardiner Expressway"],
      ["Don Valley Parkway", "Don Valley Parkway"],
      ["DVP", "DVP"],
    ])("flags %s", (_label, text) => {
      expect(isLimitedAccessHighway(step(text))).toBe(true);
    });

    it("matches embedded in a full Google-style HTML instruction string", () => {
      expect(
        isLimitedAccessHighway(step("Merge onto <b>ON-401 E</b> via the ramp to Toronto/Ottawa")),
      ).toBe(true);
    });

    it("matches Queen Elizabeth Way spelled out in full", () => {
      expect(isLimitedAccessHighway(step("Continue onto Queen Elizabeth Way"))).toBe(true);
    });

    it("matches Express Toll Route spelled out in full", () => {
      expect(isLimitedAccessHighway(step("Continue onto the Express Toll Route"))).toBe(true);
    });
  });

  describe("every 400-series number in the curated allowlist matches with a route-designation prefix", () => {
    const numbers = [400, 401, 402, 403, 404, 405, 406, 407, 409, 410, 412, 416, 417, 427];
    it.each(numbers)("Highway %i", (n) => {
      expect(isLimitedAccessHighway(step(`Merge onto Highway ${n}`))).toBe(true);
    });
    it.each(numbers)("ON-%i", (n) => {
      expect(isLimitedAccessHighway(step(`Merge onto ON-${n} E`))).toBe(true);
    });
    it.each(numbers)("Hwy %i (abbreviation)", (n) => {
      expect(isLimitedAccessHighway(step(`Continue on Hwy ${n}`))).toBe(true);
    });
    it.each(numbers)("Hwy. %i (abbreviation with period)", (n) => {
      expect(isLimitedAccessHighway(step(`Continue on Hwy. ${n}`))).toBe(true);
    });
    it.each(numbers)("lowercase 'highway %i'", (n) => {
      expect(isLimitedAccessHighway(step(`merge onto highway ${n} east`))).toBe(true);
    });
  });

  describe("lowercase / case-insensitive variants of the named highways", () => {
    it.each([
      ["qew", "qew"],
      ["gardiner expressway", "gardiner expressway"],
      ["don valley parkway", "don valley parkway"],
      ["dvp", "dvp"],
      ["407 etr", "407 etr"],
      ["on-401 e", "on-401 e"],
    ])("matches lowercase %s", (_label, text) => {
      expect(isLimitedAccessHighway(step(text))).toBe(true);
    });
  });

  describe("negative matches -- FR-020's explicit false-positive guard for arterial roads", () => {
    it.each([
      ["Highway 7", "Turn right onto Highway 7"],
      ["Highway 27", "Continue onto Highway 27"],
      ["Highway 2", "Turn left onto Highway 2"],
    ])("does NOT flag arterial %s", (_label, text) => {
      expect(isLimitedAccessHighway(step(text))).toBe(false);
    });

    it("does NOT flag a civic address containing a 400-series number with no route-designation prefix", () => {
      expect(isLimitedAccessHighway(step("Turn right onto 401 King St"))).toBe(false);
    });

    it("does NOT flag another civic-address-style number collision", () => {
      expect(isLimitedAccessHighway(step("Arrive at 407 Main Street"))).toBe(false);
    });

    it("does NOT flag an ordinary street name with no highway reference at all", () => {
      expect(isLimitedAccessHighway(step("Turn left onto Elm Street"))).toBe(false);
    });

    it("does NOT flag a non-listed 400-series-looking number even with a prefix (408 is not in the allowlist)", () => {
      expect(isLimitedAccessHighway(step("Merge onto Highway 408"))).toBe(false);
    });

    it("does NOT flag a partial numeric substring collision ('40' inside unrelated text)", () => {
      expect(isLimitedAccessHighway(step("Continue for 40 km on Main Street"))).toBe(false);
    });

    it("does NOT flag a longer number that merely starts with a listed prefix digit sequence ('4001')", () => {
      expect(isLimitedAccessHighway(step("Turn onto Highway 4001 Service Road"))).toBe(false);
    });

    it("does NOT flag 'onto' text merely containing the letters 'on' (guards the on- prefix from over-matching)", () => {
      expect(isLimitedAccessHighway(step("Turn right onto Ontario Street"))).toBe(false);
    });

    it("does NOT flag 'Gardiner' alone without 'Expressway' (allowlist requires the full name per design.md section 4.7)", () => {
      expect(isLimitedAccessHighway(step("Continue on Gardiner"))).toBe(false);
    });

    it("does NOT flag an empty/blank instruction", () => {
      expect(isLimitedAccessHighway(step(""))).toBe(false);
    });
  });

  describe("HTML stripping", () => {
    it("strips tags before matching, so a tag-split number still matches", () => {
      expect(isLimitedAccessHighway(step("Continue onto <b>Highway</b> <b>401</b>"))).toBe(true);
    });

    it("strips tags before matching a false-positive guard case too (still correctly excluded)", () => {
      expect(isLimitedAccessHighway(step("Turn right onto <b>401 King St</b>"))).toBe(false);
    });
  });
});
