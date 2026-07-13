# Design: Drop-off Point Optimizer

Status: **Core design (sections 1-9, INC-1..9 increment plan) approved at Gate 3 and delivered — see `docs/handoff.md`, `docs/test-report.md`, and `docs/requirements.md` section 6's Phase 4 delivery confirmation.** The FR-018–FR-022 extension (sections 1.4, 3.5, 4.1a/4.2a/4.3a/4.4a/4.6/4.7, 5.1/5.2 additions, 7.2, INC-10..14) added 2026-07-12 is now **Gate 3 PASSED (2026-07-13) — APPROVED, no longer draft.** All three open technical questions tech-lead flagged in section 1.4 are resolved and recorded in `docs/requirements.md` §5 (DEC-5, DEC-6, DEC-7), and FR-019's interaction-flow design (routed to designer per the user's instruction) is complete — see `docs/ux-spec.md` §5a. INC-10, INC-13, and INC-14 no longer carry any blocking flag and dev work may begin on any of them. See section 1.4 for the per-item resolution record and section 11's 2026-07-13 changelog entry for the full approval-evidence chain, including a provenance note on what tech-lead independently verified versus what rests on the orchestrator's relay.
Source: `docs/requirements.md` (FINAL, Gate 2 passed 2026-07-10; FR-018–FR-022 change request approved 2026-07-12), `docs/idea-brief.md` (approved, Gate 1 passed 2026-07-10)
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

- **DQ-2 (Provider choice + cost exposure) — CONFIRMED, but underlying estimate superseded 2026-07-12**: Google Maps Platform accepted as sole provider; the ~2,000-2,500 free-submissions/month illustrative estimate (section 3) was accepted as-is by the user on 2026-07-11, with the standing caveat (unchanged) that exact Google Cloud pricing must be re-verified before launch since list prices/credit amounts change over time. **That standing caveat has since materialized**: a 2026-07-12 cost-model refresh (section 3, recomputed free-tier analysis) found Google eliminated the shared-credit pricing model this estimate was built on (effective 2025-03-01) and replaced it with per-SKU allotments, recomputing the ceiling to roughly ~550-600 free submissions/month. This is a materially different number than the one the user confirmed here — **flagged for pm to take back to the user for re-confirmation**, not silently treated as still-accepted just because DQ-2 itself was closed.
- **DQ-3 (NFR-004 feasibility — 5 second target) — CONFIRMED**: 5 seconds is a soft target, not a hard guarantee. Per-call timeout + graceful "taking longer" degraded state (section 6.3) is the accepted resolution, as proposed.
- **DQ-4 (Billing alerting / retention ops)**: Still a cross-agent flag, not a design blocker — remains the release agent's responsibility to pick up in `docs/runbook.md` before INC-1 (this design only builds the `APP_MODE` toggle mechanism itself, per FR-017; automatic cost-based switching stays out of scope per FR-017/NFR-007).

### 1.3 Additional decisions from the user (2026-07-11)

- **No upper bound on `maxDetourMinutes`**: the user explicitly does not want a sanity-check ceiling on the detour-minutes input. `FR-002`'s validation is limited to "numeric and positive" — no configured or hardcoded maximum. This is intentional, not a gap, and is called out explicitly in INC-3 below so QA/reviewer don't flag it as a missing bound.
- **Visual map/route view**: approved as an increment, but conditionally — only if it does not increase provider API cost. See section 3.1 (provider capability re-confirmation) and the new INC-9 in section 10.
- **Reverse-geocoded labels for candidate drop-off points**: confirmed feasible via Google's Geocoding API; see section 3.1 for the capability confirmation and constraints, relayed to designer.

### 1.4 FR-018–FR-022 change request (2026-07-12) — design decisions, technical assessments, and flagged questions

`docs/requirements.md`'s FR-018–FR-022 are FINAL and approved. This subsection records the technical judgment calls made while designing to them — several with real product consequences that are flagged here for pm/user rather than decided unilaterally, consistent with this project's no-inference rule extended to design-stage technical calls, not just requirements-stage ones.

**Resolution status (2026-07-13): all items originally flagged as open below are now resolved.** FR-018's and FR-020's technical-approximation acceptability were confirmed by the user as DEC-5 and DEC-6 respectively (`docs/requirements.md` §5); FR-019's interaction-model question was routed to designer per the user's explicit instruction and resolved in `docs/ux-spec.md` §5a; FR-022's separate-API-key recommendation was approved as DEC-7. The per-item bullets below are left as originally written (the historical record of each question as posed at design time), with a **RESOLVED** line appended to each closing it out.

- **FR-018 (toll avoidance) — a technical constraint flagged for pm/user re-confirmation.** Google's Directions API and Distance Matrix API both accept an `avoid=tolls` request parameter (confirmed). **However, Google's own documented semantics describe `avoid=tolls` as a preference, not a hard constraint: a route containing a toll may still be returned if no reasonable toll-free alternative exists, and neither API returns a structured per-route/per-leg "contains a toll" flag that would let this app verify after the fact.** Section 4.1a/4.3a/4.7 below design a best-effort implementation — request `avoid=tolls` on every driving call, and *additionally verify* toll-freeness (via text pattern-matching against a known regional toll-road identifier list, itself an approximation) for the baseline route and the small set of final candidates. **This cannot mechanically guarantee**, for the full raw candidate pool evaluated only via batched Distance Matrix calls (no step/road-name data returned by that API), that a toll was never silently included for a specific candidate's leg. **Flagged for pm to take back to the user**: is "best-effort avoidance, verified only where step-level data is available/affordable (baseline route + final candidates)" an acceptable reading of FR-018's "must never be returned" language, or does the user require a stronger guarantee — which would mean migrating the driving-route calls to Google's newer Routes API with its paid `extraComputations: ["TOLLS"]` toll-data add-on (a materially different cost/coverage tradeoff, see section 3.4's existing Routes API assessment, not recommended for v1 on its own)? **RESOLVED (DEC-5, `docs/requirements.md` §5, 2026-07-12)**: the user accepted "best effort with partial verification" as satisfying FR-018's "must never be returned" language as-is; no migration to Routes API's paid toll add-on was requested.
- **FR-019 (toll re-entry question) — a genuine UX/flow decision, not decided here.** See section 4.6's design and its explicit flag: this needs designer and/or user input on the interaction model (ask about all flagged candidates in one batch vs. one at a time; how many "reject → promote next candidate → maybe ask again" rounds are supported) before INC-14 (section 10) can start build. Tech-lead has designed a recommended default (batch, one round-trip) but this is presented as a recommendation, not a final decision. **RESOLVED**: routed to designer per the user's explicit instruction ("route to designer"); designer completed the full interaction-model design — see `docs/ux-spec.md` §5a (Screen 2a, "Toll Road Check") and §5.1's loading-screen reuse note for the re-computation flow. INC-14 (section 10) is no longer blocked on this question.
- **FR-020 (highway exclusion) — an approximation, not a geometric guarantee.** See section 4.7's technical assessment. Neither Directions nor Geocoding exposes a general road-classification/limited-access-freeway data field. The design below uses text-pattern-matching against a curated, Toronto-region-specific identifier allowlist (400-series highways, QEW, DVP, Gardiner Expressway), applied to the already-fetched direct-route Directions response's steps. **Flagged for pm/user awareness**: false negatives (an actual limited-access highway not on the list) and false positives (a name collision) are both possible in principle, though the allowlist is deliberately curated to bias toward precision (avoiding wrongly excluding a valid arterial candidate), per FR-020's own explicit warning about arterial roads that happen to carry the word "Highway." **RESOLVED (DEC-6, `docs/requirements.md` §5, 2026-07-12)**: the user accepted the allowlist-based approximation as-is, acknowledging the residual false-positive/false-negative risk; no stronger geometric detection method or expanded identifier source was requested.
- **FR-021 (transit detail display)** — no open question. Google's transit-mode Directions response already contains everything FR-021 needs (`transit_details.line`, `.headsign`, `.departure_stop`/`.arrival_stop`); this is a straightforward parser/contract extension of data the app currently fetches and discards, not a new capability question.
- **FR-022 (Google Maps JS API rendering)** — no open feasibility question. One flagged security/config recommendation on API key handling — see section 7's new `GOOGLE_MAPS_JS_API_KEY` entry. Recommend **not** reusing `MAP_API_KEY` — see the rationale there. **RESOLVED (DEC-7, `docs/requirements.md` §5, 2026-07-12)**: the user approved this recommendation ("aligned with your recommendation"); `GOOGLE_MAPS_JS_API_KEY` is a settled, distinct config key (section 3, section 7.2, Configuration table).

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

> **2026-07-12 update — pricing model superseded, recomputed below.** The bullets immediately below this note (2026-07-10/11 original) were built on Google Maps Platform's pre-March-2025 pricing model: a single pooled ~$200/month usage credit shared across every Maps Platform SKU. **That model was eliminated effective 2025-03-01** and replaced with **per-SKU monthly free allotments** — there is no shared pool anymore. Separately, Google now flags the **Directions API and Distance Matrix API** (the two legacy SKUs this app's driving/detour/transit logic is built on — see `src/routing/googleRoutingService.ts`, `src/routing/googleDistanceMatrixService.ts`, `src/transit/googleTransitDirectionsService.ts`) as **"Legacy"**, recommending migration to the newer **Routes API** (`Compute Routes` / `Compute Route Matrix`) for better pricing/free-tier terms. The original bullets are left below for history; the recomputed analysis follows as "Recomputed free-tier analysis (2026-07-12)." See also the new Routes API migration assessment, section 3.4.
>
> **Provenance/verification caveat**: the figures in the recomputed analysis come from **web research relayed by the orchestrator**, not independent verification by tech-lead — Google's own pricing pages returned 403s when direct fetch was attempted in this sandbox (network-blocked, confirmed). Where a specific number could not be confirmed from the relayed research, tech-lead has made an explicit, labeled assumption by analogy rather than guessing silently. **Spot-check every figure below against Google Cloud's live Maps Platform pricing page before any real production cost commitment** (budget alerts, `APP_MODE` default choice, any user-facing "X free requests" claim) — flagged to release for the runbook and to pm/user, since this revises a figure the user explicitly confirmed at DQ-2 (2026-07-11, section 1.2) materially downward.

