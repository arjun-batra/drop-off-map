# Requirements: Drop-off Point Optimizer

Status: FINAL — all open questions resolved, presented for Gate 2 approval.
Source: docs/idea-brief.md (approved, Gate 1 passed 2026-07-10).

## 1. Functional Requirements

### Inputs
- **FR-001**: The system shall accept three location inputs per session: driver's start point, driver's destination, and the family member's (passenger's) destination.
- **FR-002**: The system shall accept a user-supplied maximum acceptable added-detour time, in minutes, entered per session (not a fixed default).
- **FR-003**: The system shall validate that all three input locations resolve to a valid geographic point before computing results, and shall display a clear error message if any location cannot be resolved.
- **FR-004**: If the start or destination point falls outside the configured geographic service radius (see Configuration: `GEOGRAPHIC_RADIUS_KM`), the system shall block the request and display a message stating that the app currently only serves within that radius. The system shall not attempt a best-effort calculation outside the service area.

### Computation
- **FR-005**: The system shall identify candidate drop-off points along the driver's route between start and destination.
- **FR-006**: For each candidate drop-off point, the system shall compute:
  a. Driving time from the driver's start point to the drop-off point (using live traffic conditions),
  b. Added detour time, defined as: (drive time from start, via the drop-off point, to the driver's destination) minus (direct drive time from start straight to the driver's destination, no stop),
  c. Walking time from the drop-off point to the nearest usable transit stop,
  d. Transit time from that stop to the passenger's destination (including any transfers), using live transit departure data,
  e. Total time for the passenger from drop-off to destination (walk + wait + transit + any transfer time),
  f. Total time for the driver from start to their own destination via the drop-off point.
- **FR-007**: The system shall use live driving traffic conditions (not static/historical-average travel times) when computing driving and detour times.
- **FR-008**: The system shall use live transit departure/schedule data (not static timetable-only data) when computing walking, wait, and transit times.
- **FR-009**: The system shall filter candidates to those whose added detour time (FR-006b) is less than or equal to the user-supplied threshold (FR-002).
- **FR-010**: Among qualifying candidates (FR-009), the system shall rank and present the top N candidates (default N=3, see Configuration: `MAX_CANDIDATES_RETURNED`), ordered by ascending passenger total time (FR-006e). Where two or more candidates have equal passenger total time, the candidate that occurs earlier along the driver's route shall be ranked higher.
- **FR-011**: If zero candidates satisfy the detour threshold (FR-009), the system shall present the single candidate with the smallest passenger total time (FR-006e) — regardless of its detour time — along with a visible warning that it exceeds the requested detour threshold.
- **FR-012**: The system shall display a clear message (not a silent empty result) if no viable drop-off/transit combination exists at all (e.g., no transit service reachable from any point along the route). Clarification (see DEC-3): a candidate whose best route to the passenger's destination is walking-only (no transit legs) is a viable result, not a no-viable-option trigger — it is ranked normally per FR-006/FR-010 with a near-zero transit time. The "no viable option" condition in this FR applies only when a candidate has neither a usable transit itinerary nor a viable walking-only path.

### Output / Display
- **FR-013**: For each returned candidate, the system shall display the full time breakdown from FR-006 (drive time, detour time, walk time, transit time, total passenger time, total driver time).
- **FR-014**: The system shall display a persistent, visible disclaimer on all results stating that the suggested drop-off point is an estimate and that the driver is responsible for confirming it is a safe and legal place to stop.
- **FR-015**: The system shall allow the user to input each of the three required locations either by typing an address (validated/resolved via a geocoding or places lookup) or by selecting "use my current location."

### Access / Cost Control
- **FR-016**: The system shall operate in one of two exclusive app-wide modes: "free-tier mode" (fully open to the public, no password required) or "paid-tier mode" (the entire app, including all functionality, requires a correct password before any use). There is no partial/feature-specific gating.
- **FR-017**: The system shall provide a configurable mechanism (see Configuration: `APP_MODE`, `PAID_TIER_ACCESS_PASSWORD`) for switching the app between free-tier mode and paid-tier mode. The switch is an operator-controlled configuration setting; the system is not required to detect usage thresholds and switch modes automatically in v1.

## 2. Non-Functional Requirements

