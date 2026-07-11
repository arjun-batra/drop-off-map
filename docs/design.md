# Design: Drop-off Point Optimizer

Status: **DRAFT — finalized, ready for Gate 3 (user approval)**. All open questions from the initial draft (DQ-1, DQ-2, DQ-3) resolved by the user 2026-07-11; see section 1.
Source: `docs/requirements.md` (FINAL, Gate 2 passed 2026-07-10), `docs/idea-brief.md` (approved, Gate 1 passed 2026-07-10)
Owner: tech-lead. Do not edit outside this agent.

---

## 0. Process note for the orchestrator

This app has a user-facing UI (address inputs, results cards, warnings, possibly a map view). Per `CLAUDE.md`, **designer should produce `docs/ux-spec.md` in parallel with this design** if that has not already been kicked off. This design document specifies functional/data contracts the frontend must satisfy (what data exists, what states are possible) but does **not** specify visual layout, styling, or interaction detail — that is ux-spec.md's job. Recommend routing to designer now, in parallel with Gate 3 review of this document.

---

## 1. Design decisions log (resolved 2026-07-11)

All open questions raised in the initial draft have been resolved by the user (via pm/orchestrator, 2026-07-11). This design is written against the resolved answers below; no section is provisional any longer except DQ-4, which remains a cross-agent (release) dependency rather than a design blocker.

### 1.1 Resolved — business/requirements ambiguity (was routed to pm → user)

- **DQ-1 (FR-004 scope — which locations get the radius check?) — RESOLVED**: Only **start + driver's destination** are subject to the `GEOGRAPHIC_RADIUS_KM` check. The **passenger's destination is explicitly exempt** — it may be any distance from Toronto (e.g., the passenger's own transit journey could plausibly continue well beyond the 200km service circle; only the driver's drivable leg is constrained). This is now reflected as final logic in sections 4.1, 5.2, and INC-2 below (no longer an assumption).

### 1.2 Resolved — architecture/cost trade-offs (was routed to user directly)

- **DQ-2 (Provider choice + cost exposure) — CONFIRMED**: Google Maps Platform accepted as sole provider; the ~2,000-2,500 free-submissions/month illustrative estimate (section 3) is accepted as-is by the user, with the standing caveat (unchanged) that exact Google Cloud pricing must be re-verified before launch since list prices/credit amounts change over time.
- **DQ-3 (NFR-004 feasibility — 5 second target) — CONFIRMED**: 5 seconds is a soft target, not a hard guarantee. Per-call timeout + graceful "taking longer" degraded state (section 6.3) is the accepted resolution, as proposed.
- **DQ-4 (Billing alerting / retention ops)**: Still a cross-agent flag, not a design blocker — remains the release agent's responsibility to pick up in `docs/runbook.md` before INC-1 (this design only builds the `APP_MODE` toggle mechanism itself, per FR-017; automatic cost-based switching stays out of scope per FR-017/NFR-007).

### 1.3 Additional decisions from the user (2026-07-11)

- **No upper bound on `maxDetourMinutes`**: the user explicitly does not want a sanity-check ceiling on the detour-minutes input. `FR-002`'s validation is limited to "numeric and positive" — no configured or hardcoded maximum. This is intentional, not a gap, and is called out explicitly in INC-3 below so QA/reviewer don't flag it as a missing bound.
- **Visual map/route view**: approved as an increment, but conditionally — only if it does not increase provider API cost. See section 3.1 (provider capability re-confirmation) and the new INC-9 in section 10.
- **Reverse-geocoded labels for candidate drop-off points**: confirmed feasible via Google's Geocoding API; see section 3.1 for the capability confirmation and constraints, relayed to designer.

---

## 2. Architecture overview

Stateless client/server web app. No database, no session persistence of trip data (NFR-003).

```
┌─────────────────────────┐        ┌──────────────────────────────┐        ┌───────────────────────────┐
│   Browser (mobile-first │  HTTPS │  Backend API (stateless,      │  HTTPS │  Maps/Routing/Transit      │
│   responsive SPA)       │◄──────►│  serverless-friendly)         │◄──────►│  Provider (Google Maps     │
│  - address inputs        │        │  - config loader/validator    │        │  Platform, see section 3)  │
│  - "use my location"     │        │  - auth gate (APP_MODE)       │        │  - Geocoding/Places        │
│  - detour minutes input  │        │  - geocoding proxy             │        │  - Directions (driving,    │
│  - results display       │        │  - candidate generator         │        │    live traffic)           │
│  - map (Leaflet/OSM,     │        │  - detour evaluator (batched)  │        │  - Distance Matrix         │
│    no provider key       │        │  - transit evaluator           │        │  - Directions (transit,    │
│    needed for tiles)     │        │  - ranker/fallback logic       │        │    live schedules)         │
└─────────────────────────┘        └──────────────────────────────┘        └───────────────────────────┘
```

Key architectural decisions:
- **All provider calls happen server-side.** `MAP_API_KEY` is never sent to the browser. This is required for key security and to let the backend enforce `APP_MODE` gating and radius checks before any billable call is made.
- **No database.** All computation is request-scoped, in-memory, and discarded after the response is sent (NFR-003). Any operational logging must avoid persisting raw coordinates long-term (see section 9, flagged to release/runbook for retention policy).
- **Map rendering uses Leaflet + OpenStreetMap tiles**, not Google's Maps JavaScript API, to avoid a second billable Google SKU (Dynamic Maps) purely for tile display. Only Directions/Distance Matrix/Geocoding calls (all server-proxied) touch the provider's billing.
- **Backend is stateless per-request**, which makes it a good fit for serverless hosting (scales with bursty public traffic, no idle cost). Recommend deploying frontend + backend API routes together on a platform like Vercel/Netlify Functions, or a small always-on container on Render/Fly if the release agent prefers simpler local dev parity. Final hosting platform choice belongs to the release agent's runbook, constrained by: must support environment-variable-based config injection (section 7), must support HTTPS, must support the request/response shape in section 5.

---

## 3. Maps / routing / transit provider recommendation

### Requirement recap
Needed capabilities: live-traffic-aware driving directions, live transit departure/schedule data (not static-only) with walk+wait+ride+transfer breakdown, geocoding + address autocomplete, all within ~200km of Toronto, across "all locally available" transit modes (TTC subway/streetcar/bus, GO Transit rail/bus, regional agencies like MiWay, YRT, Durham Region Transit, etc.).

### Providers considered

