# Test Report: DropSpot

Owner: qa. Do not edit outside this agent.

---

## INC-1: Project scaffolding, config loader, `APP_MODE` password gate, app shell

**Verdict: PASS**

Claimed coverage: FR-016, FR-017, NFR-002, partial NFR-001.

### Suite run

- `npm install` — clean (0 vulnerabilities blocking; 9 pre-existing dependency advisories noted, not introduced by this increment, no action required for INC-1).
- `npm run typecheck` (`tsc --noEmit`) — clean, 0 errors.
- `npm run lint` (`eslint .`) — clean, 0 errors, 0 warnings.
- `npm run build` (`vite build`) — clean, produces `dist/` successfully.
- `npm test` (`vitest run`) — **99 passed / 0 failed**, across 11 test files under `tests/`.
- CI pipeline sanity: confirmed `.github/workflows/ci.yml`'s "app scaffolding exists" gate now takes the real branch (package.json present) and would run install → lint → typecheck → test → build in that order, matching the local sequence above exactly. No CI-only divergence found.

Test files added (all under `tests/`, owned by qa):
- `tests/config/loader.test.ts` (35 tests) — config loader happy path, fail-fast/multi-problem reporting, configurability (per-key override checks), all 14 required keys individually missing, `APP_MODE=paid_tier` + missing/empty `PAID_TIER_ACCESS_PASSWORD`, malformed numeric/JSON/enum inputs.
- `tests/config/publicConfig.test.ts` (2 tests) — exact 5-field public shape, secret exclusion (property absence + string-serialization check).
- `tests/auth/verifyPassword.test.ts` (7 tests) — correct/wrong/empty/null/case-sensitivity/prefix cases.
- `tests/auth/session.test.ts` (7 tests) — determinism, per-password uniqueness, rotation invalidation, empty/garbage/null-password rejection.
- `tests/auth/cookies.test.ts` (12 tests) — cookie parsing, `Secure` flag environment logic, `Set-Cookie` header construction.
- `tests/auth/authGate.test.ts` (8 tests) — `free_tier` always-pass (incl. with garbage cookie), `paid_tier` block/allow matrix, cross-array-header handling, rotation invalidation via the gate.
- `tests/api/config-public.test.ts` (7 tests) — happy path, secret-leak check, configurability, config-error 500, `paid_tier`-missing-password 500, method rejection, **and** the dev-flagged unauthenticated-in-`paid_tier` behavior.
- `tests/api/verify-password.test.ts` (11 tests) — `free_tier` 400, correct/wrong password, malformed body, `Secure` flag by `VERCEL_ENV`, issued-cookie round-trips through `AuthGate.check`, rotation invalidates a previously issued cookie, config-error path, method rejection.
- `tests/regression/no-persistence.test.ts` (2 tests) — NFR-003 static spot check: no DB/file-persistence imports anywhere in `src/config`, `src/auth`, `api/`; session mechanism confirmed to be a pure HMAC function, not a store lookup.
- `tests/frontend/App.test.tsx` (4 tests) — `free_tier` renders Input Screen directly; `paid_tier` fresh session renders the gate and *not* the Input Screen; `paid_tier` with an existing `sessionStorage` flag skips the gate; network failure renders a distinct error state (not blank/crash).
- `tests/frontend/PasswordGate.test.tsx` (4 tests) — Continue disabled/enabled by field emptiness, wrong-password exact copy + field-clear behavior, correct-password `onSuccess` + session-flag set.

### Requirement-by-requirement verdict

