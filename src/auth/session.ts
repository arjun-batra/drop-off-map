import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Name of the cookie set by POST /api/auth/verify-password on success and
 * checked by AuthGate on subsequent requests (design.md section 5.2).
 */
export const SESSION_COOKIE_NAME = "dropspot_session";

const TOKEN_MESSAGE = "dropspot-authenticated";

/**
 * The session token is an HMAC of a fixed message, keyed by the currently
 * configured PAID_TIER_ACCESS_PASSWORD. This lets the backend verify a
 * session cookie statelessly (no server-side session store, no database --
 * consistent with NFR-003 and the stateless architecture in design.md
 * section 2), and it automatically invalidates every outstanding session
 * the moment the operator rotates the password.
 */
export function createSessionToken(paidTierAccessPassword: string): string {
  return createHmac("sha256", paidTierAccessPassword).update(TOKEN_MESSAGE).digest("hex");
}

export function isValidSessionToken(token: string, paidTierAccessPassword: string | null): boolean {
  if (!paidTierAccessPassword || !token) return false;
  const expected = createSessionToken(paidTierAccessPassword);
  const actualBuffer = Buffer.from(token);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
