import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { AuthGate } from "../src/auth/authGate.js";
import { CandidateGenerator } from "../src/candidates/candidateGenerator.js";
import { createDetourEvaluator } from "../src/candidates/detourEvaluator.js";
import { ShortlistSelector } from "../src/candidates/shortlistSelector.js";
import { ConfigError, loadConfig } from "../src/config/loader.js";
import { createGoogleGeocodingService } from "../src/geocoding/googleGeocodingService.js";
import { labelFinalCandidates } from "../src/geocoding/labelFinalCandidates.js";
import { RadiusValidator } from "../src/geo/radiusValidator.js";
import { Ranker } from "../src/ranking/ranker.js";
import { RoutingProviderError } from "../src/routing/errors.js";
import { createGoogleDistanceMatrixService } from "../src/routing/googleDistanceMatrixService.js";
import { createGoogleRoutingService } from "../src/routing/googleRoutingService.js";
import { DISCLAIMER_TEXT } from "../src/search/types.js";
import type { DropOffSearchCandidate, DropOffSearchLocation, DropOffSearchRequest } from "../src/search/types.js";
import { evaluateShortlist } from "../src/transit/evaluateShortlist.js";
import { createGoogleTransitService } from "../src/transit/googleTransitDirectionsService.js";

function parseLocation(raw: unknown): DropOffSearchLocation | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as Record<string, unknown>;
  const { lat, lng, label } = candidate;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return undefined;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return undefined;
  if (typeof label !== "string" || label.trim() === "") return undefined;
  return { lat, lng, label };
}

function parseMaxDetourMinutes(raw: unknown): number | undefined {
  // FR-002 / design.md section 1.3: numeric, positive, deliberately no upper bound.
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

function parseSearchRequest(body: unknown): DropOffSearchRequest | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const raw = body as Record<string, unknown>;

  const start = parseLocation(raw.start);
  const driverDestination = parseLocation(raw.driverDestination);
  const passengerDestination = parseLocation(raw.passengerDestination);
  const maxDetourMinutes = parseMaxDetourMinutes(raw.maxDetourMinutes);

  if (!start || !driverDestination || !passengerDestination || maxDetourMinutes === undefined) {
    return undefined;
  }

  return { start, driverDestination, passengerDestination, maxDetourMinutes };
}