| Provider | Live traffic driving | Live transit itineraries (walk+wait+ride+transfers) | Geocoding/autocomplete | Verdict |
|---|---|---|---|---|
| **Google Maps Platform** | Yes (Directions/Distance Matrix, `departure_time=now`, traffic-aware duration) | Yes — Google has real-time GTFS-RT ingestion agreements with TTC, GO/Metrolinx, and most regional Toronto-area agencies; Directions API `mode=transit` returns live-adjusted arrival/departure predictions where available, with per-step walk/wait/ride breakdown | Yes (Geocoding API, Places Autocomplete) | **Recommended** — only evaluated provider that covers all three needs from a single vendor with a documented real-time transit integration for this region |
| Mapbox | Yes (traffic-aware Directions) | **No** — Mapbox has no first-party live public-transit itinerary product | Yes | Rejected — would need a second vendor for transit, defeating "stay simple/single-vendor" goal |
| HERE Technologies | Yes | Partial/uncertain — HERE's intermodal routing exists but public real-time transit coverage/reliability for the Toronto region is not well-documented and would need live validation | Yes | Not recommended without a validation spike; deprioritized vs. Google given time constraints |
| TomTom | Yes (strong traffic product) | No | Partial | Rejected — no transit |
| Self-hosted OSRM (driving) + self-hosted OpenTripPlanner 2 (transit, fed by open GTFS + GTFS-RT feeds from Metrolinx/TTC open data) | **No** — OSRM's default road network uses static weights; genuine live traffic still requires a separate paid/free traffic-data feed layered in (e.g., TomTom Traffic flow API) | Yes, using free/open GTFS + GTFS-RT feeds, if agencies' RT feeds are reliable (idea-brief risk #3 — not fully validated) | Needs separate geocoder (e.g., Nominatim, free but lower quality/rate-limited) | Considered as a **future cost-reduction path**, not recommended for v1 — see below |

### Recommendation: Google Maps Platform (single vendor)

Covers Geocoding API + Places Autocomplete (FR-015), Directions API driving mode with live traffic (FR-006a/b, FR-007), Directions API transit mode with live schedule data and per-leg walk/wait/ride/transfer breakdown (FR-006c/d/e, FR-008), and Distance Matrix API for batched detour evaluation (section 4.3). Single API key, single billing account, single vendor to integrate and monitor — appropriate for an MVP where engineering time is scarce and the priority is shipping something trustworthy quickly (idea-brief: "fast/simple to use," and by extension, fast/simple to build reliably).

### Free tier vs. paid tier trade-off (for `APP_MODE`)

- **Free tier**: Google Maps Platform provides a recurring monthly usage credit (approximately $200 USD/month at time of writing — **verify current amount before launch, this changes**) applied automatically to the billing account; no separate "free tier mode" exists on Google's side, this is just usage under the credit. Per-1000-request list prices are roughly in the $5-$10 range depending on SKU (Geocoding, Directions, Distance Matrix, Places), also subject to change and volume-tiered discounts — **verify current rates before launch**.
  - Each user submission to this app costs roughly 10-15 provider calls (3 geocodes if not already resolved client-side + 1 direct route + 2 batched Distance Matrix calls + up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` transit Directions calls, default 8) — see section 4.5 for the exact accounting. This per-submission figure does not include **autocomplete-triggered geocode calls fired while the user is typing** into a location field (separate from the final resolved-address geocode counted above); that volume is bounded instead by `MIN_GEOCODE_QUERY_LENGTH` and `GEOCODE_DEBOUNCE_MS` (section 7, REV-006) rather than by anything in this per-submission table.
  - Illustrative estimate: ~$0.07-$0.10 of provider cost per user submission → **~2,000-2,500 free submissions/month** before the credit is used up and pay-as-you-go billing kicks in. This is an estimate for the user's go/no-go decision (DQ-2), not a guarantee.
- **Paid tier** (`APP_MODE=paid_tier`, password-gated per FR-016/017): unlocks unlimited pay-as-you-go scaling beyond the free credit (no hard ceiling other than a billing budget the operator sets in Google Cloud Console — this budget/alert setup is a release/runbook task, not a design mechanism, per DQ-4). The password gate itself is also a natural cost-control lever: gating the whole app behind a shared password inherently limits audience size, which is exactly the intended use of `APP_MODE` per FR-016's rationale.
- **Future alternative (not v1)**: self-hosted OpenTripPlanner2 (using free/open Toronto-region GTFS + GTFS-RT feeds) for the transit leg, paired with a traffic-aware driving provider (Google, TomTom, or Mapbox) for the driving leg only. This would reduce transit-call cost to near-zero but requires standing up and operating a GTFS-ingesting server (new infra, new maintenance burden — feed refresh jobs, agency onboarding, uptime) that is out of proportion to v1 scope. Documented here as the answer if free-tier cost becomes a real problem post-launch, not something to build now.

### 3.1 Two follow-up capability questions, confirmed (relay to designer)

**(a) Can a visual map/route view be added without increasing provider API cost?**

Yes, if built the way this design already specifies (section 2): render with **Leaflet + OpenStreetMap-family tiles**, not Google's Maps JavaScript API.
- Google's Maps Platform bills map rendering (the "Dynamic Maps"/Maps JavaScript API map-load SKU) **separately from, but out of the same shared monthly credit pool as**, the Directions/Distance Matrix/Geocoding calls already in scope. The $200/month credit is a single pooled credit across all Maps Platform SKUs, not a separate allowance per SKU — so adding Google's JS map widget would draw down the *same* budget already being spent on routing/transit calls, directly increasing total provider cost per session. **This fails the user's stated condition** and should not be built.
- Leaflet (a free, open-source JS mapping library) rendering OpenStreetMap-family tiles avoids Google billing entirely for the visual map itself, and can render the route polyline and candidate markers using data **already fetched** by calls already in scope (the direct-route Directions call from INC-3 returns the polyline; candidate points and rankings are already computed by INC-4/INC-6) — no new billed provider call is triggered by adding the map view. This satisfies the user's condition.
- **One caveat to flag to designer/release**: OpenStreetMap's own demo tile server (`tile.openstreetmap.org`) has a usage policy that discourages direct production traffic at any real volume and can rate-limit/block an app's IP under load. For a public-facing app, recommend a free-tier managed tile provider instead (e.g., MapTiler's free plan, or Stadia Maps' free tier for low-volume/non-commercial use) rather than hitting raw OSM tile servers directly. This is a separate, typically-free, non-Google account — it does not touch the Google Maps Platform billing pool the user is trying to protect, but it is a second small provider dependency worth designer/release being aware of when scoping INC-9.

**(b) Can Google's provider return a human-readable label for an arbitrary point along the route (for candidate card headers)?**

Yes, via the **Geocoding API's reverse-geocoding capability** (`reverseGeocode(point)` in the `GeocodingService` interface, section 5.1) — it accepts an arbitrary lat/lng (not just a registered place) and returns the nearest matchable address/road-segment label. Two constraints designer should account for in ux-spec.md:
- The label is the **nearest matchable address or road segment**, not a guaranteed "you are standing exactly here" name — for a candidate point on a stretch of road with no exact civic address, expect something like a nearby cross-street or road name rather than a precise street number. Card copy should be phrased accordingly (e.g., "near ___" rather than implying an exact address match).
- In sparser areas toward the edge of the 200km radius, reverse geocoding may only resolve to a coarser locality-level label (e.g., town/neighbourhood name) rather than a street-level one — an inherent data-density limitation, not a bug.
- **Cost impact**: generating a label for each of the final returned candidates (bounded by `MAX_CANDIDATES_RETURNED`, default 3, or 1 for the fallback case) adds up to a few more Geocoding calls per submission — immaterial to the section 3 cost estimate (still within the ~14-17 calls/submission range). Labels are generated only for the small set of *final* candidates actually shown to the user, not for the full raw-candidate or transit-shortlist pool, to avoid unnecessary cost.

---

## 4. Algorithm: candidate generation, evaluation, ranking, fallback

This is the core of FR-005 through FR-011. Designed in two phases specifically to keep both **cost** (provider calls) and **latency** (NFR-004) bounded, since evaluating live transit for every possible point along a route is neither affordable nor fast.

### 4.1 Phase 0 — Inputs resolved, direct baseline computed
1. Resolve `start`, `driverDestination`, `passengerDestination` to lat/lng (already done client-side via `/api/geocode` during input, or re-validated server-side — see section 5.1). Validate **`start` and `driverDestination` only** against the service radius (FR-004, NFR-006 — resolved DQ-1: the radius check does not apply to `passengerDestination`, which may be any distance away).
2. Call provider Directions (driving, `departure_time=now`, traffic-aware) for `start -> driverDestination`. This yields:
   - `directDriveTimeMinutes` (the FR-006b baseline, "no stop"),
   - the route polyline, decoded into an ordered list of `{lat, lng, cumulativeDistanceMeters}` vertices.

### 4.2 Phase 1 — Raw candidate generation (cheap, no extra provider calls)
3. Determine sampling spacing dynamically:
   ```
   effectiveSpacingMeters = max(
     CANDIDATE_SPACING_METERS,               // configured target spacing
     routeLengthMeters / MAX_RAW_CANDIDATES_SAMPLED   // never exceed the sampled-point cap
   )
   ```
4. Walk the polyline's cumulative distance and emit a candidate point every `effectiveSpacingMeters`, recording its **route order index** (used later for the FR-010 tie-break). Drop any candidate whose point falls outside `GEOGRAPHIC_RADIUS_KM` of `GEOGRAPHIC_CENTER` (edge case: a route between two in-radius points can briefly leave the circle depending on road geometry — implementation detail, not a business ambiguity, decided here).
5. Result: an ordered list of up to `MAX_RAW_CANDIDATES_SAMPLED` raw candidate points, each with zero provider calls spent so far beyond the one direct-route call.

### 4.3 Phase 2 — Batched detour evaluation (driving only, FR-006b, FR-007, FR-009 filter)
6. Batch the raw candidates into groups of `DISTANCE_MATRIX_BATCH_SIZE` (default 25, matching the provider's per-call element limits). For each batch, issue two Distance Matrix calls in parallel:
   - `origins=[start], destinations=[batch of candidates]` → `driveTimeToCandidateMinutes` per candidate (traffic-aware),
   - `origins=[batch of candidates], destinations=[driverDestination]` → `driveTimeFromCandidateMinutes` per candidate (traffic-aware).
7. For each candidate: `detourMinutes = (driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes) - directDriveTimeMinutes` (FR-006b, exact formula per resolved OQ-1).
8. Mark each candidate `qualifies = detourMinutes <= maxDetourMinutes` (the user-supplied FR-002 input) — this is the FR-009 filter, applied here but **not yet used to discard anything**, because the FR-011 fallback needs visibility into non-qualifying candidates too.

This phase costs exactly `2 * ceil(rawCandidateCount / DISTANCE_MATRIX_BATCH_SIZE)` provider calls regardless of how many candidates there are (up to the sampling cap), which is the main lever for keeping cost and latency bounded on long routes.

### 4.4 Phase 3 — Shortlist selection + transit evaluation (FR-006c/d/e, FR-008)
9. Transit evaluation is the slowest and most expensive step per-candidate (one Directions transit-mode call each, cannot be batched the way Distance Matrix can, because each candidate needs a *different* `departure_time`). Bound it with `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8):
   - Take all `qualifies=true` candidates, up to the cap, ordered by ascending `detourMinutes`.
   - If fewer than the cap qualify, fill remaining slots with the next-smallest-`detourMinutes` non-qualifying candidates. This guarantees the FR-011 fallback (smallest passenger total time overall) has a reasonable pool to search even when zero candidates qualify — without this, a zero-qualifying-candidate scenario would have no transit data to compute a fallback from.
10. For each shortlisted candidate, call provider Directions (`mode=transit`, `departure_time = now + driveTimeToCandidateMinutes`, filtered by `TRANSIT_MODES_INCLUDED`) for `candidate -> passengerDestination`, in parallel (bounded by `PROVIDER_CONCURRENCY_LIMIT`).
11. Parse the response's step breakdown into:
    - `walkTimeMinutes` = sum of WALKING step durations,
    - `waitTimeMinutes` = sum of (transit step's scheduled/live departure time − arrival time at that stop),
    - `transitTimeMinutes` = sum of in-vehicle + transfer time,
    - `passengerTotalTimeMinutes` = walk + wait + transit (FR-006e).
12. `driverTotalTimeMinutes = driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes` (FR-006f).
13. If a shortlisted candidate has no viable transit itinerary at all (provider returns no route), mark it `noTransitAvailable = true` and exclude it from ranking/fallback consideration, but keep it available for the FR-012 "no viable option" check.

### 4.5 Phase 4 — Ranking, tie-break, fallback (FR-010, FR-011, FR-012, FR-013)
14. Among evaluated candidates with `qualifies=true` and `noTransitAvailable=false`:
    - Sort ascending by `passengerTotalTimeMinutes`.
    - Tie-break: candidate with the **lower route-order index** (earlier on the driver's route) ranks higher (FR-010, resolved OQ-2).
    - Return the top `MAX_CANDIDATES_RETURNED` (default 3) with `status: "ranked"`.
15. If step 14's qualifying set is empty:
    - Among *all* evaluated candidates (qualifying or not) with `noTransitAvailable=false`, pick the single smallest `passengerTotalTimeMinutes` (FR-011, resolved OQ-3 — smallest passenger transit time, not smallest detour or distance).
    - Return that one candidate with `status: "fallback"` and a warning that it exceeds the requested detour threshold (FR-011, displayed per FR-013/FR-014).
16. If **no** evaluated candidate has a viable transit itinerary at all (every shortlisted candidate is `noTransitAvailable=true`), return `status: "no_viable_option"` with a clear message (FR-012), no candidates.

**Provider call accounting per user submission** (used for the cost estimate in section 3 and the latency analysis in section 6): 3 geocodes (if not already client-resolved) + 1 direct route + up to `2 * ceil(MAX_RAW_CANDIDATES_SAMPLED / DISTANCE_MATRIX_BATCH_SIZE)` (default: 2, since 20 ≤ 25) + up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8) + up to `MAX_CANDIDATES_RETURNED` (default 3, or 1 for a fallback result) reverse-geocode calls for final candidate labels (section 3.1b) = **~14-17 calls per submission** at default config.

---

## 5. Module boundaries and data contracts

### 5.1 Backend modules (dependency-injected, no hidden globals — for testability)

```ts
// config/schema.ts
interface AppConfig {
  mapRoutingProvider: "google_maps_platform";
  mapApiKey: string;                    // secret
  geographicCenter: { lat: number; lng: number; label: string };
  geographicRadiusKm: number;
  maxCandidatesReturned: number;
  appMode: "free_tier" | "paid_tier";
  paidTierAccessPassword: string | null; // secret, required if appMode === "paid_tier"
  responseTimeTargetSeconds: number;
  transitModesIncluded: TransitMode[] | "all";
  candidateSpacingMeters: number;
  maxRawCandidatesSampled: number;
  maxTransitEvaluationsPerRequest: number;
  distanceMatrixBatchSize: number;
  requestTimeoutMs: number;
  providerConcurrencyLimit: number;
  minGeocodeQueryLength: number;    // REV-006: min characters before an autocomplete lookup
                                    // fires; cost-control lever, gates billable Geocoding
                                    // API call volume from keystroke input
  geocodeDebounceMs: number;        // REV-006: debounce delay before an autocomplete lookup
                                    // fires; shapes (does not gate) billable call frequency
}

// geocodingService.ts
interface GeocodingService {
  resolve(query: string): Promise<GeoResult[]>;
  reverseGeocode(point: LatLng): Promise<string>; // label only; used for "use my location" AND
                                                    // final-candidate card headers (section 3.1b) —
                                                    // call only for the small set of returned
                                                    // candidates, never the full raw-candidate pool
}
interface GeoResult { lat: number; lng: number; label: string; placeId?: string }

// radiusValidator.ts
interface RadiusValidator {
  isWithinServiceArea(point: LatLng, config: RadiusServiceAreaConfig): boolean;
}
// Deliberately narrowed to only the fields this function reads (REV-011) --
// any full AppConfig structurally satisfies this type, so no caller-side
// adapter is needed.
type RadiusServiceAreaConfig = Pick<AppConfig, "geographicCenter" | "geographicRadiusKm">;

// routingService.ts
interface RoutingService {
  getDirectRoute(start: LatLng, dest: LatLng): Promise<{ durationMinutes: number; polyline: LatLng[] }>;
}

// candidateGenerator.ts
interface CandidateGenerator {
  sampleAlongPolyline(polyline: LatLng[], config: CandidateSamplingConfig): RawCandidate[];
}
// Narrowed per REV-011 -- only the fields Phase 1's sampling/radius-drop
// logic (section 4.2) actually reads.
type CandidateSamplingConfig = Pick<
  AppConfig,
  "candidateSpacingMeters" | "maxRawCandidatesSampled" | "geographicCenter" | "geographicRadiusKm"
>;
interface RawCandidate { point: LatLng; routeOrderIndex: number }

// detourEvaluator.ts
interface DetourEvaluator {
  batchEvaluate(
    start: LatLng, dest: LatLng, directDriveTimeMinutes: number,
    candidates: RawCandidate[], maxDetourMinutes: number, config: DetourEvaluationConfig
  ): Promise<EvaluatedCandidate[]>;
}
// Narrowed per REV-011 -- batchEvaluate only reads the batch-size tunable
// off config; maxDetourMinutes is separate, per-request user input (see the
// 2026-07-11 changelog entry on this parameter), not an AppConfig field.
type DetourEvaluationConfig = Pick<AppConfig, "distanceMatrixBatchSize">;
interface EvaluatedCandidate extends RawCandidate {
  driveTimeToCandidateMinutes: number;
  driveTimeFromCandidateMinutes: number;
  detourMinutes: number;
  qualifies: boolean;
}

// shortlistSelector.ts
interface ShortlistSelector {
  select(evaluated: EvaluatedCandidate[], config: ShortlistSelectionConfig): EvaluatedCandidate[];
}
// Narrowed per REV-011 -- select() only reads the transit-evaluation cap off
// config.
type ShortlistSelectionConfig = Pick<AppConfig, "maxTransitEvaluationsPerRequest">;

// transitEvaluator.ts
interface TransitEvaluator {
  evaluate(
    candidate: EvaluatedCandidate, passengerDestination: LatLng,
    departureTime: Date, config: TransitEvaluationConfig
  ): Promise<TransitResult>;
}
// Narrowed per REV-011 -- evaluate() only reads the transit-mode filter off
// config.
type TransitEvaluationConfig = Pick<AppConfig, "transitModesIncluded">;
interface TransitResult {
  walkTimeMinutes: number; waitTimeMinutes: number; transitTimeMinutes: number;
  passengerTotalTimeMinutes: number; noTransitAvailable: boolean;
}

// evaluateShortlist.ts
// Orchestrates section 4.4 steps 10-13 across the bounded shortlist
// ShortlistSelector.select produces. Not a single-candidate call like
// TransitEvaluator.evaluate above -- transit Directions calls cannot be
// batched into one request the way Distance Matrix calls can (each
// candidate needs a different departure_time), so this function fans
// TransitEvaluator.evaluate out across the shortlist in parallel, bounded
// by PROVIDER_CONCURRENCY_LIMIT (section 4.4 step 10). For each candidate,
// computes departureTime = requestNow + driveTimeToCandidateMinutes from a
// single shared now() reading (so every candidate's departure time is
// anchored to the same instant). A candidate with no viable driving route
// (driveTimeToCandidateMinutes === Infinity, from DetourEvaluator's
// per-element-failure handling) is skipped without spending a provider
// call and reported directly as noTransitAvailable: true.
function evaluateShortlist(
  transitEvaluator: TransitEvaluator,
  shortlist: EvaluatedCandidate[],
  passengerDestination: LatLng,
  config: Pick<AppConfig, "transitModesIncluded" | "providerConcurrencyLimit">,
): Promise<FullyEvaluatedCandidate[]>;

// ranker.ts
// FullyEvaluatedCandidate is the natural merge of Phase 2's
// EvaluatedCandidate and Phase 3's TransitResult -- exactly what section
// 4.4 steps 10-13 (evaluateShortlist, above) produce per shortlisted
// candidate, and what Ranker.rank below consumes.
interface FullyEvaluatedCandidate extends EvaluatedCandidate, TransitResult {}

interface Ranker {
  rank(fullyEvaluated: FullyEvaluatedCandidate[], maxDetourMinutes: number, config: RankingConfig): RankedResult;
}
// Narrowed per REV-011 -- rank() only reads the final-candidates cap off
// config; maxDetourMinutes is separate, per-request user input, not an
// AppConfig field.
type RankingConfig = Pick<AppConfig, "maxCandidatesReturned">;
type RankedResult =
  | { status: "ranked"; results: FullyEvaluatedCandidate[] }
  | { status: "fallback"; results: [FullyEvaluatedCandidate]; warning: string }
  | { status: "no_viable_option" };

// authMiddleware.ts
interface AuthGate {
  // Narrowed per REV-011 -- check() only reads appMode/paidTierAccessPassword;
  // any full AppConfig still satisfies this type, no caller-side adapter needed.
  check(req: Request, config: Pick<AppConfig, "appMode" | "paidTierAccessPassword">): boolean; // true = allowed through
}
```

### 5.2 API endpoints

- `GET /api/config/public` → non-secret config the frontend needs: `{ appMode, geographicCenter, geographicRadiusKm, maxCandidatesReturned, transitModesIncluded, minGeocodeQueryLength, geocodeDebounceMs }`. `minGeocodeQueryLength`/`geocodeDebounceMs` added per REV-006/REV-007 (section 7) — this is the frontend's **only** source for these two values; it must not redeclare them as local literals (see section 7's REV-007 note).
- `POST /api/auth/verify-password` (only relevant when `appMode=paid_tier`) → body `{ password: string }`, sets a short-lived session cookie on success. Password compared with constant-time comparison. This cookie is an auth token only, not trip data — does not conflict with NFR-003.
- `GET /api/geocode?query=...` → `{ results: GeoResult[] }`. Used for address autocomplete.
- `POST /api/drop-off-search`:
  ```ts
  // Request
  interface DropOffSearchRequest {
    start: { lat: number; lng: number; label: string };
    driverDestination: { lat: number; lng: number; label: string };
    passengerDestination: { lat: number; lng: number; label: string };
    maxDetourMinutes: number; // FR-002, user-entered, no server default
  }

  // Response
  interface DropOffSearchResponse {
    status: "ranked" | "fallback" | "no_viable_option" | "out_of_service_area" | "invalid_input";
    candidates: Array<{
      rank: number;
      location: { lat: number; lng: number };
      label: string;          // reverse-geocoded, nearest-match label (section 3.1b) — for card headers
      routeOrderIndex: number;
      driveTimeToDropoffMinutes: number;
      detourMinutes: number;
      walkTimeMinutes: number;
      waitTimeMinutes: number;
      transitTimeMinutes: number;
      passengerTotalTimeMinutes: number;
      driverTotalTimeMinutes: number;
      exceedsThreshold: boolean;
    }>;
    warning?: string;       // present when status === "fallback" (FR-011)
    message?: string;       // present for out_of_service_area / no_viable_option / invalid_input (FR-004, FR-012, FR-003)
    disclaimer: string;     // always present when candidates.length > 0 (FR-014)
    requestId: string;
    timingMs: number;       // for QA to verify NFR-004 empirically
  }
  ```

Validation ordering inside `/api/drop-off-search` (fail fast, cheapest checks first, per FR-003/FR-004): (1) shape/type validation of the 4 inputs → `invalid_input`; (2) radius check on `start` and `driverDestination` only (resolved DQ-1 — `passengerDestination` is exempt) → `out_of_service_area`; (3) proceed to section 4's algorithm.

---

## 6. NFR-004 latency feasibility analysis (5-second target)

### 6.1 Critical path under the design above (typical case, default config)
1. Geocoding (if needed) — 3 calls in parallel, ~0.2-0.4s.
2. Direct route call — ~0.3-0.5s (needed before candidate sampling can start; sequential dependency).
3. Batched Distance Matrix calls (2, in parallel) — ~0.5-0.9s.
4. Transit evaluation fan-out — up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8) calls in parallel, bounded by `PROVIDER_CONCURRENCY_LIMIT` — this is typically the slowest and most variable leg; transit itinerary computation with transfers tends to run 0.7-1.5s+ per call, and since these run in parallel the wall-clock cost is roughly the slowest straggler, not the sum — ~1.0-2.0s typical.

