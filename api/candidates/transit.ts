import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AuthGate } from "../../src/auth/authGate";
import { CandidateGenerator } from "../../src/candidates/candidateGenerator";
import { createDetourEvaluator } from "../../src/candidates/detourEvaluator";
import { ShortlistSelector } from "../../src/candidates/shortlistSelector";
import { ConfigError, loadConfig } from "../../src/config/loader";
import { RoutingProviderError } from "../../src/routing/errors";
import { createGoogleDistanceMatrixService } from "../../src/routing/googleDistanceMatrixService";
import { createGoogleRoutingService } from "../../src/routing/googleRoutingService";
import { evaluateShortlist } from "../../src/transit/evaluateShortlist";
import { createGoogleTransitService } from "../../src/transit/googleTransitDirectionsService";

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
 * GET /api/candidates/transit -- design.md section 10/INC-5: exposes the
 * transit-evaluation phase (design.md section 4.4, FR-006c/d/e, FR-008) for
 * dev/QA inspection, mirroring the same "internal/debug view, not the final
 * search endpoint" pattern `api/route/direct.ts` (INC-3) and
 * `api/candidates/evaluate.ts` (INC-4) established. This is **not**
 * `/api/drop-off-search` (design.md section 5.2) -- ranking/tie-break/
 * fallback/final response shaping (FR-010/011/012/013) is INC-6 scope, not
 * part of this response.
 *
 * Runs the full Phase 0-3 pipeline: direct route -> raw candidates -> batched
 * detour evaluation -> ShortlistSelector.select -> per-candidate transit
 * evaluation (bounded by PROVIDER_CONCURRENCY_LIMIT). Response `candidates`
 * is the shortlisted, fully-transit-evaluated set only (up to
 * MAX_TRANSIT_EVALUATIONS_PER_REQUEST) -- non-shortlisted raw/detour-only
 * candidates are summarized by count (`rawCandidateCount`) but not returned
 * individually, since this increment's job is the transit data itself, not
 * re-exposing INC-4's already-covered debug view.
 *
 * Behind AuthGate, same pattern as every other billable endpoint so far.
 *
 * ?startLat=&startLng=&destLat=&destLng=&passengerDestLat=&passengerDestLng=&maxDetourMinutes=
 * (all required). `destLat`/`destLng` is the driver's own destination (same
 * meaning as in api/candidates/evaluate.ts); `passengerDestLat`/`passengerDestLng`
 * is the passenger's destination (design.md's DQ-1 exemption from the
 * geographic radius check applies here too -- this debug endpoint performs
 * no radius validation at all, same as api/candidates/evaluate.ts's
 * documented scope).
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
    // Same sanitized-error pattern as every prior endpoint's REV-009 fix --
    // never forward the raw ConfigError message to the client.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/candidates/transit] config load failed:", message);
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
  const passengerDestLat = parseCoordinate(firstQueryValue(req.query.passengerDestLat));
  const passengerDestLng = parseCoordinate(firstQueryValue(req.query.passengerDestLng));
  const maxDetourMinutes = parsePositiveNumber(firstQueryValue(req.query.maxDetourMinutes));

  if (
    startLat === undefined ||
    startLng === undefined ||
    destLat === undefined ||
    destLng === undefined ||
    passengerDestLat === undefined ||
    passengerDestLng === undefined ||
    maxDetourMinutes === undefined
  ) {
    res.status(400).json({ error: "invalid_input" });
    return;
  }

  const start = { lat: startLat, lng: startLng };
  const dest = { lat: destLat, lng: destLng };
  const passengerDestination = { lat: passengerDestLat, lng: passengerDestLng };

  const routingService = createGoogleRoutingService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });
  const distanceMatrixService = createGoogleDistanceMatrixService({
    apiKey: config.mapApiKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const detourEvaluator = createDetourEvaluator(distanceMatrixService);
  const transitEvaluator = createGoogleTransitService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });

  try {
    const directRoute = await routingService.getDirectRoute(start, dest);
    const rawCandidates = CandidateGenerator.sampleAlongPolyline(directRoute.polyline, config);
    const evaluatedCandidates = await detourEvaluator.batchEvaluate(
      start,
      dest,
      directRoute.durationMinutes,
      rawCandidates,
      maxDetourMinutes,
      config,
    );
    const shortlist = ShortlistSelector.select(evaluatedCandidates, config);
    const candidates = await evaluateShortlist(transitEvaluator, shortlist, passengerDestination, config);

    res.status(200).json({
      directDriveTimeMinutes: directRoute.durationMinutes,
      rawCandidateCount: rawCandidates.length,
      shortlistedCount: shortlist.length,
      candidates,
    });
  } catch (err) {
    // Same sanitized-error pattern as every prior endpoint's REV-009 fix --
    // never forward the raw provider error message to the client. All three
    // provider calls (Directions driving, Distance Matrix, Directions
    // transit) throw RoutingProviderError -- same provider family, same
    // error-shape needs, per the precedent already set by
    // googleDistanceMatrixService.ts and googleTransitDirectionsService.ts.
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/candidates/transit] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