- **NFR-001**: The web app shall be responsive and usable on mobile browser viewports without requiring installation of a native app.
- **NFR-002**: The system shall not require user accounts, login, or authentication for baseline (free-tier) use.
- **NFR-003**: The system shall not persist user-submitted location data beyond what is required to serve a single request; no trip history, favorites, or cross-session storage shall be implemented in v1.
- **NFR-004**: The system shall return results within 5 seconds of the user submitting valid inputs, under normal operating conditions. *Note: this target depends on the latency of the chosen third-party routing/transit data provider(s) and the number of candidate points that must be evaluated per request. Tech-lead must validate feasibility of this target during design (Phase 2); if 5 seconds is not achievable given the chosen data provider(s) and candidate-evaluation approach, this must be escalated back to pm/user as a design-stage trade-off (e.g., fewer candidates evaluated, provider change, or a revised target) rather than silently missed.*
- **NFR-005**: The system shall be deployed to a live, publicly reachable URL, with CI/CD and hosting established before the first increment begins (per delivery workflow).
- **NFR-006**: The system's geographic service area shall be limited to a configurable radius (default 200km) around a configurable center point (default Toronto).
- **NFR-007**: Rate-limiting/abuse protection on free-tier (ungated) usage is explicitly out of scope for v1/MVP (deferred). This is a known, accepted risk: a single user or bot could exhaust free-tier API quota and force the app into paid-tier mode (FR-016) sooner than expected. No action is required beyond the operator manually switching `APP_MODE` if this occurs.

## 3. Configuration

All values below must be configurable (not hardcoded) and will form the baseline for the reviewer's hardcoding audit.

| Key | Purpose | Default (if known) |
|---|---|---|
| `MAP_ROUTING_PROVIDER` | Which maps/routing/transit data provider is used | TBD — tech-lead to recommend |
| `MAP_API_KEY` | Credential for the routing/transit data provider | secret, no default |
| `GEOGRAPHIC_CENTER` | Center point of the service area | Toronto |
| `GEOGRAPHIC_RADIUS_KM` | Max radius of service area from center | 200 |
| `MAX_DETOUR_THRESHOLD_INPUT` | N/A — user-entered per session, not a config default (confirmed: no fixed default) | n/a |
| `MAX_CANDIDATES_RETURNED` | Number of ranked candidates shown | 3 |
| `APP_MODE` | Operator-controlled switch: `free_tier` (open to all) or `paid_tier` (entire app password-gated) | `free_tier` |
| `PAID_TIER_ACCESS_PASSWORD` | Shared password/secret required to use the app when `APP_MODE=paid_tier` | secret, no default |
| `RESPONSE_TIME_TARGET_SECONDS` | Max acceptable response latency | 5 |
| `TRANSIT_MODES_INCLUDED` | Which transit modes are considered (bus, subway, tram, etc.) | all available in region |

Note: `FREE_TIER_USAGE_LIMIT` and `RATE_LIMIT_PER_IP` (previously listed as pending) are not included — automatic threshold detection and free-tier rate-limiting are explicitly out of scope for v1 (see FR-017 and NFR-007). The `APP_MODE` switch is manual/operator-controlled instead.

## 4. Resolved Questions Log

All open questions raised during drafting were answered by the user on 2026-07-10 prior to Gate 2 submission:

- **OQ-1 (Detour baseline)** — Confirmed: detour = (drive time via drop-off, then to destination) minus (direct drive time, no stop). Reflected in FR-006b.
- **OQ-2 (Ranking tie-break)** — Resolved: prefer the candidate earlier on the route. Reflected in FR-010.
- **OQ-3 (Fallback "closest")** — Resolved: smallest passenger transit time, not smallest detour or physical distance. Reflected in FR-011.
- **OQ-4 (Password gate mechanism)** — Resolved: simple binary, app-wide gate (not feature-specific), operator-controlled switch (not automatic). Reflected in FR-016, FR-017, Configuration `APP_MODE`.
- **OQ-5 (Location input method)** — Resolved: typed address (geocoded) plus "use my current location." Reflected in FR-015.
- **OQ-6 (Out-of-radius behavior)** — Resolved: block with an informational message; no best-effort attempt outside the service radius. Reflected in FR-004.
- **OQ-7 (Latency target)** — Resolved: under 5 seconds preferred; accepted with a flag that tech-lead must validate feasibility during design given real data-provider latency and escalate if not achievable. Reflected in NFR-004.
- **OQ-8 (Abuse protection on free tier)** — Resolved: explicitly deferred, not required for v1. Reflected in NFR-007.

## 5. Decisions Log

Record of decisions made directly by the user in conversation with the orchestrator (outside the standard interview process) that affect requirements-level scope or accepted risk. Logged here per this project's rule that a decision not written to its owning artifact did not happen. These are closed decisions, not open questions.

