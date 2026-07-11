const SESSION_FLAG_KEY = "dropspot_authenticated";

/**
 * Client-side-only convenience flag (ux-spec.md section 3, persistence
 * note): avoids re-prompting for the password on every navigation within
 * the same browser tab/session. This is NOT the security boundary -- the
 * server-side session cookie (see src/auth/session.ts) is what future
 * protected endpoints actually check.
 */
export function hasClientSessionFlag(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG_KEY) === "true";
  } catch {
    return false;
  }
}

export function setClientSessionFlag(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG_KEY, "true");
  } catch {
    // Non-fatal: worst case, the user is re-prompted next navigation.
  }
}

/**
 * REV-002/INC-8 re-auth behavior: called when a protected endpoint reports
 * the server-side session cookie has expired (401), so this client-side
 * convenience flag doesn't keep claiming "already authenticated" for a
 * session the server no longer honors -- otherwise a reload would skip the
 * Password Gate (per this flag) only to immediately fail every real request.
 */
export function clearClientSessionFlag(): void {
  try {
    sessionStorage.removeItem(SESSION_FLAG_KEY);
  } catch {
    // Non-fatal: worst case, the stale flag lingers until the tab closes.
  }
}