**Typical-case total: roughly 2.5-4.0s.** Within the 5s target, but with limited margin.

### 6.2 Why it is not a guarantee
- Steps 2-4 are sequentially dependent (can't sample candidates before the direct route exists, can't shortlist for transit before detour is known), so their latencies add rather than fully overlap.
- Transit Directions calls have the highest variance of any call in this design (multi-transfer itinerary search, live schedule lookups) — p95/p99 tail latency could push the fan-out step well past 2s.
- NFR-007 explicitly defers rate-limiting/abuse protection, so there is no backstop if the provider throttles or slows under bursty public load — a slow/throttled response here directly threatens the 5s target with no mitigation beyond `APP_MODE` (which is a manual, not automatic, switch).

### 6.3 Recommendation (flagged as DQ-3, needs user sign-off)
- Treat 5 seconds as a **soft target for the typical/median request**, not a guaranteed ceiling.
- Enforce a **hard per-call timeout** (`REQUEST_TIMEOUT_MS`, default 4000ms) on every individual provider call, and an overall backend orchestration timeout slightly under `RESPONSE_TIME_TARGET_SECONDS`.
- On overall timeout, return a **graceful degraded response**: rank and return whatever candidates completed evaluation within budget (if any qualify or a fallback can be computed from partial data), rather than hanging indefinitely or erroring with nothing. If literally nothing completed in time, return a distinct timeout-specific message (extension of `status`, e.g., `"timeout"`) rather than silently retrying (retries would only worsen tail latency, and are explicitly not required by any FR/NFR).
- This is presented to the user as DQ-3 for explicit acceptance, since NFR-004 itself requires escalation if the target can't be cleanly guaranteed.

