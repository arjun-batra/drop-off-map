import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Name of the cookie set by POST /api/auth/verify-password on success and
 * checked by AuthGate on subsequent requests (design.md section 5.2).
 */
export const SESSION_COOKIE_NAME = "dropspot_session";

const TOKEN_MESSAGE = "dropspot-authenticated";

/**
 * REV-002 fix (design.md section 5.2's "short-lived session cookie" +
 * reviewer's recommended remediation): the token now embeds a signed
 * expiry timestamp rather than being a fixed, non-expiring HMAC.
 *
 * Format: `${expiresAtEpochSeconds}.${hmac}`, where `hmac` is computed over
 * *both* the fixed message and the expiry value, so an attacker who holds a
 * valid cookie cannot extend its own expiry by simply editing the plaintext
 * timestamp -- doing so invalidates the signature. This preserves the
 * stateless/no-DB architecture (NFR-003, design.md section 2): there is
 * still no server-side session store, and rotating PAID_TIER_ACCESS_PASSWORD
 * still invalidates every outstanding session immediately, exactly as
 * before -- the only change is that a session token now also expires on its
 * own, on a schedule the operator controls via SESSION_LIFETIME_SECONDS
 * (config/schema.ts), closing the "indefinite until password rotation"
 * exposure reviewer flagged.
 */
function computeHmac(paidTierAccessPassword: string, expiresAtEpochSeconds: number): string {
  return createHmac("sha256", paidTierAccessPassword)
    .update(`${TOKEN_MESSAGE}:${expiresAtEpochSeconds}`)
    .digest("hex");
}

/**
 * Builds a session token that expires at `expiresAtEpochSeconds` (unix
 * seconds). Callers must compute this from a configured lifetime (e.g.
 * `Math.floor(Date.now() / 1000) + config.sessionLifetimeSeconds`, see
 * api/auth/verify-password.ts) -- there is deliberately no built-in default
 * lifetime here, so the actual duration is always traceable to the
 * SESSION_LIFETIME_SECONDS config key, never a hidden code-level constant.
 */
export function createSessionToken(paidTierAccessPassword: string, expiresAtEpochSeconds: number): string {
  return `${expiresAtEpochSeconds}.${computeHmac(paidTierAccessPassword, expiresAtEpochSeconds)}`;
}

/**
 * Validates both the signature (the token was genuinely issued for the
 * currently configured password, and its embedded expiry hasn't been
 * tampered with) and that the token has not yet expired.
 *
 * `now` (unix milliseconds) is injectable -- defaults to `Date.now()` in
 * production, but lets tests exercise "not yet expired" / "just expired" /
 * "long expired" deterministically without real waiting, matching the same
 * injectable-clock pattern already used elsewhere in this codebase (e.g.
 * googleRoutingService.ts's `now` option, evaluateShortlist.ts's shared
 * `now()` reading).
 */
export function isValidSessionToken(
  token: string,
  paidTierAccessPassword: string | null,
  now: number = Date.now(),
): boolean {
  if (!paidTierAccessPassword || !token) return false;

  const separatorIndex = token.indexOf(".");
  if (separatorIndex === -1) return false;

  const expiryRaw = token.slice(0, separatorIndex);
  const hmacPart = token.slice(separatorIndex + 1);
  const expiresAtEpochSeconds = Number(expiryRaw);
  if (!Number.isFinite(expiresAtEpochSeconds) || !Number.isInteger(expiresAtEpochSeconds)) return false;

  const expected = computeHmac(paidTierAccessPassword, expiresAtEpochSeconds);
  const actualBuffer = Buffer.from(hmacPart);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  return now < expiresAtEpochSeconds * 1000;
}