/**
 * POST /api/drop-off-search -- design.md section 5.2, the final search
 * endpoint (INC-6). Assembles every phase built in INC-3 through INC-5 plus
 * this increment's Ranker: direct route -> raw candidates -> batched detour
 * evaluation -> shortlist -> transit evaluation -> rank/fallback/no-viable
 * -> reverse-geocoded labels for only the final returned candidates.
 *
 * INC-8/REV-013: the temporary INC-3/4/5 debug endpoints
 * (`/api/route/direct`, `/api/candidates/evaluate`, `/api/candidates/transit`)
 * have been retired (deleted, not just deprecated) now that this endpoint
 * has fully superseded them for over two increments and every code path
 * they existed to validate (direct route, candidate generation, detour
 * evaluation, transit evaluation) is exercised end-to-end by this handler
 * and by each underlying module's own unit tests. Retiring them also
 * closes REV-013 (the HTTP-status-convention inconsistency between this
 * endpoint's uniform-200 business outcomes and the debug endpoints' real
 * 4xx codes) by removing the inconsistency's other side entirely, and
 * shrinks the number of live, billable, AuthGate-protected endpoints by
 * three -- relevant given this increment's session-cookie hardening
 * (REV-002). See docs/handoff.md's INC-8 section for the full reasoning
 * and the QA-owned test files this requires retiring alongside them.
 *
 * Validation ordering per design.md section 5.2 (fail fast, cheapest
 * first): (1) shape/type check of the 4 inputs -> "invalid_input"; (2)
 * radius check on `start` + `driverDestination` only (DQ-1:
 * `passengerDestination` is exempt) -> "out_of_service_area"; (3) the full
 * section-4 algorithm -> "ranked" | "fallback" | "no_viable_option".
 *
 * Business-outcome statuses (invalid_input/out_of_service_area/
 * no_viable_option/ranked/fallback) are all returned as HTTP 200 with
 * `status` describing the outcome -- design.md section 8 says the frontend
 * renders directly off `DropOffSearchResponse.status`, so there's no
 * separate HTTP-status branching for these business outcomes, unlike the
 * earlier debug endpoints' `400`-style responses. Infra-level failures
 * (config load, auth, wrong method, unreachable provider) remain real HTTP
 * error codes, matching every prior endpoint's established pattern.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const requestStart = Date.now();
  const requestId = randomUUID();

  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    // Same sanitized-error pattern as every prior endpoint's REV-009 fix --
    // never forward the raw ConfigError message to the client.
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/drop-off-search] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
    return;
  }

  if (!AuthGate.check(req, config)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const searchRequest = parseSearchRequest(req.body);
  if (!searchRequest) {
    res.status(200).json({
      status: "invalid_input",
      candidates: [],
      message: "One or more required fields are missing or invalid. Please check your inputs and try again.",
      requestId,
      timingMs: Date.now() - requestStart,
    });
    return;
  }

  const { start, driverDestination, passengerDestination, maxDetourMinutes } = searchRequest;

  // FR-004/DQ-1: only start + driverDestination are radius-checked;
  // passengerDestination may be any distance away.
  const startInArea = RadiusValidator.isWithinServiceArea(start, config);
  const destInArea = RadiusValidator.isWithinServiceArea(driverDestination, config);
  if (!startInArea || !destInArea) {
    res.status(200).json({
      status: "out_of_service_area",
      candidates: [],
      message: `This trip falls outside our service area (within ${config.geographicRadiusKm} km of ${config.geographicCenter.label}). We don't support this area yet.`,
      requestId,
      timingMs: Date.now() - requestStart,
    });
    return;
  }

  const routingService = createGoogleRoutingService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });
  const distanceMatrixService = createGoogleDistanceMatrixService({
    apiKey: config.mapApiKey,
    timeoutMs: config.requestTimeoutMs,
  });
  const detourEvaluator = createDetourEvaluator(distanceMatrixService);
  const transitEvaluator = createGoogleTransitService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });
  const geocodingService = createGoogleGeocodingService({ apiKey: config.mapApiKey, timeoutMs: config.requestTimeoutMs });

  // design.md section 6.3 (NFR-004/INC-7): an overall orchestration deadline
  // for the whole request, so a slow/throttled provider can't hold the
  // response open indefinitely even though every individual call is already
  // bounded by REQUEST_TIMEOUT_MS. No separate "safety margin" config key
  // exists in design.md section 7 -- using RESPONSE_TIME_TARGET_SECONDS
  // itself as the deadline is the most literal reading of section 6.3's
  // "slightly under RESPONSE_TIME_TARGET_SECONDS" without inventing an
  // unaudited extra tunable; flagged in docs/handoff.md for tech-lead to
  // confirm/introduce an explicit margin key if a stricter reading is wanted.
  const orchestrationDeadline = new Date(requestStart + config.responseTimeTargetSeconds * 1000);

  try {
    const directRoute = await routingService.getDirectRoute(start, driverDestination);
    const rawCandidates = CandidateGenerator.sampleAlongPolyline(directRoute.polyline, directRoute.steps, config);
    const evaluatedCandidates = await detourEvaluator.batchEvaluate(
      start,
      driverDestination,
      directRoute.durationMinutes,
      rawCandidates,
      maxDetourMinutes,
      config,
    );
    const shortlist = ShortlistSelector.select(evaluatedCandidates, config);

    let skippedDueToTimeout = 0;
    const fullyEvaluated = await evaluateShortlist(transitEvaluator, shortlist, passengerDestination, config, {
      deadline: orchestrationDeadline,
      onSkippedDueToDeadline: () => {
        skippedDueToTimeout++;
      },
    });

    const ranked = Ranker.rank(fullyEvaluated, maxDetourMinutes, config);

    if (ranked.status === "no_viable_option") {
      // design.md section 6.3: if the orchestration deadline was exceeded
      // before ANY shortlisted candidate's transit call could even start,
      // this is a graceful timeout, not a genuine "nothing is reachable"
      // business outcome -- report it distinctly so the frontend can invite
      // a retry (design.md section 8) instead of implying the trip has no
      // viable drop-off point at all.
      if (shortlist.length > 0 && skippedDueToTimeout === shortlist.length) {
        res.status(200).json({
          status: "timeout",
          candidates: [],
          message: "This is taking longer than expected. Please try again in a moment.",
          requestId,
          timingMs: Date.now() - requestStart,
        });
        return;
      }

      res.status(200).json({
        status: "no_viable_option",
        candidates: [],
        message:
          "We couldn't find a route with transit access to the passenger's destination along this trip. Try a different destination, or check back later — transit service may vary by time of day.",
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    // Labels are generated only for this small final set (design.md section
    // 3.1b/4.5), never the full raw/shortlist pool.
    const labeled = await labelFinalCandidates(geocodingService, start, ranked.results);
    const candidates: DropOffSearchCandidate[] = labeled.map((candidate, index) => ({
      rank: index + 1,
      location: candidate.point,
      label: candidate.label,
      routeOrderIndex: candidate.routeOrderIndex,
      driveTimeToDropoffMinutes: candidate.driveTimeToCandidateMinutes,
      detourMinutes: candidate.detourMinutes,
      walkTimeMinutes: candidate.walkTimeMinutes,
      waitTimeMinutes: candidate.waitTimeMinutes,
      transitTimeMinutes: candidate.transitTimeMinutes,
      passengerTotalTimeMinutes: candidate.passengerTotalTimeMinutes,
      // FR-006f: trivial sum, correctly left uncomputed until this increment
      // per design.md's INC-5 "Covers" line.
      driverTotalTimeMinutes: candidate.driveTimeToCandidateMinutes + candidate.driveTimeFromCandidateMinutes,
      exceedsThreshold: !candidate.qualifies,
    }));

    if (ranked.status === "fallback") {
      res.status(200).json({
        status: "fallback",
        candidates,
        warning: ranked.warning,
        // FR-014/INC-7: present whenever candidates.length > 0, per
        // design.md section 5.2's documented contract. Resolves REV-012.
        disclaimer: DISCLAIMER_TEXT,
        // INC-9: directRoute.polyline was already computed above by the
        // same request's RoutingService call (INC-3) -- reusing it here adds
        // no new provider call, it just exposes already-fetched data to the
        // frontend's optional map view (design.md section 3.1a/10).
        route: directRoute.polyline,
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    res.status(200).json({
      status: "ranked",
      candidates,
      disclaimer: DISCLAIMER_TEXT,
      route: directRoute.polyline,
      requestId,
      timingMs: Date.now() - requestStart,
    });
  } catch (err) {
    // Same sanitized-error pattern as every prior endpoint's REV-009 fix --
    // never forward the raw provider error message to the client. Every
    // provider call in this pipeline (Directions driving, Distance Matrix,
    // Directions transit, Geocoding reverse lookup for labels) can throw;
    // the reverse-geocode label step deliberately does NOT throw per-candidate
    // (see labelFinalCandidates.ts's own try/catch), so any error reaching
    // here is a genuine whole-request provider failure.
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/drop-off-search] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