---

## 7. Configuration schema

All values below are configurable via environment variables (or equivalent config-file mechanism the release agent sets up), never hardcoded, per the project's non-negotiables. This table supersedes/expands the configuration table in `requirements.md` — every key from requirements is present, plus additional tunables this design introduces to satisfy FR-006/FR-009/FR-010/FR-011 within the NFR-004 latency budget.

| Key | Type | Default | Secret? | Purpose / FR-NFR link |
|---|---|---|---|---|
| `MAP_ROUTING_PROVIDER` | enum | `google_maps_platform` | no | Which provider integration to use (section 3) |
| `MAP_API_KEY` | string | none (required) | **yes** | Provider credential; server-side only, never sent to browser |
| `GEOGRAPHIC_CENTER` | `{lat, lng, label}` | Toronto (43.6532, -79.3832, "Toronto, ON") | no | NFR-006 |
| `GEOGRAPHIC_RADIUS_KM` | number | 200 | no | NFR-006, FR-004 |
| `MAX_CANDIDATES_RETURNED` | integer | 3 | no | FR-010 |
| `APP_MODE` | enum | `free_tier` | no | FR-016, FR-017 |
| `PAID_TIER_ACCESS_PASSWORD` | string | none | **yes**, required if `APP_MODE=paid_tier` | FR-016, FR-017 |
| `RESPONSE_TIME_TARGET_SECONDS` | number | 5 | no | NFR-004 (soft target, see section 6) |
| `TRANSIT_MODES_INCLUDED` | enum list or `"all"` | `all` | no | FR-006d, transit query filter |
| `CANDIDATE_SPACING_METERS` | number | 1000 | no | Target spacing between raw sampled candidates (section 4.2) |
| `MAX_RAW_CANDIDATES_SAMPLED` | integer | 20 | no | Caps raw candidate count regardless of route length (cost + latency control) |
| `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` | integer | 8 | no | Caps the most expensive/slowest per-candidate calls (section 4.4) |
| `DISTANCE_MATRIX_BATCH_SIZE` | integer | 25 | no | Provider-imposed batch limit for Distance Matrix calls |
| `REQUEST_TIMEOUT_MS` | integer | 4000 | no | Per-external-call hard timeout (section 6.3) |
| `PROVIDER_CONCURRENCY_LIMIT` | integer | 10 | no | Max simultaneous outbound provider calls per user request, to respect provider QPS limits while still parallelizing (section 6) |
| `MIN_GEOCODE_QUERY_LENGTH` | integer | 3 | no | Minimum characters typed into a location field before an autocomplete geocode lookup fires. Cost-control lever — every character at/above this length triggers a real, billable Google Geocoding API call (see REV-006 decision below). |
| `GEOCODE_DEBOUNCE_MS` | integer | 300 | no | Debounce delay (ms) after the user stops typing before an autocomplete lookup fires. Shapes billable call *frequency* during typing (see REV-006 decision below). |
| `SESSION_LIFETIME_SECONDS` | integer | 3600 | no | Lifetime, in seconds, of the session cookie issued by `POST /api/auth/verify-password`; embedded (signed) into the token itself so the session genuinely expires server-side, not just via the cookie's own `Max-Age`. Required whenever `APP_MODE=paid_tier` (FR-016/017, REV-002 remediation). |

