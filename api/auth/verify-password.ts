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
    const message = err instanceof ConfigError ? err.message : "Configuration failed to load.";
    res.status(500).json({ error: "config_error", message });
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
  const token = createSessionToken(config.paidTierAccessPassword as string);
  const cookie = buildSessionCookieHeader(SESSION_COOKIE_NAME, token, {
    secure: shouldUseSecureCookie(process.env.VERCEL_ENV),
  });
  res.setHeader("Set-Cookie", cookie);
  res.status(200).json({ ok: true });
}
