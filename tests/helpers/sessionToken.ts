import { createSessionToken } from "../../src/auth/session";

/**
 * Builds a valid (non-expired) session token for tests, per REV-002/INC-8's
 * signed-expiry token format. `createSessionToken` now requires an explicit
 * `expiresAtEpochSeconds` argument (unix seconds) -- this helper defaults to
 * "1 hour from now" so call sites that only care about a generically-valid
 * token don't need to repeat the epoch-seconds math at every call site.
 *
 * Tests that specifically need to exercise expiry/boundary/tampering
 * behavior should call `createSessionToken` directly with an explicit
 * expiry instead of using this helper.
 */
export function validSessionToken(password: string, secondsFromNow = 3600): string {
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + secondsFromNow;
  return createSessionToken(password, expiresAtEpochSeconds);
}
