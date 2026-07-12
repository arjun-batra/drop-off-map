import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ConfigError, loadConfig } from "../../src/config/loader.js";
import { toPublicConfig } from "../../src/config/publicConfig.js";

/**
 * GET /api/config/public -- design.md section 5.2.
 *
 * Deliberately NOT behind AuthGate, even in paid_tier mode: docs/runbook.md
 * section 6 relies on this being a secret-free, zero-cost, always-reachable
 * smoke check that a deploy's config loaded successfully, regardless of
 * APP_MODE. It exposes no secrets (see toPublicConfig) and triggers zero
 * billed provider calls.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const config = loadConfig(process.env);
    res.status(200).json(toPublicConfig(config));
  } catch (err) {
    // INC-8 cross-cutting error-handling pass: this endpoint previously
    // forwarded the raw ConfigError problem list (naming every missing/
    // malformed env var) to an unauthenticated caller -- noted, but not
    // fixed, at the INC-1 review audit. Applying the same REV-009 pattern
    // used by every other endpoint now: log the detail server-side only,
    // return a fixed generic message. This endpoint is deliberately
    // unauthenticated (runbook.md section 6's deploy health check), which
    // is exactly why it must not leak internal config-key names/validation
    // rules any more than a protected endpoint would.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/config/public] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
  }
}