| ID | Verdict | Basis |
|---|---|---|
| FR-016 | PASS | `AuthGate.check` unit-verified: `free_tier` always passes (no login of any kind); `paid_tier` blocks all of {no cookie, garbage cookie, wrong-password-derived cookie, stale cookie post-rotation} and allows only a cookie derived from the currently configured password. `App.tsx` renders the password-gate screen for `paid_tier` and never renders it for `free_tier`, matching "no partial/feature-specific gating" (there is exactly one binary switch, `appMode`, and nothing else). No protected business endpoint exists yet in INC-1 (by design — `/api/geocode` and `/api/drop-off-search` land in INC-2+), so full end-to-end "no functionality reachable pre-auth" cannot be proven against a real business endpoint yet; this is expected per design.md section 10's own INC-1 scope and is flagged below as a carry-forward check for INC-2. |
| FR-017 | PASS | `loadConfig` reads `APP_MODE` from the environment with no hardcoded default surfacing on a successful load (config loader tests confirm both `free_tier` and `paid_tier` load correctly from env, and that changing the env value changes the resulting mode — configurability explicitly tested, not just presence). `POST /api/auth/verify-password` implements the operator-controlled switch's runtime behavior correctly for both modes. |
| NFR-002 | PASS | `AuthGate.check` returns `true` unconditionally for `free_tier` regardless of any cookie state (tested, including with a garbage cookie present, to rule out an accidental "cookie present == authenticated" bug). `App.tsx` never renders the password gate for `free_tier`. No account/login construct exists anywhere in the codebase for baseline use. |
| NFR-001 (partial) | PASS (partial, as scoped) | Automated coverage for INC-1 is necessarily limited to what doesn't require a real/headless browser viewport harness (not yet a project dependency): confirmed `index.html`'s responsive viewport meta tag is present, and that `ux-spec.md`'s CSS custom-property tokens (`tokens.css`/`global.css`) are referenced by components rather than inline literals (spot-checked by reading `PasswordGate.tsx`/`InputScreen.tsx`, which use `type-*`/`focus-ring` classes, not inline styles). Full responsive/breakpoint verification relies on dev's documented manual Playwright walkthrough at a 390×844 mobile viewport (per handoff.md) — this is consistent with design.md section 10, which explicitly defers the *full* mobile-responsiveness pass to INC-8. Recommend a Playwright (or equivalent) visual/viewport test be added to `tests/` starting no later than INC-8 so this stops depending on a manual walkthrough. |

### Explicit verdicts on the two items dev flagged

