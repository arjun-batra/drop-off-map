import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthGate } from "../../src/auth/authGate";
import { CandidateGenerator } from "../../src/candidates/candidateGenerator";
import { createDetourEvaluator } from "../../src/candidates/detourEvaluator";
import { ConfigError, loadConfig } from "../../src/config/loader";
import { RoutingProviderError } from "../../src/routing/errors";
import { createGoogleDistanceMatrixService } from "../../src/routing/googleDistanceMatrixService";
import { createGoogleRoutingService } from "../../src/routing/googleRoutingService";

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseCoordinate(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePositiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * GET /api/candidates/evaluate -- design.md section 10/INC-4: exposes the
 * candidate-generation + batched driving-detour-evaluation phase (design.md
 * section 4.2/4.3, FR-005, FR-006b, FR-009's `qualifies` flag) for dev/QA
 * inspection, mirroring the same "internal/debug view, not the final search
 * endpoint" pattern `api/route/direct.ts` established in INC-3. This is
 * **not** `/api/drop-off-search` (design.md section 5.2) -- transit
 * evaluation (INC-5) and ranking/fallback (INC-6) are not part of this
 * response.
 *
 * Behind AuthGate, same pattern as every other billable endpoint so far.
 *
 * ?startLat=&startLng=&destLat=&destLng=&maxDetourMinutes= (all required)
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
    console.error("[api/candidates/evaluate] config load failed:", message);
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
  const maxDetourMinutes = parsePositiveNumber(firstQueryValue(req.query.maxDetourMinutes));

  if (
    startLat === undefined ||
    startLng === undefined ||
    destLat === undefined ||
    destLng === undefined ||
    maxDetourMinutes === undefined
  ) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const start = { lat: startLat, lng: startLng };
  const dest = { lat: destLat, lng: destLng };

  const routingService = createGoogleRoutingService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });
  const distanceMatrixService = createGoogleDistanceMatrixService({
    apiKey: config.mapApiKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const detourEvaluator = createDetourEvaluator(distanceMatrixService);

  try {
    const directRoute = await routingService.getDirectRoute(start, dest);
    const rawCandidates = CandidateGenerator.sampleAlongPolyline(directRoute.polyline, config);
    const candidates = await detourEvaluator.batchEvaluate(
      start,
      dest,
      directRoute.durationMinutes,
      rawCandidates,
      maxDetourMinutes,
      config,
    );

    res.status(200).json({
      directDriveTimeMinutes: directRoute.durationMinutes,
      rawCandidateCount: rawCandidates.length,
      candidates,
    });
  } catch (err) {
    // Same sanitized-error pattern as /api/route/direct's REV-009 fix --
    // never forward the raw provider error message to the client. Both the
    // Directions call and the Distance Matrix call throw
    // RoutingProviderError (googleDistanceMatrixService.ts reuses the same
    // error type -- same provider family, same error-shape needs).
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/candidates/evaluate] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
