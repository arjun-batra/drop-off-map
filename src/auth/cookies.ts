/** Minimal cookie-header parser -- pure function, no framework dependency. */
export function parseCookies(cookieHeader: string | undefined | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;

  for (const pair of cookieHeader.split(";")) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) continue;
    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }

  return result;
}

/**
 * Vercel sets VERCEL_ENV to "production" | "preview" | "development".
 * Both production and preview are served over HTTPS, so the Secure cookie
 * flag is safe there; local dev (`npm run dev`, VERCEL_ENV unset) usually
 * runs over plain http, where a Secure cookie would silently never be sent.
 */
export function shouldUseSecureCookie(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production" || vercelEnv === "preview";
}

export interface SessionCookieOptions {
  /** Whether to mark the cookie Secure (omit for plain-http local dev). */
  secure: boolean;
}

/** Builds the Set-Cookie header value for the session cookie. */
export function buildSessionCookieHeader(
  cookieName: string,
  token: string,
  options: SessionCookieOptions,
): string {
  const parts = [`${cookieName}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
