import type { DirectionStep } from "./types.js";

/**
 * design.md section 4.7 / FR-020 (DEC-6): a curated, Toronto-region-specific
 * allowlist of limited-access (controlled-access) highway identifiers --
 * deliberately NOT a broad "contains the word Highway" match. FR-020's own
 * text requires that arterial/surface roads officially named "Highway N"
 * (e.g. Highway 7, Highway 2, Highway 27's arterial sections) must NOT be
 * excluded, since they function as ordinary streets (at-grade intersections,
 * traffic signals, direct property access), not limited-access freeways.
 *
 * This is a fixed, code-level business-rule constant, not a config/env
 * entry -- per requirements.md's explicit note that FR-018 through FR-021
 * introduce no new Configuration entries, and design.md section 4.7's
 * statement that both pattern lists are "fixed business rules, not
 * user-configurable values." Updating this list (e.g. correcting a
 * false positive/negative found in production) is a reviewed code change,
 * not an operator-configurable tunable.
 *
 * Deliberately located under src/routing/ (alongside DirectionStep, the type
 * it operates on) rather than src/candidates/, since design.md section 4.7
 * also anticipates a sibling `analyzeTollUsage()` function (INC-13, FR-018/
 * FR-019) reusing the exact same fixed-constant module and DirectionStep
 * input shape -- this module is a shared routing-domain business rule, not a
 * candidate-generation-specific concern. `isLimitedAccessHighway` shipped in
 * INC-11 (FR-020); `analyzeTollUsage` (below) ships in INC-13 (FR-018), for
 * its `usesTollRoad` half -- the `hasExitReentry` half is computed by the
 * same function (design.md section 5.1's fixed signature) but is only
 * consumed starting at INC-14 (FR-019).
 */

const FOUR_HUNDRED_SERIES_NUMBERS = [
  "400",
  "401",
  "402",
  "403",
  "404",
  "405",
  "406",
  "407",
  "409",
  "410",
  "412",
  "416",
  "417",
  "427",
] as const;

// Requires a route-designation prefix (Highway/Hwy/ON-/Route) immediately
// before the number, so a bare civic address number appearing in a step's
// instruction text (e.g. "Turn onto 401 King St") never matches -- this is
// the false-positive guard FR-020's own text requires. Google's Directions
// instructions consistently render 400-series references this way (e.g.
// "Merge onto <b>ON-401 E</b>", "Continue onto <b>Highway 407</b>").
const FOUR_HUNDRED_SERIES_PATTERN = new RegExp(
  `\\b(?:on-|highway|hwy\\.?|route)\\s*-?\\s*(?:${FOUR_HUNDRED_SERIES_NUMBERS.join("|")})\\b`,
  "i",
);

// Named limited-access highways that aren't referred to by a bare number in
// Google's instruction text. Highway 407 is also commonly rendered as
// "407 ETR"/"Express Toll Route" without a "Highway"/"ON-" prefix, so it
// gets its own explicit pattern here in addition to the numeric one above.
const NAMED_LIMITED_ACCESS_PATTERNS: RegExp[] = [
  /\bQEW\b/i,
  /\bQueen Elizabeth Way\b/i,
  /\bDon Valley Parkway\b/i,
  /\bDVP\b/i,
  /\bGardiner Expressway\b/i,
  /\b407\s*ETR\b/i,
  /\bExpress Toll Route\b/i,
];

function stripHtml(instructionsHtml: string): string {
  return instructionsHtml.replace(/<[^>]*>/g, " ");
}

/**
 * design.md section 4.7's `isLimitedAccessHighway(step)`. Text-pattern-match
 * against the fixed allowlist above -- an approximation, not a geometric/
 * topological classification (no such data field exists in the Legacy
 * Directions API response, per section 4.7's honest assessment). DEC-6
 * accepted this approximation, including its residual false-positive/
 * false-negative risk, as-is.
 */
export function isLimitedAccessHighway(step: DirectionStep): boolean {
  const text = stripHtml(step.instructionsHtml);
  if (FOUR_HUNDRED_SERIES_PATTERN.test(text)) return true;
  return NAMED_LIMITED_ACCESS_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * design.md section 4.7's toll-road identifier list (2026-07-12, FR-018/
 * FR-019/INC-13): "currently just Highway 407 / '407 ETR' / 'ON-407' /
 * 'Express Toll Route' -- the only significant tolled highway in the service
 * region." Deliberately narrower than `isLimitedAccessHighway`'s allowlist
 * above -- most 400-series highways (401, 400, etc.) are limited-access but
 * NOT tolled, so this function must not reuse that broader list.
 */
const TOLL_ROAD_PATTERNS: RegExp[] = [
  /\b(?:on-|highway|hwy\.?|route)\s*-?\s*407\b/i,
  /\b407\s*ETR\b/i,
  /\bExpress Toll Route\b/i,
];

function isTollRoadStep(step: DirectionStep): boolean {
  const text = stripHtml(step.instructionsHtml);
  return TOLL_ROAD_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * design.md section 4.7/5.1's `analyzeTollUsage(steps)` (FR-018/FR-019,
 * INC-13). Walks the ordered step list tracking an "on toll road" boolean:
 * `usesTollRoad` is true if any step matches the toll-road allowlist above;
 * `hasExitReentry` is true if the route contains an on -> off -> on
 * transition (a run of toll-matching steps, then a run of non-matching
 * steps, then another run of toll-matching steps) -- i.e. the route exits a
 * toll road and later re-enters one within the same trip. A single
 * unbroken run of toll-road steps (get on once, stay on, get off once) is
 * `usesTollRoad: true, hasExitReentry: false` -- ordinary toll usage, not a
 * re-entry pattern.
 *
 * This is a text-pattern heuristic, not a geometric/topological analysis of
 * the actual road network (section 4.7's honest assessment, DEC-5) -- it can
 * miss a re-entry if intermediate step text doesn't consistently reference
 * the highway name, and cannot detect a toll road absent from the fixed
 * pattern list above.
 */
export function analyzeTollUsage(steps: DirectionStep[]): { usesTollRoad: boolean; hasExitReentry: boolean } {
  let usesTollRoad = false;
  let hasExitReentry = false;
  let wasOnTollRoad = false;
  let hasExitedTollRoad = false;

  for (const step of steps) {
    const onTollRoad = isTollRoadStep(step);
    if (onTollRoad) {
      usesTollRoad = true;
      if (hasExitedTollRoad && !wasOnTollRoad) {
        hasExitReentry = true;
      }
    } else if (wasOnTollRoad) {
      hasExitedTollRoad = true;
    }
    wasOnTollRoad = onTollRoad;
  }

  return { usesTollRoad, hasExitReentry };
}
