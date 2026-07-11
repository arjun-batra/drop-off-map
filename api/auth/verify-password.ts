import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buildSessionCookieHeader, shouldUseSecureCookie } from "../../src/auth/cookies";
import { createSessionToken } from "../../src/auth/session";
import { verifyPassword } from "../../src/auth/verifyPassword";
import { SESSION_COOKIE_NAME } from "../../src/auth/session";
import { ConfigError, loadConfig } from "../../src/config/loader";

/**
 * POST /api/auth/verify-password -- design.md section 5.2.
 * Body: { password: string }. On success, sets a session cookie the
 * frontend and future protected endpoints rely on (see src/auth/authGate.ts).
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // INC-8 cross-cutting error-handling pass: apply the same REV-009
    // sanitized pattern every other endpoint uses -- log the detailed
    // ConfigError server-side only, return a fixed generic message. This
    // endpoint previously forwarded the raw problem list (env var names)
    // to the client, inconsistent with every other endpoint's config-error
    // handling.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/auth/verify-password] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
    return;
  }

  if (config.appMode !== "paid_tier") {
    res.status(400).json({
      error: "not_applicable",
      message: "Password verification only applies when APP_MODE=paid_tier.",
    });
    return;
  }

  const body = (req.body ?? {}) as { password?: unknown };
  const submitted = typeof body.password === "string" ? body.password : "";

  if (!verifyPassword(submitted, config.paidTierAccessPassword)) {
    res.status(401).json({ error: "invalid_password" });
    return;
  }

  // paidTierAccessPassword is guaranteed non-null here: verifyPassword only
  // returns true when config.paidTierAccessPassword is set.
  // REV-002: the token now embeds a signed expiry (SESSION_LIFETIME_SECONDS)
  // so the session is genuinely short-lived, not just non-expiring-until-
  // password-rotation. The cookie's own Max-Age mirrors the same value.
  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + config.sessionLifetimeSeconds;
  const token = createSessionToken(config.paidTierAccessPassword as string, expiresAtEpochSeconds);
  const cookie = buildSessionCookieHeader(SESSION_COOKIE_NAME, token, {
    secure: shouldUseSecureCookie(process.env.VERCEL_ENV),
    maxAgeSeconds: config.sessionLifetimeSeconds,
  });
  res.setHeader("Set-Cookie", cookie);
  res.status(200).json({ ok: true });
}
