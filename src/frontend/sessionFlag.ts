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
