# Idea Brief: Drop-off Point Optimizer

## Problem Statement
When a driver is traveling from one location to another (e.g., home to office) and a family member needs a ride part of the way but is headed to a different final destination, there is no easy way to find the best point along the driver's route to drop them off so they can continue by transit. Today this is solved by guessing — picking a familiar transit stop or an arbitrary point — which often results in a suboptimal drop-off that adds unnecessary transit time for the passenger, an unnecessary detour for the driver, or both. This tool computes the optimal drop-off point(s) by jointly considering the driver's route/detour tolerance and the passenger's resulting transit journey.

## Target Users
- General public — any driver/passenger pair with this situation, not a personal single-user tool.
- Either party may use the app independently in their own session (driver planning the trip, or passenger checking transit options from a candidate point).
- No accounts, no saved history — each use is a fresh, anonymous session with all inputs (start, destination, passenger's destination, detour threshold) entered per use.
- Expected to be used frequently, with all trip parameters varying every time (no fixed "home/office" defaults).

## Core Workflow (v1)
1. User enters: driver's start point, driver's destination, family member's destination, and a maximum acceptable added-detour time (minutes), all per session.
2. System computes, using live traffic and live transit data (including walking time to/from stops), the top 3 ranked candidate drop-off points along/near the driver's route.
3. Each candidate result shows a full breakdown: driving time to drop-off point, added detour time for the driver, walking time to the transit stop, transit time, and total time to the passenger's destination.
4. If no candidate satisfies the user's detour threshold, the system shows the closest available option anyway, with a warning that it exceeds the requested threshold.

## V1 Scope — In
- Mobile-friendly responsive web app (browser-based, no native app/install).
- Anonymous, stateless sessions — no accounts, no persistence, no shared driver/passenger session/link.
- Input: three locations (start, driver destination, passenger destination) + user-supplied max detour threshold (minutes), entered fresh each session.
- Optimization: joint objective — minimize passenger's total transit time (drive-to-drop-off is not counted in passenger time, but detour is constrained) subject to the driver's detour staying within the user-supplied threshold; fallback to closest option with warning if none qualify.
- Live/real-time data: live driving traffic conditions and live transit schedules/departures (not static timetables only).
- Output: top 3 ranked candidate points with full time breakdown per candidate.
- Geographic scope: within ~200km radius of Toronto for v1.
- Transit modes: all locally available modes (bus, subway/rail, tram, etc.).
- Public deployment: live URL, publicly accessible, with release/CI/hosting set up before the first increment.

## V1 Scope — Out (explicitly deferred)
- Native mobile apps (iOS/Android) — web only for v1.
- User accounts, saved trips, trip history, favorites.
- Shared driver/passenger session (e.g., a link one generates for the other to view the same session) — each person uses the tool independently for v1.
- Offline / low-connectivity support.
- Geographic coverage beyond ~200km of Toronto.
- Any assessment of whether a candidate drop-off point is a physically safe/legal place to stop (e.g., no-stopping zones, lack of shoulder/pull-over space) — flagged as an open risk below, not solved in v1.

## Constraints
- Tech stack/hosting: open — tech-lead to recommend and confirm with user before design lock.
- Data source: open — tech-lead to recommend a maps/routing/transit data provider (e.g., Google Maps Platform or alternatives) capable of live traffic + live transit departures + walking directions. User prefers staying within free-tier where possible but wants paid-tier cost/capability trade-offs presented for decision.
- Public deployment means API usage costs scale with public traffic — cost ceiling and abuse/rate-limiting approach must be decided explicitly (open risk, see below), not assumed.
- Privacy: no accounts or persistence; location inputs are per-session only. No other stated privacy requirements yet.

## Success Criteria
- Validated in real-world use: on at least 3 real trips, the top-ranked suggested drop-off point is one the user would actually use and it saved the family member meaningful transit time compared to guessing.
- Tool is fast/simple enough to use in the moments before or during a trip (not slow or clunky).
- Suggested points and transit time estimates are accurate enough to be trusted repeatedly.

## Open Risks (unvalidated / need attention before or during design)
1. **Safety/practicality of stopping points**: v1's algorithm optimizes for transit time only; it does not verify that a candidate point is a legal or physically safe place for a driver to actually pull over and drop someone off. This is a known abandonment risk the user flagged explicitly and is currently out of scope to solve — needs an explicit decision (e.g., disclaimer only vs. future filtering) before or shortly after v1 launch.
2. **API cost exposure**: Public, anonymous, no-rate-limit-by-default deployment combined with live traffic + live transit data calls could exceed free-tier quotas quickly or unpredictably once real users show up. Needs a concrete decision on provider, cost ceiling, and any rate-limiting/abuse protection — this will go to the user via tech-lead during design.
3. **Live transit data availability/quality in the Toronto region**: real-time departure feeds (e.g., TTC, GO Transit, regional agencies) vary in reliability/coverage; accuracy of "transit time" estimates depends on this and is not yet validated.
4. **Definition of "detour"**: threshold is user-supplied per session in minutes, but the precise baseline it's measured against (driver's direct route with no stop, vs. some other baseline) needs to be nailed down precisely in requirements to be testable.
5. **No usage data feedback loop**: since v1 is fully anonymous/stateless, there's no built-in way to measure the stated success criteria (3 real trips, meaningfully saved time) other than the user's own manual observation — success will be assessed subjectively/manually, not through in-app analytics (none planned for v1).

## Non-Functional Considerations (to become NFRs)
- Mobile-friendly, responsive UI.
- Performance: must feel fast for pre-trip / in-trip use (specific latency target to be pinned down in requirements).
- Public deployment: needs release/CI/hosting pipeline in place before INC-1, per delivery workflow.
- No accounts/auth needed for v1; anonymous access only.