`MAX_DETOUR_THRESHOLD_INPUT` is intentionally **not** in this table — confirmed in requirements as user-entered per session, no config default.

### 7.1 REV-006/REV-007 decision (resolved 2026-07-11)

**Background**: dev implemented `MIN_QUERY_LENGTH = 3` and `DEBOUNCE_MS = 300` as literal constants in `src/frontend/hooks/useLocationField.ts` and `api/geocode.ts` (INC-2). Neither was in this schema. QA judged this an acceptable UX-detail choice; reviewer (REV-006) partially disagreed, arguing `MIN_QUERY_LENGTH` directly gates billable Geocoding API call volume per keystroke and belongs in the same family as `DISTANCE_MATRIX_BATCH_SIZE`/`MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, and recommended tech-lead make an explicit decision. Reviewer separately flagged (REV-007) that the value was independently redeclared in two files with no shared source. The user reviewed reviewer's concern and said "aligned."

**Decision: both `MIN_QUERY_LENGTH` and `DEBOUNCE_MS` are promoted to the config schema**, renamed `MIN_GEOCODE_QUERY_LENGTH` and `GEOCODE_DEBOUNCE_MS` for clarity (the old names were ambiguous — "query" alone doesn't say *which* query, and the project has other query-shaped concepts, e.g. `DropOffSearchRequest`). Defaults unchanged (3, 300ms) so this is a config-surfacing change, not a behavior change.

- **`MIN_GEOCODE_QUERY_LENGTH`: promoted, no dissent.** This is squarely a cost-control lever, not a cosmetic UX choice: it is the *only* thing standing between a keystroke and a billable provider call in the autocomplete path, and it needs to be tunable by an operator without a code change/redeploy — e.g., raised from 3 to 5 if free-tier credit is burning faster than section 3's estimate assumed, or lowered in `paid_tier` if the operator prioritizes responsiveness over cost. This is exactly the reasoning already applied to `DISTANCE_MATRIX_BATCH_SIZE`/`MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, and CLAUDE.md's non-negotiable ("no hardcoded tunables") is not scoped only to values requirements.md happened to name — any real operational tunable qualifies, and this is one.
- **`GEOCODE_DEBOUNCE_MS`: promoted as well, not left hardcoded.** Reviewer characterized this as "a weaker case (no direct cost impact, pure UX timing)" and a lower priority than `MIN_GEOCODE_QUERY_LENGTH`. Tech-lead's independent assessment: it is *not* cost-neutral — debounce directly shapes how many autocomplete calls fire while a user is actively typing (a shorter debounce fires more calls per keystroke burst; a longer one collapses a typing burst into fewer calls), which is the same "call-frequency" concern `PROVIDER_CONCURRENCY_LIMIT`/`REQUEST_TIMEOUT_MS` already address for other parts of the request lifecycle. Given (a) it costs nothing extra to add — the config loader/schema/public-config plumbing is already being touched for `MIN_GEOCODE_QUERY_LENGTH`, and (b) leaving it hardcoded while promoting its sibling would recreate exactly the kind of "implicit judgment call" reviewer already flagged once, tech-lead is promoting it too rather than drawing a line QA/reviewer would likely have to revisit later.
- **Neither is a secret.** Both are safe to expose to the frontend via `GET /api/config/public` (section 5.2) — knowing the minimum query length or debounce value does not expose any credential or business logic an attacker could exploit beyond what's already inferable by using the UI.

