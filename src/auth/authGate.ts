import type { AppConfig } from "../config/schema.js";
import { parseCookies } from "./cookies.js";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "./session.js";

/**
 * Deliberately narrower than VercelRequest / http.IncomingMessage so this
 * gate can be unit tested with a plain object and reused by any future
 * handler (Vercel function or otherwise) without a framework dependency.
 */
export interface GateableRequest {
  headers: {
    cookie?: string | string[] | undefined;
    [key: string]: unknown;
  };
}

function firstCookieHeader(cookie: string | string[] | undefined): string | undefined {
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

/**
 * Implements design.md section 5.1's `AuthGate` interface: the binary,
 * app-wide gate behind FR-016/FR-017. free_tier always passes; paid_tier
 * requires a valid session cookie (set by POST /api/auth/verify-password).
 */
export const AuthGate = {
  /**
   * `now` (unix milliseconds) is injectable, defaulting to `Date.now()` --
   * lets callers/tests exercise REV-002's session-expiry behavior (a cookie
   * that was valid when issued but has since expired) deterministically,
   * matching the injectable-clock pattern already used elsewhere in this
   * codebase. Production call sites never pass it explicitly.
   */
  check(
    req: GateableRequest,
    config: Pick<AppConfig, "appMode" | "paidTierAccessPassword">,
    now: number = Date.now(),
  ): boolean {
    if (config.appMode === "free_tier") return true;

    const cookies = parseCookies(firstCookieHeader(req.headers.cookie));
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return false;

    return isValidSessionToken(token, config.paidTierAccessPassword, now);
  },
};
