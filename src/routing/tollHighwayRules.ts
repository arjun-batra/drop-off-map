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
 *
 * Paired with a display `name` (INC-14, FR-019, section 4.6 step 2) so
 * `describeTollRoadReentry` below can name the matched toll road in the
 * factual description surfaced to the frontend, without changing
 * `analyzeTollUsage`'s own fixed return shape (section 5.1).
 */
const TOLL_ROADS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(?:on-|highway|hwy\.?|route)\s*-?\s*407\b/i, name: "Highway 407" },
  { pattern: /\b407\s*ETR\b/i, name: "Highway 407" },
  { pattern: /\bExpress Toll Route\b/i, name: "Highway 407" },
];

function matchedTollRoadName(step: DirectionStep): string | undefined {
  const text = stripHtml(step.instructionsHtml);
  return TOLL_ROADS.find(({ pattern }) => pattern.test(text))?.name;
}

function isTollRoadStep(step: DirectionStep): boolean {
  return matchedTollRoadName(step) !== undefined;
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

/**
 * design.md section 4.6 step 2 (FR-019, INC-14): "include a short, factual
 * description of the pattern (e.g., naming the toll road matched) for the
 * frontend to present as FR-019's question." Section 5.1's `analyzeTollUsage`
 * signature is fixed to `{ usesTollRoad, hasExitReentry }` with no
 * description field, so this is a small sibling helper over the same step
 * list rather than a change to that signature -- `tollReentryChecker.ts`
 * calls both.
 *
 * **Judgment call (flagged for tech-lead/designer awareness, not decided
 * unilaterally as a business rule):** ux-spec.md section 5a.2's mockup shows
 * the pattern line rendered as "Uses Highway 407 — exits and re-enters it
 * during this trip." Section 5a.2's own text says the frontend renders
 * `tollReentryDescription` "wrapped in a short fixed lead-in ('Uses {highway}
 * — {description}')" but design.md's response contract (section 5.2) only
 * has room for a single `tollReentryDescription?: string` field -- there is
 * no separate `highway` field for the frontend to interpolate into that
 * template. Dev's reading: the fixed lead-in is literally just the word
 * "Uses " (a client-side constant, ux-spec.md's own precedent for fixed
 * copy elsewhere in section 5a), and this function's return value already
 * contains everything after it ("Highway 407 — exits and re-enters it during
 * this trip"), so `"Uses " + tollReentryDescription` reproduces the mockup's
 * exact copy without inventing a second response field design.md never
 * defined. See docs/handoff.md's INC-14 section for the full reasoning.
 *
 * Returns `undefined` if no toll-road pattern from the fixed identifier list
 * above matched any step -- defensive; callers only invoke this after
 * `analyzeTollUsage` has already reported `hasExitReentry: true`, which
 * implies at least one step matched, but this function does not assume that
 * invariant holds.
 */
export function describeTollRoadReentry(steps: DirectionStep[]): string | undefined {
  for (const step of steps) {
    const name = matchedTollRoadName(step);
    if (name) return `${name} — exits and re-enters it during this trip`;
  }
  return undefined;
}
