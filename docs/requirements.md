# Requirements: Drop-off Point Optimizer

Status: DRAFT — pending resolution of open questions below before Gate 2 approval.
Source: docs/idea-brief.md (approved, Gate 1 passed 2026-07-10).

## 1. Functional Requirements

### Inputs
- **FR-001**: The system shall accept three location inputs per session: driver's start point, driver's destination, and the family member's (passenger's) destination.
- **FR-002**: The system shall accept a user-supplied maximum acceptable added-detour time, in minutes, entered per session (not a fixed default).
- **FR-003**: The system shall validate that all three input locations resolve to a valid geographic point before computing results, and shall display a clear error message if any location cannot be resolved.
- **FR-004**: The system shall reject or flag sessions where the start or destination point falls outside the configured geographic service radius (see Configuration: `GEOGRAPHIC_RADIUS_KM`) — *exact behavior pending user decision, see Open Question OQ-6*.

### Computation
- **FR-005**: The system shall identify candidate drop-off points along the driver's route between start and destination.
- **FR-006**: For each candidate drop-off point, the system shall compute:
  a. Driving time from the driver's start point to the drop-off point (using live traffic conditions),
  b. Added detour time incurred by the driver as a result of routing through the drop-off point, relative to a defined baseline — *baseline definition pending user decision, see Open Question OQ-1*,
  c. Walking time from the drop-off point to the nearest usable transit stop,
  d. Transit time from that stop to the passenger's destination (including any transfers), using live transit departure data,
  e. Total time for the passenger from drop-off to destination (walk + wait + transit + any transfer time),
  f. Total time for the driver from start to their own destination via the drop-off point.
- **FR-007**: The system shall use live driving traffic conditions (not static/historical-average travel times) when computing driving and detour times.
- **FR-008**: The system shall use live transit departure/schedule data (not static timetable-only data) when computing walking, wait, and transit times.
- **FR-009**: The system shall filter candidates to those whose added detour time (FR-006b) is less than or equal to the user-supplied threshold (FR-002).
- **FR-010**: Among qualifying candidates (FR-009), the system shall rank and present the top N candidates (default N=3, see Configuration: `MAX_CANDIDATES_RETURNED`), ordered by ascending passenger total time (FR-006e) — *tie-breaking rule pending user decision, see Open Question OQ-2*.
- **FR-011**: If zero candidates satisfy the detour threshold (FR-009), the system shall present the single closest available candidate along with a visible warning that it exceeds the requested detour threshold — *definition of "closest" in this fallback case pending user decision, see Open Question OQ-3*.
- **FR-012**: The system shall display a clear message (not a silent empty result) if no viable drop-off/transit combination exists at all (e.g., no transit service reachable from any point along the route).

### Output / Display
- **FR-013**: For each returned candidate, the system shall display the full time breakdown from FR-006 (drive time, detour time, walk time, transit time, total passenger time, total driver time).
- **FR-014**: The system shall display a persistent, visible disclaimer on all results stating that the suggested drop-off point is an estimate and that the driver is responsible for confirming it is a safe and legal place to stop.
- **FR-015**: The system shall provide a method for the user to input the three required locations — *exact input method (typed address with autocomplete, map pin placement, current-location detection, or a combination) pending user/designer decision, see Open Question OQ-5*.

### Access / Cost Control
- **FR-016**: The system shall, by default, allow anonymous public users to access only the functionality/usage volume that stays within the configured free-tier API usage limits.
- **FR-017**: The system shall gate any functionality or usage that would incur paid-tier API cost behind a password check; a user who does not provide the correct password shall not be able to trigger paid-tier-incurring requests — *exact mechanism (what is gated: full feature vs. usage-volume cutover; how/when the gate activates: static config flag vs. automatic threshold detection; what the ungated experience looks like once the free tier is exhausted) pending user decision, see Open Question OQ-4*.

## 2. Non-Functional Requirements

