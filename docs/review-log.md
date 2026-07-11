# Review Log: DropSpot

Owner: reviewer. Do not edit outside this agent. Read-only on src/, tests/, requirements.md, design.md.

---

## INC-1 Audit — 2026-07-11

Scope under review: project scaffolding, config loader, `APP_MODE` password gate, app shell.
Claimed coverage: FR-016, FR-017, NFR-002, partial NFR-001.
Inputs reviewed: idea-brief.md, requirements.md, design.md, ux-spec.md, runbook.md, handoff.md, test-report.md, all files under `src/`, `api/`, `tests/`, plus root config (`package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `.nvmrc`, `vercel.json`, `index.html`).

### Pass 1 — Traceability, requirements → code

| ID | Design coverage | Implementation | Test | Verdict |
|---|---|---|---|---|
| FR-016 | design.md §5.1/§5.2/§10 (AuthGate, INC-1) | `src/auth/authGate.ts`, `App.tsx` | `tests/auth/authGate.test.ts`, `tests/frontend/App.test.tsx` | OK |
| FR-017 | design.md §7 (`APP_MODE`, `PAID_TIER_ACCESS_PASSWORD`), §10 | `src/config/loader.ts`, `api/auth/verify-password.ts` | `tests/config/loader.test.ts`, `tests/api/verify-password.test.ts` | OK |
| NFR-002 | design.md §10 | `authGate.ts` always passes in `free_tier` | `tests/auth/authGate.test.ts` | OK |
| NFR-001 (partial) | ux-spec.md §2 tokens | `tokens.css`, `global.css`, components use token classes not inline styles | manual Playwright walkthrough only (no automated viewport test yet) | OK for INC-1 scope (full pass deferred to INC-8 per design.md §10 — consistent, not a gap) |
| NFR-003 (cross-cutting) | design.md §2 | no persistence anywhere in `src/config`, `src/auth`, `api/` | `tests/regression/no-persistence.test.ts` | OK |

No missing design coverage, no missing implementation, no missing test found for this increment's claimed scope. `MAP_API_KEY` and the remaining config-7 keys are loaded/validated even though not yet consumed by business logic — consistent with design.md's own note that INC-1 loads the full schema early.

### Pass 2 — Traceability, code → requirements (scope creep)

- **REV-004 [SCOPE-CREEP] minor** — `index.html:5` sets `maximum-scale=1.0` in the viewport meta tag, disabling pinch-to-zoom. This is not called for anywhere in ux-spec.md or design.md (ux-spec §8 accessibility notes say nothing about disabling zoom) and works against general accessibility practice (WCAG 1.4.4, reflow/zoom to 200%). QA flagged this as a non-blocking observation; I'm formalizing it here since it's undocumented behavior with an accessibility cost and no corresponding requirement authorizing it. **Owner: dev.** Suggested fix: drop `maximum-scale=1.0` (keep `width=device-width, initial-scale=1.0`).
- Everything else reviewed (client session flag via `sessionStorage`, Show/Hide password toggle, dev-only Vite API middleware, disabled placeholder Input Screen controls) is explicitly authorized by ux-spec.md or design.md, or is non-shipped dev tooling. No other scope creep found.

### Pass 3 — Hardcoding audit

Checked `src/config/loader.ts` against every key in design.md §7's config schema: all 14 keys are read from `env` with no in-code fallback default (operators must set the env var itself, matching runbook.md §4). Spot-checked for stray literals that should be config:
- `SESSION_COOKIE_NAME` (`dropspot_session`), `TOKEN_MESSAGE` (`dropspot-authenticated`) in `src/auth/session.ts` — internal implementation constants, not listed as tunables in design.md §7's schema. Not flagged.
- CSS tokens (`tokens.css`) — exactly mirror ux-spec.md §2's token table; components reference `var(--*)`/`type-*` classes rather than inline literals (verified in `PasswordGate.css`, `InputScreen.tsx`). Compliant with ux-spec's explicit instruction.
- `package.json` `engines.node: "22.x"` matches `.nvmrc` (`22`) — consistent, no drift.
- No model names, retry counts, timeouts, URLs, or thresholds found hardcoded in `src/` or `api/` outside the above internal constants.

**No `[HARDCODED]` findings this pass.**

### Pass 4 — Leanness audit

- Comments throughout `src/config`, `src/auth`, `api/` are substantive (explain *why*, tie back to design.md/FR IDs), not step-by-step narration of trivial code. No commented-out code found.
- No unused imports/dead code found in `src/`, `api/`, or `scripts/viteApiMiddleware.ts` (dev-only tooling, correctly scoped with `apply: 'serve'`, not bundled to production).
- Test helpers (`tests/helpers/*`) are appropriately shared/reused, no duplication across the 11 test files noted.

**No `[BLOAT]` findings this pass.**

### Pass 5 — Security audit

- **Committed secrets**: `.env.local` exists on disk with a dummy `MAP_API_KEY` and a placeholder `PAID_TIER_ACCESS_PASSWORD` (`correct-horse-battery-staple`), but confirmed **not tracked by git** (absent from `.git/index`; `.gitignore` excludes `.env.local`/`.env`). `.env.example` contains only placeholder text, no real values. **No committed secrets found.**
- **Password comparison**: `src/auth/verifyPassword.ts` hashes both sides to a fixed-length SHA-256 digest before `timingSafeEqual` — correctly constant-time, satisfies design.md §5.2.
- **REV-002 [SECURITY] major** — Session token (`src/auth/session.ts`) is a **deterministic, non-expiring** HMAC-SHA256 of a fixed constant message, keyed only by the shared `PAID_TIER_ACCESS_PASSWORD`. Consequences, independently verified by reading the code (not just taking handoff.md's self-flagged note at face value):
  - The valid cookie value is identical for every user/login and never changes unless the operator rotates the shared password. A copied/leaked cookie value (e.g., shared/public computer, browser history sync, any future XSS, log exposure) grants **indefinite** access, not bounded by any session TTL — the only revocation lever is rotating the password for *all* legitimate users too.
  - This contradicts design.md §5.2's own language: "sets a **short-lived** session cookie on success." As implemented, the cookie is not short-lived — it is a permanent credential-equivalent bounded only by browser-close (no `Max-Age`/`Expires` at all) and manual password rotation. This is a design-doc/implementation mismatch, not just a hardening nice-to-have.
  - Cookie flags themselves are otherwise sound: `HttpOnly` (prevents JS/XSS read), `Secure` correctly gated on `VERCEL_ENV` (production/preview only, appropriately omitted for local plain-HTTP dev), `SameSite=Lax` (reasonable; `Strict` would be marginally tighter but Lax is an acceptable default given no other authenticated mutating endpoints exist yet).
  - **Recommendation** (for tech-lead to confirm/design, dev to implement): embed a signed expiry into the token itself (e.g., HMAC over `expiryTimestamp + fixed message`, cookie value `expiryTimestamp.hmac`, `isValidSessionToken` checks both the HMAC and `now < expiryTimestamp`) — this preserves the stateless/no-DB architecture (NFR-003) while actually satisfying "short-lived." Needs a config key added to design.md §7 (e.g., `SESSION_LIFETIME_SECONDS`) if a tunable is wanted, per the project's no-hardcoded-tunables rule.
  - **Severity/routing**: Major, not a blocker for INC-2 (no protected business endpoint exists yet, so today's actual exposure is limited to the password gate's own screen). Must be resolved by INC-8 ("paid-tier hardening... re-auth behavior" is already that increment's explicit scope per design.md §10) or sooner if `APP_MODE=paid_tier` is turned on in a real production deployment before then. **Owner: tech-lead** (amend design.md §5.2/§7 to specify the intended session lifetime and mechanism), then **dev** to implement.
- **REV-003 [SECURITY] minor/informational** — `POST /api/auth/verify-password` has no rate-limiting, attempt counter, or lockout (confirmed in code: no such logic exists in `api/auth/verify-password.ts`). This is an explicit, already-documented user decision (ux-spec.md §3: "Resolved: no lockout/throttling is required for the password gate"), so it is not a defect — but I want to flag independently that it does carry a real consequence design.md itself names as the point of `APP_MODE=paid_tier`: "the password gate itself is also a natural cost-control lever" (design.md §3). An unthrottled, unlimited-attempt online password gate is brute-forceable at whatever rate the network/serverless platform allows, which weakens that stated cost-control rationale if the configured password is short or guessable. Not filing as a blocker (explicit user decision already on record), but recommending **pm** confirm with the user that this trade-off is still acceptable now that it's framed against the gate's stated cost-control purpose, not just its UX purpose. **Owner: pm.**
- **`GET /api/config/public` unauthenticated in `paid_tier` — independent conclusion: CONCUR with dev/QA, acceptable, not a bug.** Verified myself (not just trusting the existing tests) that `toPublicConfig()` only ever returns `{ appMode, geographicCenter, geographicRadiusKm, maxCandidatesReturned, transitModesIncluded }` and that `mapApiKey`/`paidTierAccessPassword` are structurally absent from `AppConfig → PublicConfig` mapping (not just "usually" excluded — there is no code path that could include them). Reasons this is correct, independent of dev/QA's framing:
  1. It is a genuine chicken-and-egg requirement: the frontend cannot decide whether to render the password gate at all without first knowing `appMode`, so *some* pre-auth endpoint must exist.
  2. runbook.md §6 depends on exactly this endpoint, exactly this shape, as its zero-cost/no-auth deploy health check.
  3. FR-016 gates "functionality... any use," not configuration metadata; radius/candidate-count/transit-mode-list are not user data or billable business features.
  One residual, low-severity observation not raised by dev/QA: this endpoint also returns the config-loader's raw validation-error message text (`api/config/public.ts`'s catch branch) to an unauthenticated caller on a 500. This reveals internal config-key names/validation rules to anyone, even in `paid_tier` mode. Low value to an attacker (the same key names are already documented in this repo's own runbook.md/design.md), so **not logged as a standalone finding**, just noted for awareness.
- **`APP_MODE=paid_tier` client-render + server-cookie gate, not edge/CDN-level — independent conclusion: CONCUR, acceptable for INC-1's actual scope, given:**
  1. Zero protected business endpoints exist yet in this increment (confirmed: `api/` contains only `config/public.ts`, intentionally public, and `auth/verify-password.ts`, the gate's own endpoint) — so there is nothing of value reachable pre-auth today regardless of where the block happens.
  2. ux-spec.md §3 explicitly assigns the exact mechanism to dev/tech-lead as an implementation choice, and design.md never calls for an edge-level block anywhere in §2, §5, §8, or the INC-1 scope in §10.
  3. `AuthGate.check()` itself is correctly framework-agnostic and reusable, so INC-2+'s real protected endpoints (`/api/geocode`, `/api/drop-off-search`) just need to wrap themselves with it — verified the interface supports that without modification.
  This conclusion is conditional, not a blanket pass: it depends entirely on every future protected endpoint actually being wrapped in `AuthGate.check()`. I will re-verify this explicitly at the INC-2 audit once `/api/geocode` lands, per the same carry-forward flag QA already recorded.
- No SQL/shell/file-path injection surfaces exist yet (no user input reaches a trust boundary of that kind in INC-1 — the only inputs are `password` string compared via HMAC/hash, and env vars read by the operator). No dependency vulnerabilities beyond the 9 pre-existing advisories QA already noted as not introduced by this increment (not independently re-audited here; flagging that reviewer should re-check `npm audit` output directly at the next pass rather than relying solely on QA's characterization).

### Non-blocking items carried over from QA, now formally logged

- **REV-004** (see Pass 2 above) — `maximum-scale=1.0` accessibility anti-pattern. Minor. Owner: dev.
- **REV-005 [TEST-GAP] minor** — `tsconfig.json`'s `include` (`src`, `api`, `scripts`, `vite.config.ts`) omits `tests/`, so `npm run typecheck` does not type-check QA's test files (vitest's esbuild transform still runs them at test time, so syntax errors surface as failures, but non-emitting type errors in `tests/` would not). Recommend `tests/` be added to `tsconfig.json`'s `include` (or a separate `tsconfig.test.json`) before the test suite grows much further. Owner: dev.

### Summary — Pass 1-5

- New findings: 1 major security/design-mismatch (REV-002), 1 minor security/product-tradeoff note (REV-003), 1 minor scope-creep (REV-004), 1 minor test-tooling gap (REV-005). Zero `[HARDCODED]`, zero `[BLOAT]`, zero `[REQUIREMENTS-GAP]`/`[DESIGN-GAP]`/`[CODE-GAP]` (beyond the session-lifetime mismatch folded into REV-002), zero committed-secret findings.
- Resolved items: none yet (first audit pass).
- **Open blocker count: 0.**

**Verdict: INC-1 is cleared to proceed to INC-2.** No blockers found. REV-002 (major) should be scheduled for resolution no later than INC-8 (paid-tier hardening, already scoped for exactly this in design.md §10) or immediately if `paid_tier` is enabled in real production before then — recommend the orchestrator relay this timing constraint to the user explicitly rather than let it ride silently to INC-8. REV-003 should go to pm for a quick user confirmation (not a blocker, just a trade-off worth re-confirming now that it's framed against cost-control rationale). REV-004 and REV-005 are cheap fixes dev can pick up whenever convenient, no urgency.

---

## Findings Register

| ID | Tag | Severity | Location | Description | Owner | Status |
|---|---|---|---|---|---|---|
| REV-001 | _(reserved — not used; see REV-002)_ | — | — | — | — | — |
| REV-002 | SECURITY | major | `src/auth/session.ts`, `design.md` §5.2 | Session token is a deterministic, non-expiring HMAC of a fixed message keyed by the shared password; contradicts design.md's "short-lived session cookie" language; a leaked cookie is valid indefinitely, revocable only by rotating the password for all users. | tech-lead (design), dev (implement) | OPEN — re-scoped at INC-2 audit, see note below |
| REV-003 | SECURITY | minor | `api/auth/verify-password.ts` | No rate-limiting/lockout on password verification (explicit ux-spec decision) undermines the password gate's stated cost-control rationale (design.md §3) if the password is weak/guessable. Recommend pm re-confirm with user. | pm | OPEN |
| REV-004 | SCOPE-CREEP | minor | `index.html:5` | `maximum-scale=1.0` disables pinch-zoom; not specified in ux-spec/design, accessibility anti-pattern (WCAG 1.4.4). | dev | OPEN |
| REV-005 | TEST-GAP | minor | `tsconfig.json` | `include` list omits `tests/`, so typecheck doesn't cover QA's test files. | dev | OPEN |
| REV-006 | HARDCODED | minor | `src/frontend/hooks/useLocationField.ts:7-8`, `api/geocode.ts:8` | `MIN_QUERY_LENGTH` (3) and `DEBOUNCE_MS` (300) are literal constants, not entries in design.md §7's config schema. Independent conclusion, disagreeing in part with dev/QA's "not a violation" framing — see INC-2 audit Pass 3 below. Recommend tech-lead add `MIN_GEOCODE_QUERY_LENGTH` (or similar) to the schema since it directly gates billable provider-call volume; debounce is a softer case. Not a blocker. | tech-lead (schema), dev (implement) | **RESOLVED 2026-07-11** — see Closure Verification below |
| REV-007 | BLOAT | minor | `src/frontend/hooks/useLocationField.ts:7`, `api/geocode.ts:8` | `MIN_QUERY_LENGTH = 3` is independently redeclared in both the frontend hook and the backend handler with no shared constant/module. If one is changed without the other, frontend and backend validation will silently disagree (e.g., frontend queries at 3 chars but backend now requires 4). Recommend a single shared constant (or the config value from REV-006, once promoted) imported by both. | dev | **RESOLVED 2026-07-11** — see Closure Verification below |
| REV-008 | SCOPE-CREEP | minor | `src/frontend/hooks/useLocationField.ts` (`provider_error` status), `src/frontend/components/InputScreen.tsx:86` | A `provider_error` field state/copy ("We couldn't check that address right now. Please try again.") was added that is not in ux-spec.md §4.1's field-states table (which lists only empty/focused/resolved/geolocating/geolocation-denied/unresolvable/out-of-service-area). Dev flagged this transparently in handoff.md as justified by ux-spec §0's "never fail silently" principle, and it is a reasonable, low-risk addition — but it is undocumented in the artifact of record. Per the traceability rule, this should be either accepted and folded into ux-spec.md's table (designer) or rejected, not left as code-only behavior. | designer / pm | OPEN (out of scope for this targeted closure check — not addressed by the REV-006/007/009 fix pass) |
| REV-009 | SECURITY | minor | `api/geocode.ts:35-36,85-86` | Both the config-load failure path (500) and the provider-error path (502) forward the raw underlying error message (`ConfigError.message` / `GeocodingProviderError.message`, the latter sourced directly from Google's `error_message` field) verbatim to the unauthenticated-or-authenticated caller. Repeats the pattern already noted (not logged) on `/api/config/public` in the INC-1 audit — now recorded formally since a second endpoint repeats it and one observed real value (`"The provided API key is invalid."`) confirms it can reveal provider/credential-validity detail, not just internal key names. Low severity (no secret value itself is ever included), but recommend dev return a generic message to the client and log the detailed provider/config message server-side only. | dev | **RESOLVED 2026-07-11** — see Closure Verification below |

---

## INC-2 Audit — 2026-07-11

Scope under review: location input, geocoding, radius validation.
Claimed coverage: FR-001, FR-003, FR-004, FR-015, NFR-006.
Inputs reviewed: requirements.md, design.md, ux-spec.md, handoff.md (INC-1 + INC-2 sections), test-report.md (INC-1 + INC-2 sections), this log's INC-1 findings (REV-001–REV-005), plus code: `api/geocode.ts`, `src/geo/*`, `src/geocoding/*`, `src/frontend/hooks/useLocationField.ts`, `src/frontend/components/InputScreen.tsx`, `src/frontend/api.ts`, `src/frontend/App.tsx`, `src/config/schema.ts`, `src/auth/authGate.ts`, `src/auth/session.ts`, and the relevant test files (`tests/api/geocode.test.ts`, `tests/frontend/InputScreen.test.tsx`, `tests/geo/radiusValidator.test.ts`, `tests/geocoding/googleGeocodingService.test.ts`, `tests/helpers/testEnv.ts`).

### Pass 1 — Traceability, requirements → code

| ID | Design coverage | Implementation | Test | Verdict |
|---|---|---|---|---|
| FR-001 | design.md §10 INC-2 | `InputScreen.tsx` renders 3 `LocationField`s | `tests/frontend/InputScreen.test.tsx` ("FR-001") | OK |
| FR-003 | design.md §5.1/§10 (ZERO_RESULTS handling) | `googleGeocodingService.ts` (ZERO_RESULTS → `[]`, not throw on forward geocode), `api/geocode.ts` (`200 {results:[]}`), `InputScreen.tsx` unresolvable copy | `tests/geocoding/googleGeocodingService.test.ts`, `tests/api/geocode.test.ts`, `tests/frontend/InputScreen.test.tsx` | OK — appropriately scoped to field-level validation; submit-time "before computing results" gate is deferred to INC-6 per design.md §10, consistent, not a gap now |
| FR-004 | design.md §4.1/§5.2/§10, resolved DQ-1 | `src/geo/radiusValidator.ts` (`isWithinServiceArea`), wired in `useLocationField.ts` via `applyRadiusCheck`, set `true`/`true`/`false` in `InputScreen.tsx` for start/destination/passenger | `tests/geo/radiusValidator.test.ts`, `tests/frontend/InputScreen.test.tsx` (3-direction exemption test) | OK — independently re-verified in code, see Pass-independent verification below |
| FR-015 | design.md §5.1/§5.2/§10 | `useLocationField.ts` (typed autocomplete + geolocation), `InputScreen.tsx` | `tests/frontend/InputScreen.test.tsx` | OK |
| NFR-006 | design.md §7 (`GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM`) | `radiusValidator.ts` takes both as parameters, no hardcoded default; `InputScreen.tsx` substitutes actual configured values into copy | `tests/geo/radiusValidator.test.ts` (configurability), `tests/frontend/InputScreen.test.tsx` (widened radius, changed center label) | OK |

No missing design coverage, implementation, or test found for this increment's claimed scope. Nothing overclaimed: the detour field/CTA remain correctly out of scope (unwired, disabled), matching both handoff.md and design.md §10's INC-2 boundary.

### Independent verification of the orchestrator's three flagged items

**1. `/api/geocode` genuinely wrapped by `AuthGate.check()` before any provider call.** Confirmed directly from `api/geocode.ts`: `loadConfig()` runs first (lines 32-38), then `AuthGate.check(req, config)` (line 40) returns early with `401` *before* `createGoogleGeocodingService(...)` is even constructed (line 49) or any `resolve`/`reverseGeocode` call is made. Independently read `tests/api/geocode.test.ts`'s AuthGate-wiring block and confirmed the assertions actually do what QA claims: every `401` case asserts `fetchSpy).not.toHaveBeenCalled()` (lines 68, 85, 124), and a fifth test confirms `AuthGate` is checked even before the too-short-query validation (so an unauthenticated caller can't learn validation rules — line 127-139). This is a genuine, code-level guarantee, not just a coincidental status code. **Confirmed, not just deferred to QA's framing.**

**2. Radius check applies to `start`/`driverDestination` only, never `passengerDestination`.** Confirmed directly in `InputScreen.tsx` lines 34-48: `applyRadiusCheck` is `true` on the first two `LocationField`s ("Your start point", "Your destination") and explicitly `false` on the third ("Passenger's destination"). Traced into `useLocationField.ts`'s `applyRadiusOutcome` (lines 60-70): when `applyRadiusCheck` is false, the function returns `"resolved"` unconditionally without ever calling `RadiusValidator.isWithinServiceArea`. No shared/ambient state or default could accidentally flip this — it's an explicit prop threaded through one call site per field. Independently re-ran the logic of `tests/frontend/InputScreen.test.tsx`'s three-direction test (same far-away coordinate blocked on start, blocked on destination, accepted on passenger destination) — this is the correct test design to rule out an accidental "any field is exempt" or "no field is exempt" bug, and it passes as claimed. **Confirmed correct and correctly wired.**

**3. Hardcoded debounce (300ms) / min-query-length (3 chars) — independent conclusion, partially disagreeing with QA's judgment call.** See Pass 3 below (REV-006, REV-007). QA's core reasoning — neither value appears in requirements.md's Configuration section or design.md §7's schema, and ux-spec.md §4.1 explicitly delegates the exact number to dev — is accurate as far as it goes, and is consistent with this log's own INC-1 precedent (`SESSION_COOKIE_NAME`/`TOKEN_MESSAGE` not flagged). But that precedent was for values with **no operational/cost consequence** (an arbitrary cookie name). `MIN_QUERY_LENGTH` is different in kind: every character typed at or above that threshold triggers a real, billable Google Geocoding API call (design.md §3's own cost accounting is per-submission, but the mechanism generating autocomplete cost *per keystroke* is introduced by this increment and isn't bounded by any config value at all). This is squarely the kind of "threshold" this audit's Pass 3 instructions call out by name, and it sits in the same conceptual family as schema entries like `DISTANCE_MATRIX_BATCH_SIZE`/`MAX_TRANSIT_EVALUATIONS_PER_REQUEST` (also cost/latency levers tech-lead chose to make configurable). Ux-spec.md delegating the *exact number* to dev is not the same as design.md deciding it need not be *configurable at all* — that decision belongs to tech-lead's schema, not to an implicit omission. Conclusion: **not a blocker, but reviewer does not fully concur with "not a violation" — recommend tech-lead explicitly decide (add to schema, or affirmatively document the decision not to) rather than let it stand as an implicit judgment call.** `DEBOUNCE_MS` is a weaker case (no direct cost impact, pure UX timing) and would be a lower priority to promote than `MIN_QUERY_LENGTH`. Logged as REV-006 (minor, not blocking INC-3).

### Pass 2 — Traceability, code → requirements (scope creep)

- **REV-008 [SCOPE-CREEP] minor** — see Findings Register. A `provider_error` field-level state was added to `useLocationField.ts`/`InputScreen.tsx` that has no entry in ux-spec.md §4.1's field-states table. Justified by ux-spec §0's general "never fail silently" principle and transparently flagged by dev in handoff.md, so this is a low-risk, well-reasoned addition — but it is still undocumented in the artifact of record, and per CLAUDE.md's "a stale doc is a bug" rule, ux-spec.md should be updated to include it (or the addition explicitly rejected), not left as an implicit code-only behavior. Routed to designer/pm, not a blocker.
- Everything else reviewed (ARIA combobox pattern, mousedown-before-blur suggestion selection, "current location" badge, blur-race self-correction) is explicitly authorized by ux-spec.md §4.1 or design.md, or is a direct, undocumented-but-necessary consequence of implementing a spec'd interaction correctly (not new business behavior). No other scope creep found.

### Pass 3 — Hardcoding audit

Checked all INC-2 code against design.md §7's config schema and requirements.md's Configuration table:
- `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM` — genuinely threaded through as parameters (`RadiusServiceAreaConfig`, `PublicConfig`) with no hardcoded fallback anywhere in `src/geo/radiusValidator.ts` or `InputScreen.tsx`. Compliant.
- `MAP_API_KEY` — read once from `AppConfig` in `api/geocode.ts:49`, passed into `createGoogleGeocodingService`, never hardcoded, never sent to the browser (confirmed `src/frontend/api.ts` only ever calls same-origin `/api/geocode`, never embeds a key). Compliant.
- **REV-006 [HARDCODED] minor** — `MIN_QUERY_LENGTH = 3` (`src/frontend/hooks/useLocationField.ts:7`, `api/geocode.ts:8`) and `DEBOUNCE_MS = 300` (`useLocationField.ts:8`) are literal constants absent from design.md §7's schema. See independent-conclusion discussion above. Not a blocker.
- **REV-007 [BLOAT] minor** — `MIN_QUERY_LENGTH` is independently redeclared (same value, no shared source) in both `api/geocode.ts` and `useLocationField.ts`. Drift risk if only one is edited later. See Findings Register.
- `GOOGLE_GEOCODE_ENDPOINT` (`https://maps.googleapis.com/maps/api/geocode/json`, `googleGeocodingService.ts:5`) — a literal URL, but it is the fixed endpoint of the single provider `MAP_ROUTING_PROVIDER` already selects (design.md §3 names Google Maps Platform as the sole recommended/accepted provider), it is injectable via `options.endpoint` for tests, and design.md §7's schema does not list a separate endpoint-URL config key. Consistent with this log's INC-1 precedent for provider-fixed implementation details. **Not flagged.**
- No retry counts, model names, or other new thresholds found hardcoded beyond the above.

### Pass 4 — Leanness audit

- Comments in `src/geo/`, `src/geocoding/`, `api/geocode.ts`, `useLocationField.ts` are substantive and tie back to design.md/FR IDs, not narration. No commented-out code found.
- No unused imports or dead code found in the INC-2 file set.
- Minor duplication already captured as REV-007 above; no other redundant abstractions found. `useLocationField` is a reasonable, non-over-engineered shared abstraction across the three fields (matches design's intent that `applyRadiusCheck` be the only behavioral difference between them).

**No new `[BLOAT]` findings this pass beyond REV-007 (already logged above under Pass 3/Findings Register).**

### Pass 5 — Security audit

- **Committed secrets**: `tests/helpers/testEnv.ts`'s `MAP_API_KEY: "test-api-key-value"` and `PAID_TIER_ACCESS_PASSWORD` defaults (`""` / `"correct-horse-battery-staple"` in `validPaidTierEnv`) are clearly placeholder/test-fixture values, not real credentials, consistent with INC-1's precedent. `.env.example` unchanged, still placeholder-only. **No committed secrets found.**
- **Input at trust boundary**: `api/geocode.ts` forwards the user-supplied `query` string and `lat`/`lng` values to Google's Geocoding API. `query` and coordinate values are placed into `URLSearchParams` (`googleGeocodingService.ts:39-42`), which correctly percent-encodes all values — no injection risk into the outbound URL. The destination host (`GOOGLE_GEOCODE_ENDPOINT`) is a fixed literal, never derived from user input, so there is no SSRF surface here (user input affects query parameters only, never the target host/protocol). `lat`/`lng` are validated as finite numbers (`Number.isFinite`) but not range-checked against valid latitude/longitude bounds (±90/±180) — low-severity: worst case is a wasted/failed provider call, not a security issue, so not logged as a standalone finding.
- **REV-009 [SECURITY] minor** — see Findings Register. Raw config/provider error messages forwarded to the client on the 500/502 paths in `api/geocode.ts`. Formalizing this now (was only "noted for awareness" against `/api/config/public` at the INC-1 audit) since it now repeats on a second endpoint and one concrete example (`"The provided API key is invalid."`) shows it can leak provider-credential-validity information, not just config key names.
- **REV-002 re-scoped, not resolved**: `src/auth/session.ts` is unchanged since INC-1 (still a deterministic, non-expiring HMAC token). The risk calculus named in the original finding ("not a blocker for INC-2 — no protected business endpoint exists yet") **no longer fully holds**: `/api/geocode` is now exactly such an endpoint, and it makes real, billable provider calls when reached. A leaked/copied session cookie in `paid_tier` mode now grants indefinite, unrevocable (short of a full password rotation) access to a cost-incurring endpoint, not just to an inert password screen. This does not change REV-002's severity to blocker — design.md §10 still explicitly scopes the fix to INC-8 ("paid-tier hardening... re-auth behavior"), and the cost exposure is bounded by the same billing-alert mechanism release/runbook already owns (DQ-4) — but the urgency argument for fixing it *before* INC-8, or at minimum before any real `paid_tier` production deployment, is now concrete rather than hypothetical. Recommend the orchestrator relay this explicitly to tech-lead/pm rather than let it ride silently to INC-8.
- No new dependency changes this increment; `npm audit`-equivalent re-check not re-run independently this pass (carried the same caveat as INC-1: reviewer should run it directly at the next audit rather than rely on QA's characterization).

### Summary — INC-2 Pass 1-5

- **New findings**: 1 `[HARDCODED]` minor (REV-006), 1 `[BLOAT]` minor (REV-007), 1 `[SCOPE-CREEP]` minor (REV-008), 1 `[SECURITY]` minor (REV-009). Zero new blockers, zero new majors. Zero `[REQUIREMENTS-GAP]`/`[DESIGN-GAP]`/`[CODE-GAP]`/`[TEST-GAP]` — traceability for FR-001, FR-003, FR-004, FR-015, NFR-006 is complete and nothing is overclaimed.
- **Independent verdicts on the orchestrator's three flagged items**: (1) AuthGate wiring — CONFIRMED from code, matches QA's claim exactly. (2) Radius-check exemption scope — CONFIRMED from code, matches QA's claim exactly. (3) Hardcoded debounce/min-length — PARTIALLY DISAGREE with QA's "not a violation" conclusion; recommend tech-lead make an explicit schema decision rather than leave it implicit (REV-006), not a blocker.
- **Resolved items**: none this pass. REV-002 through REV-005 (from INC-1) remain OPEN and are unaffected/unfixed by INC-2's code changes; REV-002's risk framing is updated (re-scoped) above given `/api/geocode` is now live, though its severity (major) and target-fix increment (INC-8, per design.md §10) are unchanged.
- **Open blocker count: 0.**

**Verdict: INC-2 is cleared to proceed to INC-3.** No blockers. REV-006/007/008/009 are minor, non-urgent items for tech-lead/dev/designer to pick up opportunistically. REV-002 (major, carried from INC-1) should be flagged to tech-lead/pm with the updated urgency note above — recommend the orchestrator confirm with the user whether `paid_tier` is expected to go live in a real deployment before INC-8, since that would change REV-002's timing from "fix by INC-8" to "fix before deploy."

---

## Closure Verification — REV-006, REV-007, REV-009 (2026-07-11)

Targeted closure check only, per the orchestrator's instruction — not a re-run of the full 5-pass audit and not a re-opening of INC-2's cleared status. Verified directly against code (not taken on trust from handoff.md/test-report.md's writeups), against the same three findings logged at the INC-2 audit.

**REV-006 (HARDCODED — `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS`) — CONFIRMED RESOLVED.**
Read `src/config/schema.ts`, `src/config/loader.ts`, `src/config/publicConfig.ts` directly:
- `schema.ts`: `AppConfig` and `PublicConfig` both carry `minGeocodeQueryLength: number` / `geocodeDebounceMs: number`.
- `loader.ts`: both are parsed via the same `parsePositiveNumber(env, KEY, problems, integerOnly: true)` helper used for the other 14 keys — `MIN_GEOCODE_QUERY_LENGTH` and `GEOCODE_DEBOUNCE_MS` are read from `env` with **no in-code fallback/default** anywhere; if unset, they push onto `problems` and `loadConfig` throws `ConfigError` (fail-fast), identical in kind to every pre-existing key. Confirmed this matches tech-lead's design.md §7.1 decision (read directly, not just cited from handoff.md).
- `publicConfig.ts`: `toPublicConfig()` includes both fields in the `GET /api/config/public` shape.
This is a genuine schema promotion, not a partial/cosmetic one — no hardcoded value or fallback default was left behind at any layer.

**REV-007 (BLOAT — duplicate constant) — CONFIRMED RESOLVED.**
Read `api/geocode.ts`, `src/frontend/hooks/useLocationField.ts`, `src/frontend/components/InputScreen.tsx` directly, plus a repo-wide grep for `MIN_QUERY_LENGTH`/`DEBOUNCE_MS =`/`MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS`:
- `api/geocode.ts` line 53 reads `config.minGeocodeQueryLength` off the already-loaded `AppConfig` — no local constant declared anywhere in the file.
- `useLocationField.ts`: no local `MIN_QUERY_LENGTH`/`DEBOUNCE_MS` declarations remain; `UseLocationFieldOptions` requires `minGeocodeQueryLength`/`geocodeDebounceMs` as caller-supplied fields (no default parameter value either), used directly in the debounce `useEffect` (line 104/108) and `onBlur` (line 165).
- `InputScreen.tsx`: `LocationField` threads `config.minGeocodeQueryLength`/`config.geocodeDebounceMs` (from the fetched `PublicConfig` prop) into `useLocationField` — same pattern already used for `geographicCenter`/`geographicRadiusKm`.
- Repo-wide grep found zero remaining numeric-literal redeclarations in `src/`, `api/`, or `scripts/`; all matches outside `docs/`/`tests/` are the config-key string names themselves (env var keys, object property names), not duplicate literal values. Single source of truth confirmed — backend `AppConfig` (one `loadConfig()` call) is the only place either value originates.

**REV-009 (SECURITY — raw error message leakage) — CONFIRMED RESOLVED.**
Read `api/geocode.ts` end to end:
- Config-load-failure path (lines 29-38): catches, logs `message` (the `ConfigError.message` or stringified error) via `console.error` server-side, then responds `500 {"error":"config_error","message":"The service is temporarily unavailable."}` — a fixed, generic string, not `err.message`.
- Provider-error path (lines 84-92): catches, logs the underlying `GeocodingProviderError.message` (or stringified error) via `console.error` server-side, then responds `502 {"error":"provider_error","message":"Unable to reach the geocoding provider right now."}` — again a fixed generic string.
- Confirmed no code path in either catch block forwards `err.message`/`ConfigError.message`/`GeocodingProviderError.message` into the client-facing `res.json()` call — the only place the detailed message is used is the `console.error` line, so server-side debuggability is preserved, not silently dropped, matching the task's specific ask.
Both the 500 and 502 client paths are sanitized; both are still logged server-side. Genuinely resolved, not just relabeled.

**Test suite**: not independently re-run by reviewer (read-only on `tests/`/`src/`), but QA's re-verification (164/164 passing, including new configurability and leak-check tests for all three findings) is consistent with what the code shows on direct reading.

**Not in scope for this check**: REV-008 (scope-creep, `provider_error` field state) was not part of this fix pass and remains OPEN, unaffected — routed to designer/pm as before.

## Note on REV-002 and REV-003 status, per the orchestrator's request

Re-checked both against the current Findings Register and against requirements.md/design.md, without re-litigating either:

- **REV-002** (major — session cookie is a deterministic, non-expiring HMAC token) is recorded in the Register as **OPEN** ("re-scoped at INC-2 audit"), targeted for resolution by INC-8 per design.md §10's own scoping of "paid-tier hardening... re-auth behavior" to that increment. This log itself only shows a *design-doc* scoping decision (design.md §10), not a distinct recorded user sign-off on the deferral — I did not find a separate changelog/decision entry in requirements.md or design.md documenting the user personally approving the INC-8 timeline. If pm/tech-lead have that confirmation from the user through some other channel, it should be written into requirements.md's changelog or design.md per this project's "a decision not written to its owner's artifact did not happen" rule — right now the deferral is traceable to design.md's increment plan, not to an explicit logged user decision. Recommend the orchestrator confirm this was in fact put to the user (as this log recommended at both the INC-1 and INC-2 audits) before treating it as settled.
- **REV-003** (minor — no password-attempt throttling) is recorded in the Register as **OPEN**, not resolved/accepted, with owner `pm` and an explicit recommendation ("pm re-confirm with user") that was never marked as actioned in this log. I found no changelog entry, requirements.md update, or design.md note recording that this conversation with the user happened or that the trade-off was reconfirmed post-INC-1. As logged, REV-003 is still an open recommendation to pm, not a closed item. If this was in fact settled with the user, the record of that decision is missing from the artifacts I'm allowed to read — recommend the orchestrator have pm log it (in requirements.md's changelog, per the change-request/decision-recording convention) so it isn't relying on out-of-band memory.

Both findings' severity/routing/target are otherwise unchanged from the INC-2 audit — this is a status-accuracy check only, not a new evaluation of the underlying risk.

## Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Initial review log created. INC-1 5-pass audit complete: 0 blockers, 1 major (REV-002), 3 minor (REV-003, REV-004, REV-005). Cleared to proceed to INC-2. |
| 2026-07-11 | INC-2 5-pass audit complete: 0 blockers, 0 majors, 4 new minors (REV-006 HARDCODED, REV-007 BLOAT, REV-008 SCOPE-CREEP, REV-009 SECURITY). Independently confirmed AuthGate wiring and the FR-004/DQ-1 radius-exemption scope directly from code (not deferred to QA's framing). Partially challenged QA's judgment call on hardcoded debounce/min-query-length constants — recommend tech-lead make an explicit schema decision. Re-scoped REV-002's urgency now that `/api/geocode` is a live protected endpoint, severity/target unchanged. REV-002 through REV-005 remain open, unaffected by this increment. Cleared to proceed to INC-3. |
| 2026-07-11 | Targeted closure check (not a full audit pass): independently re-verified REV-006, REV-007, and REV-009 directly against `src/config/schema.ts`, `src/config/loader.ts`, `src/config/publicConfig.ts`, `api/geocode.ts`, `src/frontend/hooks/useLocationField.ts`, `src/frontend/components/InputScreen.tsx` (not just handoff.md/test-report.md's writeups). All three confirmed genuinely resolved — see Closure Verification section above. Findings Register updated accordingly. REV-008 unaffected, remains OPEN. Flagged to the orchestrator that REV-002's INC-8 deferral and REV-003's "accepted trade-off" characterization are not backed by a distinct recorded user decision in requirements.md/design.md beyond design.md's own increment scoping — both remain logged as OPEN in the Register, not RESOLVED/CLOSED; recommend confirming and logging the user decision explicitly if it was in fact obtained. |