- **DEC-1 (2026-07-11) — Session cookie expiry deferral (relates to FR-016, FR-017; originates from reviewer finding REV-002).** Considered: fixing the non-expiring session cookie (flagged by reviewer as contradicting design.md §5.2's "short-lived session cookie" language) immediately at INC-2, versus deferring it. Decided: defer the fix to INC-8, which design.md §10 already scopes as "paid-tier hardening... re-auth behavior." The user accepted the interim risk on the basis that no protected business endpoint existed yet at the time of the decision. Note (reviewer, INC-2 audit): this risk basis changed once `/api/geocode` shipped as a live, billable protected endpoint in INC-2 — the deferral itself is unchanged, but tech-lead/pm should confirm with the user before any real `paid_tier` production deployment ahead of INC-8 that the timeline still holds.
- **DEC-2 (2026-07-11) — No rate-limiting/lockout on password-gate attempts, kept as-is (relates to NFR-007; originates from reviewer finding REV-003).** Considered: adding a 3-attempt lockout on `POST /api/auth/verify-password`. Decided: do not add it. The app is fully stateless/serverless with no database (per NFR-003's persistence constraints); any real lockout mechanism would require either an unreliable in-memory counter (would not survive across serverless invocations) or introducing a new persistence dependency, which the user judged not worth the trade-off. This is a deliberate, accepted-risk decision, not an oversight — no rate-limiting/throttling is implemented on this endpoint by design.
- **DEC-3 (2026-07-11) — Walking-only transit results are a valid, normally-ranked outcome, not a "no transit available" case (relates to FR-006, FR-008, FR-010, FR-011, FR-012; surfaced by dev during INC-5 transit-evaluation implementation).** Considered: treating a candidate whose Google transit-mode directions return a walking-only route (zero bus/subway/tram legs) the same as `noTransitAvailable: true` (excluding it from normal ranking, surfacing it only via the FR-011 no-qualifying-candidate fallback), versus treating it as a genuine, rankable result. Decided: walking-only routes are treated as a valid result with near-zero transit time and ranked normally alongside all other candidates per FR-006e/FR-010 (likely near the top, since a short walk to the destination is a great outcome for the passenger) — they are not flagged as no-transit-available and do not trigger the FR-011 fallback or the FR-012 "no viable option" message. FR-012 updated with a clarifying note reflecting this.

## 6. Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-07-10 | Initial draft created from approved idea-brief.md (FR-001–FR-017, NFR-001–NFR-006, Configuration section) | Phase 1 kickoff following Gate 1 approval |
| 2026-07-10 | Incorporated user decisions: stop-point safety disclaimer (FR-014) and password-gated paid-tier access (FR-016, FR-017) | Explicit user decisions on previously flagged idea-brief risks |
| 2026-07-10 | Added 8 open questions (OQ-1 through OQ-8) blocking Gate 2 | No-inference rule — ambiguities in detour baseline, ranking/fallback tie-breaks, password-gate mechanism, input method, out-of-radius behavior, latency target, and abuse protection must be resolved by the user, not assumed |
| 2026-07-10 | Resolved all 8 open questions; finalized FR-004, FR-006b, FR-010, FR-011, FR-015, FR-016, FR-017; added NFR-004 (5s latency target with feasibility-validation caveat) and NFR-007 (rate-limiting explicitly deferred); updated Configuration table (`APP_MODE` replaces `FREE_TIER_USAGE_LIMIT`/`RATE_LIMIT_PER_IP`); status changed DRAFT to FINAL | User answers received; document ready for Gate 2 approval |
| 2026-07-11 | Added section 5, "Decisions Log," recording DEC-1 (session cookie expiry fix deferred to INC-8, accepted interim risk) and DEC-2 (password-gate lockout/rate-limiting considered and explicitly declined, stateless-architecture trade-off). Renumbered former section 5 (Changelog) to section 6. | Closing a documentation gap flagged by reviewer (REV-002, REV-003 at INC-2 closure): both decisions were made directly with the user in conversation with the orchestrator but never recorded in an owning artifact, violating the "a decision not written to its owner's artifact did not happen" rule. No FR/NFR scope, numbering, or content changed — this is a record of already-made decisions, not a new change request. |
| 2026-07-11 | Added DEC-3 to Decisions Log (walking-only transit routes treated as a valid, normally-ranked result rather than "no transit available"). Added a clarifying note to FR-012 stating that a walking-only path counts as a viable outcome and does not trigger the "no viable option" message. | Closing a decision-recording gap: dev surfaced a genuine product ambiguity during INC-5 implementation (transit evaluation), the user decided directly with the orchestrator, and the decision plus its implication for FR-012's wording needed to be recorded per the "a decision not written to its owner's artifact did not happen" rule. FR-012 wording clarified only, not rewritten; no new FR/NFR added, no new approval gate required. |