**REV-007 (single source of truth) — resolved.** The backend `AppConfig` (loaded once via the config loader, section 5.1) is the sole source of truth for both values. Concretely, dev should:
1. Remove the two literal constants from `src/frontend/hooks/useLocationField.ts` entirely (no local `MIN_QUERY_LENGTH`/`DEBOUNCE_MS` declarations, not even as a fallback/default — a stale local fallback would silently reintroduce the drift risk REV-007 flagged).
2. Have `api/geocode.ts` read `config.minGeocodeQueryLength` directly from the already-loaded `AppConfig` (it already receives `config` for `MAP_API_KEY`, so this is a one-line change, no new plumbing) instead of its own literal.
3. Have the frontend read both values from the `GET /api/config/public` response (already fetched once at app startup to drive the password-gate/service-area copy, section 8) and thread them into `useLocationField.ts` as parameters/props — the same pattern already used for `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM` (section 5.2, INC-2).
4. Backend enforcement of `MIN_GEOCODE_QUERY_LENGTH` in `api/geocode.ts` remains the actual security/cost boundary regardless of what the frontend does (a client that bypasses the frontend's debounce/length gate entirely and calls `/api/geocode` directly still gets rejected server-side before any Google call is made — already true today per the INC-2 audit's confirmed `AuthGate`-then-validation ordering). The frontend's copy of the value is purely for shaping its own UX/call-triggering behavior, not a security control; it must never be the only place the check is enforced.

This does not reopen INC-2's QA/reviewer clearance — INC-2 remains cleared. This is a follow-up correction dev should pick up opportunistically (same handling as REV-004/REV-005), re-verified by QA/reviewer as a small diff against the already-passed increment, not a new increment.

---

## 8. Frontend contract (functional, not visual — visual/UX detail belongs to designer's ux-spec.md)

Required states the UI must be able to render, driven directly by `DropOffSearchResponse.status`:
- `ranked` — up to `maxCandidatesReturned` result cards, each showing the full FR-013 breakdown.
- `fallback` — single result card + visible warning banner (FR-011, FR-013).
- `no_viable_option` — message, no cards (FR-012).
- `out_of_service_area` — message referencing the configured radius, no computation attempted (FR-004).
- `invalid_input` — field-level error messaging (FR-003).
- `timeout` (see section 6.3) — message distinct from the above, inviting retry.
- Persistent disclaimer (FR-014) rendered whenever `candidates.length > 0`, regardless of status.
- Password-gate screen when `appMode === "paid_tier"` and no valid session cookie exists yet (FR-016/017).
- Three location inputs each supporting typed-address-with-autocomplete and "use my current location" (FR-015), on mobile-responsive layout (NFR-001).

---

## 9. Assumptions and known limitations (not blocking, documented for traceability)

- Radius edge case for candidates briefly outside the service circle on a route between two in-radius points: resolved as "exclude that candidate point" (section 4.2, step 4) — an implementation detail, not a business ambiguity.
- Live transit data quality/coverage will vary at the edges of the 200km radius (smaller regional agencies with weaker GTFS-RT feeds) — this is idea-brief risk #3, inherent to the chosen provider's data sources, not something this design can fully resolve; no action taken beyond documenting it.
- Safety/legality of a candidate drop-off point (idea-brief risk #1) is out of scope for v1 per requirements; addressed only via the FR-014 disclaimer.
- Operational log retention for request-scoped coordinate data (NFR-003 adjacent) — flagged to release for `docs/runbook.md`, not a design mechanism itself.

---

## 10. Increment plan (INC-1..8, plus conditional INC-9)

Prerequisite (not a numbered increment, owned by release per pipeline): **CI/CD pipeline + hosting + `docs/runbook.md` established before INC-1 begins**, since this app is public-facing (NFR-005). Includes: chosen hosting platform, environment-variable injection mechanism for section 7's config, HTTPS, and the billing-alert/cost-ceiling ops concern from DQ-4.

Each increment below is independently testable by QA and does not depend on anything not yet built in an earlier increment.

### INC-1: Project scaffolding, config loader, auth gate, app shell
- Backend skeleton (stateless server), `AppConfig` loader/validator (fails fast on missing `MAP_API_KEY`, or missing `PAID_TIER_ACCESS_PASSWORD` when `APP_MODE=paid_tier`).
- `AuthGate` middleware implementing FR-016/FR-017's binary app-wide gate; `/api/auth/verify-password` endpoint.
- `GET /api/config/public` endpoint.
- Frontend app shell: mobile-responsive layout skeleton, three location-input fields and detour-minutes field present (not yet wired to real geocoding), password-gate screen wired to the auth endpoint.
- **Covers**: FR-016, FR-017, NFR-002, config keys `APP_MODE`/`PAID_TIER_ACCESS_PASSWORD`/`MAP_API_KEY`, partial NFR-001.
- **QA can test**: config validation failure modes, password gate blocks/allows correctly in both modes, app renders on mobile viewports, no persistence layer exists anywhere (NFR-003 spot check).

### INC-2: Location input, geocoding, radius validation
- `GeocodingService`, `/api/geocode` endpoint, "use my current location" (browser geolocation + reverse-geocode label).
- `RadiusValidator` + `out_of_service_area` response path (FR-004 — resolved DQ-1: radius check applies to **`start` and `driverDestination` only**; `passengerDestination` is never radius-checked and should be accepted at any distance).
- Invalid-address error handling (FR-003).
- **Covers**: FR-001, FR-003, FR-004, FR-015, NFR-006, config keys `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM`. Follow-up (2026-07-11, REV-006/REV-007): config keys `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` (section 7.1) also belong to this increment's scope — dev to fold the corrected, config-driven values into the existing `useLocationField.ts`/`api/geocode.ts` code as an opportunistic fix, not a new increment.
- **QA can test**: valid/invalid addresses, current-location flow, in-radius/out-of-radius combinations for `start`/`driverDestination`, and confirmation that a far-away `passengerDestination` is accepted without a radius error, all without any driving/transit computation yet. Follow-up: re-verify `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` are read from config (not hardcoded) in both the frontend hook and `api/geocode.ts`, and that changing the configured value changes both call sites' behavior consistently (closes REV-007's drift risk).