**1. `GET /api/config/public` unauthenticated in `paid_tier` mode — ACCEPTABLE, not a bug.**
Tested directly (`tests/api/config-public.test.ts`, "dev-flagged item" block): the endpoint returns `200` with the correct `paid_tier` payload with zero cookie present. This is not a gap against FR-016 as currently specified, for three independent reasons, not just dev's own framing:
- design.md section 5.2 defines this endpoint's contract with no auth requirement, and design.md section 8 (frontend contract) requires the frontend to know `appMode` *before* it can decide whether to render the password gate at all — i.e., the design itself requires this data to be fetchable pre-auth (a chicken-and-egg constraint: the client cannot know a password is required until it asks the server).
- runbook.md section 6 explicitly relies on this exact endpoint being reachable regardless of `APP_MODE`, secret-free, and zero-cost, as the deploy-verification smoke check.
- Independently verified (not just trusted from dev's claim) that the response never contains `mapApiKey` or `paidTierAccessPassword`, in any of the 3 places a leak could occur: property presence, and a full-string search of the serialized JSON body (`tests/config/publicConfig.test.ts`, `tests/api/config-public.test.ts`).
Config metadata (service radius, candidate count, transit modes, app mode) is not "functionality" in FR-016's sense — no user data, no business feature, and no billable provider call is exposed. Verdict: working as intended; no fix required.

**2. Client-side + server-cookie gate (no CDN/edge-level block) — ACCEPTABLE for INC-1's scope, with one carry-forward check flagged to QA's own INC-2 pass.**
Independently checked against `ux-spec.md` section 3, which defines the gate as: "Fully replaces the app; nothing behind it is reachable... this is a hard block per FR-016" — read in context, this describes the *UI experience* (no other screen/functionality is rendered or reachable without passing the gate), not a network/infrastructure-level block, and ux-spec.md explicitly assigns the exact mechanism ("This can be a client-side session flag only... exact mechanism is a dev/tech-lead implementation choice") to dev/tech-lead. design.md never calls for an edge/CDN block anywhere (section 2, 5.1, 8, or the INC-1 scope in section 10). Given INC-1 introduces **zero** protected business endpoints yet (confirmed by reading `api/`: only `config/public.ts`, itself intentionally public, and `auth/verify-password.ts`, the gate's own endpoint), there is nothing of value reachable pre-authentication today. `AuthGate` itself is correctly implemented and thoroughly unit-tested (8 tests covering the full block/allow matrix including rotation). Verdict: PASS for INC-1's actual scope. Not filing a bug. Flagging forward (not a blocker): when INC-2 introduces `/api/geocode` (and later `/api/drop-off-search`), QA will explicitly verify that endpoint is wrapped by `AuthGate.check` before signing off — if a future protected endpoint is added without wrapping itself in `AuthGate`, *that* would be a genuine FR-016 violation. Also echoing dev's suggestion: worth a one-line confirmation from tech-lead that no edge-level block was intended, purely to close the open question, not because current evidence points to a gap.

### Non-blocking observations (not filed as bugs — no FR/NFR is violated)

1. `index.html`'s viewport meta tag includes `maximum-scale=1.0`, which disables pinch-to-zoom. NFR-001 only requires "responsive and usable on mobile browser viewports," which doesn't explicitly mandate zoom support, so this isn't filed as a bug — but it's a common accessibility anti-pattern (WCAG 1.4.4) worth reviewer's attention during the accessibility pass.
2. `tsconfig.json`'s `include` list (`src`, `api`, `scripts`, `vite.config.ts`) does not include `tests/`, so `npm run typecheck` does not type-check QA's test files (vitest's esbuild transform still runs them, so genuine syntax errors would surface as test failures, but non-emitting type errors in `tests/` would not be caught by the `typecheck` script specifically). Not a bug against any FR/NFR; flagging so dev/tech-lead can decide whether to broaden `include` in a later increment.

### Bugs filed

**None.** Zero BUG-NNN entries for INC-1 — all claimed FR/NFR coverage passed against the requirements/design/ux-spec documents, and the full regression suite (99/99) plus the CI-equivalent pipeline (install/lint/typecheck/test/build) are clean.

---

## INC-2: Location input, geocoding, radius validation

**Verdict: PASS**

Claimed coverage: FR-001, FR-003, FR-004, FR-015, NFR-006.

### Suite run (full regression, not just new tests)

- `npm run typecheck` (`tsc --noEmit`) — clean, 0 errors.
- `npm run lint` (`eslint .`) — clean, 0 errors, 0 warnings.
- `npm run build` (`vite build`) — clean, produces `dist/` successfully.
- `npm test` (`vitest run`) — **149 passed / 0 failed**, across 15 test files (99 pre-existing INC-1 tests + 50 new INC-2 tests). **Zero regressions** — every INC-1 test still passes unmodified.
- Independent real-HTTP smoke test against the actual local dev server (`npm run dev`, dev-only Vite middleware bridge), not just direct handler invocation — see "AuthGate" section below.

Test files added (all under `tests/`, owned by qa):
- `tests/api/geocode.test.ts` (19 tests) — the critical AuthGate-wiring matrix (free_tier success, paid_tier no-cookie/garbage-cookie/rotated-password-cookie all 401 **with the provider fetch spy asserted never called**, paid_tier valid-cookie success), forward-geocode happy path, FR-003 zero-results-as-empty-array, query-too-short (400), whitespace-only query, provider-status error mapping (502), network-failure mapping (502), reverse-geocode happy path, reverse-geocode zero-results, invalid lat/lng (400), missing query/point (400), method rejection (405), config-error-before-authgate ordering (500).
- `tests/geocoding/googleGeocodingService.test.ts` (10 tests) — `resolve()`/`reverseGeocode()` against an injected fake provider: OK mapping, ZERO_RESULTS-as-empty-array (not throw), empty/whitespace short-circuit (no provider call made), non-OK provider status → `GeocodingProviderError`, non-OK HTTP status, network failure, malformed response shape, apiKey correctly forwarded in the request, ZERO_RESULTS on reverse geocode throws (tagged) rather than silently returning a fake label.
- `tests/geo/radiusValidator.test.ts` (8 tests) — `haversineDistanceKm` sanity (identical points, a real-world distance range, symmetry), `isWithinServiceArea` happy path, out-of-radius rejection, inclusive `<=` boundary check (a point just inside vs. just outside the exact configured radius), and two explicit **configurability** checks (widening `GEOGRAPHIC_RADIUS_KM` flips a rejected point to accepted; changing `GEOGRAPHIC_CENTER` flips which points are in-area) — this directly tests NFR-006's "configurable radius/configurable center" language, not just the default values.
- `tests/frontend/InputScreen.test.tsx` (13 tests) — FR-001 (all three fields render), FR-015 happy path (typed query → suggestion → resolved field with check icon), FR-015 "use my current location" happy path (mocked Geolocation + reverse geocode → field populated + "Current location" badge), FR-015 geolocation-unavailable edge case (no silent failure), FR-003 (zero-result address shows the exact unresolvable copy), **the FR-004/DQ-1 exemption scope, tested precisely in three directions** (destination blocked, the identical far address on passenger-destination accepted with no error, and the same address confirmed still blocked on the start field too — ruling out an accidental "any field is exempt" bug), two NFR-006 configurability checks (widened radius accepts a previously-rejected point; changed center label appears verbatim in the danger copy, not a hardcoded "Toronto"), debounce/min-length behavior (sub-3-char input never calls the geocoder; rapid keystrokes collapse into exactly one debounced call), and a directed regression test for the blur-vs-in-flight-request race dev flagged as a known limitation (asserts the final state always converges to the correct resolved suggestion, not just that it doesn't crash).
- `tests/helpers/mockVercel.ts` — extended (not new) to accept a `query` object in `MockReqInit`, needed to exercise `/api/geocode`'s two query shapes; purely additive, does not change existing call sites' behavior (verified via the still-passing INC-1 suite).

### Requirement-by-requirement verdict

| ID | Verdict | Basis |
|---|---|---|
| FR-001 | PASS | `InputScreen` renders exactly three location fields ("Your start point", "Your destination", "Passenger's destination"), each independently wired via `useLocationField`. Verified by direct DOM inspection, not just presence of markup from INC-1 (INC-1's fields were non-functional placeholders; INC-2 confirms they are now live). |
| FR-003 | PASS | An address that resolves to zero geocode results is surfaced as a clear inline error ("We couldn't find that address. Try a more specific address or a nearby cross street.") at the field level, matching ux-spec.md section 4.1's exact copy. Verified at three layers: the provider-mapping layer (`GoogleGeocodingService`, ZERO_RESULTS → `[]`, not a throw), the endpoint layer (`/api/geocode` returns `200 {results:[]}`, not an error status, for both forward and reverse shapes), and the UI layer (the field renders the exact copy, danger-styled). |
| FR-004 | PASS | Independently re-verified the exact scope dev flagged as easy to get backwards: a single far-away resolved address is (a) **blocked** with the out-of-service-area message on "Your start point", (b) **blocked** on "Your destination" (driver's destination), and (c) **accepted with no radius error at all** on "Passenger's destination" — all three checked with the identical coordinate pair in the same test suite, not just the two "different fields, different addresses" spot checks a less careful pass might settle for. Server-side, `/api/geocode` itself performs no radius check at all (correctly out of INC-2's server scope per design.md section 5.2 — that's `/api/drop-off-search` in INC-4+); the check is entirely client-side via the shared, isomorphic `RadiusValidator`, exercised directly in `tests/geo/radiusValidator.test.ts` and again through the UI in `tests/frontend/InputScreen.test.tsx`. |
| FR-015 | PASS | Both input methods work: typed address with debounced autocomplete (suggestion list, keyboard/ARIA combobox pattern present, selection resolves the field) and "use my current location" (mocked Geolocation API → reverse-geocode → field populated with a human-readable label + "Current location" badge, matching ux-spec.md section 4.1). Geolocation-unavailable path shows the specified fallback copy rather than leaving the field unexplained (ux-spec's "never fail silently" principle, section 0). |
| NFR-006 | PASS | Both the radius and the center point are genuinely configurable, not hardcoded, at every layer this increment touches: (1) `RadiusValidator.isWithinServiceArea` unit-tested with multiple distinct radius/center values, confirming behavior changes when the config value changes, not just that a default value is read; (2) the same shown at the UI layer — a point rejected under the default 200km/Toronto config is accepted once the `PublicConfig` prop supplies a wider radius or a different center, **and** the rendered error copy substitutes the actual configured center label/radius rather than a hardcoded "Toronto"/"200". This is exactly the configurability check CLAUDE.md's QA responsibilities call for (change a config value, verify behavior changes) applied to NFR-006 specifically. |

### The orchestrator's critical flag: `/api/geocode` behind `AuthGate.check()` — independently verified, PASS

This was treated as the single most important thing to verify in this increment, per the orchestrator's explicit instruction and reviewer's carried-forward INC-1 note. Verified at **two independent levels**, not just by reading dev's handoff claim:

1. **Direct handler invocation** (`tests/api/geocode.test.ts`), covering the full matrix: `free_tier` (no cookie needed, request reaches the provider); `paid_tier` + no cookie → `401 unauthorized`; `paid_tier` + wrong/garbage cookie → `401`; `paid_tier` + a cookie valid under a since-rotated password → `401`; `paid_tier` + a valid session cookie → passes through to the provider call and returns `200`. Critically, for every `401` case, the test asserts the provider `fetch` spy was **never called** — this proves `AuthGate.check()` runs and short-circuits *before* any billable provider call is attempted, not merely that the final HTTP status happens to be 401 for some unrelated reason (e.g., a coincidental downstream error). Also confirmed `AuthGate.check()` is evaluated before the `query`-shape validation (a too-short query with no auth still returns `401`, not `400` — the wrong body would leak information about internal validation rules to an unauthenticated caller).
2. **Real HTTP, against the actual local dev server** (`npm run dev`, hitting `localhost:5173` with `curl`, exactly the way a real client would) — independently reproducing dev's own claimed smoke test rather than trusting it: with `APP_MODE=paid_tier`, `GET /api/geocode?query=...` with no cookie returned `401 {"error":"unauthorized"}`; with a garbage cookie, also `401`; after `POST /api/auth/verify-password` with the correct password and reusing the resulting `Set-Cookie` value, the same request passed AuthGate and reached the (deliberately invalid, dummy) Google API key, correctly surfacing `502 {"error":"provider_error","message":"The provided API key is invalid. "}` — i.e., the request provably passed through `AuthGate` and all the way to the real outbound provider call, not blocked or short-circuited anywhere in between. Also confirmed `free_tier` mode reaches the provider with **no cookie at all** (same `502`, not `401`), confirming the gate is mode-sensitive in both directions, not just "always blocks" or "always passes." `GET /api/config/public` was reconfirmed to remain `200`/unauthenticated in `paid_tier` mode throughout (INC-1 behavior, unaffected by this increment).

**Conclusion: dev's claim is correct.** `/api/geocode` is genuinely, provably wrapped by `AuthGate.check()`, checked before any provider call, in both directions (blocks correctly in `paid_tier`, does not block in `free_tier`). This closes reviewer's REV-002-adjacent carry-forward note from the INC-1 audit ("AuthGate's real test comes when the first protected business endpoint lands") with a PASS.

### Assessment of dev's flagged known limitations (handoff.md, INC-2 section)

1. **No real `MAP_API_KEY` available in this environment.** Not a QA concern to file — all success-path behavior was independently verified against injected/mocked fetch implementations at the unit level (`googleGeocodingService.test.ts`), at the endpoint level (`geocode.test.ts`), and at the real-HTTP level with a deliberately-invalid real key (confirms the error-mapping path against Google's actual API, matching dev's own claim). Recommend, as dev already did, a real-key pass before final sign-off/production launch — but this does not block INC-2's QA sign-off, since every code path this increment introduces has been exercised.
2. **Autocomplete uses the Geocoding API's `address=` parameter, not Places Autocomplete.** Not a bug: FR-015 itself says "a geocoding **or** places lookup" — a geocoding-only implementation is explicitly permitted by the requirement as worded, not just a design interpretation. Flagging forward (as dev did) that if partial-prefix "as-you-type" suggestions turn out to be an implicit UX expectation, that is a product/UX conversation for pm/designer, not a QA-filed defect against any current FR.
3. **Debounce (300ms) and `MIN_QUERY_LENGTH` (3 chars) are literal constants, not config-file entries.** Assessed against the project's "no hardcoded tunables" non-negotiable and judged **not a violation**: neither requirements.md's Configuration section nor design.md section 7's config schema lists a debounce or minimum-query-length tunable, and ux-spec.md section 4.1 explicitly frames the exact value as "a dev/tech-lead implementation detail, not specified here" (i.e., deliberately delegated, not omitted by oversight). This is consistent with reviewer's own INC-1 precedent (Pass 3: `SESSION_COOKIE_NAME`/`TOKEN_MESSAGE` treated as internal implementation constants, not flagged, because they aren't in design.md's config schema either). By contrast, `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM` — which *are* in the schema — were independently confirmed fully configurable in this pass (see NFR-006 above), which is the actual scope of the non-negotiable as applied to this increment. Recommend reviewer independently confirm this same conclusion during the INC-2 audit, since it's a judgment call rather than a mechanical check.
4. **`REQUEST_TIMEOUT_MS` not yet wired into the geocoding call.** Not a gap for INC-2: design.md section 6.3/10 explicitly scopes per-call timeout hardening to INC-7. No test was written expecting timeout behavior in this increment for the same reason.
5. **Blur-triggered "unresolvable" one-frame race.** Independently reproduced and verified rather than taken on trust: added a directed test (`tests/frontend/InputScreen.test.tsx`, "known-limitation follow-up" block) that blurs a field immediately after typing a valid query — before the 300ms debounce elapses — and confirms the field converges to the correct resolved suggestion once the in-flight request completes, with no error state left stuck. Judged **not a bug** worth blocking sign-off: it's a cosmetic, self-correcting flash with no data-integrity or requirement violation, and ux-spec.md does not specify an exact debounce/blur-interaction timing that this would contradict.
6. **Passenger-destination exemption enforced only client-side (no server-side check exists yet since `/api/drop-off-search` isn't built until INC-4+).** Confirmed accurate by reading `api/geocode.ts` in full — it contains no radius-check logic at all, consistent with design.md section 5.2 scoping the radius-check-in-request-validation-order behavior to `/api/drop-off-search`, not `/api/geocode`. Noting, as dev did, that this exemption must be independently re-verified server-side once INC-4 lands; recording this as a carry-forward flag for QA's own future INC-4 pass, not a current-increment gap.
7. **CTA and detour-minutes field remain non-functional placeholders.** Confirmed unchanged from INC-1 and correctly out of INC-2 scope per design.md section 10 (FR-002/search itself is INC-3/INC-6).

### Non-blocking observations (not filed as bugs — no FR/NFR is violated)

- None new this increment beyond the two carried forward from INC-1 (`maximum-scale=1.0` viewport meta tag; `tests/` omitted from `tsconfig.json`'s `include`) — both remain open per the review log, unaffected by this increment's changes.

### Bugs filed

**None.** Zero BUG-NNN entries for INC-2 — every claimed FR/NFR passed against requirements.md/design.md/ux-spec.md (not just against what the code happens to do), the critical AuthGate-wiring claim was independently reproduced at both the unit and real-HTTP level, the FR-004/DQ-1 exemption scope was verified precisely in all three directions, and the full regression suite (149/149, including all 99 pre-existing INC-1 tests unmodified) plus the CI-equivalent pipeline (typecheck/lint/build/test) are clean.

---

## Follow-up re-verification pass on INC-2 (2026-07-11): REV-006, REV-007, REV-009

**Verdict: PASS**

Scope: dev's opportunistic fix pass promoting `MIN_QUERY_LENGTH`/`DEBOUNCE_MS` into config keys `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` (REV-006/REV-007, per design.md section 7/7.1) and sanitizing client-facing error messages on `/api/geocode`'s 500/502 paths while preserving server-side logging (REV-009). Does not reopen INC-2's cleared status; this is a diff against already-passed code, re-verified per CLAUDE.md's increment-loop rules.

### 1. Fixture fix (dev-flagged gap, plus additional QA-discovered scope)

Dev flagged that `tests/helpers/testEnv.ts`'s `validEnv()` and the hardcoded `PublicConfig` literals in `tests/frontend/InputScreen.test.tsx`/`App.test.tsx` predate the new config keys. Confirmed this by running the suite before any fix: **7 test files failed, 42/149 tests failing** (not just the 3 files dev named — the gap also cascaded into `tests/config/loader.test.ts`, `tests/config/publicConfig.test.ts`, `tests/api/config-public.test.ts`, and indirectly `tests/api/verify-password.test.ts`, since `loadConfig()` now throws for any env missing the two new required keys and those files' hardcoded exact-shape assertions predate the schema change too). Fixed all of the following, all under `tests/` (QA-owned):
- `tests/helpers/testEnv.ts` — added `MIN_GEOCODE_QUERY_LENGTH: "3"` / `GEOCODE_DEBOUNCE_MS: "300"` to `validEnv()`.
- `tests/frontend/InputScreen.test.tsx`, `tests/frontend/App.test.tsx` — added `minGeocodeQueryLength: 3` / `geocodeDebounceMs: 300` to the hardcoded `PublicConfig` literals.
- `tests/config/loader.test.ts` — renamed `ALL_14_KEYS` → `ALL_16_KEYS` including the two new keys (so the "missing key" fail-fast loop and the "every key missing" problem-list check now cover them automatically); updated the happy-path `toEqual` shape to include `minGeocodeQueryLength`/`geocodeDebounceMs`; added dedicated configurability and invalid-input tests for both new keys (see section 2 below).
- `tests/config/publicConfig.test.ts` — updated the "exactly N fields" assertion from 5 to 7 fields; added a configurability test.
- `tests/api/config-public.test.ts` — updated the happy-path `toEqual` shape to include both new fields; added a configurability test.

After these fixes: **full suite 15/15 files, 164/164 tests passed** (see section 4). `npm run typecheck`, `npm run lint`, `npm run build` all clean.

### 2. Independent verification of REV-006/REV-007 (config promotion, single source of truth, configurability)

- **Sourced from config, not hardcoded** — confirmed by reading code, not just handoff.md's claim: `src/config/schema.ts`/`loader.ts`/`publicConfig.ts` define and parse `minGeocodeQueryLength`/`geocodeDebounceMs` with no code-level fallback (same required-env-var pattern as the other 14 keys); `api/geocode.ts` reads `config.minGeocodeQueryLength` directly off the already-loaded `AppConfig`; `useLocationField.ts` takes both as required `UseLocationFieldOptions` fields with no default; `InputScreen.tsx` threads `config.minGeocodeQueryLength`/`config.geocodeDebounceMs` from the fetched `PublicConfig` into every `LocationField`.
- **Exactly one source of truth, no duplicate constants** — grepped `src/`, `api/`, `scripts/` for `MIN_QUERY_LENGTH`, `DEBOUNCE_MS = <number>`, and similar numeric-literal patterns: zero matches anywhere in production code. The backend `AppConfig` (loaded once via `loadConfig()`) is the sole source; the frontend has no local copy/fallback.
- **Configurability proven, not just threaded through unused** — added and ran tests confirming a *changed* value changes real behavior at every layer:
  - Backend: lowering `MIN_GEOCODE_QUERY_LENGTH` to 1 lets a 2-character query reach the provider that the default-3 config would reject; raising it to 5 rejects a 4-character query the default-3 config would accept (`tests/api/geocode.test.ts`).
  - Config loader/public endpoint: changed `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` values are reflected in `AppConfig` and in `GET /api/config/public`'s response body (`tests/config/loader.test.ts`, `tests/config/publicConfig.test.ts`, `tests/api/config-public.test.ts`).
  - Frontend: a `minGeocodeQueryLength: 1` config triggers a lookup at 2 characters (which the default-3 config does not); a `minGeocodeQueryLength: 5` config suppresses a lookup at 4 characters (which the default-3 config allows); a `geocodeDebounceMs: 1000` config delays the request past the point where the default-300ms config would already have fired (`tests/frontend/InputScreen.test.tsx`).
  - Invalid-input coverage added for both new keys (non-integer, zero/negative rejected by the loader) matching the existing pattern for other integer config keys.
- **Conclusion: REV-006 and REV-007 are genuinely resolved.** Config-driven, single-sourced, and independently proven to change behavior when changed — not merely relocated literals.

### 3. Independent verification of REV-009 (error message sanitization)

- **Code review**: confirmed both catch blocks in `api/geocode.ts` (config-load failure → 500, provider-error → 502) log the detailed underlying message via `console.error` server-side and return a fixed generic message to the client (`"The service is temporarily unavailable."` / `"Unable to reach the geocoding provider right now."`), with no code path forwarding `err.message` into the client JSON response.
- **Unit tests added** (`tests/api/geocode.test.ts`) asserting the exact response body does not contain the raw provider text (`"The provided API key is invalid"`, `"API key"`) or raw config validation text (`"MAP_API_KEY"`, `"is required but was not set"`), that it does contain the expected generic message, and — critically, to guard against a debuggability regression — that `console.error` was actually called with the detailed message (not silently dropped).
- **Real end-to-end reproduction, not just mocked**: started the local dev server (`npm run dev`) with a genuinely invalid `MAP_API_KEY` and made a real outbound HTTPS call to Google's live Geocoding API. Confirmed:
  - `GET /api/geocode?query=123%20Main%20St` → `HTTP/1.1 502`, body exactly `{"error":"provider_error","message":"Unable to reach the geocoding provider right now."}` — Google's real response (`"The provided API key is invalid. "`) does **not** appear anywhere in the client-visible body.
  - Server stderr log contained `[api/geocode] provider request failed: The provided API key is invalid.` — confirms the detail is still captured server-side, not lost.
  - With `MAP_API_KEY` unset entirely: `HTTP/1.1 500`, body exactly `{"error":"config_error","message":"The service is temporarily unavailable."}`, with the server log containing `[api/geocode] config load failed: Invalid configuration:\n- MAP_API_KEY is required but was not set.`.
  - `.env.local` used for this test was a temporary scratch file, removed after the check; never committed.
- **Conclusion: REV-009 is genuinely resolved.** Both the 500 and 502 client-facing paths are sanitized; server-side logging is preserved (no debuggability regression); verified against a real provider response, not only a mock.

### 4. Full regression suite

- `npm run typecheck` (`tsc --noEmit`) — clean, 0 errors.
- `npm run lint` (`eslint .`) — clean, 0 errors, 0 warnings.
- `npm run build` (`vite build`) — clean.
- `npm test` (`vitest run`) — **164 passed / 0 failed**, across all 15 test files (149 pre-existing + 15 new: 2 REV-009 leak/logging tests, 2 backend REV-006/007 configurability tests, 3 frontend REV-006/007 configurability tests, 4 config-loader/public-config configurability/invalid-input tests for the two new keys). Zero regressions — every pre-existing INC-1/INC-2 test still passes.

### Bugs filed

**None.** REV-006, REV-007, and REV-009 are all independently confirmed resolved against the underlying findings (not just against dev's self-report), with new automated coverage added for configurability (the specific thing REV-006/007 were about) and for the exact client-facing response body plus preserved server-side logging (the specific thing REV-009 was about). Recommend the orchestrator route this back to reviewer to formally close REV-006/REV-007/REV-009 in `docs/review-log.md`'s Findings Register.

---

## Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Initial test report for INC-1: PASS, 99/99 tests across 11 files, 0 bugs filed, explicit verdicts recorded on the two dev-flagged items (unauthenticated public-config endpoint, client-side-only gate). |
| 2026-07-11 | INC-2 test report: PASS, 149/149 tests across 15 files (50 new, 0 regressions), 0 bugs filed. Independently verified (unit + real-HTTP) that `/api/geocode` is genuinely gated by `AuthGate.check()` before any provider call, in both `free_tier` and `paid_tier`. Verified the FR-004/DQ-1 radius-exemption scope precisely (start + driver destination blocked, passenger destination exempt, same address in all three fields). Verified NFR-006 configurability of both radius and center at the validator and UI layers. Assessed all 7 of dev's flagged known limitations; judged none as bugs, with reasoning recorded for reviewer to independently re-check (esp. item 3, the hardcoded-tunables judgment call). |
| 2026-07-11 | Follow-up re-verification pass on INC-2 (REV-006/REV-007/REV-009): PASS, 164/164 tests across 15 files (15 new, 0 regressions), 0 bugs filed. Fixed the fixture gap dev flagged (`tests/helpers/testEnv.ts`, `InputScreen.test.tsx`/`App.test.tsx`) plus a broader cascade QA discovered independently (`loader.test.ts`, `publicConfig.test.ts`, `config-public.test.ts`). Independently confirmed REV-006/REV-007 resolved: config-sourced, single source of truth (no duplicate literals anywhere in `src`/`api`/`scripts`), and configurability proven end-to-end (backend, config loader/public endpoint, and frontend all change behavior when the config value changes). Independently confirmed REV-009 resolved: unit tests plus a real end-to-end reproduction (live dev server, real Google API call with an invalid key) show the exact client response body never leaks provider/config detail, while server-side `console.error` logging is preserved (no debuggability regression). Recommend orchestrator route to reviewer to formally close REV-006/REV-007/REV-009. |