- **Free tier (superseded 2025-03-01, kept for history)**: Google Maps Platform provides a recurring monthly usage credit (approximately $200 USD/month at time of writing — **verify current amount before launch, this changes**) applied automatically to the billing account; no separate "free tier mode" exists on Google's side, this is just usage under the credit. Per-1000-request list prices are roughly in the $5-$10 range depending on SKU (Geocoding, Directions, Distance Matrix, Places), also subject to change and volume-tiered discounts — **verify current rates before launch**.
  - Each user submission to this app costs roughly 10-15 provider calls (3 geocodes if not already resolved client-side + 1 direct route + 2 batched Distance Matrix calls + up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` transit Directions calls, default 8) — see section 4.5 for the exact accounting. This per-submission figure does not include **autocomplete-triggered geocode calls fired while the user is typing** into a location field (separate from the final resolved-address geocode counted above); that volume is bounded instead by `MIN_GEOCODE_QUERY_LENGTH` and `GEOCODE_DEBOUNCE_MS` (section 7, REV-006) rather than by anything in this per-submission table.
  - Illustrative estimate: ~$0.07-$0.10 of provider cost per user submission → **~2,000-2,500 free submissions/month** before the credit is used up and pay-as-you-go billing kicks in. This was the estimate accepted for the user's go/no-go decision (DQ-2), **now superseded — see recomputed analysis below.**
- **Recomputed free-tier analysis (2026-07-12) — per-SKU model**: each Google Maps Platform SKU now carries its own separate monthly free-call allotment; nothing pools across SKUs anymore. Relayed research reports three allotment tiers by SKU classification: **Essentials-tier SKUs get 10,000 free calls/month**, **Pro-tier SKUs get 5,000 free calls/month**, **Enterprise-tier SKUs get 1,000 free calls/month**. Mapping this app's provider calls (section 4.5's accounting) onto SKUs:
  - **Geocoding API** (Essentials tier → 10,000 free/month, per relayed research). Backs `GeocodingService.resolve()` (forward geocode of typed addresses **and** autocomplete-triggered lookups gated by `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS`, section 7.1) and `GeocodingService.reverseGeocode()` (candidate-label lookups, section 3.1b, and "use my current location"). Per submission: 3 forward geocodes (if not already client-resolved) + up to `MAX_CANDIDATES_RETURNED` (default 3, or 1 for a fallback result) reverse geocodes = **up to 6 Geocoding-API calls/submission**, plus a variable, not-per-submission-bounded volume from in-progress autocomplete typing — drawing on the *same* 10,000/month bucket, so heavy autocomplete usage eats into this ceiling too.
  - **Directions API (Legacy)** — used for **both** `RoutingService.getDirectRoute()` (driving mode, section 4.1) **and** `TransitEvaluator.evaluate()` (transit mode, section 4.4): Google bills these under the *same* SKU regardless of the `mode` query parameter, they are not billed as separate products. Per submission: 1 driving call + up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8) transit calls = **up to 9 Directions-API calls/submission**. Tier classification used here (Pro → 5,000 free/month) is **an assumption by analogy** to Google's general pattern of placing legacy compute-heavy routing SKUs in the Pro tier — **not directly confirmed** by the relayed research; verify before relying on it.
  - **Distance Matrix API (Legacy)** — backs `DetourEvaluator.batchEvaluate()`'s batched driving-time lookups (section 4.3). Per submission at default config: `2 * ceil(MAX_RAW_CANDIDATES_SAMPLED / DISTANCE_MATRIX_BATCH_SIZE)` = `2 * ceil(20/25)` = **2 calls/submission**. Tier classification (Pro → 5,000 free/month) is likewise an **assumption by analogy, not confirmed** — the relayed research gave a legacy paid rate (~$5.00 per 1,000 elements) but no explicit free-allotment figure for this specific SKU.
  - **Maps JavaScript API / "Dynamic Maps"** (Essentials tier → 10,000 free loads/month, per relayed research) — **not currently called** by this app (section 2's Leaflet decision), but its own **separate** allotment, independent of the three SKUs above. Directly relevant to section 3.1a's now-stale rationale, below.

  **Recomputed free-submission ceiling, default config:**

  | SKU | Calls/submission (default config) | Assumed free allotment/month | Submissions until this SKU's allotment is exhausted |
  |---|---|---|---|
  | Geocoding API | up to 6 (+ variable, same-bucket autocomplete volume) | 10,000 (Essentials — relayed research) | ~1,666 (fewer if autocomplete volume is material) |
  | Directions API (Legacy, driving + transit combined) | up to 9 | 5,000 (Pro — **assumed by analogy, unconfirmed**) | ~555 |
  | Distance Matrix API (Legacy) | 2 | 5,000 (Pro — **assumed by analogy, unconfirmed**) | ~2,500 |

  **Binding constraint: roughly 550-600 free submissions/month**, set by the Directions API SKU — a sharp drop from the previous (now-superseded) ~2,000-2,500/month figure. This is not because the app's absolute dollar cost per submission changed; it's because the old estimate blended cost across one shared pool, while the new per-SKU model means the single most call-heavy SKU sets its own ceiling with no ability to borrow headroom from the comparatively lighter Distance Matrix or Geocoding usage. The Directions API SKU is the bottleneck almost entirely because of the up-to-8 transit-mode calls (`MAX_TRANSIT_EVALUATIONS_PER_REQUEST`), not the single driving call.
  - **This revises DQ-2's user-confirmed figure (2026-07-11) materially downward and should be relayed back to the user via pm before being treated as a settled number** — DQ-2's original acceptance was of the old ~2,000-2,500 estimate, not this one.
  - **Existing config lever, now more cost-significant than before**: `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (section 7, default 8) is, under this pricing model, the single most cost-relevant tunable in the system — lowering it directly raises the Directions-API-bound free-submission ceiling (fewer transit-shortlist calls/submission), at the cost of a smaller candidate pool for the FR-011 fallback search. This is an existing lever (no new config key needed); only its cost significance has changed.
- **Paid tier** (`APP_MODE=paid_tier`, password-gated per FR-016/017): unlocks unlimited pay-as-you-go scaling beyond the free allotments (no hard ceiling other than a billing budget the operator sets in Google Cloud Console — this budget/alert setup is a release/runbook task, not a design mechanism, per DQ-4). The password gate itself is also a natural cost-control lever: gating the whole app behind a shared password inherently limits audience size, which is exactly the intended use of `APP_MODE` per FR-016's rationale. (Unchanged by the 2026-07-12 pricing update — this mechanism does not depend on whether the free tier is a shared pool or per-SKU allotments.)
- **Future alternative (not v1)**: self-hosted OpenTripPlanner2 (using free/open Toronto-region GTFS + GTFS-RT feeds) for the transit leg, paired with a traffic-aware driving provider (Google, TomTom, or Mapbox) for the driving leg only. This would reduce transit-call cost to near-zero but requires standing up and operating a GTFS-ingesting server (new infra, new maintenance burden — feed refresh jobs, agency onboarding, uptime) that is out of proportion to v1 scope. Documented here as the answer if free-tier cost becomes a real problem post-launch, not something to build now. **Under the 2026-07-12 recomputed analysis, this alternative becomes more attractive sooner than previously thought**, since the Directions API SKU (which the transit calls dominate) is now the binding constraint on its own, rather than one contributor to a larger shared pool — still not recommended for v1, but flagged as a stronger candidate for "first thing to revisit if free-tier cost is a real post-launch problem."

### 3.1 Two follow-up capability questions, confirmed (relay to designer)

**(a) Can a visual map/route view be added without increasing provider API cost?**

Yes, if built the way this design already specifies (section 2): render with **Leaflet + OpenStreetMap-family tiles**, not Google's Maps JavaScript API.
- Google's Maps Platform bills map rendering (the "Dynamic Maps"/Maps JavaScript API map-load SKU) **separately from, but out of the same shared monthly credit pool as**, the Directions/Distance Matrix/Geocoding calls already in scope. The $200/month credit is a single pooled credit across all Maps Platform SKUs, not a separate allowance per SKU — so adding Google's JS map widget would draw down the *same* budget already being spent on routing/transit calls, directly increasing total provider cost per session. **This fails the user's stated condition** and should not be built.
- Leaflet (a free, open-source JS mapping library) rendering OpenStreetMap-family tiles avoids Google billing entirely for the visual map itself, and can render the route polyline and candidate markers using data **already fetched** by calls already in scope (the direct-route Directions call from INC-3 returns the polyline; candidate points and rankings are already computed by INC-4/INC-6) — no new billed provider call is triggered by adding the map view. This satisfies the user's condition.
- **One caveat to flag to designer/release**: OpenStreetMap's own demo tile server (`tile.openstreetmap.org`) has a usage policy that discourages direct production traffic at any real volume and can rate-limit/block an app's IP under load. For a public-facing app, recommend a free-tier managed tile provider instead (e.g., MapTiler's free plan, or Stadia Maps' free tier for low-volume/non-commercial use) rather than hitting raw OSM tile servers directly. This is a separate, typically-free, non-Google account — it does not touch the Google Maps Platform billing pool the user is trying to protect, but it is a second small provider dependency worth designer/release being aware of when scoping INC-9.

> **2026-07-12 update — this rationale's premise no longer holds.** The paragraph above ("separately from, but out of the same shared monthly credit pool as") described the pre-March-2025 pricing model. Under the **current per-SKU model** (see the recomputed free-tier analysis above), the Maps JavaScript API / "Dynamic Maps" SKU has its **own separate free allotment (Essentials tier, ~10,000 free loads/month per relayed research)**, entirely independent of the Geocoding/Directions/Distance Matrix allotments this app's routing logic consumes. Adding Google's JS map widget today would **not** draw down the same budget as the routing/transit calls — it would draw against its own, currently-unused 10,000/month bucket. **The specific cost-pooling concern that drove the original Leaflet-over-Google-Maps-JS decision is no longer accurate as stated.**
> This is directly relevant to change-request item 4 (FR-022, `docs/requirements.md`, approved by the user 2026-07-12): switching the app's map rendering to Google's Maps JavaScript API. That switch is **not implemented as part of this cost-model refresh** — per the CLAUDE.md change-request pipeline, a requirements-level change (FR-022) is followed by tech-lead reworking the affected increment(s) (INC-9 and/or a successor) as a distinct design pass, once pm has fully scoped FR-022's requirements. This note exists so that pass does not inherit a stale cost objection: the *only* thing this subsection now asserts is that the original shared-pool rationale is outdated; it does not itself redesign INC-9, add a new increment number, or change INC-9's "Covers"/QA-test text in section 10 — that remains a follow-up design task once FR-022 is fully scoped by pm.
> One caveat carried forward regardless of which map-rendering approach is used: whatever the per-load or per-1000-load rate is beyond the (Essentials-tier or otherwise) free allotment for Dynamic Maps has **not been verified** in this pass — if FR-022 is implemented, re-run this same per-SKU cost analysis for the Dynamic Maps SKU specifically (expected submission volume × map loads/submission vs. its own 10,000/month ceiling) before treating it as cost-neutral.

**(b) Can Google's provider return a human-readable label for an arbitrary point along the route (for candidate card headers)?**

Yes, via the **Geocoding API's reverse-geocoding capability** (`reverseGeocode(point)` in the `GeocodingService` interface, section 5.1) — it accepts an arbitrary lat/lng (not just a registered place) and returns the nearest matchable address/road-segment label. Two constraints designer should account for in ux-spec.md:
- The label is the **nearest matchable address or road segment**, not a guaranteed "you are standing exactly here" name — for a candidate point on a stretch of road with no exact civic address, expect something like a nearby cross-street or road name rather than a precise street number. Card copy should be phrased accordingly (e.g., "near ___" rather than implying an exact address match).
- In sparser areas toward the edge of the 200km radius, reverse geocoding may only resolve to a coarser locality-level label (e.g., town/neighbourhood name) rather than a street-level one — an inherent data-density limitation, not a bug.
- **Cost impact**: generating a label for each of the final returned candidates (bounded by `MAX_CANDIDATES_RETURNED`, default 3, or 1 for the fallback case) adds up to a few more Geocoding calls per submission — immaterial to the section 3 cost estimate (still within the ~14-17 calls/submission range). Labels are generated only for the small set of *final* candidates actually shown to the user, not for the full raw-candidate or transit-shortlist pool, to avoid unnecessary cost.

### 3.4 Routes API migration assessment (2026-07-12, research/planning only — not implemented in this pass)

Google now flags the Legacy Directions API and Legacy Distance Matrix API (both used by this app, see the recomputed free-tier analysis above) as "Legacy," recommending migration to the newer **Routes API** (`Compute Routes` for point-to-point, `Compute Route Matrix` for many-to-many) for better pricing and free-tier terms. This subsection assesses whether that migration is worth recommending as a future increment. **No code is changed by this pass** — this is analysis only, per the orchestrator's explicit instruction.

**Why this app's existing module boundaries make the migration bounded, not sprawling:**
- `RoutingService` and `DistanceMatrixService` (section 5.1) are already narrow, provider-agnostic interfaces — `getDirectRoute(start, dest): Promise<{durationMinutes, polyline}>` and `getDurationsMinutes(origins, destinations): Promise<ElementDurationMinutes[][]>`. Every downstream consumer (`DetourEvaluator`, `CandidateGenerator`, `Ranker`, `evaluateShortlist`, `api/drop-off-search.ts`) depends only on these interface shapes, never on Google's Directions/Distance Matrix response bodies directly (confirmed by reading `src/routing/googleRoutingService.ts` and `src/routing/googleDistanceMatrixService.ts` — the Google-specific request/response parsing is fully contained inside these two files, behind the interfaces).
- A migration would therefore be contained to rewriting exactly these two implementation files (plus their unit-test fixtures) to call `computeRoutes`/`computeRouteMatrix` instead — a different request shape (POST with a JSON body and a field-mask header, rather than GET query params) and a different response shape (e.g. Distance-Matrix-equivalent results returned as a flat list of origin/destination-indexed elements rather than Google's legacy rows-of-elements matrix), reshaped internally to the existing `ElementDurationMinutes[][]`/`DirectRouteResult` contracts. **No change would be needed** to `detourEvaluator.ts`, `candidateGenerator.ts`, `ranker.ts`, or `api/drop-off-search.ts` — this is exactly the payoff of designing to narrow, DI-friendly interfaces in the first place (section 5.1).

**Why the migration would NOT touch this app's actual free-tier bottleneck:**
- Google's Routes API (as of general product knowledge; **not independently re-verified in this pass, flagged for spot-check**) supports driving/walking/bicycling/two-wheeler routing but **does not support transit mode**. Transit itineraries (FR-006c/d/e, FR-008 — this app's core differentiator) have no Routes API equivalent today; `TransitEvaluator`/`googleTransitDirectionsService.ts` would remain on the Legacy Directions API regardless of whether the driving-route and distance-matrix calls migrate.
- Per the recomputed table above, transit calls are 8 of the app's 9 Directions-API-SKU calls/submission at default config — the actual binding constraint on free-tier submissions (~555/month). Migrating only the 1 driving call to `Compute Routes`, and the 2 Distance Matrix calls to `Compute Route Matrix`, would **not move the Directions-API bottleneck at all**, since the transit calls (which have no migration path) remain on the same SKU driving that constraint.

**Recommendation: worth doing eventually as a backlog item, not urgent, not this pass.**
- **Benefit**: exits a SKU Google has explicitly flagged as legacy (reduces long-term deprecation/feature-freeze risk) and may yield better per-call pricing or a larger free allotment for the driving-route and distance-matrix pieces specifically — **unverified**; Routes API's own tier/pricing for the traffic-aware routing preference this app needs for FR-007 (the equivalent of `duration_in_traffic`) was not confirmed by the relayed research and needs its own pricing lookup before being sized precisely. It is possible Routes API's traffic-aware fields sit in a higher (less generous) tier than the base product, in which case the "better free tier" benefit may not materialize for this app's specific usage.
- **Cost**: two service-file rewrites (`googleRoutingService.ts`, `googleDistanceMatrixService.ts`) + updated test fixtures + a validation pass confirming the request/response reshaping preserves exact behavior (traffic-aware duration field, per-element failure handling for unreachable origin/destination pairs) — bounded effort given the interface isolation above, but not zero, and **does not address the actual bottleneck** (transit calls, which cannot migrate).
- **Recommendation**: log this as a candidate future increment, to be scoped and prioritized after INC-1..9 ship and real production usage data exists to confirm whether free-tier depletion at ~555 submissions/month is actually a practical problem. No FR/NFR requires this migration today — "Legacy" is a signal about Google's future investment/deprecation posture, not a functional break; the Legacy Directions/Distance Matrix APIs continue to function as designed. Do not insert this into the current INC-1..9 plan.

### 3.5 Cost impact of FR-018–FR-022 (2026-07-12 change request)

- **FR-018/FR-019 increase Directions-API-SKU call volume — the binding free-tier constraint already identified above.** FR-019's toll re-entry check (section 4.6) adds 2 Directions calls (with steps retained, one for the start→candidate leg, one for candidate→destination) per **final** candidate checked — bounded by `MAX_CANDIDATES_RETURNED` (default 3) or 1 for the fallback case — so up to **+6 to +8 Directions-API calls/submission** when `avoidTolls` is unchecked (tolls allowed) and the final ranked/fallback candidates need re-entry checking. This is on top of the existing up-to-9 Directions calls/submission (1 driving baseline + up to 8 transit), materially worsening the already-binding ~555-submissions/month ceiling identified above. **Flagged again for pm/user re-confirmation** — this is the same category of "a previously accepted cost figure changes materially" event section 3's 2026-07-12 update already flagged once, now happening again in the opposite (worse) direction.
- **FR-020 is cost-neutral.** It uses the direct-route Directions response's own steps (already fetched at Phase 0 for every submission regardless of this feature) for highway-candidate attribution (section 4.2a/4.7) — no new provider call, no reverse-geocoding of the raw candidate pool.
- **FR-021 is cost-neutral.** It retains data already present in the existing transit-mode Directions response (no new call, no new request parameter).
- **FR-022 draws on the Maps JavaScript API's own separate ~10,000-free-loads/month allotment** (per this section's 2026-07-12 recomputed analysis, and section 3.1a's superseded-rationale note) — does not affect the Geocoding/Directions/Distance Matrix ceilings above at all. One map load per Results-screen view. The existing caveat in section 3.1a (re-verify the per-load rate beyond the free allotment before a production cost commitment) still applies and is not re-litigated here.

---

## 4. Algorithm: candidate generation, evaluation, ranking, fallback

This is the core of FR-005 through FR-011. Designed in two phases specifically to keep both **cost** (provider calls) and **latency** (NFR-004) bounded, since evaluating live transit for every possible point along a route is neither affordable nor fast.

### 4.1 Phase 0 — Inputs resolved, direct baseline computed
1. Resolve `start`, `driverDestination`, `passengerDestination` to lat/lng (already done client-side via `/api/geocode` during input, or re-validated server-side — see section 5.1). Validate **`start` and `driverDestination` only** against the service radius (FR-004, NFR-006 — resolved DQ-1: the radius check does not apply to `passengerDestination`, which may be any distance away).
2. Call provider Directions (driving, `departure_time=now`, traffic-aware) for `start -> driverDestination`. This yields:
   - `directDriveTimeMinutes` (the FR-006b baseline, "no stop"),
   - the route polyline, decoded into an ordered list of `{lat, lng, cumulativeDistanceMeters}` vertices.

**4.1a — FR-018/FR-020 additions to Phase 0** (does not renumber steps 1-2 above; existing code/handoff references to "step 2" etc. are unaffected):
- Read the per-request `avoidTolls: boolean` input (the "avoid tolls" checkbox, FR-018) — this is per-session/per-request user input exactly like `maxDetourMinutes`, not a config value; default `false` (unchecked) client-side, matching FR-018's stated default.
- Step 2's Directions call now includes `avoid=tolls` in the request whenever `avoidTolls === true`.
- Step 2's Directions call now also retains (does not discard) the response's `routes[0].legs[0].steps[]`, as an ordered `steps: DirectionStep[]` list (`{ instructionsHtml, distanceMeters, cumulativeDistanceMeters, maneuver? }`, see section 5.1) — needed by FR-020's highway-candidate attribution (section 4.2a) and FR-018's toll-free-baseline verification (next bullet). This is new data capture from a call already being made every submission; no new provider call.
- **(FR-018/OQ-9)** When `avoidTolls === true`: run `analyzeTollUsage(steps)` (section 4.7) against the baseline route's own steps. If it reports `usesTollRoad: true` — i.e., even Google's best-effort `avoid=tolls` baseline route still traverses a known regional toll road — conclude no reasonably toll-free route exists between `start` and `driverDestination` at all, and **short-circuit the entire search**: skip Phases 1 through 5 entirely and return `status: "no_toll_free_route"` (new response status, section 5.2 — a message-only/empty-result outcome, same shape as FR-012's `no_viable_option`, per FR-018's resolved OQ-9). This is the only point in the pipeline where OQ-9's fallback message is produced. See section 1.4's flagged caveat: this is a best-effort/approximate verification (text pattern-matching), not a mathematically certain one.

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

**4.2a — FR-020 addition to Phase 1 (highway exclusion, hard rejection before ranking)**: for each raw candidate emitted by step 4, attribute it to the enclosing `DirectionStep` from 4.1a's retained `steps[]` list by matching the candidate's `cumulativeDistanceMeters` against each step's `cumulativeDistanceMeters` range (the same cumulative-distance walk already used for sampling). Run `isLimitedAccessHighway(step.instructionsHtml)` (section 4.7) against that step; if it matches, **drop the candidate outright** (do not emit it into the raw candidate list at all — same treatment as the existing out-of-radius drop in step 4, not a flag applied later). This runs regardless of whether `avoidTolls` is checked (FR-020 is an independent, always-on business rule, not conditional on the toll checkbox) and against whichever route was actually computed at Phase 0 (toll-avoiding or not), so no separate call/route is needed for this check. No new provider call — reuses step 4.1a's already-retained `steps[]`. If every raw candidate along the route is excluded by this rule, the existing FR-012 "no viable option" handling applies once the (now-empty) candidate list reaches Phase 4 (per FR-020's explicit text — no new fallback behavior is introduced).

### 4.3 Phase 2 — Batched detour evaluation (driving only, FR-006b, FR-007, FR-009 filter)
6. Batch the raw candidates into groups of `DISTANCE_MATRIX_BATCH_SIZE` (default 25, matching the provider's per-call element limits). For each batch, issue two Distance Matrix calls in parallel:
   - `origins=[start], destinations=[batch of candidates]` → `driveTimeToCandidateMinutes` per candidate (traffic-aware),
   - `origins=[batch of candidates], destinations=[driverDestination]` → `driveTimeFromCandidateMinutes` per candidate (traffic-aware).
7. For each candidate: `detourMinutes = (driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes) - directDriveTimeMinutes` (FR-006b, exact formula per resolved OQ-1).
8. Mark each candidate `qualifies = detourMinutes <= maxDetourMinutes` (the user-supplied FR-002 input) — this is the FR-009 filter, applied here but **not yet used to discard anything**, because the FR-011 fallback needs visibility into non-qualifying candidates too.

This phase costs exactly `2 * ceil(rawCandidateCount / DISTANCE_MATRIX_BATCH_SIZE)` provider calls regardless of how many candidates there are (up to the sampling cap), which is the main lever for keeping cost and latency bounded on long routes.

**4.3a — FR-018 addition to Phase 2**: both of step 6's Distance Matrix calls include `avoid=tolls` whenever `avoidTolls === true` (the same per-request boolean read in 4.1a). Distance Matrix returns only durations, never steps/road names (confirmed — this is a hard API limitation, not a design choice), so this phase can request toll avoidance for the detour-time math across the whole raw candidate pool cheaply, but **cannot itself verify** whether a specific candidate's leg silently still includes a toll under Google's best-effort semantics (section 1.4's flagged FR-018 caveat). That verification, where it happens at all, is deferred to the small final candidate set in section 4.6 (Phase 5), which uses full Directions calls with step data for exactly this reason.

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

**4.4a — FR-021 addition to Phase 3 (retain transit stop/line/direction detail instead of discarding it)**: step 11's parse already walks every step of the transit-mode response; confirmed (see section 1.4) that each `TRANSIT`-mode step includes a `transit_details` object with `line.name`/`line.short_name` (the line/route name or number, FR-021b), `headsign` (the direction of travel identifier, FR-021c), and `departure_stop`/`arrival_stop` (`{name, location}`, FR-021a). In addition to the existing numeric accumulation (`walkTimeMinutes`/`waitTimeMinutes`/`transitTimeMinutes`), step 11 now also captures, from the **first** `TRANSIT` step's `departure_stop`/`line`/`headsign` (the drop-off boarding stop) and the **last** `TRANSIT` step's `arrival_stop`/`line`/`headsign` (the passenger's destination arrival/alighting stop): a `boardingStop: TransitStopDetail` and `arrivalStop: TransitStopDetail` (section 5.1's `TransitResult` extension). For a walking-only route (DEC-3, no `TRANSIT` steps at all), both are `undefined` — matching FR-021's own text that line/direction don't apply when no transit line exists. This applies to every shortlisted-then-ranked candidate uniformly (FR-021's "not only the top pick" requirement), since it is captured in the same per-candidate parse every candidate already goes through, not a special top-1-only pass.

### 4.5 Phase 4 — Ranking, tie-break, fallback (FR-010, FR-011, FR-012, FR-013)
14. Among evaluated candidates with `qualifies=true` and `noTransitAvailable=false`:
    - Sort ascending by `passengerTotalTimeMinutes`.
    - Tie-break: candidate with the **lower route-order index** (earlier on the driver's route) ranks higher (FR-010, resolved OQ-2).
    - Return the top `MAX_CANDIDATES_RETURNED` (default 3) with `status: "ranked"`.
15. If step 14's qualifying set is empty:
    - Among *all* evaluated candidates (qualifying or not) with `noTransitAvailable=false`, pick the single smallest `passengerTotalTimeMinutes` (FR-011, resolved OQ-3 — smallest passenger transit time, not smallest detour or distance).
    - Return that one candidate with `status: "fallback"` and a warning that it exceeds the requested detour threshold (FR-011, displayed per FR-013/FR-014).
16. If **no** evaluated candidate has a viable transit itinerary at all (every shortlisted candidate is `noTransitAvailable=true`), return `status: "no_viable_option"` with a clear message (FR-012), no candidates.

**Provider call accounting per user submission** (used for the cost estimate in section 3 and the latency analysis in section 6): 3 geocodes (if not already client-resolved) + 1 direct route + up to `2 * ceil(MAX_RAW_CANDIDATES_SAMPLED / DISTANCE_MATRIX_BATCH_SIZE)` (default: 2, since 20 ≤ 25) + up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8) + up to `MAX_CANDIDATES_RETURNED` (default 3, or 1 for a fallback result) reverse-geocode calls for final candidate labels (section 3.1b) = **~14-17 calls per submission** at default config. **(2026-07-12 addition, FR-019)**: when `avoidTolls === false`, add up to `2 * (MAX_CANDIDATES_RETURNED or 1)` Directions-with-steps calls for section 4.6's toll re-entry check (default config: up to 6 additional calls) = **~20-23 calls per submission** in the tolls-allowed path. See section 3.5 for the free-tier ceiling impact of this addition.

### 4.6 Phase 5 — Toll re-entry detection and confirmation (FR-019, conditional on `avoidTolls === false`)

This phase runs after Phase 4 (section 4.5) produces a `ranked` or `fallback` result, and only when `avoidTolls === false` (per FR-019's explicit scope — when tolls are avoided entirely, no toll segment can exist to exit/re-enter, so this phase is skipped and the Phase 4 result is returned as-is). It does not run for `no_viable_option`/`no_toll_free_route` (nothing to check).

1. For each candidate in Phase 4's final result set (the ranked top `MAX_CANDIDATES_RETURNED`, or the single fallback candidate — the same small, already-labeled set section 3.1b's reverse-geocoding uses, not the full raw/shortlist pool), issue 2 Directions calls **with steps retained** (same shape as 4.1a's `DirectionStep[]`): `start -> candidate` and `candidate -> driverDestination`. Concatenate the two step lists in order (this is the actual as-driven route via the stop, which can differ from Phase 0's non-stop baseline route — this is precisely why a via-point-specific check is needed rather than reusing Phase 0's baseline steps).
2. Run `analyzeTollUsage(concatenatedSteps)` (section 4.7). If it reports `hasExitReentry: true`, mark the candidate `needsTollReentryConfirmation: true` in the response (section 5.2) and include a short, factual description of the pattern (e.g., naming the toll road matched) for the frontend to present as FR-019's question.
3. **The response is returned to the frontend with these flags present, not auto-excluded.** The user is asked FR-019's question for every flagged candidate (see the flow note below). Their answer(s) are submitted via a new endpoint, `POST /api/drop-off-search/confirm-toll-reentry` (section 5.2), carrying the original request plus the set of candidates the user found unacceptable.
4. That endpoint excludes the rejected candidate(s) from the previously-fully-evaluated candidate pool (already computed and available to reconstruct — no re-fetching of driving/transit data for already-evaluated candidates) and re-runs `Ranker.rank` (section 4.5) over the reduced pool, per OQ-10's "exclude entirely, no targeted recalculation, re-apply normal FR-010/FR-011/FR-012 handling" resolution. **If a newly-promoted candidate (one that entered the top-`MAX_CANDIDATES_RETURNED`/fallback slot only because a rejected candidate vacated it) was not previously checked for toll re-entry**, it is checked now (2 more Directions-with-steps calls) before the confirm response is returned — this can, in principle, surface a *new* re-entry question on the newly-promoted candidate.

**Flagged as a genuine UX/flow decision, not resolved here (see section 1.4)**: step 4's "a newly-promoted candidate might itself need a follow-up question" is where the interaction model choice matters most. Tech-lead's recommended default, designed into the two-endpoint contract above, is: **ask about every initially-flagged candidate in a single batch on the first response** (not one at a time, not paused mid-computation), and support **exactly one confirm round-trip** — if a promoted replacement also needs confirmation, surface it in the confirm endpoint's own response (which has the same shape as the search response, so the frontend can show a second, smaller confirmation round using the identical UI component) rather than an unbounded chain. This keeps the protocol stateless (no server-side session/candidate-pool persistence between the two calls — the client resends the original `DropOffSearchRequest` each time, per NFR-003) and bounds worst-case latency to two request/response round-trips rather than an open-ended one. **This is a recommendation for designer (ux-spec.md, a new screen/interaction for the question) and/or the user to confirm, not a decision tech-lead is making unilaterally** — alternatives (asking upfront/hypothetically before any computation, or a fully sequential one-candidate-at-a-time flow) were considered and are described in the orchestrator's brief; the batch/one-round-trip design above is recommended specifically because it fits this app's existing stateless architecture with the least new surface area, but the exact wording, presentation, and whether a second round is acceptable UX are business/design calls.

### 4.7 Technical basis and known limitations of toll/highway detection (FR-018, FR-019, FR-020)

Honest assessment, not a claim of certainty — flagged in section 1.4 for pm/user awareness:

- **No structured toll or road-classification data exists in the Legacy Directions/Distance Matrix API responses.** There is no `is_toll_road` field, no `road_type`/`highway_classification` field, and no per-leg "this route used a restricted feature" flag anywhere in either API's documented response shape. The only data available is `steps[].html_instructions` (an HTML-formatted turn-by-turn instruction string that often, but not reliably in every step, names the road, e.g. `"Merge onto <b>ON-401 E</b> via the ramp to Toronto/Ottawa"`) and `steps[].maneuver` (turn/ramp/fork/merge type — useful for detecting ramp-style transitions but not road identity on its own).
- **`analyzeTollUsage(steps)` (new module, section 5.1)**: strips HTML tags from each step's `instructionsHtml` and pattern-matches the resulting text against a **fixed, code-level, Toronto-region-specific toll-road identifier list** (currently just Highway 407 / "407 ETR" / "ON-407" / "Express Toll Route" — the only significant tolled highway in the service region; there are no other material toll roads/bridges in the ~200km Toronto radius at the time of writing). Walks the ordered step list tracking an "on toll road" boolean; a transition from on→off→on (a run of matching steps, then a run of non-matching steps, then another run of matching steps) is `hasExitReentry: true`. This is a **text-pattern heuristic**, not a geometric/topological analysis of the actual road network — it can miss a re-entry if intermediate step text happens to still (or no longer) reference the highway name inconsistently, and per FR-018/1.4's caveat, it cannot detect a toll road with no name pattern in this list.
- **`isLimitedAccessHighway(stepInstructionsHtml)` (new module, section 5.1)**: same HTML-stripping approach, matched against a **fixed, code-level, curated allowlist** of Toronto-region limited-access freeway identifiers: the 400-series highways (400, 401, 402, 403, 404, 405, 406, 407, 409, 410, 412, 416, 417, 427), the QEW, the Don Valley Parkway (DVP), and the Gardiner Expressway. This list is deliberately an **allowlist of known limited-access designations**, not a broad "contains the word Highway" match — FR-020 explicitly warns that arterial roads with "Highway" in their official name (e.g., Highway 7, Highway 2, Highway 27's arterial sections) must NOT be excluded, so those are deliberately absent from the pattern list.
- **Both business-rule pattern lists are fixed code constants, not config/environment-variable entries** — per `docs/requirements.md`'s explicit note that FR-018 through FR-021 introduce no new Configuration entries, and that the highway/transit-display rules are "fixed business rules, not user-configurable values." Updating either list (e.g., adding a newly-discovered toll road, correcting a false positive/negative found in production) is a code change reviewed like any other business-rule constant, not an operator-configurable tunable.
- **Recommendation**: treat both mechanisms as "best current approximation given the data the chosen provider actually exposes," ship them with this explicit caveat documented (this section, plus user-facing copy that never overclaims precision — a designer/ux-spec.md concern), and monitor for reported false positives/negatives post-launch as a normal maintenance item, not a sign the mechanism is broken.

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
  googleMapsJsApiKey: string;       // FR-022 (2026-07-12): DISTINCT from mapApiKey -- see
                                    // section 7's rationale. Intentionally exposed to the
                                    // browser via PublicConfig (below); restricted in Google
                                    // Cloud Console by HTTP referrer + Maps JavaScript API
                                    // only, never granted Directions/Distance
                                    // Matrix/Geocoding/Transit access.
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
// (2026-07-12, FR-018/FR-020): `avoidTolls` added as an explicit 3rd
// parameter, following the same precedent as `maxDetourMinutes` on
// DetourEvaluator.batchEvaluate below -- it is per-request user input (the
// FR-018 checkbox), never an AppConfig field. `DirectRouteResult` gained
// `steps`, previously fetched by every call and silently discarded; this is
// new *data retention*, not a new provider call (section 4.1a).
interface RoutingService {
  getDirectRoute(start: LatLng, dest: LatLng, avoidTolls: boolean): Promise<DirectRouteResult>;
}
interface DirectRouteResult {
  durationMinutes: number;
  polyline: LatLng[];
  steps: DirectionStep[];
}
// Section 4.7: the only route-shape data Legacy Directions actually
// exposes -- no structured toll/road-classification field exists.
// `instructionsHtml` is Google's raw (HTML-tagged) per-step instruction
// text; both analyzeTollUsage() and isLimitedAccessHighway() (below) strip
// tags before pattern-matching it.
interface DirectionStep {
  instructionsHtml: string;
  distanceMeters: number;
  cumulativeDistanceMeters: number;
  maneuver?: string;
}

// distanceMatrixService.ts (googleDistanceMatrixService.ts)
// (2026-07-12, FR-018): `avoidTolls` added as a 3rd parameter, same
// per-request-input precedent as above. Distance Matrix has no steps/road
// data in its response (section 4.7) -- this parameter only affects the
// returned durations, it cannot be used to verify toll-freeness.
interface DistanceMatrixService {
  getDurationsMinutes(origins: LatLng[], destinations: LatLng[], avoidTolls: boolean): Promise<ElementDurationMinutes[][]>;
}
type ElementDurationMinutes = number | null;

// candidateGenerator.ts
// (2026-07-12, FR-020): `steps` added as a 2nd parameter -- the same
// DirectionStep[] RoutingService.getDirectRoute now returns (section 4.1a),
// needed to attribute each raw candidate to its enclosing step and drop it
// if isLimitedAccessHighway() matches (section 4.2a). Not sourced from
// config; it is per-request data from the same Phase 0 call.
interface CandidateGenerator {
  sampleAlongPolyline(polyline: LatLng[], steps: DirectionStep[], config: CandidateSamplingConfig): RawCandidate[];
}
// Narrowed per REV-011 -- only the fields Phase 1's sampling/radius-drop
// logic (section 4.2) actually reads.
type CandidateSamplingConfig = Pick<
  AppConfig,
  "candidateSpacingMeters" | "maxRawCandidatesSampled" | "geographicCenter" | "geographicRadiusKm"
>;
interface RawCandidate { point: LatLng; routeOrderIndex: number }

// tollHighwayRules.ts (new, 2026-07-12 -- FR-018/FR-019/FR-020, section 4.7)
// Fixed business-rule constants, deliberately NOT config/env entries per
// requirements.md's explicit note. Pure functions, framework-agnostic, unit
// testable without any provider mock.
function analyzeTollUsage(steps: DirectionStep[]): { usesTollRoad: boolean; hasExitReentry: boolean };
function isLimitedAccessHighway(step: DirectionStep): boolean;

// detourEvaluator.ts
// (2026-07-12, FR-018): `avoidTolls` added as an explicit parameter,
// positioned after `maxDetourMinutes` and before `config`, following the
// same "per-request input, not an AppConfig field" precedent this
// interface already established for maxDetourMinutes.
interface DetourEvaluator {
  batchEvaluate(
    start: LatLng, dest: LatLng, directDriveTimeMinutes: number,
    candidates: RawCandidate[], maxDetourMinutes: number, avoidTolls: boolean, config: DetourEvaluationConfig
  ): Promise<EvaluatedCandidate[]>;
}
// Narrowed per REV-011 -- batchEvaluate only reads the batch-size tunable
// off config; maxDetourMinutes/avoidTolls are separate, per-request user
// input (see the 2026-07-11 and 2026-07-12 changelog entries on these
// parameters), not AppConfig fields.
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
  // (2026-07-12, FR-021): captured from the first/last TRANSIT step's
  // transit_details (section 4.4a) -- undefined for a walking-only route
  // (DEC-3, no TRANSIT steps at all), per FR-021's own text that
  // line/direction don't apply when no transit line exists.
  boardingStop?: TransitStopDetail;
  arrivalStop?: TransitStopDetail;
}
// (2026-07-12, FR-021a/b/c): stop name/location, line/route name, and
// headsign/direction -- confirmed present on Google's transit-mode
// Directions response's transit_details (section 1.4/4.4a), not an
// assumption.
interface TransitStopDetail {
  name: string;
  location: LatLng;
  lineName: string;
  headsign: string;
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

// tollReentryChecker.ts (new, 2026-07-12 -- FR-019, section 4.6/Phase 5)
// Runs only over the small final (ranked/fallback) candidate set, never the
// raw/shortlist pool -- section 3.5's cost accounting depends on this scope
// being small. `routingService` is the same RoutingService instance used
// elsewhere (start->candidate and candidate->dest calls, WITHOUT avoid=tolls
// -- this phase only runs when avoidTolls===false per FR-019's own scope).
interface TollReentryCheckResult {
  needsTollReentryConfirmation: boolean;
  description?: string; // factual, e.g. "exits and re-enters Highway 407"
}
function checkTollReentry(
  routingService: RoutingService,
  start: LatLng,
  candidate: LatLng,
  driverDestination: LatLng,
): Promise<TollReentryCheckResult>;
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
    avoidTolls: boolean;      // (2026-07-12, FR-018) per-session checkbox, default false, no server default/config
  }

  // Response
  // (2026-07-12 note, opportunistic doc-sync while editing this block: this
  // listing had also drifted from shipped code independently of FR-018-022 --
  // `disclaimer` is actually optional and `"timeout"` (INC-7) was missing
  // from `status`. Both corrected below alongside the FR-018-022 additions;
  // not a new-scope change, just closing a pre-existing stale-doc gap while
  // already touching this exact block.)
  interface DropOffSearchResponse {
    status:
      | "ranked" | "fallback" | "no_viable_option" | "out_of_service_area" | "invalid_input" | "timeout"
      | "no_toll_free_route"; // (2026-07-12, FR-018/OQ-9) new -- section 4.1a
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
      // (2026-07-12, FR-021) undefined for a walking-only candidate (DEC-3) --
      // section 4.4a/5.1's TransitStopDetail.
      boardingStop?: { name: string; location: { lat: number; lng: number }; lineName: string; headsign: string };
      arrivalStop?: { name: string; location: { lat: number; lng: number }; lineName: string; headsign: string };
      // (2026-07-12, FR-019) present only when avoidTolls===false and
      // section 4.6's check found an exit/re-entry pattern for this
      // candidate's actual driven route.
      needsTollReentryConfirmation?: boolean;
      tollReentryDescription?: string;
    }>;
    warning?: string;       // present when status === "fallback" (FR-011)
    message?: string;       // present for out_of_service_area / no_viable_option / invalid_input / timeout / no_toll_free_route (FR-004, FR-012, FR-003, FR-018)
    disclaimer?: string;    // present when candidates.length > 0 (FR-014)
    requestId: string;
    timingMs: number;       // for QA to verify NFR-004 empirically
    route?: Array<{ lat: number; lng: number }>; // INC-9: driver's direct-route polyline, for the map view. Present exactly when candidates.length > 0 ("ranked"/"fallback"), mirroring `disclaimer`'s presence rule. Reuses the polyline already decoded from `RoutingService.getDirectRoute` for the same request — no new provider call.
  }
  ```

Validation ordering inside `/api/drop-off-search` (fail fast, cheapest checks first, per FR-003/FR-004): (1) shape/type validation of the 4 pre-existing inputs plus `avoidTolls` → `invalid_input`; (2) radius check on `start` and `driverDestination` only (resolved DQ-1 — `passengerDestination` is exempt) → `out_of_service_area`; (3) proceed to section 4's algorithm, which itself may short-circuit to `no_toll_free_route` (section 4.1a, OQ-9) before Phase 1 ever runs.

- **`POST /api/drop-off-search/confirm-toll-reentry`** (new, 2026-07-12 — FR-019/OQ-10, section 4.6's Phase 5):
  ```ts
  interface ConfirmTollReentryRequest {
    // The identical original request -- this app remains fully stateless
    // (NFR-003); no server-side candidate-pool session is kept between the
    // two calls.
    originalRequest: DropOffSearchRequest;
    // The candidate location(s) the user found the toll re-entry pattern on
    // unacceptable for (OQ-10: excluded entirely, no targeted recalculation).
    rejectedCandidateLocations: Array<{ lat: number; lng: number }>;
  }
  // Same shape as DropOffSearchResponse above (including the possibility
  // that a newly-promoted candidate now itself carries
  // needsTollReentryConfirmation: true, per section 4.6 step 4's flagged,
  // not-yet-designer/user-confirmed recommendation of one bounded
  // confirm round-trip rather than an open-ended chain).
  type ConfirmTollReentryResponse = DropOffSearchResponse;
  ```
  This endpoint re-derives the search deterministically from `originalRequest` (re-running the full section 4 pipeline is acceptable cost-wise since it only happens on this rarer confirm path, not the common case) and then applies the exclusion + re-rank described in section 4.6. **This endpoint's existence and exact request/response shape is a technical recommendation, not a finalized UX contract** — see section 1.4/4.6's explicit flag to designer/user on the interaction model this endpoint is meant to support.

---

## 6. NFR-004 latency feasibility analysis (5-second target)

### 6.1 Critical path under the design above (typical case, default config)
1. Geocoding (if needed) — 3 calls in parallel, ~0.2-0.4s.
2. Direct route call — ~0.3-0.5s (needed before candidate sampling can start; sequential dependency).
3. Batched Distance Matrix calls (2, in parallel) — ~0.5-0.9s.
4. Transit evaluation fan-out — up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (default 8) calls in parallel, bounded by `PROVIDER_CONCURRENCY_LIMIT` — this is typically the slowest and most variable leg; transit itinerary computation with transfers tends to run 0.7-1.5s+ per call, and since these run in parallel the wall-clock cost is roughly the slowest straggler, not the sum — ~1.0-2.0s typical.

**Typical-case total: roughly 2.5-4.0s.** Within the 5s target, but with limited margin.

**(2026-07-12 addition, FR-019)**: when `avoidTolls === false`, section 4.6's Phase 5 toll re-entry check adds one more sequential step *after* step 4 above (it runs on Phase 4's ranked/fallback output, so it cannot overlap with the earlier steps): up to `2 * (MAX_CANDIDATES_RETURNED or 1)` Directions-with-steps calls, run in parallel across the small final candidate set (bounded by `PROVIDER_CONCURRENCY_LIMIT` like every other fan-out in this design) — roughly **+0.3-0.6s** typical, tightening the already-limited margin against the 5s soft target. This is a genuine, if modest, latency cost of FR-019 that section 6.3's existing soft-target/graceful-degradation posture already covers (no new mechanism needed), but is flagged here since it further erodes NFR-004's margin — worth pm/user awareness alongside the cost impact already flagged in section 3.5.

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
| `GOOGLE_MAPS_JS_API_KEY` | string | none (required if FR-022's map view is enabled) | **no — see rationale below; distinct from `MAP_API_KEY`** | FR-022 (2026-07-12): loads Google's Maps JavaScript API client-side for the Results-screen map (replaces INC-9's Leaflet implementation) |
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
| `MAP_TILE_URL_TEMPLATE` | string \| null | `null` — ships in `.env.example` pre-filled with CARTO's free keyless "Positron" basemap (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`) | no | **Superseded by FR-022 (2026-07-12) — see note below the table.** XYZ tile URL template for INC-9's now-being-replaced Leaflet map view (section 3.1a/10). |
| `MAP_TILE_ATTRIBUTION` | string \| null | `null` — ships in `.env.example` pre-filled with CARTO/OpenStreetMap's required attribution text | no | **Superseded by FR-022 (2026-07-12) — see note below the table.** Attribution text/HTML required by OSM-family tile providers' license terms, rendered in Leaflet's built-in attribution control. |

