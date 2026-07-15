import { describe, expect, it } from "vitest";
import { analyzeTollUsage, describeTollRoadReentry, isLimitedAccessHighway } from "../../src/routing/tollHighwayRules";
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

/**
 * FR-018/FR-019 (toll avoidance / re-entry) / DEC-5. Tests `analyzeTollUsage()`
 * against design.md section 4.7's explicit instruction that its toll-road
 * identifier list is "currently just Highway 407 / '407 ETR' / 'ON-407' /
 * 'Express Toll Route'" -- deliberately NARROWER than `isLimitedAccessHighway`'s
 * broader 400-series allowlist, because most 400-series highways (401, 400,
 * 402-406, 409, 410, 412, 416, 417, 427) are limited-access but NOT tolled.
 * This is the exact distinction the orchestrator flagged for extra scrutiny
 * (item 3) -- every test below cross-checks both functions on the identical
 * step to make the divergence undeniable, not just assert one function in
 * isolation.
 */
describe("analyzeTollUsage -- FR-018/FR-019, design.md section 4.7, DEC-5", () => {
  describe("usesTollRoad -- positive matches (Highway 407 variants only)", () => {
    it.each([
      ["Highway 407", "Merge onto Highway 407"],
      ["ON-407", "Merge onto ON-407 E"],
      ["Hwy 407", "Continue on Hwy 407"],
      ["407 ETR (no Highway/ON- prefix)", "Continue onto 407 ETR"],
      ["Express Toll Route spelled out", "Continue onto the Express Toll Route"],
      ["lowercase 407 etr", "continue onto 407 etr"],
      ["lowercase on-407", "merge onto on-407 e"],
    ])("flags %s as usesTollRoad:true", (_label, text) => {
      expect(analyzeTollUsage([step(text)]).usesTollRoad).toBe(true);
    });

    it("matches embedded in a full Google-style HTML instruction string", () => {
      expect(
        analyzeTollUsage([step("Merge onto <b>Highway 407</b> via the ramp")]).usesTollRoad,
      ).toBe(true);
    });
  });

  describe("usesTollRoad -- the critical narrower-list distinction (item 3): every OTHER 400-series highway is limited-access but NOT tolled", () => {
    const nonTolledNumbers = [400, 401, 402, 403, 404, 405, 406, 409, 410, 412, 416, 417, 427];

    it.each(nonTolledNumbers)(
      "Highway %i is NOT flagged as a toll road by analyzeTollUsage, even though it IS flagged as a limited-access highway by isLimitedAccessHighway",
      (n) => {
        const s = step(`Merge onto Highway ${n}`);
        expect(analyzeTollUsage([s]).usesTollRoad).toBe(false);
        // Direct cross-check on the identical step: proves this is a
        // deliberately narrower list, not merely a different pattern syntax
        // that happens to also miss 401.
        expect(isLimitedAccessHighway(s)).toBe(true);
      },
    );

    it.each(nonTolledNumbers)("ON-%i form is also not flagged as tolled (still flagged as a highway)", (n) => {
      const s = step(`Merge onto ON-${n} E`);
      expect(analyzeTollUsage([s]).usesTollRoad).toBe(false);
      expect(isLimitedAccessHighway(s)).toBe(true);
    });

    it("a whole direct-route baseline entirely on Highway 401 (no 407 anywhere) is correctly NOT flagged as using a toll road", () => {
      const steps = [
        step("Head north on Main St", { distanceMeters: 500, cumulativeDistanceMeters: 500 }),
        step("Merge onto <b>ON-401 E</b>", { distanceMeters: 5000, cumulativeDistanceMeters: 5500 }),
        step("Take exit 42 toward destination", { distanceMeters: 300, cumulativeDistanceMeters: 5800 }),
      ];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(false);
      expect(result.hasExitReentry).toBe(false);
    });
  });

  describe("usesTollRoad -- other limited-access-but-not-tolled named highways are also excluded", () => {
    it.each([
      ["QEW", "Continue onto QEW"],
      ["Queen Elizabeth Way", "Continue onto Queen Elizabeth Way"],
      ["Gardiner Expressway", "Continue onto Gardiner Expressway"],
      ["Don Valley Parkway", "Continue onto Don Valley Parkway"],
      ["DVP", "Continue onto DVP"],
    ])("%s is not flagged as a toll road (it IS flagged as limited-access)", (_label, text) => {
      const s = step(text);
      expect(analyzeTollUsage([s]).usesTollRoad).toBe(false);
      expect(isLimitedAccessHighway(s)).toBe(true);
    });
  });

  describe("usesTollRoad -- negative cases carried over from FR-020's own false-positive guards", () => {
    it("does not flag a civic address number collision ('407 Main Street')", () => {
      expect(analyzeTollUsage([step("Arrive at 407 Main Street")]).usesTollRoad).toBe(false);
    });

    it("does not flag an ordinary street with no highway reference at all", () => {
      expect(analyzeTollUsage([step("Turn left onto Elm Street")]).usesTollRoad).toBe(false);
    });

    it("an empty steps array yields usesTollRoad:false, hasExitReentry:false", () => {
      expect(analyzeTollUsage([])).toEqual({ usesTollRoad: false, hasExitReentry: false });
    });
  });

  describe("hasExitReentry -- on/off/on transition detection", () => {
    it("a single continuous run of toll-road steps (get on, stay on, get off once) is usesTollRoad:true but hasExitReentry:false", () => {
      const steps = [
        step("Head north on Main St"),
        step("Merge onto Highway 407"),
        step("Continue on Highway 407"),
        step("Take exit toward destination"),
        step("Arrive at destination"),
      ];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(true);
      expect(result.hasExitReentry).toBe(false);
    });

    it("an on -> off -> on transition (genuine exit then re-entry) is hasExitReentry:true", () => {
      const steps = [
        step("Merge onto Highway 407"), // on
        step("Take exit onto Local Road"), // off
        step("Continue on Local Road"), // off
        step("Merge back onto Highway 407"), // on again -- re-entry
      ];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(true);
      expect(result.hasExitReentry).toBe(true);
    });

    it("a route that never touches a toll road at all is both false", () => {
      const steps = [step("Head north on Main St"), step("Merge onto Highway 401"), step("Arrive at destination")];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(false);
      expect(result.hasExitReentry).toBe(false);
    });

    it("multiple exit/re-entry cycles (on-off-on-off-on) still resolve to hasExitReentry:true (not miscounted/toggled back to false)", () => {
      const steps = [
        step("Merge onto Highway 407"), // on
        step("Take exit onto Local Road"), // off
        step("Merge back onto Highway 407"), // on (1st re-entry)
        step("Take exit onto Local Road"), // off again
        step("Merge back onto Highway 407"), // on (2nd re-entry)
      ];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(true);
      expect(result.hasExitReentry).toBe(true);
    });

    it("a route that exits the toll road and never re-enters is hasExitReentry:false", () => {
      const steps = [
        step("Merge onto Highway 407"),
        step("Take exit onto Local Road"),
        step("Arrive at destination"),
      ];
      const result = analyzeTollUsage(steps);
      expect(result.usesTollRoad).toBe(true);
      expect(result.hasExitReentry).toBe(false);
    });

    it("strips HTML tags before matching, consistent with isLimitedAccessHighway's behavior", () => {
      const steps = [step("Merge onto <b>Highway 407</b>")];
      expect(analyzeTollUsage(steps).usesTollRoad).toBe(true);
    });
  });

  // FR-019/INC-14 (design.md section 4.6 step 2): describeTollRoadReentry has
  // NO prior coverage anywhere in this suite -- it shipped in INC-14 but
  // isTollHighwayRules.test.ts (INC-13) predates it. Verifying independently
  // here, not trusting dev's own smoke-testing claim in docs/handoff.md.
  describe("describeTollRoadReentry -- FR-019/INC-14, design.md section 4.6 step 2", () => {
    it('names "Highway 407" and reproduces the exact ux-spec.md section 5a.2 mockup copy ("Highway 407 — exits and re-enters it during this trip")', () => {
      const steps = [
        step("Merge onto Highway 407"),
        step("Take exit onto Local Road"),
        step("Merge back onto Highway 407"),
      ];
      expect(describeTollRoadReentry(steps)).toBe("Highway 407 — exits and re-enters it during this trip");
    });

    it.each([
      ["ON-407 E", "Merge onto <b>ON-407 E</b>"],
      ["407 ETR", "Continue on 407 ETR"],
      ["Express Toll Route", "Continue on the Express Toll Route"],
    ])("recognizes the %s spelling variant and still names it \"Highway 407\"", (_label, text) => {
      expect(describeTollRoadReentry([step(text)])).toBe("Highway 407 — exits and re-enters it during this trip");
    });

    it("returns the name of the FIRST matching step when multiple toll-road steps are present (not the last)", () => {
      const steps = [step("Merge onto Highway 407"), step("Take exit"), step("Continue on 407 ETR")];
      // Both steps match the same toll road name in this fixed identifier
      // list (there is only one tolled highway in the region per design.md
      // section 4.7), so this mostly documents "first match wins" behavior
      // rather than a name conflict -- still worth pinning down explicitly.
      expect(describeTollRoadReentry(steps)).toBe("Highway 407 — exits and re-enters it during this trip");
    });

    it("returns undefined when no step matches the fixed toll-road identifier list (defensive -- callers only invoke this after hasExitReentry:true, but this function does not assume that invariant)", () => {
      const steps = [step("Merge onto Highway 401"), step("Take exit"), step("Merge onto Highway 401 again")];
      expect(describeTollRoadReentry(steps)).toBeUndefined();
    });

    it("returns undefined for an empty steps array", () => {
      expect(describeTollRoadReentry([])).toBeUndefined();
    });

    it("strips HTML tags before matching, consistent with analyzeTollUsage/isLimitedAccessHighway", () => {
      expect(describeTollRoadReentry([step("Merge onto <b>Highway 407</b>")])).toBe(
        "Highway 407 — exits and re-enters it during this trip",
      );
    });
  });
});
