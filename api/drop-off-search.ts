import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { AuthGate } from "../src/auth/authGate.js";
import { createDetourEvaluator } from "../src/candidates/detourEvaluator.js";
import { ConfigError, loadConfig } from "../src/config/loader.js";
import { createGoogleGeocodingService } from "../src/geocoding/googleGeocodingService.js";
import { labelFinalCandidates } from "../src/geocoding/labelFinalCandidates.js";
import { RadiusValidator } from "../src/geo/radiusValidator.js";
import { RoutingProviderError } from "../src/routing/errors.js";
import { createGoogleDistanceMatrixService } from "../src/routing/googleDistanceMatrixService.js";
import { createGoogleRoutingService } from "../src/routing/googleRoutingService.js";
import { toDropOffSearchCandidates } from "../src/search/buildCandidates.js";
import { parseSearchRequest } from "../src/search/parseSearchRequest.js";
import { runSearchPipeline } from "../src/search/searchPipeline.js";
import { DISCLAIMER_TEXT } from "../src/search/types.js";
import type { DropOffSearchCandidate } from "../src/search/types.js";
import { computeTollReentryFlags } from "../src/search/tollReentryPhase.js";
import { createGoogleTransitService } from "../src/transit/googleTransitDirectionsService.js";

/**
 * POST /api/drop-off-search -- design.md section 5.2, the final search
 * endpoint (INC-6). Assembles every phase built in INC-3 through INC-5 plus
 * the Ranker (INC-6): direct route -> raw candidates -> batched detour
 * evaluation -> shortlist -> transit evaluation -> rank/fallback/no-viable
 * -> reverse-geocoded labels for only the final returned candidates ->
 * (INC-14, FR-019) toll re-entry confirmation flags for the same final set.
 *
 * INC-14 (FR-019): Phases 0-4 (the shared `runSearchPipeline`, section 4) are
 * now extracted into `src/search/searchPipeline.ts` so this endpoint and the
 * new `POST /api/drop-off-search/confirm-toll-reentry` endpoint
 * (design.md section 5.2, section 4.6's Phase 5) share the exact same
 * orchestration rather than two independently-maintained copies. This
 * endpoint always runs Phase 5 (`computeTollReentryFlags`) over *every*
 * final candidate when `avoidTolls === false` -- nothing has been asked
 * about yet, unlike the confirm endpoint, which only checks newly-promoted
 * candidates (section 4.6 step 4).
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
 * first): (1) shape/type check of the 4 pre-existing inputs plus
 * `avoidTolls` (FR-018, INC-13) -> "invalid_input"; (2) radius check on
 * `start` + `driverDestination` only (DQ-1: `passengerDestination` is
 * exempt) -> "out_of_service_area"; (3) the full section-4 algorithm ->
 * "ranked" | "fallback" | "no_viable_option" | "no_toll_free_route"
 * (section 4.1a's short-circuit, OQ-9, when `avoidTolls === true` and even
 * the best-effort toll-avoiding baseline route still traverses a known toll
 * road).
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

  const { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls } = searchRequest;

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
    const outcome = await runSearchPipeline(
      { routingService, detourEvaluator, transitEvaluator },
      { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls, config, orchestrationDeadline },
    );

    if (outcome.kind === "no_toll_free_route") {
      res.status(200).json({
        status: "no_toll_free_route",
        candidates: [],
        message:
          "We couldn't find a route that avoids tolls for this trip. Uncheck \"Avoid tolls\" to see toll-inclusive options, or try a different start or destination.",
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    const { ranked, route, timedOut } = outcome;

    if (ranked.status === "no_viable_option") {
      // design.md section 6.3: if the orchestration deadline was exceeded
      // before ANY shortlisted candidate's transit call could even start,
      // this is a graceful timeout, not a genuine "nothing is reachable"
      // business outcome -- report it distinctly so the frontend can invite
      // a retry (design.md section 8) instead of implying the trip has no
      // viable drop-off point at all.
      if (timedOut) {
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

    // design.md section 4.6/5.1 (FR-019, INC-14): Phase 5 runs only when
    // avoidTolls === false, over every one of Phase 4's final candidates --
    // nothing has been asked about yet on this, the first search response.
    const tollFlagsByKey = avoidTolls
      ? new Map()
      : await computeTollReentryFlags(
          routingService,
          start,
          driverDestination,
          ranked.results.map((candidate) => candidate.point),
          config.providerConcurrencyLimit,
        );

    // Labels are generated only for this small final set (design.md section
    // 3.1b/4.5), never the full raw/shortlist pool.
    const labeled = await labelFinalCandidates(geocodingService, start, ranked.results);
    const candidates: DropOffSearchCandidate[] = toDropOffSearchCandidates(labeled, tollFlagsByKey);

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
        route,
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    res.status(200).json({
      status: "ranked",
      candidates,
      disclaimer: DISCLAIMER_TEXT,
      route,
      requestId,
      timingMs: Date.now() - requestStart,
    });
  } catch (err) {
    // Same sanitized-error pattern as every prior endpoint's REV-009 fix --
    // never forward the raw provider error message to the client. Every
    // provider call in this pipeline (Directions driving, Distance Matrix,
    // Directions transit, Geocoding reverse lookup for labels, and (INC-14)
    // the toll re-entry check's own Directions-with-steps calls) can throw;
    // the reverse-geocode label step deliberately does NOT throw per-candidate
    // (see labelFinalCandidates.ts's own try/catch), so any error reaching
    // here is a genuine whole-request provider failure.
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/drop-off-search] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
