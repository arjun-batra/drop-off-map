/**
 * FR-002 / ux-spec.md section 4.2: the max-acceptable-detour field's
 * validation is "numeric and positive" only -- design.md section 1.3
 * explicitly records the user's decision that there is **no** upper bound /
 * sanity-check ceiling, so this function must never reject a value merely
 * for being large.
 */
export type DetourMinutesValidation =
  | { valid: true; minutes: number }
  | { valid: false; error: string };

export function validateMaxDetourMinutes(rawValue: string): DetourMinutesValidation {
  const trimmed = rawValue.trim();

  if (trimmed === "") {
    return { valid: false, error: "Enter a maximum detour time in minutes." };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { valid: false, error: "Enter a number greater than 0." };
  }

  return { valid: true, minutes: parsed };
}
