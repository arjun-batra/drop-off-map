import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { AuthGate } from "../../src/auth/authGate.js";
import { createDetourEvaluator } from "../../src/candidates/detourEvaluator.js";
import { ConfigError, loadConfig } from "../../src/config/loader.js";
import { createGoogleGeocodingService } from "../../src/geocoding/googleGeocodingService.js";
import { labelFinalCandidates } from "../../src/geocoding/labelFinalCandidates.js";
import { locationKey } from "../../src/geo/locationKey.js";
import { RadiusValidator } from "../../src/geo/radiusValidator.js";
import { Ranker } from "../../src/ranking/ranker.js";
import { RoutingProviderError } from "../../src/routing/errors.js";
import { createGoogleDistanceMatrixService } from "../../src/routing/googleDistanceMatrixService.js";
import { createGoogleRoutingService } from "../../src/routing/googleRoutingService.js";
import { toDropOffSearchCandidates } from "../../src/search/buildCandidates.js";
import { parseRejectedCandidateLocations, parseSearchRequest } from "../../src/search/parseSearchRequest.js";
import { runSearchPipeline } from "../../src/search/searchPipeline.js";
import { DISCLAIMER_TEXT } from "../../src/search/types.js";
import type { DropOffSearchCandidate } from "../../src/search/types.js";
import { computeTollReentryFlags } from "../../src/search/tollReentryPhase.js";
import { createGoogleTransitService } from "../../src/transit/googleTransitDirectionsService.js";

const NO_VIABLE_OPTION_MESSAGE =
  "We couldn't find a route with transit access to the passenger's destination along this trip. Try a different destination, or check back later — transit service may vary by time of day.";

/**
 * POST /api/drop-off-search/confirm-toll-reentry -- design.md section 5.2
 * (FR-019/OQ-10, INC-14), the second half of section 4.6's Phase 5. Fully
 * stateless (NFR-003): the request carries the original `DropOffSearchRequest`
 * plus the cumulative set of candidate locations the user rejected; this
 * endpoint re-derives the whole search deterministically from
 * `originalRequest` (design.md section 5.2's own words -- "re-running the
 * full section 4 pipeline is acceptable cost-wise since it only happens on
 * this rarer confirm path") via the same `runSearchPipeline` used by
 * `api/drop-off-search.ts`, then:
 *
 * 1. Excludes the rejected candidate(s) from the already-computed,
 *    fully-transit-evaluated pool (`outcome.fullyEvaluated`) -- no
 *    re-fetching of driving/transit data for candidates already evaluated,
 *    per design.md section 4.6 step 4.
 * 2. Re-runs `Ranker.rank` (section 4.5) over the reduced pool.
 * 3. Diffs the new final candidate set against the *original* (pre-
 *    exclusion) final set -- any candidate present in the new set but absent
 *    from the original one is "newly promoted" (a candidate the user was
 *    never shown/asked about). Only newly-promoted candidates run Phase 5's
 *    toll re-entry check (section 4.6 step 4 / ux-spec.md section 5a.4's
 *    explicit "do not re-ask" rule) -- a candidate that was already in the
 *    original final set and is not in `rejectedCandidateLocations` is, by
 *    construction, one the user already answered "Yes" to, so it is not
 *    re-checked.
 *
 * The frontend enforces ux-spec.md section 5a.4's two-round cap (it simply
 * never calls this endpoint a third time); this endpoint itself has no
 * concept of "round number" -- it is a pure function of
 * `(originalRequest, rejectedCandidateLocations)` each time, per its own
 * stateless design.
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
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error("[api/drop-off-search/confirm-toll-reentry] config load failed:", message);
    res.status(500).json({ error: "config_error", message: "The service is temporarily unavailable." });
    return;
  }

  if (!AuthGate.check(req, config)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const rawBody = typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {};
  const originalRequest = parseSearchRequest(rawBody.originalRequest);
  const rejectedCandidateLocations = parseRejectedCandidateLocations(rawBody.rejectedCandidateLocations);

  if (!originalRequest || !rejectedCandidateLocations) {
    res.status(200).json({
      status: "invalid_input",
      candidates: [],
      message: "One or more required fields are missing or invalid. Please check your inputs and try again.",
      requestId,
      timingMs: Date.now() - requestStart,
    });
    return;
  }

  const { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls } = originalRequest;

  // Same defense-in-depth radius re-validation as api/drop-off-search.ts
  // (DQ-1: passengerDestination is exempt) -- this endpoint re-derives the
  // whole search from originalRequest, so it re-checks everything the
  // original search checked, not just the parts that changed.
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

  const orchestrationDeadline = new Date(requestStart + config.responseTimeTargetSeconds * 1000);

  try {
    const outcome = await runSearchPipeline(
      { routingService, detourEvaluator, transitEvaluator },
      { start, driverDestination, passengerDestination, maxDetourMinutes, avoidTolls, config, orchestrationDeadline },
    );

    if (outcome.kind === "no_toll_free_route") {
      // Defensive: this endpoint is only ever legitimately reached with
      // avoidTolls === false (FR-019's own scope), so this should not
      // normally happen, but the pipeline is re-run against live data, and
      // this is the correct, already-defined response for it if it does.
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

    const { ranked: originalRanked, fullyEvaluated, route, timedOut } = outcome;

    if (originalRanked.status === "no_viable_option") {
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
        message: NO_VIABLE_OPTION_MESSAGE,
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    // design.md section 4.6 step 4: exclude the rejected candidate(s) from
    // the already-evaluated pool and re-rank -- no re-fetching of driving/
    // transit data for candidates already evaluated by the pipeline call
    // above.
    const rejectedKeys = new Set(rejectedCandidateLocations.map(locationKey));
    const filteredPool = fullyEvaluated.filter((candidate) => !rejectedKeys.has(locationKey(candidate.point)));
    const newRanked = Ranker.rank(filteredPool, maxDetourMinutes, config);

    if (newRanked.status === "no_viable_option") {
      res.status(200).json({
        status: "no_viable_option",
        candidates: [],
        message: NO_VIABLE_OPTION_MESSAGE,
        requestId,
        timingMs: Date.now() - requestStart,
      });
      return;
    }

    // ux-spec.md section 5a.4 / design.md section 4.6 step 4: only a
    // candidate absent from the *original* (pre-exclusion) final set is
    // "newly promoted" and needs its own Phase 5 check -- a candidate that
    // was already shown and not rejected was already answered "Yes" and must
    // not be re-asked.
    const originalFinalKeys = new Set(originalRanked.results.map((candidate) => locationKey(candidate.point)));
    const newlyPromoted = newRanked.results.filter(
      (candidate) => !originalFinalKeys.has(locationKey(candidate.point)),
    );

    const tollFlagsByKey = avoidTolls
      ? new Map()
      : await computeTollReentryFlags(
          routingService,
          start,
          driverDestination,
          newlyPromoted.map((candidate) => candidate.point),
          config.providerConcurrencyLimit,
        );

    const labeled = await labelFinalCandidates(geocodingService, start, newRanked.results);
    const candidates: DropOffSearchCandidate[] = toDropOffSearchCandidates(labeled, tollFlagsByKey);

    if (newRanked.status === "fallback") {
      res.status(200).json({
        status: "fallback",
        candidates,
        warning: newRanked.warning,
        disclaimer: DISCLAIMER_TEXT,
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
    const message = err instanceof RoutingProviderError ? err.message : String(err);
    console.error("[api/drop-off-search/confirm-toll-reentry] provider request failed:", message);
    res.status(502).json({ error: "provider_error", message: "Unable to reach the routing provider right now." });
  }
}