- **NFR-001**: The web app shall be responsive and usable on mobile browser viewports without requiring installation of a native app.
- **NFR-002**: The system shall not require user accounts, login, or authentication for baseline (free-tier) use.
- **NFR-003**: The system shall not persist user-submitted location data beyond what is required to serve a single request; no trip history, favorites, or cross-session storage shall be implemented in v1.
- **NFR-004**: The system shall respond with results within a defined maximum time — *specific target pending user decision, see Open Question OQ-7*.
- **NFR-005**: The system shall be deployed to a live, publicly reachable URL, with CI/CD and hosting established before the first increment begins (per delivery workflow).
- **NFR-006**: The system's geographic service area shall be limited to a configurable radius (default 200km) around a configurable center point (default Toronto).

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
| `FREE_TIER_USAGE_LIMIT` | Threshold defining "free tier" usage ceiling for gating purposes | TBD, see OQ-4 |
| `PAID_TIER_ACCESS_PASSWORD` | Shared password/secret required to unlock paid-tier-incurring functionality | secret, no default |
| `RATE_LIMIT_PER_IP` | Whether/how the free (ungated) functionality itself is rate-limited to prevent abuse | TBD, see OQ-8 |
| `RESPONSE_TIME_TARGET` | Max acceptable response latency | TBD, see OQ-7 |
| `TRANSIT_MODES_INCLUDED` | Which transit modes are considered (bus, subway, tram, etc.) | all available in region |

## 4. Open Questions (blocking Gate 2 — no-inference rule)

These must be answered by the user before requirements.md can be approved as final. I have not guessed at any of these.

- **OQ-1 (Detour baseline)**: "Added detour time" (FR-006b) — is this defined as: (drive time via the drop-off point, then to driver's destination) minus (drive time on the direct route straight from start to destination, no stop)? Please confirm or correct this definition.
- **OQ-2 (Ranking tie-break)**: When two or more qualifying candidates have equal or near-equal passenger total time, how should ties be broken (e.g., prefer lower driver detour, prefer fewer transit transfers, arbitrary)?
- **OQ-3 (Fallback "closest")**: When no candidate meets the detour threshold (FR-011), should "closest" mean smallest detour-time overage, smallest passenger total transit time regardless of detour, or something else?
- **OQ-4 (Password gate mechanism)**: For FR-017 —
  - Is the gate applied to the entire app once a usage/cost threshold is reached (i.e., app-wide lockdown requiring a password for anyone), or only to specific features/tiers of the maps API (e.g., live traffic stays free, something else becomes paid)?
  - Is the threshold crossing detected automatically by the system, or is this a manual switch an operator flips after noticing usage/cost?
  - When the gate is active for a given user without the password, what do they see — a hard block with a password prompt, or a degraded experience (e.g., static/less accurate data) with an option to unlock full functionality via password?
- **OQ-5 (Location input method)**: Should location entry be via typed address with autocomplete, tap-to-place a pin on a map, "use my current location" detection, or a combination? (This may also route to the designer once ux-spec.md exists, but I need to know the intended method(s) to write it as a testable FR.)
- **OQ-6 (Out-of-radius behavior)**: If a user enters a start/destination outside the 200km service radius, should the system refuse with an error, or attempt the calculation anyway with a warning that results may be unreliable/unsupported?
- **OQ-7 (Latency target)**: What is the maximum acceptable time from submitting inputs to seeing results (e.g., "under 5 seconds," "under 10 seconds")? Per CLAUDE.md, "fast" alone is not a testable requirement — I need a concrete number.
- **OQ-8 (Abuse protection on free tier)**: Independent of the password gate on paid-tier functionality, should the free/ungated public functionality itself have any rate-limiting or abuse protection (e.g., per-IP request caps) to slow how quickly a single user/bot could exhaust the free-tier quota, or is that considered covered by the password-gate decision alone?

## 5. Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-07-10 | Initial draft created from approved idea-brief.md (FR-001–FR-017, NFR-001–NFR-006, Configuration section) | Phase 1 kickoff following Gate 1 approval |
| 2026-07-10 | Incorporated user decisions: stop-point safety disclaimer (FR-014) and password-gated paid-tier access (FR-016, FR-017) | Explicit user decisions on previously flagged idea-brief risks |
| 2026-07-10 | Added 8 open questions (OQ-1 through OQ-8) blocking Gate 2 | No-inference rule — ambiguities in detour baseline, ranking/fallback tie-breaks, password-gate mechanism, input method, out-of-radius behavior, latency target, and abuse protection must be resolved by the user, not assumed |