### INC-3: Direct driving route + detour threshold input
- `RoutingService.getDirectRoute` (live traffic), `maxDetourMinutes` input field (FR-002) with numeric/positive validation **and explicitly no upper bound** (user decision, section 1.3 — do not add a sanity-check ceiling).
- Expose direct drive time (dev/QA-visible, not yet the final feature) to validate live-traffic integration end to end.
- **Covers**: FR-002, FR-006a, part of FR-006b (baseline), FR-007.
- **QA can test**: live traffic is reflected (e.g., comparing times at different times of day, or against the provider's own consumer app), detour-minutes field accepts any positive number including very large values (confirm no hidden max is enforced).

### INC-4: Candidate generation + batched detour evaluation
- `CandidateGenerator.sampleAlongPolyline`, `DetourEvaluator.batchEvaluate` (Distance Matrix batching), `qualifies` flag computation.
- Expose raw candidate list with detour times via an internal/debug view for QA inspection (transit not yet computed).
- **Covers**: FR-005, full FR-006b, FR-009 (filter flag only, not yet applied to final ranking), config keys `CANDIDATE_SPACING_METERS`/`MAX_RAW_CANDIDATES_SAMPLED`/`DISTANCE_MATRIX_BATCH_SIZE`.
- **QA can test**: correct candidate count/spacing given route length, correct detour math against the FR-006b formula, batch size respected.

### INC-5: Transit evaluation
- `ShortlistSelector`, `TransitEvaluator.evaluate` (departure-time-aware transit Directions calls), walk/wait/transit/transfer parsing, `TRANSIT_MODES_INCLUDED` filtering.
- **Covers**: FR-006c, FR-006d, FR-006e, FR-008, config keys `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`/`TRANSIT_MODES_INCLUDED`.
- **QA can test**: transit legs computed correctly, live-schedule departure-time honored (spot check against provider's own live data), transit-mode filter honored, evaluation cap respected.

### INC-6: Ranking, tie-break, fallback, full results output
- `Ranker.rank` implementing FR-010's sort + tie-break, FR-011's fallback, FR-012's no-viable-option path; full `DropOffSearchResponse` wiring; frontend results cards for `ranked`/`fallback`/`no_viable_option` states (FR-013).
- Reverse-geocoded `label` field (section 3.1b) generated only for the final returned candidates (bounded by `MAX_CANDIDATES_RETURNED` or the single fallback candidate), for card headers.
- **Covers**: FR-006f, FR-010, FR-011, FR-012, FR-013, config key `MAX_CANDIDATES_RETURNED`.
- **QA can test**: all three response-status scenarios reproducible with controlled/mocked provider responses (normal ranked case, fallback-with-warning case, zero-viable-option case), tie-break behavior with contrived equal-time candidates, label present and reasonable (nearest-match phrasing, not a false precise-address claim) on every returned candidate.

### INC-7: Disclaimer, latency hardening, timeout handling
- Persistent FR-014 disclaimer on all candidate-bearing responses; per-call `REQUEST_TIMEOUT_MS`, `PROVIDER_CONCURRENCY_LIMIT` tuning, overall orchestration timeout, `timeout` status path (section 6.3).
- Timing instrumentation (`timingMs` in response) for QA to empirically validate NFR-004.
- **Covers**: FR-014, NFR-004 (validated, not just designed), config keys `RESPONSE_TIME_TARGET_SECONDS`/`REQUEST_TIMEOUT_MS`/`PROVIDER_CONCURRENCY_LIMIT`.
- **QA can test**: disclaimer visible on `ranked`/`fallback` states, latency measurements against target under realistic/staging conditions, graceful behavior when an artificial slow-provider-response is simulated.

### INC-8: Paid-tier hardening, full mobile polish, cross-cutting error handling
- End-to-end paid-tier UX (password entry, session cookie, re-auth behavior), full mobile responsiveness pass across all screens/states, remaining error-state polish (network failures, malformed provider responses), final NFR-006 edge cases, final NFR-003 persistence audit across the whole app.
- **Covers**: remainder of NFR-001, NFR-002, FR-016/FR-017 (full end-to-end), NFR-006 edge cases, NFR-003 closure check.
- **QA can test**: full mobile device pass across breakpoints, full paid-tier auth flow including session expiry, full regression pass.

### INC-9 (conditional/optional): Visual route + candidate map view
- **Condition to build this increment at all**: only if it does not increase Google Maps Platform provider API cost (user decision, section 1.3). Per section 3.1a, this is achievable using Leaflet + a free-tier non-Google tile provider (e.g., MapTiler free plan or Stadia Maps free tier — **not** the raw OpenStreetMap demo tile server, per the production-usage-policy caveat in 3.1a), rendering the route polyline and candidate markers from data already fetched in INC-3/INC-4/INC-6 (no new billed Google call).
- Not required for FR/NFR compliance — every FR/NFR is already satisfied by the text/card-based output of INC-1..8. This increment is a pure UX enhancement, and its detailed visual/interaction design belongs to designer's `ux-spec.md`, not this document.
- Flag to designer: confirm the non-Google tile provider choice and attribution requirements (OSM-family tiles require on-map attribution text) fit the intended UX before building.
- **Covers**: no FR/NFR directly (enhancement only); depends on data already produced by INC-3 (route polyline), INC-4 (candidate points), and INC-6 (final ranked/fallback candidates + labels).
- **QA can test**: map renders route + candidate markers correctly; confirm via network inspection that no additional Google Maps Platform billed request is triggered by loading or interacting with the map (only the non-Google tile requests, which are free-tier and out of Google's billing pool).

### Traceability summary
- FR-001 → INC-2. FR-002 → INC-3. FR-003 → INC-2. FR-004 → INC-2 (resolved DQ-1: start + driverDestination only). FR-005 → INC-4. FR-006(a-f) → INC-3/4/5/6. FR-007 → INC-3. FR-008 → INC-5. FR-009 → INC-4/6. FR-010 → INC-6. FR-011 → INC-6. FR-012 → INC-6. FR-013 → INC-6. FR-014 → INC-7. FR-015 → INC-2. FR-016/FR-017 → INC-1/INC-8.
- NFR-001 → INC-1/INC-8. NFR-002 → INC-1. NFR-003 → cross-cutting, checked at INC-1 and closed at INC-8. NFR-004 → designed in section 6, validated at INC-7. NFR-005 → release prerequisite, before INC-1. NFR-006 → INC-2/INC-8. NFR-007 → accepted risk, no increment (explicitly out of scope per requirements).

No FR/NFR is without design coverage. All previously open questions (DQ-1, DQ-2, DQ-3) are resolved as of 2026-07-11; only DQ-4 (billing-alert ops setup) remains, and it is a release/runbook task, not a design gap.

---

## 11. Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-07-10 | Initial design drafted from FINAL requirements.md and approved idea-brief.md; provider recommendation (Google Maps Platform), two-phase candidate/detour/transit evaluation algorithm, config schema, 8-increment plan; DQ-1 through DQ-4 raised for pm/user resolution before Gate 3 | Phase 2 kickoff following Gate 2 approval |
| 2026-07-11 | Resolved DQ-1 (FR-004 radius check applies only to `start`+`driverDestination`, not `passengerDestination` — updated sections 4.1, 5.2, INC-2, traceability); resolved DQ-2 (Google Maps Platform + free-tier estimate confirmed, no changes needed); resolved DQ-3 (5s soft target + graceful timeout confirmed, no changes needed); recorded new user decisions: no upper bound on `maxDetourMinutes` (INC-3), added section 3.1 confirming (a) Leaflet+non-Google-tiles satisfies the "map view must not increase provider cost" condition and (b) Google's Geocoding API can reverse-geocode arbitrary candidate points for card labels (with nearest-match/coarse-label caveats), added `label` field to `DropOffSearchResponse`, added conditional/optional INC-9 (visual map view) to the increment plan; DQ-4 remains open only as a release/runbook dependency, not a design gap | User resolved all open questions from initial draft; incorporating into finalized design for Gate 3 |
| 2026-07-11 | Resolved reviewer findings REV-006 (`[HARDCODED]`)/REV-007 (`[BLOAT]`) from the INC-2 audit: promoted the two literal constants `MIN_QUERY_LENGTH`/`DEBOUNCE_MS` (dev's INC-2 implementation) into the config schema as `MIN_GEOCODE_QUERY_LENGTH` (default 3) and `GEOCODE_DEBOUNCE_MS` (default 300ms) — see new section 7.1 for full rationale. Both exposed via `GET /api/config/public` (section 5.2 updated); `AppConfig` interface updated (section 5.1); added a cost-accounting footnote to section 3 clarifying autocomplete-triggered geocode volume is bounded by these two keys, separate from the per-submission call estimate; updated INC-2's "Covers" line (section 10) to include this as an opportunistic follow-up fix to the already-QA'd/reviewer-cleared increment, not a new increment. Directed dev (in section 7.1) to make backend `AppConfig` the single source of truth for both values, eliminating REV-007's dual-declaration drift risk, while keeping backend enforcement of `MIN_GEOCODE_QUERY_LENGTH` as the real security/cost boundary independent of frontend behavior. | Reviewer (REV-006/REV-007) flagged undocumented hardcoded cost-relevant constants; user confirmed alignment with reviewer's concern, directing tech-lead to make an explicit schema decision rather than leave it implicit |
| 2026-07-11 | Corrected section 5.1's `DetourEvaluator.batchEvaluate` TS interface listing to include the `maxDetourMinutes: number` parameter (positioned after `candidates`, before `config`), matching `src/candidates/detourEvaluator.ts`'s actual signature. Section 4.3 step 8's prose already required this value (the user-supplied FR-002 input) to compute the `qualifies` flag, and it cannot be sourced from `AppConfig` since it is per-request input, not config — the interface listing had simply never been updated to match. No functional/behavioral change; dev's INC-4 implementation (confirmed correct by QA) is unchanged. | Stale-doc gap flagged independently by dev and QA during INC-4; documentation-only correction, no new increment |
| 2026-07-11 | Batch documentation cleanup on section 5.1, pre-INC-5-audit, consolidating four independent items — no behavior/design change, all already-implemented/QA'd/reviewed code: (1) **REV-011**: replaced the generic `AppConfig` config parameter with each module's actual narrowed type — `AuthGate.check(req, config: Pick<AppConfig, "appMode" \| "paidTierAccessPassword">)`, `RadiusValidator.isWithinServiceArea(point, config: RadiusServiceAreaConfig)` (`= Pick<AppConfig, "geographicCenter" \| "geographicRadiusKm">`), `CandidateGenerator.sampleAlongPolyline(polyline, config: CandidateSamplingConfig)` (`= Pick<AppConfig, "candidateSpacingMeters" \| "maxRawCandidatesSampled" \| "geographicCenter" \| "geographicRadiusKm">`), `DetourEvaluator.batchEvaluate(..., config: DetourEvaluationConfig)` (`= Pick<AppConfig, "distanceMatrixBatchSize">`) — reviewer independently assessed this narrowing pattern as good testability/DI practice, not a risk, so the doc now reflects it rather than the illustrative full-`AppConfig` shorthand. (2) Added the missing `FullyEvaluatedCandidate` type definition (`extends EvaluatedCandidate, TransitResult`) that `Ranker.rank`'s signature already referenced but section 5.1 never defined — matches `src/transit/types.ts`'s implementation exactly (dev's completion of an apparent drafting gap, independently confirmed correct by QA). (3) Added `evaluateShortlist.ts`'s fan-out/concurrency-bounding orchestration (`Pick<AppConfig, "transitModesIncluded" \| "providerConcurrencyLimit">` config, bounded by `PROVIDER_CONCURRENCY_LIMIT`) as a named, documented part of section 5.1's architecture — previously only an implicit implementation detail; QA confirmed the concurrency bound is genuinely enforced, not theoretical. (4) Confirmed (no change needed) that section 10's INC-5 "Covers" line correctly attributes only FR-008 (the live-transit-data requirement) and does not misattribute the "no viable transit" case, which has no dedicated FR and is plumbing for INC-6's FR-012 check. **FR/NFR coverage**: unchanged by this pass — FR-005/FR-006b/FR-009 (INC-4), FR-006c/FR-006d/FR-006e/FR-008 (INC-5) remain covered exactly as before; no FR/NFR newly covered or newly gapped. | Reviewer flagged REV-011 (design-gap, stale `AppConfig` listings) at the INC-1 audit, carried forward; dev/QA independently flagged the missing `FullyEvaluatedCandidate` definition and the undocumented `evaluateShortlist` orchestration during INC-5. Consolidated into one documentation-only pass ahead of reviewer's INC-5 audit, per the orchestrator's request — no user approval needed (no design/behavior change, only already-implemented/QA'd/reviewed code being reflected accurately) |
| 2026-07-11 | Batch documentation cleanup, consolidating two independent stale-doc items flagged by reviewer — no behavior/design change, both already-implemented/QA'd/reviewed code: (1) **REV-011 (remaining 3 of 6 instances)**: section 5.1's `ShortlistSelector.select`, `TransitEvaluator.evaluate`, and `Ranker.rank` still showed an unnarrowed `config: AppConfig` parameter even though the earlier batch pass (previous changelog entry) had already corrected the same pattern for `AuthGate`, `RadiusValidator`, `CandidateGenerator`, and `DetourEvaluator`. Updated all three to their actual narrowed types, matching `src/candidates/shortlistSelector.ts`, `src/transit/types.ts`, and `src/ranking/ranker.ts` exactly: `ShortlistSelector.select(evaluated, config: ShortlistSelectionConfig)` (`= Pick<AppConfig, "maxTransitEvaluationsPerRequest">`), `TransitEvaluator.evaluate(candidate, passengerDestination, departureTime, config: TransitEvaluationConfig)` (`= Pick<AppConfig, "transitModesIncluded">`), `Ranker.rank(fullyEvaluated, maxDetourMinutes, config: RankingConfig)` (`= Pick<AppConfig, "maxCandidatesReturned">`). This closes REV-011 with all 6 known instances of the narrowing pattern now accurately reflected in section 5.1. (2) **REV-016**: section 7's config schema table was missing `SESSION_LIFETIME_SECONDS` (added in INC-8's session-hardening work, `src/config/schema.ts`'s `sessionLifetimeSeconds`), a required, non-hardcoded integer config key controlling the signed session-cookie lifetime for `POST /api/auth/verify-password` (REV-002 remediation, FR-016/017). Added a row: type integer, default 3600 (per `.env.example`'s documented value and `loader.ts`'s fail-fast-if-unset parsing, consistent with every other numeric key in the schema — no in-code fallback), not secret. **FR/NFR coverage**: unchanged by this pass — no FR/NFR newly covered or newly gapped; both fixes bring section 5.1/section 7 into sync with already-shipped, already-tested code. | Reviewer flagged REV-011 (3 remaining instances, introduced at INC-5/INC-6) and REV-016 (INC-8's `SESSION_LIFETIME_SECONDS` missing from the schema table) in the review log; consolidated into one documentation-only cleanup pass per the orchestrator's request — no user approval needed (no design/behavior change, only already-implemented/QA'd/reviewed code being reflected accurately) |