`MAX_DETOUR_THRESHOLD_INPUT` is intentionally **not** in this table — confirmed in requirements as user-entered per session, no config default. No new config keys are introduced by FR-018/FR-019/FR-020/FR-021 (confirmed per `requirements.md`'s explicit note — the toll checkbox/re-entry-answer are per-request inputs like `maxDetourMinutes`/`avoidTolls` above, and the highway/toll pattern lists (section 4.7) are fixed business-rule code constants, deliberately not operator-tunable).

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

### 7.2 `GOOGLE_MAPS_JS_API_KEY` — security/config recommendation (2026-07-12, FR-022)

**Recommendation: a new, distinct config key, NOT a reuse of `MAP_API_KEY`.**

- **Different threat model, not just a different value.** `MAP_API_KEY` is called exclusively server-side (section 2's "all provider calls happen server-side" architecture) and is never sent to the browser — its blast radius, if it were ever restricted incorrectly, is contained to whatever this app's own backend does with it. Google's Maps JavaScript API, by contrast, is loaded via a client-side `<script src="...&key=...">` tag (or the newer dynamic `importLibrary` loader) — the key is necessarily visible to anyone who opens browser dev tools or views the page source. This is expected/normal for this specific Google product (Maps JS API keys are designed to be used client-side), but it means the *correct* restriction mechanism in Google Cloud Console is different: **HTTP referrer restriction** (limit the key to this app's actual production/preview domain(s)) rather than an IP-based restriction, which is the natural fit for a server-only key like `MAP_API_KEY` calling from a known set of egress addresses (or, in practice on serverless hosting with dynamic egress IPs, whatever restriction the release runbook already specifies for it — unaffected by this change).
- **Google Cloud Console keys generally support only one "application restriction" type at a time** (IP address, OR HTTP referrer, OR Android/iOS app — not IP-and-referrer simultaneously) — reusing `MAP_API_KEY` for both purposes would force a choice between the restriction that's correct for server-side calls and the one that's correct for browser-side calls, weakening one or the other. Distinct keys let each be restricted correctly for its actual usage.
- **Blast-radius containment.** If `GOOGLE_MAPS_JS_API_KEY` is extracted from the browser (expected, unavoidable for this product) and it were the *same* key as `MAP_API_KEY`, an attacker could use it directly against Directions/Distance Matrix/Geocoding/Transit — APIs this app's own cost-control levers (`MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, `DISTANCE_MATRIX_BATCH_SIZE`, etc.) have no ability to govern once the key is used outside this app's own request pipeline, and NFR-007 already accepts no rate-limiting on this app's own free-tier surface, meaning there is no independent backstop either. With a **distinct** key, restricted (in Google Cloud Console, an operational/runbook task, not a design mechanism) to **API restriction: Maps JavaScript API only** and **application restriction: HTTP referrer**, the same extraction only exposes "someone can load Google's map widget attributed to this billing account from an unauthorized site" — a bounded, Dynamic-Maps-SKU-only nuisance/cost risk (itself already assessed as low-cost per section 3.5's ~10,000-free-loads/month allotment), not a path to burning through the Directions/Geocoding/Transit free-tier ceilings this app's core functionality depends on, nor an unbounded pay-as-you-go bill in `paid_tier` mode.
- **Config/architecture implication**: `googleMapsJsApiKey` is added to `AppConfig` (section 5.1) but, unlike `mapApiKey`/`paidTierAccessPassword`, it is **intentionally included in `PublicConfig`** (`GET /api/config/public`'s response) — this is the first and only Google credential in this app designed to reach the browser. This is a deliberate architecture note, not an oversight or a violation of section 2's "provider calls happen server-side" principle: that principle still holds for every *other* Google API this app calls (Directions, Distance Matrix, Geocoding, Transit all remain server-side-only via `mapApiKey`), and Maps JavaScript API rendering is the one narrow, Google-sanctioned exception where client-side key exposure is the product's own intended usage pattern, contained via the restriction scheme above.
- **Required whenever FR-022's map view is enabled** (parallel to how `mapTileUrlTemplate`/`mapTileAttribution` were optional/nullable for INC-9's conditional map view) — recommend keeping the same "nullable, frontend omits the map panel gracefully if unset" pattern rather than a hard `ConfigError`, since designer/pm may still want the map view to degrade gracefully in an environment where this key hasn't been provisioned yet.
- **Cleanup**: `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` (Leaflet-specific, INC-9) become obsolete once FR-022 ships — dev should remove them from `AppConfig`/`PublicConfig`/`.env.example` as part of the increment that retires `MapView.tsx`'s Leaflet implementation (section 10, INC-10), not leave them as dead config alongside the new key.

---

## 8. Frontend contract (functional, not visual — visual/UX detail belongs to designer's ux-spec.md)

Required states the UI must be able to render, driven directly by `DropOffSearchResponse.status`:
- `ranked` — up to `maxCandidatesReturned` result cards, each showing the full FR-013 breakdown.
- `fallback` — single result card + visible warning banner (FR-011, FR-013).
- `no_viable_option` — message, no cards (FR-012).
- `out_of_service_area` — message referencing the configured radius, no computation attempted (FR-004).
- `invalid_input` — field-level error messaging (FR-003).
- `timeout` (see section 6.3) — message distinct from the above, inviting retry.
- `no_toll_free_route` (2026-07-12, FR-018/OQ-9) — message-only/empty-result state, same treatment as `no_viable_option` (section 4.1a).
- Persistent disclaimer (FR-014) rendered whenever `candidates.length > 0`, regardless of status.
- Password-gate screen when `appMode === "paid_tier"` and no valid session cookie exists yet (FR-016/017).
- Three location inputs each supporting typed-address-with-autocomplete and "use my current location" (FR-015), on mobile-responsive layout (NFR-001).
- **(2026-07-12, FR-018)** An "avoid tolls" checkbox on the Input screen, per-session/per-submission, default unchecked, no persistence (NFR-003) — visual/interaction detail belongs to designer's ux-spec.md.
- **(2026-07-12, FR-019)** A new confirmation interaction, presented only when one or more returned candidates carry `needsTollReentryConfirmation: true` — **exact presentation (batch vs. sequential, screen placement, copy) is not specified here; flagged to designer/user, see sections 1.4 and 4.6.** Functionally, the UI must be able to: display each flagged candidate's `tollReentryDescription`, collect an accept/reject answer per flagged candidate, and submit the rejected set to `POST /api/drop-off-search/confirm-toll-reentry`, then render its response (same shape/states as above, including the possibility of a second, smaller confirmation round).
- **(2026-07-12, FR-021)** Every candidate card (not only the top-ranked one) must render `boardingStop`/`arrivalStop` (name, line, direction) when present, and omit that section gracefully for a walking-only candidate (`boardingStop`/`arrivalStop` both `undefined`) rather than showing an empty/broken line-name field.
- **(2026-07-12, FR-022)** The Results-screen map renders via Google's Maps JavaScript API (client-side, using `googleMapsJsApiKey` from `GET /api/config/public` — section 7.2), not Leaflet. Functional contract (route polyline + candidate markers + tap-to-highlight) is unchanged from INC-9's existing `MapView` component contract; only the underlying rendering library/credential changes.

---

## 9. Assumptions and known limitations (not blocking, documented for traceability)

- Radius edge case for candidates briefly outside the service circle on a route between two in-radius points: resolved as "exclude that candidate point" (section 4.2, step 4) — an implementation detail, not a business ambiguity.
- Live transit data quality/coverage will vary at the edges of the 200km radius (smaller regional agencies with weaker GTFS-RT feeds) — this is idea-brief risk #3, inherent to the chosen provider's data sources, not something this design can fully resolve; no action taken beyond documenting it.
- Safety/legality of a candidate drop-off point (idea-brief risk #1) is out of scope for v1 per requirements; addressed only via the FR-014 disclaimer.
- Operational log retention for request-scoped coordinate data (NFR-003 adjacent) — flagged to release for `docs/runbook.md`, not a design mechanism itself.
- **(2026-07-12)** Toll-road/highway detection (FR-018/FR-019/FR-020) is text-pattern-matching against a fixed, Toronto-region-specific identifier list, not a geometric/topological road-classification data source (neither Directions nor Geocoding exposes one) — see section 4.7 for the full honest assessment and section 1.4 for the pm/user-facing flags this implies.

---

## 10. Increment plan (INC-1..9 delivered/closed per Phase 4; INC-10..14 added 2026-07-12 for FR-018–FR-022)

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

---

**INC-10 through INC-14 below cover FR-018–FR-022 (2026-07-12 change request).** Dependency note: INC-10, INC-11, and INC-12 are mutually independent and independent of INC-13/14 — any order among them is fine, and they can be built in parallel by different dev sessions if useful. INC-13 must precede INC-14 (INC-14 reuses INC-13's `avoidTolls` plumbing and the shared `tollHighwayRules.ts` module). **Gate 3 for this extension passed 2026-07-13 (see the top-of-file status line and section 1.4); INC-14's former designer/user interaction-model block is resolved** — see its own entry below, section 1.4, and `docs/ux-spec.md` §5a.

### INC-10: Google Maps JavaScript API rendering (FR-022)
- Add `GOOGLE_MAPS_JS_API_KEY` config (section 7.2 — new, distinct from `MAP_API_KEY`, intentionally exposed via `GET /api/config/public`). Retire `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` (Leaflet-specific, now obsolete) from `AppConfig`/`PublicConfig`/`.env.example`.
- Rewrite `src/frontend/components/MapView.tsx` using Google's Maps JavaScript API (client-side loader) instead of Leaflet — same functional contract as today's component (route polyline, per-candidate markers, `variant`/`highlightedRank` styling, `onSelectCandidate` tap-to-highlight callback). No change to candidate computation, ranking, or the data displayed (per FR-022's own text) — this is a rendering-library swap only.
- **Covers**: FR-022.
- **QA can test**: map renders via Google's JS API (network tab shows a `maps.googleapis.com/maps/api/js` request using `googleMapsJsApiKey`, not `mapApiKey`); confirm `mapApiKey`'s actual value never appears in any browser-visible request or page source (the server-side key stays server-side); functional parity with the retired Leaflet version (markers, highlight-on-tap, route polyline, graceful omission when the key is unset); confirm in Google Cloud Console (release/runbook task, not a QA-testable code assertion) that the new key is restricted to HTTP referrer + Maps JavaScript API only, per section 7.2's recommendation.

### INC-11: Highway-exclusion candidate filtering (FR-020)
- Extend `RoutingService.getDirectRoute` / `DirectRouteResult` to retain `steps: DirectionStep[]` (section 4.1a/5.1) instead of discarding them after polyline decoding.
- Extend `CandidateGenerator.sampleAlongPolyline` to accept `steps` and drop any raw candidate whose enclosing step matches the new `isLimitedAccessHighway()` (section 4.2a/4.7, new `tollHighwayRules.ts` module — this increment only needs the highway half of that module; the toll half, `analyzeTollUsage`, ships in INC-13).
- **Covers**: FR-020.
- **QA can test**: a candidate sampled on a known 400-series-highway/QEW/DVP stretch of a real or fixture route is excluded before ranking; a candidate on an arterial road whose official name contains "Highway" (e.g., a fixture route including "Highway 7") is correctly **not** excluded (the false-positive guard FR-020 explicitly requires); confirm zero new provider calls are introduced (steps come from the already-fetched Phase 0 call, verified via call-count assertion, same technique already used for the existing `route` field's INC-9 verification); a route where every raw candidate is excluded correctly falls through to the existing FR-012 `no_viable_option` path, not a new/different empty state.

### INC-12: Full transit stop/line/direction detail capture and display (FR-021)
- Extend `parseTransitRoute()`/`TransitResult` (section 4.4a/5.1) to capture `boardingStop`/`arrivalStop` (`TransitStopDetail`: name, location, line name, headsign) from the first/last `TRANSIT` step's `transit_details`, instead of discarding this data after the numeric walk/wait/transit accumulation.
- Extend `DropOffSearchCandidate`/`DropOffSearchResponse` (section 5.2) and `ResultsScreen.tsx`'s candidate cards to render both stops' name/line/direction for **every** displayed candidate, not only the top-ranked one (FR-021's explicit requirement) — omitted gracefully (no broken/empty line-name field) for a walking-only candidate (DEC-3).
- **Covers**: FR-021.
- **QA can test**: against a constructed multi-transfer fixture, `boardingStop` equals the *first* transit step's departure stop/line/headsign and `arrivalStop` equals the *last* transit step's arrival stop/line/headsign (not an intermediate transfer stop); every candidate card in a multi-candidate `ranked` response shows this data, not only rank 1; a walking-only candidate's card omits both fields without a layout break.

### INC-13: "Avoid tolls" checkbox, hard exclusion (best-effort), and no-toll-free-route message (FR-018)
- Frontend: "avoid tolls" checkbox on the Input screen (default unchecked, no persistence per NFR-003 — visual/interaction detail is designer's ux-spec.md, this increment only needs the functional wiring).
- Thread `avoidTolls: boolean` through `DropOffSearchRequest` → `RoutingService.getDirectRoute` → `DistanceMatrixService.getDurationsMinutes` → `DetourEvaluator.batchEvaluate` (section 4.1a/4.3a/5.1) — every driving-mode call includes `avoid=tolls` when checked.
- New `tollHighwayRules.ts`'s `analyzeTollUsage()` (section 4.7), used here for its `usesTollRoad` half: run against the direct-baseline route's steps when `avoidTolls===true`; if it still matches a known toll-road pattern, short-circuit to `status: "no_toll_free_route"` (section 4.1a, OQ-9) before Phase 1 runs.
- **Covers**: FR-018.
- **Resolved before this increment starts** (section 1.4, DEC-5, `docs/requirements.md` §5): the user confirmed that "best-effort avoidance + verification only at the baseline-route level (plus final candidates, section 4.6)" is an acceptable implementation of FR-018's "must never be returned" language; no migration to a stronger (costlier) approach was requested. No longer a blocking flag.
- **QA can test**: `avoid=tolls` confirmed present (via mocked-request-URL inspection) on every driving-mode call — direct baseline, both Distance Matrix legs — when the checkbox is checked, and absent when unchecked; a fixture/staging route requiring Highway 407 with no realistic alternative returns `no_toll_free_route`, not a toll-inclusive result; unchecked-checkbox behavior is unaffected (full regression pass against the existing `ranked`/`fallback`/`no_viable_option` suite).

### INC-14: Toll re-entry detection and confirmation flow (FR-019)
- **Unblocked (2026-07-13)**: the interaction-model question (batch vs. sequential question presentation; how many "reject → promote next candidate → re-check" rounds are supported) was routed to designer per the user's explicit instruction and resolved — see `docs/ux-spec.md` §5a (Screen 2a, "Toll Road Check," including its bounded-round-cap handling). Implementation may proceed (this increment still depends on INC-13's `avoidTolls` plumbing and shared `tollHighwayRules.ts` module, per the dependency note above).
- New `tollReentryChecker.ts` (`checkTollReentry`, section 5.1) — for each of Phase 4's final ranked/fallback candidates (when `avoidTolls===false`), 2 Directions-with-steps calls (start→candidate, candidate→destination), concatenated and run through `analyzeTollUsage()`'s `hasExitReentry` half (section 4.6/4.7).
- New endpoint `POST /api/drop-off-search/confirm-toll-reentry` (section 5.2) implementing OQ-10's exclude-and-rerank behavior, including the one-bounded-round-trip handling of a newly-promoted candidate that itself needs confirmation (section 4.6 step 4).
- Frontend: whatever interaction model designer/user confirm, wired to the new endpoint.
- **Covers**: FR-019.
- **QA can test**: `needsTollReentryConfirmation` set only when `avoidTolls===false` and the concatenated start→candidate→destination route genuinely shows an exit/re-entry pattern (not merely toll usage without exit/re-entry, and never when `avoidTolls===true`); the confirm endpoint excludes exactly the rejected candidate(s) and correctly re-derives `ranked`/`fallback`/`no_viable_option` from the remaining pool per OQ-10; a newly-promoted candidate needing its own confirmation is surfaced in the confirm response, not silently dropped or silently included unchecked.

### Traceability summary
- FR-001 → INC-2. FR-002 → INC-3. FR-003 → INC-2. FR-004 → INC-2 (resolved DQ-1: start + driverDestination only). FR-005 → INC-4. FR-006(a-f) → INC-3/4/5/6. FR-007 → INC-3. FR-008 → INC-5. FR-009 → INC-4/6. FR-010 → INC-6. FR-011 → INC-6. FR-012 → INC-6. FR-013 → INC-6. FR-014 → INC-7. FR-015 → INC-2. FR-016/FR-017 → INC-1/INC-8. **FR-018 → INC-13 (2026-07-12). FR-019 → INC-14 (2026-07-12; interaction-model question resolved 2026-07-13, see INC-14's entry and section 1.4). FR-020 → INC-11 (2026-07-12). FR-021 → INC-12 (2026-07-12). FR-022 → INC-10 (2026-07-12).**
- NFR-001 → INC-1/INC-8. NFR-002 → INC-1. NFR-003 → cross-cutting, checked at INC-1 and closed at INC-8. NFR-004 → designed in section 6, validated at INC-7; **re-tightened by FR-019's added latency, section 6.1's 2026-07-12 addition — no new increment, existing soft-target/graceful-degradation mechanism (INC-7) already covers it.** NFR-005 → release prerequisite, before INC-1. NFR-006 → INC-2/INC-8. NFR-007 → accepted risk, no increment (explicitly out of scope per requirements).

No FR/NFR is without design coverage, **including FR-018–FR-022 as of this 2026-07-12 update.** All previously open questions (DQ-1, DQ-2, DQ-3) are resolved as of 2026-07-11; only DQ-4 (billing-alert ops setup) remains, and it is a release/runbook task, not a design gap. **The three pm/user-facing flags raised by this update — (1) FR-018's best-effort-vs-hard-guarantee technical constraint, (2) FR-019's interaction-model decision, (3) FR-020's approximation acceptability — are all resolved as of 2026-07-13: DEC-5 and DEC-6 (`docs/requirements.md` §5) and `docs/ux-spec.md` §5a, respectively. See section 1.4 and this document's top-of-file status line.**

---

## 11. Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-07-10 | Initial design drafted from FINAL requirements.md and approved idea-brief.md; provider recommendation (Google Maps Platform), two-phase candidate/detour/transit evaluation algorithm, config schema, 8-increment plan; DQ-1 through DQ-4 raised for pm/user resolution before Gate 3 | Phase 2 kickoff following Gate 2 approval |
| 2026-07-11 | Resolved DQ-1 (FR-004 radius check applies only to `start`+`driverDestination`, not `passengerDestination` — updated sections 4.1, 5.2, INC-2, traceability); resolved DQ-2 (Google Maps Platform + free-tier estimate confirmed, no changes needed); resolved DQ-3 (5s soft target + graceful timeout confirmed, no changes needed); recorded new user decisions: no upper bound on `maxDetourMinutes` (INC-3), added section 3.1 confirming (a) Leaflet+non-Google-tiles satisfies the "map view must not increase provider cost" condition and (b) Google's Geocoding API can reverse-geocode arbitrary candidate points for card labels (with nearest-match/coarse-label caveats), added `label` field to `DropOffSearchResponse`, added conditional/optional INC-9 (visual map view) to the increment plan; DQ-4 remains open only as a release/runbook dependency, not a design gap | User resolved all open questions from initial draft; incorporating into finalized design for Gate 3 |
| 2026-07-11 | Resolved reviewer findings REV-006 (`[HARDCODED]`)/REV-007 (`[BLOAT]`) from the INC-2 audit: promoted the two literal constants `MIN_QUERY_LENGTH`/`DEBOUNCE_MS` (dev's INC-2 implementation) into the config schema as `MIN_GEOCODE_QUERY_LENGTH` (default 3) and `GEOCODE_DEBOUNCE_MS` (default 300ms) — see new section 7.1 for full rationale. Both exposed via `GET /api/config/public` (section 5.2 updated); `AppConfig` interface updated (section 5.1); added a cost-accounting footnote to section 3 clarifying autocomplete-triggered geocode volume is bounded by these two keys, separate from the per-submission call estimate; updated INC-2's "Covers" line (section 10) to include this as an opportunistic follow-up fix to the already-QA'd/reviewer-cleared increment, not a new increment. Directed dev (in section 7.1) to make backend `AppConfig` the single source of truth for both values, eliminating REV-007's dual-declaration drift risk, while keeping backend enforcement of `MIN_GEOCODE_QUERY_LENGTH` as the real security/cost boundary independent of frontend behavior. | Reviewer (REV-006/REV-007) flagged undocumented hardcoded cost-relevant constants; user confirmed alignment with reviewer's concern, directing tech-lead to make an explicit schema decision rather than leave it implicit |
| 2026-07-11 | Corrected section 5.1's `DetourEvaluator.batchEvaluate` TS interface listing to include the `maxDetourMinutes: number` parameter (positioned after `candidates`, before `config`), matching `src/candidates/detourEvaluator.ts`'s actual signature. Section 4.3 step 8's prose already required this value (the user-supplied FR-002 input) to compute the `qualifies` flag, and it cannot be sourced from `AppConfig` since it is per-request input, not config — the interface listing had simply never been updated to match. No functional/behavioral change; dev's INC-4 implementation (confirmed correct by QA) is unchanged. | Stale-doc gap flagged independently by dev and QA during INC-4; documentation-only correction, no new increment |
| 2026-07-11 | Batch documentation cleanup on section 5.1, pre-INC-5-audit, consolidating four independent items — no behavior/design change, all already-implemented/QA'd/reviewed code: (1) **REV-011**: replaced the generic `AppConfig` config parameter with each module's actual narrowed type — `AuthGate.check(req, config: Pick<AppConfig, "appMode" \| "paidTierAccessPassword">)`, `RadiusValidator.isWithinServiceArea(point, config: RadiusServiceAreaConfig)` (`= Pick<AppConfig, "geographicCenter" \| "geographicRadiusKm">`), `CandidateGenerator.sampleAlongPolyline(polyline, config: CandidateSamplingConfig)` (`= Pick<AppConfig, "candidateSpacingMeters" \| "maxRawCandidatesSampled" \| "geographicCenter" \| "geographicRadiusKm">`), `DetourEvaluator.batchEvaluate(..., config: DetourEvaluationConfig)` (`= Pick<AppConfig, "distanceMatrixBatchSize">`) — reviewer independently assessed this narrowing pattern as good testability/DI practice, not a risk, so the doc now reflects it rather than the illustrative full-`AppConfig` shorthand. (2) Added the missing `FullyEvaluatedCandidate` type definition (`extends EvaluatedCandidate, TransitResult`) that `Ranker.rank`'s signature already referenced but section 5.1 never defined — matches `src/transit/types.ts`'s implementation exactly (dev's completion of an apparent drafting gap, independently confirmed correct by QA). (3) Added `evaluateShortlist.ts`'s fan-out/concurrency-bounding orchestration (`Pick<AppConfig, "transitModesIncluded" \| "providerConcurrencyLimit">` config, bounded by `PROVIDER_CONCURRENCY_LIMIT`) as a named, documented part of section 5.1's architecture — previously only an implicit implementation detail; QA confirmed the concurrency bound is genuinely enforced, not theoretical. (4) Confirmed (no change needed) that section 10's INC-5 "Covers" line correctly attributes only FR-008 (the live-transit-data requirement) and does not misattribute the "no viable transit" case, which has no dedicated FR and is plumbing for INC-6's FR-012 check. **FR/NFR coverage**: unchanged by this pass — FR-005/FR-006b/FR-009 (INC-4), FR-006c/FR-006d/FR-006e/FR-008 (INC-5) remain covered exactly as before; no FR/NFR newly covered or newly gapped. | Reviewer flagged REV-011 (design-gap, stale `AppConfig` listings) at the INC-1 audit, carried forward; dev/QA independently flagged the missing `FullyEvaluatedCandidate` definition and the undocumented `evaluateShortlist` orchestration during INC-5. Consolidated into one documentation-only pass ahead of reviewer's INC-5 audit, per the orchestrator's request — no user approval needed (no design/behavior change, only already-implemented/QA'd/reviewed code being reflected accurately) |
| 2026-07-11 | Documentation cleanup on INC-9, consolidating two independent gaps flagged by dev and QA — no behavior/design change, already-implemented/QA'd code: (1) Added `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` to section 7's config schema table, matching `src/config/schema.ts`'s `mapTileUrlTemplate`/`mapTileAttribution` (`string \| null`) exactly. Marked **optional/nullable**, unlike every other row in the table — deliberately so, since INC-9 (section 10) is a conditional/optional increment no FR/NFR depends on, and requiring every deployment to configure a tile provider just to avoid a config-load failure would contradict that framing. Default recorded as `null`, with `.env.example`'s shipped example value (CARTO's free keyless "Positron" basemap) noted alongside. (2) Added the `route?: Array<{ lat: number; lng: number }>` field to section 5.2's `DropOffSearchResponse` interface listing, matching `src/search/types.ts`'s implementation — present exactly when `candidates.length > 0`, reusing the polyline already fetched by INC-3's existing direct-route call (QA independently confirmed via a call-count assertion that no new provider call is triggered by exposing this field). **FR/NFR coverage**: unchanged — INC-9 covers no FR/NFR directly (enhancement only, per section 10); no FR/NFR newly covered or newly gapped by this pass. | Both gaps flagged independently by dev (handoff.md INC-9 section) and QA (test-report.md INC-9 section) during INC-9; consolidated into one documentation-only cleanup pass per the orchestrator's request — no user approval needed (no design/behavior change, only already-implemented/QA'd code being reflected accurately) |
| 2026-07-11 | Batch documentation cleanup, consolidating two independent stale-doc items flagged by reviewer — no behavior/design change, both already-implemented/QA'd/reviewed code: (1) **REV-011 (remaining 3 of 6 instances)**: section 5.1's `ShortlistSelector.select`, `TransitEvaluator.evaluate`, and `Ranker.rank` still showed an unnarrowed `config: AppConfig` parameter even though the earlier batch pass (previous changelog entry) had already corrected the same pattern for `AuthGate`, `RadiusValidator`, `CandidateGenerator`, and `DetourEvaluator`. Updated all three to their actual narrowed types, matching `src/candidates/shortlistSelector.ts`, `src/transit/types.ts`, and `src/ranking/ranker.ts` exactly: `ShortlistSelector.select(evaluated, config: ShortlistSelectionConfig)` (`= Pick<AppConfig, "maxTransitEvaluationsPerRequest">`), `TransitEvaluator.evaluate(candidate, passengerDestination, departureTime, config: TransitEvaluationConfig)` (`= Pick<AppConfig, "transitModesIncluded">`), `Ranker.rank(fullyEvaluated, maxDetourMinutes, config: RankingConfig)` (`= Pick<AppConfig, "maxCandidatesReturned">`). This closes REV-011 with all 6 known instances of the narrowing pattern now accurately reflected in section 5.1. (2) **REV-016**: section 7's config schema table was missing `SESSION_LIFETIME_SECONDS` (added in INC-8's session-hardening work, `src/config/schema.ts`'s `sessionLifetimeSeconds`), a required, non-hardcoded integer config key controlling the signed session-cookie lifetime for `POST /api/auth/verify-password` (REV-002 remediation, FR-016/017). Added a row: type integer, default 3600 (per `.env.example`'s documented value and `loader.ts`'s fail-fast-if-unset parsing, consistent with every other numeric key in the schema — no in-code fallback), not secret. **FR/NFR coverage**: unchanged by this pass — no FR/NFR newly covered or newly gapped; both fixes bring section 5.1/section 7 into sync with already-shipped, already-tested code. | Reviewer flagged REV-011 (3 remaining instances, introduced at INC-5/INC-6) and REV-016 (INC-8's `SESSION_LIFETIME_SECONDS` missing from the schema table) in the review log; consolidated into one documentation-only cleanup pass per the orchestrator's request — no user approval needed (no design/behavior change, only already-implemented/QA'd/reviewed code being reflected accurately) |
| 2026-07-12 | **Cost-model refresh, section 3**: Google Maps Platform eliminated the universal ~$200/month shared-credit pricing model effective 2025-03-01, replacing it with per-SKU monthly free allotments (Essentials 10,000/Pro 5,000/Enterprise 1,000, per relayed research); the Directions API and Distance Matrix API (this app's driving/detour/transit backbone) are now flagged "Legacy" by Google. Rewrote the free-tier cost analysis: mapped this app's provider calls to their Google SKUs (Geocoding API — forward+reverse geocode+autocomplete, up to 6/submission; Directions API [Legacy] — driving **and** transit calls share one SKU, up to 9/submission, transit dominating at up to 8 of the 9; Distance Matrix API [Legacy] — 2/submission), and recomputed the binding free-submission ceiling as **~550-600 submissions/month** (set by the Directions API SKU), materially down from the prior ~2,000-2,500/month estimate the user confirmed at DQ-2 (2026-07-11) — flagged for pm/user re-confirmation given this revises a previously accepted figure. Added section 3.4, a research/planning-only assessment of migrating `RoutingService`/`DistanceMatrixService` from Legacy Directions/Distance Matrix to the newer Routes API (`Compute Routes`/`Compute Route Matrix`): recommends **not urgent** — migration is bounded in effort (only `googleRoutingService.ts`/`googleDistanceMatrixService.ts` need to change, thanks to existing interface isolation in section 5.1) but does not touch the actual free-tier bottleneck, since transit calls (8 of 9 Directions-SKU calls/submission) have no Routes API equivalent (no transit-mode support) and must remain on Legacy Directions regardless. Updated section 3.1a to flag that its original rationale for choosing Leaflet over Google's Maps JavaScript API — avoiding depletion of the shared credit pool — no longer holds, since Dynamic Maps now has its own separate ~10,000-free-loads/month allotment; cross-referenced to the now-approved FR-022 (Google Maps rendering change request) as a follow-up design task for pm/tech-lead once FR-022 is fully scoped, not redesigned in this pass. **All figures in this update are relayed web research (orchestrator search, Google's pricing pages network-blocked/403 in this sandbox), not independently verified by tech-lead — explicitly flagged in the doc for spot-check by user/release before any production cost commitment.** **FR/NFR coverage**: unchanged — this is a cost/architecture-analysis update, no FR/NFR gained or lost coverage; no code changed. | Orchestrator relayed a live-web-research finding (Google Maps Platform pricing model change + Legacy API flagging) requiring the cost analysis this design's DQ-2-accepted figure rests on to be recomputed; per CLAUDE.md, "docs stay in sync with reality — a stale doc is a bug" |
| 2026-07-12 | **FR-018–FR-022 design pass** (this update). Added section 1.4 (technical assessments and pm/user-facing flags for all five items). Section 3.5 (new): FR-018/FR-019 add up to +6 to +8 Directions-API calls/submission (toll re-entry check, section 4.6), worsening the already-binding ~555-submission/month ceiling — flagged for pm/user re-confirmation; FR-020/FR-021 are cost-neutral; FR-022 draws on its own separate Dynamic Maps allotment. Section 4 additions: **4.1a** (FR-018/FR-020) — `avoidTolls` read from the request, threaded into the Phase 0 Directions call as `avoid=tolls`; the call's `steps[]` are now retained (previously discarded); the OQ-9 "no toll-free route" short-circuit (new `status: "no_toll_free_route"`) checks the baseline route's steps for toll-road patterns. **4.2a** (FR-020) — raw candidates are attributed to their enclosing step and dropped outright if `isLimitedAccessHighway()` matches (hard exclusion before ranking, no new provider call). **4.3a** (FR-018) — `avoidTolls` threaded into both Distance Matrix batch calls; explicitly documents that this phase cannot verify toll-freeness (Distance Matrix has no step data). **4.4a** (FR-021) — the transit-mode parse now retains `boardingStop`/`arrivalStop` (line name, headsign, stop name/location) from the first/last `TRANSIT` step instead of discarding them. **4.6** (new, FR-019) — Phase 5: toll re-entry detection on the small final ranked/fallback candidate set only (2 Directions-with-steps calls per candidate, concatenated start→candidate→destination), a new `confirm-toll-reentry` two-endpoint stateless protocol per OQ-10, and an explicit flag that the exact interaction model (batch vs. sequential question presentation, how many confirm rounds) is a designer/user decision, not decided here — tech-lead's recommended default (batch, one bounded round-trip) is presented as a recommendation only. **4.7** (new) — honest technical assessment: neither Directions nor Geocoding exposes structured toll/road-classification data; both `analyzeTollUsage()` and `isLimitedAccessHighway()` are text-pattern-matching against fixed, Toronto-region-specific code constants (Highway 407/ETR for tolls; the 400-series/QEW/DVP/Gardiner for highways), not a geometric guarantee — flagged as an approximation, with the highway allowlist deliberately curated to avoid the false-positive risk FR-020 itself warns about (arterial roads named "Highway"). Section 5.1: `RoutingService.getDirectRoute`/`DirectRouteResult` gained `avoidTolls`/`steps`/`DirectionStep`; new `DistanceMatrixService` interface documented (previously undocumented in this section, now includes `avoidTolls`); `CandidateGenerator.sampleAlongPolyline` gained a `steps` parameter; new `tollHighwayRules.ts` (`analyzeTollUsage`, `isLimitedAccessHighway`) and `tollReentryChecker.ts` (`checkTollReentry`) modules; `DetourEvaluator.batchEvaluate` gained `avoidTolls`; `TransitResult` gained `boardingStop`/`arrivalStop`/new `TransitStopDetail` type. Section 5.2: `DropOffSearchRequest` gained `avoidTolls`; `DropOffSearchResponse.status` gained `"no_toll_free_route"` (plus, as an opportunistic doc-sync while already editing this exact block, corrected two independent pre-existing stale-doc gaps unrelated to this change request — `disclaimer` was documented as required but has been optional since INC-7, and `"timeout"` (also INC-7) was missing from the `status` union); `DropOffSearchCandidate` gained `boardingStop`/`arrivalStop`/`needsTollReentryConfirmation`/`tollReentryDescription`; new endpoint `POST /api/drop-off-search/confirm-toll-reentry` documented. Section 6.1: added a latency note for FR-019's added Phase-5 calls (~+0.3-0.6s typical), covered by the existing INC-7 soft-target/graceful-degradation mechanism, no new mechanism needed. Section 7: new `GOOGLE_MAPS_JS_API_KEY` config row + new section 7.2 (security/config recommendation: **do not reuse `MAP_API_KEY`** — different threat model, different Google Cloud Console restriction type (HTTP referrer + Maps-JS-API-only vs. server-side), distinct blast radius if extracted from the browser, since this is the first Google credential in this app intentionally exposed to the client); flagged `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` as obsolete once FR-022 ships. Section 8: added frontend-contract bullets for the new checkbox, the new (designer/user-TBD) toll-re-entry confirmation interaction, per-candidate transit-detail rendering, and the Google-Maps-JS map. Section 9: added a bullet cross-referencing section 4.7's approximation caveat. Section 10: retitled; added **INC-10 (FR-022, map rendering)**, **INC-11 (FR-020, highway exclusion)**, **INC-12 (FR-021, transit detail)**, **INC-13 (FR-018, toll avoidance — carries its own pm/user re-confirmation flag on the best-effort-vs-hard-guarantee question)**, **INC-14 (FR-019, toll re-entry — explicitly BLOCKED pending the designer/user flow decision, depends on INC-13)**; updated the traceability summary (FR-018→INC-13, FR-019→INC-14, FR-020→INC-11, FR-021→INC-12, FR-022→INC-10) and NFR-004's entry (re-tightened margin, no new mechanism needed). Also updated the document's top-of-file status line, which had gone stale (still read "DRAFT, ready for Gate 3" despite INC-1..9 having since been built, tested, and Phase-4-closed) — now correctly states the core design is approved/delivered and only the FR-018–FR-022 extension is DRAFT/pending approval. **FR/NFR coverage**: FR-018 (INC-13, flagged), FR-019 (INC-14, blocked), FR-020 (INC-11), FR-021 (INC-12), FR-022 (INC-10) all now have design coverage for the first time; no previously-covered FR/NFR lost coverage. **Three items explicitly NOT decided by tech-lead, flagged for the orchestrator to route onward**: (1) FR-018's best-effort-vs-hard-guarantee acceptability (route to pm→user); (2) FR-019's exact interaction/flow model (route to designer and/or pm→user); (3) FR-020's approximation-based detection acceptability (route to pm→user for awareness/sign-off, though no better alternative exists given the chosen provider's data). | User approved change-request FR-018–FR-022 (`docs/requirements.md`, 2026-07-12); orchestrator directed tech-lead to design the technical approach and produce a new increment plan (INC-10 onward) for all five items, per CLAUDE.md's change-request pipeline (pm updates requirements → tech-lead updates design/increment plan → user approves before dev work starts) |
| 2026-07-13 | **Status-line/approval-metadata correction only — no technical or design content changed.** Dev correctly refused to start INC-10 because the top-of-file status line and section 1.4 still read the FR-018–FR-022 extension as DRAFT/pending, despite the underlying approval having since happened in substance. Corrected: (1) the top-of-file status line, now reading Gate 3 PASSED (2026-07-13), APPROVED; (2) section 1.4, where a resolution note was added at the top and a **RESOLVED** line was appended to each of the FR-018, FR-019, FR-020, and FR-022 bullets, citing the specific closing decision/artifact for each; (3) section 10's dependency note (removed "INC-14 is explicitly blocked..."); INC-13's "flagged before this increment starts" bullet (replaced with "resolved before this increment starts," citing DEC-5); INC-14's header (dropped "— BLOCKED pending a designer/user interaction-model decision") and its first bullet (replaced with an "Unblocked (2026-07-13)" note citing `docs/ux-spec.md` §5a) and its "QA can test (once unblocked)" wording (dropped the parenthetical); (4) the traceability summary's FR-019→INC-14 entry (dropped "blocked," added "resolved 2026-07-13") and the closing "design coverage" paragraph (dropped the FR-019/INC-14 exception carve-out and the "two new pm/user-facing flags... not yet resolved" line, replacing it with a statement that all three flags are now resolved). **Evidence closing the gate, independently verified by tech-lead directly against each owning artifact**: DEC-5 (FR-018 best-effort-with-partial-verification accepted, no Routes API toll add-on requested), DEC-6 (FR-020's allowlist approximation accepted, residual risk acknowledged), and DEC-7 (FR-022's separate `GOOGLE_MAPS_JS_API_KEY` approved) are all recorded, verbatim-consistent with tech-lead's own section 1.4 flags, in `docs/requirements.md` §5; and `docs/ux-spec.md` §5a ("Screen 2a — Toll Road Check") plus its §5.1 loading-screen-reuse note independently confirm designer completed the FR-019 interaction-model design referred to it. **Provenance note on the remaining piece of evidence, flagged transparently per this document's own established practice of labeling orchestrator-relayed information** (see, e.g., section 3's pricing-research caveat, and section 3's 2026-07-12 entry above): the specific claim that the user told the orchestrator "Proceed" on INC-10's kickoff is relayed via the orchestrator's instruction to tech-lead for this update and has not been independently re-verified by tech-lead beyond that relay (tech-lead has no direct channel to the user). This is recorded on the same basis this document has always recorded user decisions relayed via pm/orchestrator — see section 1's DQ-1/DQ-2/DQ-3 resolutions ("resolved by the user, via pm/orchestrator, 2026-07-11") — not a new or lower evidentiary standard introduced by this entry. **FR/NFR coverage**: unchanged — no FR/NFR gained or lost design coverage by this pass; this entry corrects approval-status metadata only, per CLAUDE.md's "docs stay in sync with reality — a stale doc is a bug" rule. | Dev correctly refused to start INC-10 per the pipeline's own rule ("no dev work starts before its gate is passed"), because design.md's own status line had not been updated to reflect that Gate 3 approval had, in substance, already occurred (DEC-5/DEC-6/DEC-7 recorded in `docs/requirements.md`, FR-019's interaction flow completed in `docs/ux-spec.md` §5a, and a direct "Proceed" instruction to the orchestrator). This entry closes that gap so the next agent reading design.md sees accurate, evidenced approval status rather than a stale blocker. |
