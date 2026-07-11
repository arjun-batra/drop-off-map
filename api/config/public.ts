import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ConfigError, loadConfig } from "../../src/config/loader";
import { toPublicConfig } from "../../src/config/publicConfig";

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
    const message = err instanceof ConfigError ? err.message : "Configuration failed to load.";
    res.status(500).json({ error: "config_error", message });
  }
}
