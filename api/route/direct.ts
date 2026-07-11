import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthGate } from "../../src/auth/authGate";
import { ConfigError, loadConfig } from "../../src/config/loader";
import { RoutingProviderError } from "../../src/routing/errors";
import { createGoogleRoutingService } from "../../src/routing/googleRoutingService";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCoordinate(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * GET /api/route/direct -- design.md section 10/INC-3: exposes
 * `RoutingService.getDirectRoute` (design.md section 5.1) for dev/QA
 * validation of the live-traffic driving integration end to end. This is
 * **not** the final `/api/drop-off-search` endpoint (design.md section 5.2,
 * INC-4-6) -- it exists so the direct-route baseline (FR-006a, FR-007) can be
 * exercised and verified before the rest of the candidate/detour/transit
 * pipeline is built on top of it.
 *
 * Behind AuthGate, same pattern as /api/geocode (INC-2) -- this makes a
 * billable provider call and must be gated identically in paid_tier mode.
 *
 * ?startLat=&startLng=&destLat=&destLng= (all required, numeric)
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // Same sanitized-error pattern as /api/geocode's REV-009 fix -- never
    // forward the raw ConfigError message to the client.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/route/direct] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
    return;
  }

  if (!AuthGate.check(req, config)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const startLat = parseCoordinate(firstQueryValue(req.query.startLat));
  const startLng = parseCoordinate(firstQueryValue(req.query.startLng));
  const destLat = parseCoordinate(firstQueryValue(req.query.destLat));
  const destLng = parseCoordinate(firstQueryValue(req.query.destLng));

  if (startLat === undefined || startLng === undefined || destLat === undefined || destLng === undefined) {
    res.status(400).json({ error: "invalid_point" });
    return;
  }

  const routingService = createGoogleRoutingService({ apiKey: config.mapApiKey });

  try {
    const route = await routingService.getDirectRoute(
      { lat: startLat, lng: startLng },
      { lat: destLat, lng: destLng },
    );
    res.status(200).json(route);
  } catch (err) {
    // Same sanitized-error pattern as /api/geocode's REV-009 fix -- never
    // forward the raw provider error message (e.g. Google's own
    // error_message field) to the client.
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/route/direct] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
