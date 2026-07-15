import type { LatLng } from "../geo/types.js";
import type { DropOffSearchLocation, DropOffSearchRequest } from "./types.js";

/**
 * Shared shape/type validation for `DropOffSearchRequest`, extracted
 * (INC-14) from `api/drop-off-search.ts` so the new
 * `POST /api/drop-off-search/confirm-toll-reentry` endpoint (design.md
 * section 5.2, FR-019/OQ-10) can validate its embedded `originalRequest`
 * with the exact same rules, rather than a second, independently-maintained
 * copy of this logic drifting from the original over time.
 */
export function parseLocation(raw: unknown): DropOffSearchLocation | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const { lat, lng, label } = candidate;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return undefined;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return undefined;
  if (typeof label !== "string" || label.trim() === "") return undefined;
  return { lat, lng, label };
}

export function parseMaxDetourMinutes(raw: unknown): number | undefined {
  // FR-002 / design.md section 1.3: numeric, positive, deliberately no upper bound.
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/**
 * FR-018/design.md section 5.2 (INC-13). Judgment call, flagged for
 * tech-lead confirmation: design.md section 5.2's own comment on this field
 * -- "default false, no server default/config" -- reads two ways: (a) the
 * server must hard-require the field's presence (matching how
 * `maxDetourMinutes`, which genuinely has no sensible default, is treated
 * above), or (b) "no server default/config" only means the value isn't
 * sourced from `AppConfig` (unlike, say, `maxCandidatesReturned`), not that
 * an absent field must be rejected. Reading (a) would break every existing
 * request the full pre-INC-13 regression suite sends (none of which include
 * `avoidTolls` at all), directly contradicting this increment's own
 * "QA can test" line in design.md section 10 ("unchecked-checkbox behavior
 * is unaffected -- full regression pass against the existing
 * ranked/fallback/no_viable_option suite"). Dev is taking reading (b): a
 * missing `avoidTolls` field defaults to `false` (the checkbox's own
 * unchecked default), so the full regression suite is genuinely unaffected;
 * only a field that IS present but isn't a boolean (a real shape violation,
 * e.g. a string) fails validation as `invalid_input`.
 *
 * (REV-024, INC-14): `src/search/types.ts`'s doc comment on
 * `DropOffSearchRequest.avoidTolls` previously asserted the opposite of this
 * function's actual, already-shipped behavior (it claimed a missing field
 * fails validation) -- corrected as a comment-only fix; this function's
 * behavior is unchanged.
 */
export function parseAvoidTolls(raw: unknown): boolean | undefined {
  if (raw === undefined) return false;
  return typeof raw === "boolean" ? raw : undefined;
}

export function parseSearchRequest(body: unknown): DropOffSearchRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const raw = body as Record<string, unknown>;

  const start = parseLocation(raw.start);
  const driverDestination = parseLocation(raw.driverDestination);
  const passengerDestination = parseLocation(raw.passengerDestination);
  const maxDetourMinutes = parseMaxDetourMinutes(raw.maxDetourMinutes);
  const avoidTolls = parseAvoidTolls(raw.avoidTolls);

  if (
    !start ||
    !driverDestination ||
    !passengerDestination ||
    maxDetourMinutes === undefined ||
    avoidTolls === undefined
  ) {
    return undefined;
  }

  return { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls };
}

function parseLatLng(raw: unknown): LatLng | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const { lat, lng } = candidate;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return undefined;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return undefined;
  return { lat, lng };
}

/**
 * design.md section 5.2's `ConfirmTollReentryRequest.rejectedCandidateLocations`
 * (FR-019/OQ-10, INC-14). An empty array is valid and meaningful (ux-spec.md
 * section 5a.3: "an empty array if every card was answered 'Yes' -- this is
 * a valid, meaningful request, not skipped"), so `[]` parses successfully;
 * only a non-array value, or an array containing a malformed point, fails
 * shape validation.
 */
export function parseRejectedCandidateLocations(raw: unknown): LatLng[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: LatLng[] = [];
  for (const item of raw) {
    const point = parseLatLng(item);
    if (!point) return undefined;
    parsed.push(point);
  }
  return parsed;
}
