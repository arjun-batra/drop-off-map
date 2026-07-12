# Handoff: INC-1 — Project scaffolding, config loader, APP_MODE auth gate, app shell

Status: implemented, smoke-tested, ready for QA.
Covers: FR-016, FR-017, NFR-002, partial NFR-001, config keys `APP_MODE`/`PAID_TIER_ACCESS_PASSWORD`/`MAP_API_KEY` (and the rest of design.md section 7's schema, loaded end-to-end even though most aren't consumed by logic until later increments).

## Tech stack chosen

Design.md section 2 left the framework open (only pinning "stateless SPA + stateless serverless-friendly backend," Vercel per the runbook). Chosen stack:

- **Frontend**: Vite + React 18 + TypeScript, single-page (no router — matches ux-spec.md's "single linear flow" principle).
- **Backend**: Vercel serverless functions under `api/**.ts` (the file-path convention Vercel auto-deploys), each a thin handler that delegates to pure, framework-agnostic modules in `src/`.
- **Business logic** (`src/config/*`, `src/auth/*`): plain TypeScript, no Vercel/React dependency, so QA can unit test them directly with plain objects (no HTTP server needed).
- Test runner: **Vitest** (jsdom environment configured, so both pure-function and future React-component tests work without QA needing to touch config).
- Lint: ESLint 9 flat config (`eslint.config.js`) with `@typescript-eslint` + `eslint-plugin-react-hooks`.

## Files created

**Project scaffolding**
- `package.json`, `package-lock.json` — `dev`, `build`, `typecheck`, `lint`, `test` scripts. `test` uses `vitest run --passWithNoTests` deliberately, so CI doesn't fail merely because QA hasn't added test files yet for this increment — real tests added later run normally.
- `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `vercel.json`, `index.html`
- `.env.example` — documents every env var from design.md section 7 / runbook.md section 4 with example (non-secret) values, for local setup.
- `.gitignore` — excludes `node_modules`, `dist`, `.vercel`, `.env*`.
- `scripts/viteApiMiddleware.ts` — **local-dev tooling only**, not shipped to production. Lets `npm run dev` serve `/api/*` in-process (via Vite middleware) by calling the same `api/**.ts` handler modules Vercel deploys, without needing a Vercel account/CLI for local iteration. Vite's own env loading was also wired up in `vite.config.ts` to copy `.env.local` values onto `process.env`, since the API handlers read `process.env` directly (matching Vercel's runtime), not `import.meta.env`.

**Config loader** (`src/config/`)
- `schema.ts` — `AppConfig` / `PublicConfig` types, mirroring design.md section 5.1 exactly.
- `loader.ts` — `loadConfig(env)`: pure function, reads **every** key in design.md section 7 from environment variables (no hardcoded defaults anywhere in code — operators set defaults by setting the env var itself, per runbook.md section 4's table). Throws `ConfigError` listing every violation found (not just the first) if anything is missing/malformed. Fails fast on `APP_MODE=paid_tier` with no `PAID_TIER_ACCESS_PASSWORD`, per design.md section 10/INC-1.
- `publicConfig.ts` — `toPublicConfig()`, strips secrets for the public endpoint.

**Auth** (`src/auth/`)
- `verifyPassword.ts` — constant-time password comparison (hashes both sides to fixed-length digests before `timingSafeEqual`, so timing doesn't leak either string's length).
- `session.ts` — stateless session token: HMAC-SHA256 of a fixed message keyed by the configured password. No server-side session store needed (consistent with the no-DB, stateless architecture in design.md section 2 and NFR-003) — rotating the password invalidates all outstanding sessions automatically.
- `cookies.ts` — cookie header parsing + `Set-Cookie` building (Secure flag only applied on Vercel production/preview, omitted for local plain-http dev).
- `authGate.ts` — implements design.md section 5.1's `AuthGate.check(req, config)` interface. `free_tier` always passes; `paid_tier` requires a valid session cookie. Framework-agnostic (`GateableRequest` only needs a `headers` object), reusable by any future protected endpoint (INC-2+).

**API endpoints** (`api/`)
- `config/public.ts` — `GET /api/config/public`, per design.md section 5.2. Returns `{ appMode, geographicCenter, geographicRadiusKm, maxCandidatesReturned, transitModesIncluded }`. Deliberately **not** behind `AuthGate`, even in `paid_tier` mode — runbook.md section 6 relies on this being an always-reachable, secret-free, zero-cost health check regardless of `APP_MODE`. On a config-loader failure, returns `500` with the validation problems, which is exactly what the runbook's deploy-verification step checks for.
- `auth/verify-password.ts` — `POST /api/auth/verify-password`. `400` if `APP_MODE` isn't `paid_tier` (nothing to verify); `401` + `{"error":"invalid_password"}` on a wrong password; `200` + `Set-Cookie` on success.

**Frontend** (`src/frontend/`)
- `main.tsx`, `App.tsx` — app shell. Fetches `/api/config/public` on mount; if `appMode === "paid_tier"` and no valid client session flag, renders the password gate; otherwise renders the Input Screen shell. Handles a basic loading state and a network-failure state.
- `components/PasswordGate.tsx` (+ `.css`) — Screen 0 per ux-spec.md section 3: lock icon, title, password field with Show/Hide toggle, disabled Continue until non-empty, "Checking…" submitting state, inline red error + field-clear + refocus on wrong password (exact copy: "Incorrect password. Please try again.").
- `components/InputScreen.tsx` (+ `.css`) — Screen 1 shell per ux-spec.md section 4: title/tagline, three location fields + "use my current location" buttons, detour-minutes field, CTA button — **all visual scaffolding only, not wired to geocoding/search yet** (INC-2/INC-3 scope per design.md). CTA and "use current location" buttons are disabled with an explicit caption so this is never mistaken for working functionality.
- `sessionFlag.ts` — client-side `sessionStorage` flag so the user isn't re-prompted for the password on every in-tab navigation (ux-spec.md section 3's persistence note). This is a UX convenience only — the real security boundary is the server-side session cookie checked by `AuthGate`.
- `styles/tokens.css`, `styles/global.css` — ux-spec.md section 2's color/spacing/type/shape tokens implemented as CSS custom properties + utility classes, so components reference tokens (`var(--color-brand-primary)`, `.type-h1`, etc.) rather than inline literal values, per the spec's explicit instruction.
- `api.ts` — thin fetch wrapper for the two INC-1 endpoints.

## How to run locally

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values (a dummy `MAP_API_KEY` is fine for INC-1 — it's not called yet).
3. `npm run dev` → http://localhost:5173. This single command serves both the frontend and `/api/*` (via the dev-only Vite middleware bridge described above) — no Vercel CLI/account needed for local iteration.
4. To exercise `paid_tier` mode locally: set `APP_MODE=paid_tier` and a `PAID_TIER_ACCESS_PASSWORD` in `.env.local`, restart `npm run dev` (env is loaded once at server start).

Production/preview deploys use Vercel's native build (per `vercel.json` + `docs/runbook.md`), which runs the real `api/**.ts` handlers directly — the dev middleware in `scripts/viteApiMiddleware.ts` is never part of that path.

## Smoke test performed

All of the following were run and passed locally before this handoff:
- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- `npm test` — exits 0 via `--passWithNoTests` (no test files yet; QA owns `tests/`).
- `GET /api/config/public` in `free_tier` → `200` with correct non-secret payload, no secrets present.
- `GET /api/config/public` in `paid_tier` with `PAID_TIER_ACCESS_PASSWORD` unset → `500` `config_error` (fail-fast confirmed).
- `POST /api/auth/verify-password` in `free_tier` → `400 not_applicable`.
- `POST /api/auth/verify-password` in `paid_tier`: wrong password → `401 invalid_password`; correct password → `200` + `Set-Cookie: dropspot_session=...; HttpOnly; SameSite=Lax` (no `Secure` locally over http, as designed).
- `src/auth/authGate.ts`'s `AuthGate.check()` exercised directly (no protected endpoint exists yet to hit over HTTP): confirmed `free_tier` always passes, `paid_tier` blocks with no/wrong cookie and passes with a valid one.
- Full browser walkthrough via Playwright (390×844 mobile viewport):
  - `paid_tier`, fresh browser context → password gate shown (never bypassed for a new session).
  - Wrong password → red field border, cleared input, inline error text, refocus — matches ux-spec.md section 3 exactly.
  - Correct password → transitions to the Input Screen; reloading the page in the same tab skips the gate again (sessionStorage flag).
  - `free_tier` → gate never shown, Input Screen renders directly.
  - Input Screen renders three location fields, "use my current location" buttons, detour field, and a disabled CTA with the "coming in a later increment" caption, per ux-spec.md section 4.

## Known limitations / things for QA and reviewer to be aware of

1. **`GET /api/config/public` is intentionally unauthenticated even in `paid_tier` mode.** This is a deliberate reading of runbook.md section 6 (it must be a secret-free, always-reachable smoke check regardless of `APP_MODE`), not an oversight. Flagging explicitly in case reviewer's security pass wants tech-lead to confirm this interpretation.
2. **The password gate is enforced client-side (React render logic) + a server-side session cookie for future protected endpoints — not a CDN/edge-level block.** The static HTML/JS shell itself is always servable (no Vercel Edge Middleware was added); "hard block" per FR-016 is implemented as "no functionality is reachable without a valid session," not "the bytes of the page are unreachable." No protected business endpoint exists yet in INC-1 to verify this end-to-end (that starts at INC-2 with `/api/geocode`); `AuthGate` is built and unit-verified now so those future endpoints just need to wrap themselves with it. Flag to tech-lead if a stronger (edge-level) block is actually intended — design.md doesn't call for one.
3. **Input Screen fields are non-functional placeholders** (typeable text inputs, but no validation, autocomplete, geocoding, or "current location" wiring, and the submit CTA is disabled). This is explicitly INC-1 scope per design.md section 10 ("present," not "wired"); INC-2/INC-3 wire them up.
4. **Session token has no expiry field** — it's a true HTTP session cookie (no `Max-Age`/`Expires`), so it lasts until the browser closes, and is also invalidated instantly if the operator rotates `PAID_TIER_ACCESS_PASSWORD`. No numeric session-lifetime tunable was introduced since none is in design.md section 7's config schema; flag to tech-lead if a configurable session lifetime is wanted later.
5. `MAP_API_KEY` is loaded and validated as present but never actually called against Google Maps Platform yet (that starts INC-2+) — a dummy value is sufficient for all of INC-1's testing.

## Config keys covered (design.md section 7 / runbook.md section 4)

All 14 keys are read and validated by `loadConfig()`: `MAP_ROUTING_PROVIDER`, `MAP_API_KEY`, `GEOGRAPHIC_CENTER`, `GEOGRAPHIC_RADIUS_KM`, `MAX_CANDIDATES_RETURNED`, `APP_MODE`, `PAID_TIER_ACCESS_PASSWORD`, `RESPONSE_TIME_TARGET_SECONDS`, `TRANSIT_MODES_INCLUDED`, `CANDIDATE_SPACING_METERS`, `MAX_RAW_CANDIDATES_SAMPLED`, `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, `DISTANCE_MATRIX_BATCH_SIZE`, `REQUEST_TIMEOUT_MS`, `PROVIDER_CONCURRENCY_LIMIT`. None have a hardcoded fallback value in code — every one must be set as an env var, matching the project's no-hardcoded-tunables rule.

---

# Handoff: INC-2 — Location input, geocoding, radius validation

Status: implemented, smoke-tested, ready for QA.
Covers: FR-001, FR-003, FR-004, FR-015, NFR-006. Config keys consumed (already loaded by INC-1's loader, now actually used): `MAP_API_KEY`, `GEOGRAPHIC_CENTER`, `GEOGRAPHIC_RADIUS_KM`.

## What was built

### Backend

**`src/geo/`** (new — shared, framework-agnostic geo math)
- `types.ts` — `LatLng` shared coordinate type.
- `radiusValidator.ts` — `haversineDistanceKm()` (pure great-circle distance) + `RadiusValidator.isWithinServiceArea(point, config)`, implementing design.md section 5.1's `RadiusValidator` interface. Deliberately isomorphic (no Node-only APIs) so it is imported **directly by the frontend** as well as usable server-side later (INC-4+'s `/api/drop-off-search`) — `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM` are already public via `/api/config/public` (INC-1), so no secret is at risk letting the browser run this check itself for instant field-level feedback (ux-spec.md section 4.1's "validation timing" requirement — checked the moment a suggestion is selected, not deferred to submit, with no extra network round trip).

**`src/geocoding/`** (new)
- `types.ts` — `GeoResult`, `GeocodingService` interface, mirroring design.md section 5.1 exactly.
- `errors.ts` — `GeocodingProviderError` (thrown for any non-OK/non-ZERO_RESULTS provider status or transport failure; `ZERO_RESULTS` is treated as a normal empty result, not an error).
- `googleGeocodingService.ts` — `createGoogleGeocodingService({ apiKey, fetchImpl?, endpoint? })` implements `GeocodingService.resolve()` / `.reverseGeocode()` against Google Maps Platform's Geocoding API (design.md section 3's chosen provider). `fetchImpl`/`endpoint` are injectable purely for testability (QA can mock the provider without hitting the real API or needing a key). Server-side only — `MAP_API_KEY` never leaves this module.

**`api/geocode.ts`** (new) — `GET /api/geocode`, design.md section 5.2.
- **Wrapped by `AuthGate.check()`** — the first real protected business endpoint (per the orchestrator's flag): `loadConfig()` first, then `AuthGate.check(req, config)`, returning `401 {"error":"unauthorized"}` before any provider call is made if it fails. Verified this actually gates over real HTTP in `paid_tier` mode (see Smoke test section) — not just referenced/imported.
- Two query shapes, matching what the Input Screen needs:
  - `?query=<text>` → forward geocode (`GeocodingService.resolve`), used for the address-autocomplete dropdown. Rejects queries under `MIN_QUERY_LENGTH` (3 chars, per ux-spec.md section 4.1) with `400 query_too_short`.
  - `?lat=&lng=` → reverse geocode (`GeocodingService.reverseGeocode`), used by "use my current location". On `ZERO_RESULTS`, returns `200 {"results":[]}` (not an error) so the frontend can show its own "couldn't resolve" state consistently.
- Non-OK method → `405`. Config load failure → `500 config_error` (same pattern as the other two INC-1 endpoints). Any other provider failure → `502 provider_error`.
- `scripts/viteApiMiddleware.ts` — added the `/geocode` route so local dev (`npm run dev`) serves it the same way as the other two endpoints.

### Frontend

**`src/frontend/hooks/useLocationField.ts`** (new) — encapsulates one field's full lifecycle per ux-spec.md section 4.1: debounced (300ms) autocomplete query (min 3 chars), suggestion selection, "use my current location" (browser Geolocation API → `/api/geocode?lat=&lng=` reverse geocode), and the FR-004 radius check via `RadiusValidator` — gated by an `applyRadiusCheck` option so the same hook serves all three fields per design's resolved DQ-1. Status machine: `empty | typing | resolved | geolocating | geolocation_unavailable | unresolvable | out_of_service_area | provider_error`.

**`src/frontend/components/InputScreen.tsx`** (rewritten) — the three location fields (start, driver's destination, passenger's destination) are now fully wired:
- `applyRadiusCheck={true}` for start and driver's destination; `applyRadiusCheck={false}` for passenger's destination (FR-004/DQ-1 — get this scope right, per the orchestrator's explicit flag). Verified via a browser smoke test that an identical far-away address is blocked on driver's destination but accepted cleanly on passenger's destination.
- Autocomplete dropdown (ARIA combobox pattern: `role="combobox"`/`listbox`/`option`, arrow-key navigable, Enter to select, mousedown-not-click on options so selection registers before the input's blur handler fires).
- "Use my current location" button now calls the real Geolocation API + reverse-geocodes the result; shows the "current location" badge/pill per ux-spec.md section 4.1.
- Field states rendered per ux-spec.md section 4.1's table: resolved (check icon), geolocating (spinner + "Finding your location…"), geolocation unavailable/denied, unresolvable address ("We couldn't find that address…"), out-of-service-area (danger border + copy with the **actual configured** radius/center substituted in, e.g. "within 200 km of Toronto, ON"), and a `provider_error` state (not explicitly in the spec table, added per ux-spec's "never fail silently" principle to cover a failed/network-down geocode call).
- The detour-minutes field and the "Find drop-off points" CTA remain **unchanged from INC-1** (still disabled, "coming in a later increment") — FR-002/search itself is INC-3/INC-6 scope, not INC-2.

**`src/frontend/api.ts`** — added `geocodeQuery(query)` / `reverseGeocode(lat, lng)`, thin fetch wrappers around `/api/geocode` (both send `credentials: "same-origin"` so the session cookie reaches the AuthGate-protected endpoint in `paid_tier` mode).

**`src/frontend/App.tsx`** — now passes the already-fetched `PublicConfig` down to `<InputScreen config={...}>` so the radius check has `geographicCenter`/`geographicRadiusKm` without a second fetch.

## How to run/smoke-test

1. Same as INC-1: `npm install`, fill in `.env.local` (a real `MAP_API_KEY` is now needed to see *successful* geocode results — a dummy key still exercises every error path correctly, see below), `npm run dev`.
2. `GET /api/geocode?query=<address>` → `{ results: GeoResult[] }`; `GET /api/geocode?lat=&lng=` → same shape, single result.

## Smoke test performed

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (full existing INC-1 suite, 99 tests) — all clean, no regressions.
- Backend, `/api/geocode` handler invoked directly with a mocked provider (`fetch` stubbed) covering: `free_tier` forward geocode success; **`paid_tier` with no cookie → `401 unauthorized`; `paid_tier` with a wrong/garbage cookie → `401`; `paid_tier` with a valid session cookie → `200`** (this is the AuthGate-wiring check the orchestrator specifically flagged); reverse geocode success; `ZERO_RESULTS` → `200` empty array (not an error); query-too-short → `400`; wrong HTTP method → `405`.
- Backend, over real HTTP against the local dev server (not just the injected handler) with `APP_MODE=paid_tier`: confirmed `GET /api/geocode?query=...` with no cookie → `401`; after `POST /api/auth/verify-password` with the correct password and reusing the resulting cookie → request passes AuthGate and reaches the (dummy-key) Google call, failing there instead with `502 provider_error` — i.e., **AuthGate is provably in the request path before the provider call**, not bypassed. Also reconfirmed `GET /api/config/public` stays `200`/unauthenticated in `paid_tier` mode (INC-1 behavior, unaffected).
- Backend, with a dummy (invalid) `MAP_API_KEY` against the real Google endpoint (real outbound HTTPS call, `free_tier`): got Google's actual `REQUEST_DENIED` response, correctly surfaced as `502 provider_error` — confirms the provider integration and error mapping work against the real API, not just mocks.
- Full browser walkthrough (Playwright, 390×844 mobile viewport) against the local dev server with `/api/geocode` responses intercepted at the network layer (so the *frontend* wiring is verified deterministically without needing a real Google API key):
  - Typing an address (3+ chars, debounced) renders a suggestion dropdown; selecting one resolves the field (check icon, value replaced with the resolved formatted address).
  - A far-away resolved address on **driver's destination** shows the out-of-service-area message with the real configured radius/center substituted in.
  - The **identical far-away address on passenger's destination** resolves cleanly with no radius error and shows the resolved check icon — confirms the FR-004 exemption scope is correct.
  - An address with zero geocode results shows "We couldn't find that address…".
  - "Use my current location" (mocked `Geolocation`/`context.setGeolocation`) populates the field via reverse geocode and shows the "current location" badge.

## Known limitations / things for QA to test

1. **No real `MAP_API_KEY` was available in this environment.** All success-path provider responses were verified against a mocked `fetch` (backend) or intercepted `/api/geocode` network calls (frontend), plus one real call to Google with a deliberately invalid key to confirm the error-mapping path against the live API. QA should re-run the full success path against a real key before sign-off, particularly to confirm Google's actual autocomplete-style result quality/ordering for ambiguous queries.
2. **The autocomplete uses the Geocoding API's `address=` parameter, not Places Autocomplete.** Design.md section 5.1's `GeocodingService` interface only specifies `resolve(query): Promise<GeoResult[]>` / `reverseGeocode`, with no separate autocomplete-specific method — this was implemented literally against that interface. Practically this means suggestions only appear once a query is specific enough for the Geocoding API to return full-address matches (it does not do partial-prefix "as-you-type" place suggestions the way Places Autocomplete does). This is a reasonable reading of the design, but flag to tech-lead if partial-prefix suggestions turn out to be a hard UX requirement — that would need a design update (a different Google API/SKU with its own cost implications per section 3).
3. **Debounce (300ms) and minimum-query-length (3 chars) are literal constants**, not config-file entries — they mirror ux-spec.md section 4.1's explicit UX behavior spec ("min 3 characters…standard debounce" — exact ms called out there as a dev implementation detail, not a business tunable), not one of design.md section 7's audited config keys. Flag to tech-lead/reviewer if this reasoning is wrong and it should be promoted to config.
4. **`REQUEST_TIMEOUT_MS` is not yet wired into the geocoding call.** Per-call timeout hardening is explicitly INC-7 scope (design.md section 6.3/10) — INC-2's provider calls rely on whatever the platform's default HTTP timeout is. Not a regression, just not yet built.
5. **Blur-triggered "unresolvable" validation has a possible one-frame race**: if a user blurs the field while a debounced geocode request is still in flight, the blur handler may transiently mark the field "unresolvable" before the in-flight response arrives and corrects the status (to "typing" with suggestions, or a confirmed "unresolvable"). The final state always converges correctly; QA may see a brief flash on a slow network and should confirm it self-corrects rather than sticking.
6. **Passenger destination's exemption from the radius check is enforced only via the `applyRadiusCheck={false}` prop on the frontend's `LocationField`/`useLocationField`**, and by simply never invoking `RadiusValidator` server-side yet (no `/api/drop-off-search` exists until INC-4+). QA should specifically re-verify this exemption again once INC-4's server-side validation ordering is built, per design.md section 5.2's "(1) shape/type → (2) radius check on start+driverDestination only)" ordering — this increment only covers the input-screen-level check.
7. As with INC-1, the CTA ("Find drop-off points") and the detour-minutes field are still non-functional placeholders — unchanged from INC-1, intentionally out of INC-2 scope.

---

# Follow-up fix pass on INC-2 (2026-07-11): REV-006, REV-007, REV-009

Status: implemented, smoke-tested (typecheck/lint/build clean). INC-2 remains cleared by QA/reviewer; this is the opportunistic follow-up dev pass design.md section 7.1 called for, not a new increment.

## 1. Config promotion (REV-006/REV-007, per design.md section 7.1)

Promoted the two previously-hardcoded constants into the config schema, exactly per tech-lead's decision:

- **`src/config/schema.ts`**: added `minGeocodeQueryLength: number` / `geocodeDebounceMs: number` to `AppConfig`, and the same two fields to `PublicConfig`.
- **`src/config/loader.ts`**: added `MIN_GEOCODE_QUERY_LENGTH` / `GEOCODE_DEBOUNCE_MS` parsing via the existing `parsePositiveNumber(..., integerOnly: true)` helper, in the same required-with-no-code-fallback pattern as the other 14 keys (operator must set the env var; ConfigError lists it as a problem if missing, same as `MAX_CANDIDATES_RETURNED` etc.).
- **`src/config/publicConfig.ts`**: `toPublicConfig()` now includes both fields in the `GET /api/config/public` response shape.
- **`.env.example`**: added both keys with their design.md-documented defaults (3, 300) as example values, next to `TRANSIT_MODES_INCLUDED`.
- **`api/geocode.ts`**: removed the local `MIN_QUERY_LENGTH` constant entirely; the query-length check now reads `config.minGeocodeQueryLength` from the already-loaded `AppConfig` (one-line change, no new plumbing, per section 7.1 point 2).
- **`src/frontend/hooks/useLocationField.ts`**: removed both local constants (`MIN_QUERY_LENGTH`, `DEBOUNCE_MS`) entirely — no fallback/default left behind. `UseLocationFieldOptions` gained `minGeocodeQueryLength`/`geocodeDebounceMs` fields, used in the debounce `useEffect` and the `onBlur` handler.
- **`src/frontend/components/InputScreen.tsx`**: `LocationField`'s call to `useLocationField` now threads `config.minGeocodeQueryLength` / `config.geocodeDebounceMs` from the already-fetched `PublicConfig` prop — the same pattern already used for `geographicCenter`/`geographicRadiusKm`. No second fetch, no new plumbing.

Backend enforcement of `minGeocodeQueryLength` in `api/geocode.ts` remains the real security/cost boundary independent of the frontend's copy of the value (per section 7.1 point 4) — unchanged in this pass, just re-confirmed.

## 2. Error message leakage fix (REV-009)

In `api/geocode.ts`:
- Config-load-failure path (500): logs the detailed `ConfigError.message` via `console.error` server-side, returns a fixed generic client message (`"The service is temporarily unavailable."`) instead of the raw validation-error text.
- Provider-error path (502): logs the detailed `GeocodingProviderError.message` (or any other thrown error, stringified) via `console.error` server-side, returns a fixed generic client message (`"Unable to reach the geocoding provider right now."`) instead of forwarding Google's raw `error_message` (e.g. no more leaking things like "The provided API key is invalid.").

This does not touch coordinate/address logging (design.md section 9's constraint on raw-coordinate logging is unaffected — these are error-detail logs, not location logs).

## Files touched

- `src/config/schema.ts`, `src/config/loader.ts`, `src/config/publicConfig.ts`
- `api/geocode.ts`
- `src/frontend/hooks/useLocationField.ts`, `src/frontend/components/InputScreen.tsx`
- `.env.example`

## How to run / smoke-test

- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- Manually loaded config with `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` set/unset via a Node REPL against `loadConfig()` to confirm both the happy path (values come through as numbers on `AppConfig`) and the fail-fast path (`ConfigError` lists both by name when unset), matching the existing 14-key pattern.
- Re-read `api/geocode.ts`'s two catch blocks to confirm no code path still forwards `err.message` to the client `res.json()` call.

## Known limitation / heads-up for QA

`tests/helpers/testEnv.ts`'s `validEnv()` fixture (and the hardcoded `PublicConfig` object literals in `tests/frontend/InputScreen.test.tsx`/`App.test.tsx`) predate this change and do not yet include `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` (env) or `minGeocodeQueryLength`/`geocodeDebounceMs` (`PublicConfig` object literals). Since `tests/` is QA's file, dev did not modify it — but running the existing suite as-is will fail broadly (`loadConfig()` now throws `ConfigError` for every test env missing the two new required keys, and the frontend tests' hardcoded `PublicConfig` mocks produce `NaN` for the two new fields, breaking the debounce/min-length logic). This is the same fixture-update QA would need for any newly-promoted required config key (no different in kind from onboarding the original 14) — not a defect in this fix pass. Confirmed via `tsc --noEmit` passing cleanly that this isn't a type error either; it's purely because `tests/tsconfig` doesn't type-check `tests/` (already tracked separately as REV-005) and JS values pass through as `undefined`/`NaN` at runtime instead. Recommend QA add both keys to `validEnv()` (e.g. `"3"`/`"300"`) and to the two hardcoded `PublicConfig` test fixtures (e.g. `3`/`300`) before re-running the suite.

---

# Handoff: INC-3 — Direct driving route (live traffic) + detour-minutes input

Status: implemented, smoke-tested, ready for QA.
Covers: FR-002, FR-006a, part of FR-006b (the direct-route baseline only — the full detour subtraction formula is INC-4's `DetourEvaluator`), FR-007. No new config keys were needed (`RESPONSE_TIME_TARGET_SECONDS`/`REQUEST_TIMEOUT_MS` remain correctly deferred to INC-7 per design.md section 10 — this increment's provider call relies on the platform's default HTTP timeout, same as INC-2's geocoding call).

## What was built

### Backend

**`src/routing/`** (new — mirrors the `src/geocoding/` module shape from INC-2)
- `types.ts` — `RoutingService` interface + `DirectRouteResult`, mirroring design.md section 5.1's `RoutingService.getDirectRoute(start, dest): Promise<{ durationMinutes, polyline }>` exactly.
- `errors.ts` — `RoutingProviderError` (thrown for any non-`OK` Directions API status or transport failure). Unlike geocoding's `ZERO_RESULTS`, there is no "normal empty result" case for a direct route between two already-resolved points — every non-`OK` status is treated as an error.
- `polyline.ts` — `decodePolyline(encoded: string): LatLng[]`, a pure implementation of Google's standard encoded-polyline algorithm (precision 5). Verified against Google's own documented sample string (`_p~iF~ps|U_ulLnnqC_mqNvxq\`@` → `[(38.5,-120.2), (40.7,-120.95), (43.252,-126.453)]`) — see Smoke test section.
- `googleRoutingService.ts` — `createGoogleRoutingService({ apiKey, fetchImpl?, endpoint?, now? })` implements `RoutingService.getDirectRoute()` against Google Maps Platform's **Directions API** (driving mode) — **not** the newer Routes API. This is a literal reading of design.md section 3 ("Directions/Distance Matrix, `departure_time=now`, traffic-aware duration") and section 4.1 step 2 ("Call provider Directions (driving, `departure_time=now`, traffic-aware)"), both of which name Directions API explicitly as the chosen SKU for the driving leg — flagging this explicitly since the orchestrator's brief noted Routes API as a possibility to check, but design.md is unambiguous here, so no design deviation was needed. Sends `departure_time=<now, unix seconds>` on every call (FR-007's live-traffic requirement — Directions API only returns a traffic-aware `duration_in_traffic` leg field when a `departure_time` is supplied) and prefers `leg.duration_in_traffic.value` over the static `leg.duration.value` whenever both are present, falling back to the static value only in the (rare, undocumented-as-guaranteed) case Google omits `duration_in_traffic` entirely. `now` is injectable purely for deterministic tests of the `departure_time` parameter. Server-side only — `MAP_API_KEY` never leaves this module, same boundary as `googleGeocodingService.ts`.

**`api/route/direct.ts`** (new) — `GET /api/route/direct?startLat=&startLng=&destLat=&destLng=`.
- **Wrapped by `AuthGate.check()`**, identical ordering/pattern to `api/geocode.ts` (INC-2): `loadConfig()` first, then `AuthGate.check(req, config)`, returning `401 {"error":"unauthorized"}` before any provider call is made if it fails. Verified this gates over real HTTP in `paid_tier` mode (see Smoke test section), not just referenced/imported.
- This is a **deliberately temporary/simple endpoint shape**, per design.md section 10's INC-3 scope note ("Expose direct drive time (dev/QA-visible, not yet the final feature) to validate live-traffic integration end to end"). It is not `/api/drop-off-search` (design.md section 5.2) — that endpoint doesn't exist yet and isn't built until INC-4-6 once the candidate/detour/transit pipeline it depends on exists. The response body is exactly `RoutingService`'s `DirectRouteResult` shape (`{ durationMinutes, polyline }`), with no extra wrapping, since its only purpose right now is letting QA/dev inspect the direct-route call directly.
- Error handling follows the exact REV-009 sanitized pattern from `api/geocode.ts`: config-load failure → `500 config_error` with a fixed generic client message (`"The service is temporarily unavailable."`), detailed `ConfigError` logged server-side only; provider failure → `502 provider_error` with a fixed generic client message (`"Unable to reach the routing provider right now."`), detailed `RoutingProviderError`/other error logged server-side only via `console.error`. No raw Google `error_message` (e.g. "The provided API key is invalid.") reaches the client — verified directly (see Smoke test section).
- Non-`GET` method → `405`. Missing/non-numeric `startLat`/`startLng`/`destLat`/`destLng` → `400 invalid_point`.
- `scripts/viteApiMiddleware.ts` — added the `/route/direct` route mapping so local dev (`npm run dev`) serves it the same way as the other three endpoints.

### Frontend

**`src/frontend/validation/detourMinutes.ts`** (new) — `validateMaxDetourMinutes(rawValue: string)`, a pure function (framework-agnostic, directly unit-testable) implementing ux-spec.md section 4.2's exact validation rules for FR-002:
- Empty → `{ valid: false, error: "Enter a maximum detour time in minutes." }`
- Non-numeric or ≤ 0 → `{ valid: false, error: "Enter a number greater than 0." }`
- Otherwise → `{ valid: true, minutes: <parsed number> }`
- **No upper bound of any kind** — design.md section 1.3's explicit user decision, called out again in section 10's INC-3 note specifically so QA/reviewer don't flag it as a missing sanity ceiling. There is no configured or hardcoded maximum anywhere in this function; any positive finite number (10, 500, 100000, etc.) returns `valid: true`.

**`src/frontend/components/InputScreen.tsx`** (edited) — the max-acceptable-detour field is now wired to `validateMaxDetourMinutes`:
- Error is shown only after the field has been blurred at least once (`detourTouched`), matching ux-spec.md section 4.2's "on submit attempt"/interaction-driven error timing rather than showing an error before the user has touched the field.
- Invalid state re-uses the existing `input-screen__input-wrap--error` / `input-screen__helper--danger` styling already established for the location fields in INC-2 (same visual language, no new CSS needed).
- The `<input type="number">` has **no `max` attribute** (only `min={0}` and `step="any"`), consistent with the no-upper-bound decision.
- The CTA ("Find drop-off points") and the actual search request itself remain **unchanged from INC-1/INC-2** — still disabled with the "coming in a later increment" caption. Per design.md section 10, INC-3 scope is exposing the direct-route baseline and validating the detour input's own logic, not wiring the full search flow (that's INC-4/INC-6).

## How to run / smoke-test

1. Same as INC-1/INC-2: `npm install`, fill in `.env.local` (a real `MAP_API_KEY` is needed to see a *successful* `/api/route/direct` response — a dummy key still exercises every error path correctly, see below), `npm run dev`.
2. `GET /api/route/direct?startLat=<n>&startLng=<n>&destLat=<n>&destLng=<n>` → `{ durationMinutes: number; polyline: {lat,lng}[] }`.

## Smoke test performed

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (full existing suite, 164 tests) — all clean, no regressions.
- `decodePolyline()` verified directly against Google's own documented sample encoded string, producing the exact documented output coordinates — confirms the polyline decoding is correct, not just "doesn't crash."
- `googleRoutingService.ts` exercised directly with a mocked `fetch` (temporary local script, not committed):
  - Confirmed the request URL sent to the provider **always includes `departure_time=<unix seconds>`** and `mode=driving` — the live-traffic parameter is provably being sent on every call, not just assumed.
  - Confirmed `duration_in_traffic` (900s → 15 min) is preferred over the static `duration` (600s → 10 min) when both are present in the mocked response — i.e., **live traffic actually changes the returned value** relative to what the static duration would have given, the specific check the orchestrator asked for.
  - Confirmed the fallback path (static `duration` only, no `duration_in_traffic`) still returns a duration rather than crashing.
  - Confirmed a non-`OK` provider status (`REQUEST_DENIED`) throws `RoutingProviderError` with the provider's detail intact (sanitization happens at the API-handler layer, not the service layer — same division of responsibility as geocoding).
- `api/route/direct.ts` handler invoked directly with a mocked provider (temporary local script mirroring `tests/api/geocode.test.ts`'s existing pattern/helpers, not committed to `tests/`), covering: `free_tier` success with `duration_in_traffic` correctly preferred; **`paid_tier` with no cookie → `401 unauthorized`, provider never called; `paid_tier` with a valid session cookie → `200`, provider called** (the AuthGate-wiring check the orchestrator specifically flagged); provider error (`REQUEST_DENIED`) → `502 provider_error` with the raw Google `error_message` confirmed absent from the JSON response body (checked via string search on the serialized body) while still present in the server-side `console.error` log; missing/non-numeric coordinates → `400 invalid_point`; wrong HTTP method → `405`; config-load failure → `500 config_error`, `MAP_API_KEY` absent from the client-facing body.
- Backend, over real HTTP against the local dev server (not just the injected handler), with a deliberately invalid dummy `MAP_API_KEY` against the **real** Google Directions API endpoint (real outbound HTTPS call):
  - `free_tier`: `GET /api/route/direct?...` → real Google call made, Google's actual `REQUEST_DENIED` response received and correctly surfaced as `502 provider_error` with the sanitized client message (no raw Google error text in the response body) — confirms the provider integration and error mapping work against the live API, not just mocks.
  - `paid_tier`: `GET /api/route/direct?...` with no cookie → `401`; after `POST /api/auth/verify-password` with the correct password and reusing the resulting cookie → request passes AuthGate and reaches the real Google call, failing there instead with `502` (same dummy-key error as above) — i.e., **AuthGate is provably in the request path before the provider call**, not bypassed, mirroring INC-2's exact verification method.
- Frontend: `validateMaxDetourMinutes()` exercised directly (empty string, `"0"`, `"-5"`, `"abc"`, `"10"`, `"100000"` — confirms no upper bound rejects a very large value) plus `npm run build` confirms the component compiles/bundles with the new import wired in. No real `MAP_API_KEY` was available in this environment to visually confirm a populated `durationMinutes` value end-to-end in a browser; QA should re-run the real-HTTP smoke steps above against a real key before sign-off.

## Known limitations / things for QA to test

1. **No real `MAP_API_KEY` was available in this environment.** As with INC-2, all success-path provider responses were verified against a mocked `fetch`, plus one real call to Google's Directions API with a deliberately invalid key to confirm the error-mapping path against the live API. QA should re-run the full success path against a real key before sign-off, and specifically compare `durationMinutes` for the same origin/destination pair at a normal-traffic time of day vs. a known-congested time (or against Google Maps' own consumer app/website for the same route) to independently confirm live-traffic values are being returned, not a cached/static estimate.
2. **`duration_in_traffic` vs. `duration` fallback.** Google's documentation does not explicitly guarantee `duration_in_traffic` is always present on every driving leg when `departure_time` is supplied (e.g., it's conceivable a leg type without a traffic model could omit it) — `googleRoutingService.ts` falls back to the static `duration` in that case rather than throwing, so FR-007's live-traffic requirement could theoretically be silently unmet for an edge-case leg. This was a deliberate defensive choice (a single edge case shouldn't take down the whole feature) but flag to tech-lead if a hard failure is preferred instead so FR-007 is never silently unmet.
3. **`/api/route/direct` is intentionally a temporary/dev-facing endpoint, not the final `/api/drop-off-search` shape** (design.md section 5.2). It returns the bare `RoutingService.DirectRouteResult` shape with no `requestId`/`timingMs`/etc. It is not wired into any frontend screen yet (no UI shows this value to an end user) — per design.md section 10's INC-3 note, this increment's job is validating the live-traffic integration itself, not building result UI (that's INC-6). Expect this endpoint to be superseded (not necessarily deleted immediately) once `/api/drop-off-search` exists.
4. **The detour-minutes field's validation is not yet wired to the CTA's disabled/enabled state** — the CTA remains hardcoded `disabled` (unchanged since INC-1) because the full multi-field "all fields valid → enable CTA" logic and the actual search request are INC-4/INC-6 scope, not INC-3. QA should confirm the detour field's own error states (empty, zero/negative, very large value) render correctly per ux-spec.md section 4.2, but should not expect the CTA to become tappable yet.
5. As with INC-2's REQUEST_TIMEOUT_MS note: **no per-call timeout is wired into the routing call yet** — this is explicitly INC-7 scope (design.md section 6.3/10), same as geocoding. Not a regression, just not yet built.
6. `RoutingService`'s `getDirectRoute` is written to be reused as-is by INC-4's `CandidateGenerator`/`DetourEvaluator` pipeline (design.md section 4.1 step 2 — the direct-route call and its `durationMinutes`/`polyline` are exactly the FR-006b baseline and the polyline-sampling input those later increments need) — no interface changes anticipated, but flagging so QA/tech-lead know this module's contract is already load-bearing for INC-4, not just a throwaway dev-validation shim.

---

# Handoff: INC-4 — Candidate generation + batched detour evaluation

Status: implemented, smoke-tested, ready for QA.
Covers: FR-005, full FR-006b, FR-009 (filter flag only, not yet applied to ranking — that's INC-6). Config keys consumed (already loaded by INC-1's loader, now actually used): `CANDIDATE_SPACING_METERS`, `MAX_RAW_CANDIDATES_SAMPLED`, `DISTANCE_MATRIX_BATCH_SIZE`.

## What was built

### Backend

**`src/routing/googleDistanceMatrixService.ts`** (new — sibling to `googleRoutingService.ts`)
- `createGoogleDistanceMatrixService({ apiKey, fetchImpl?, endpoint?, now? })` implements a `DistanceMatrixService.getDurationsMinutes(origins, destinations): Promise<ElementDurationMinutes[][]>` against Google Maps Platform's **Distance Matrix API**, driving mode, same `departure_time=now` live-traffic pattern as INC-3's Directions call (`duration_in_traffic` preferred over static `duration`).
- Returns a rows-by-elements matrix mirroring Google's own response shape, so both a `1×N` call (`origins=[start]`, `destinations=batch`) and an `N×1` call (`origins=batch`, `destinations=[dest]`) fall out of the same method — matching design.md section 4.3 step 6's two-call-per-batch shape exactly.
- Per-element failure (Google's per-pair `status` isn't `OK`, e.g. `ZERO_RESULTS`/`NOT_FOUND`) resolves to `null` for that element rather than throwing — distinct from a whole-request failure (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`, network/HTTP error, malformed body), which throws `RoutingProviderError` (reused from `src/routing/errors.ts` — same provider family, no new error class needed).

**`src/candidates/candidateGenerator.ts`** (new) — `CandidateGenerator.sampleAlongPolyline(polyline, config)` implements design.md section 4.2's Phase 1, pure geo math, zero provider calls:
- `effectiveSpacingMeters = max(CANDIDATE_SPACING_METERS, routeLengthMeters / MAX_RAW_CANDIDATES_SAMPLED)` (design's exact formula), walked via cumulative haversine distance along the decoded polyline (reusing `src/geo/radiusValidator.ts`'s `haversineDistanceKm`, now imported outside the radius-check context it was originally built for — no duplication).
- Each sample gets a `routeOrderIndex` equal to its position in the walking sequence (0, 1, 2, …), assigned **before** the radius filter is applied — so relative ordering among surviving candidates always reflects true position along the route even when earlier/later samples are dropped (design.md section 4.2 steps 4/FR-010's tie-break needs this later, in INC-6).
- Candidates outside `GEOGRAPHIC_RADIUS_KM` of `GEOGRAPHIC_CENTER` are dropped (design's explicit edge-case decision — a route between two in-radius points can briefly leave the circle).
- Config param typed as `Pick<AppConfig, "candidateSpacingMeters" | "maxRawCandidatesSampled" | "geographicCenter" | "geographicRadiusKm">` rather than the full `AppConfig`, matching the narrowing pattern `authGate.ts`/`radiusValidator.ts` already established (any full `AppConfig` still satisfies this type, so no caller-side friction).

**`src/candidates/detourEvaluator.ts`** (new) — `createDetourEvaluator(distanceMatrixService)` returns a `DetourEvaluator.batchEvaluate(start, dest, directDriveTimeMinutes, candidates, maxDetourMinutes, config)` implementing design.md section 4.3's Phase 2:
- Chunks `candidates` into groups of `DISTANCE_MATRIX_BATCH_SIZE`, issuing exactly 2 Distance Matrix calls per batch **in parallel** (`Promise.all`): `start→batch` and `batch→dest`.
- Per candidate: `detourMinutes = (driveTimeToCandidateMinutes + driveTimeFromCandidateMinutes) - directDriveTimeMinutes`; `qualifies = detourMinutes <= maxDetourMinutes`.
- A candidate whose pair had no viable route on either leg (Google per-element status not `OK`, surfaced as `null` from the Distance Matrix service) is **kept**, not dropped, with `detourMinutes: Infinity` and `qualifies: false` — per design.md step 8's explicit instruction that FR-011's fallback (INC-6) needs visibility into every evaluated candidate, qualifying or not. `Infinity` sorts last by construction, so INC-6's ranker needs no special-case handling for this.
- **Interface deviation flagged to tech-lead**: design.md section 5.1's TS listing shows `batchEvaluate(start, dest, directDriveTimeMinutes, candidates, config)` — 5 params, no `maxDetourMinutes`. But section 4.3 step 8's prose requires `maxDetourMinutes` (the user-supplied FR-002 value) to compute `qualifies`, and it is per-request user input, not an `AppConfig` field, so it cannot be read off `config`. Read literally, the documented interface cannot implement its own documented formula. Dev's read: this is a drafting gap in the interface listing (an omitted parameter), not a business ambiguity — so `maxDetourMinutes` was added as an explicit 5th parameter (before `config`) rather than inventing a config-based source for it or silently guessing. Documented inline in `detourEvaluator.ts`'s JSDoc as well. Please confirm/correct in design.md section 5.1 if a different resolution was intended.

**`api/candidates/evaluate.ts`** (new) — `GET /api/candidates/evaluate?startLat=&startLng=&destLat=&destLng=&maxDetourMinutes=`.
- Design.md section 10/INC-4 calls for "an internal/debug view for QA inspection" at this phase (transit not yet computed, ranking not yet built) — this mirrors `api/route/direct.ts`'s INC-3 pattern exactly: a deliberately temporary/dev-facing endpoint, **not** `/api/drop-off-search` (design.md section 5.2, which doesn't exist until INC-6).
- **Wrapped by `AuthGate.check()`**, identical ordering to every prior protected endpoint: `loadConfig()` first, then `AuthGate.check(req, config)` returning `401 {"error":"unauthorized"}` before any provider call — verified this actually blocks over the handler (provider never called) in `paid_tier` mode with no/wrong cookie, and passes through with a valid one (see Smoke test section). Per REV-002's carried-forward note (growing `AuthGate` surface with each new protected endpoint): this is now the **4th** endpoint wrapped by the same `AuthGate.check(req, config)` one-liner — no new gating logic was introduced, same call verified identically to the prior three.
- Calls `RoutingService.getDirectRoute` (INC-3, unchanged) to get the baseline + polyline, then `CandidateGenerator.sampleAlongPolyline`, then `DetourEvaluator.batchEvaluate`. Response: `{ directDriveTimeMinutes, rawCandidateCount, candidates: EvaluatedCandidate[] }`.
- Error handling follows the exact REV-009 sanitized pattern from `api/geocode.ts`/`api/route/direct.ts`: config-load failure → `500 config_error` with a fixed generic client message, detailed `ConfigError` logged server-side only; provider failure (from either the Directions call or the Distance Matrix call — both throw `RoutingProviderError`) → `502 provider_error` with a fixed generic client message, detailed error logged server-side only via `console.error`. Verified no raw Google `error_message` reaches the client body.
- Non-`GET` method → `405`. Missing/non-numeric `startLat`/`startLng`/`destLat`/`destLng`/`maxDetourMinutes`, or non-positive `maxDetourMinutes` → `400 invalid_input`.
- `scripts/viteApiMiddleware.ts` — added the `/candidates/evaluate` route mapping so local dev (`npm run dev`) serves it the same way as the other four endpoints.

### Frontend

None. Per design.md section 10's INC-4 scope note ("Expose raw candidate list with detour times via an internal/debug view for QA inspection"), no UI was built for this phase — the Input Screen/CTA remain exactly as INC-3 left them (still disabled). Candidate/detour data is inspectable only via `GET /api/candidates/evaluate` directly, same as INC-3's `/api/route/direct`.

## Distance Matrix batching / call-count logic (exact)

For a request with `rawCandidateCount` = N surviving candidates (after the radius filter) and `distanceMatrixBatchSize` = B:
- Candidates are chunked into `ceil(N / B)` batches (last batch may be smaller than B).
- Each batch issues **exactly 2** Distance Matrix calls, in parallel: `origins=[start], destinations=<batch>` (the "to" leg) and `origins=<batch>, destinations=[driverDestination]` (the "from" leg).
- Total Distance Matrix calls for the request = `2 * ceil(N / B)` — verified directly in smoke testing with N=47, B=25 → 4 calls (2 batches × 2 calls), and N=0 → 0 calls (no batches).
- Total provider calls for the whole `/api/candidates/evaluate` request = `1 (Directions, direct route) + 2 * ceil(N / B)` — verified end-to-end via the handler smoke test (N=14 candidates from a real-shaped encoded polyline → 1 + 2 = 3 total `fetch` calls, matching the formula).
- At default config (`MAX_RAW_CANDIDATES_SAMPLED=20`, `DISTANCE_MATRIX_BATCH_SIZE=25`), N never exceeds 20 ≤ 25, so this is always 1 batch → exactly 2 Distance Matrix calls, matching design.md section 4.5's cost accounting ("2, since 20 ≤ 25").

## How to run / smoke-test

1. Same as INC-1/2/3: `npm install`, fill in `.env.local` (a real `MAP_API_KEY` needed for a *successful* response; a dummy key still exercises every error path).
2. `GET /api/candidates/evaluate?startLat=<n>&startLng=<n>&destLat=<n>&destLng=<n>&maxDetourMinutes=<n>` → `{ directDriveTimeMinutes: number; rawCandidateCount: number; candidates: EvaluatedCandidate[] }`, where each `EvaluatedCandidate` is `{ point: {lat,lng}, routeOrderIndex, driveTimeToCandidateMinutes, driveTimeFromCandidateMinutes, detourMinutes, qualifies }`.

## Smoke test performed

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (full existing suite, 215 tests) — all clean, no regressions. `tests/` untouched (QA's file), confirmed the existing suite still passes as-is (no new required config keys were introduced this increment, unlike the REV-006/REV-007 follow-up).
- `CandidateGenerator.sampleAlongPolyline` exercised directly (temporary local script, not committed) against several polylines:
  - A ~10km straight route, spacing 1000m, cap 20 → 10 candidates, `routeOrderIndex` strictly increasing.
  - A ~200km straight route, spacing 1000m, cap 20 → 19-20 candidates (saturates the cap; `effectiveSpacingMeters` widened correctly to `routeLengthMeters/20` rather than emitting hundreds of samples at the configured 1000m spacing) — confirms the "never exceed the sampled-point cap" formula.
  - A route deliberately running north away from Toronto confirmed the radius-drop step actually removes far-away samples (fewer candidates returned than naively expected from spacing alone).
- `DetourEvaluator.batchEvaluate` exercised directly against a mocked `DistanceMatrixService` (temporary local script):
  - 47 candidates, `distanceMatrixBatchSize=25` → confirmed exactly 4 Distance Matrix calls (`2 * ceil(47/25)`), and all 47 candidates present in the output (none silently dropped).
  - Confirmed `detourMinutes = (5+5) - 8 = 2` matches a hand-computed expected value from mocked 5-minute-each-way legs against an 8-minute direct baseline; `qualifies=true` when `maxDetourMinutes=5` (2 ≤ 5) and `qualifies=false` when `maxDetourMinutes=1` (2 > 1) — **and confirmed the non-qualifying candidates are still present in the output**, not discarded (the specific FR-011-readiness behavior design.md calls for).
  - Confirmed a per-element `ZERO_RESULTS` (one candidate has no viable route on one leg) resolves to that candidate getting `detourMinutes: Infinity`/`qualifies: false` without crashing, while its sibling candidate in the same batch is unaffected and evaluated normally.
  - Confirmed a whole-request provider failure (`REQUEST_DENIED`) throws `RoutingProviderError` rather than silently returning empty/partial data.
- `api/candidates/evaluate.ts` handler invoked directly (temporary local script mirroring `tests/api/route-direct.test.ts`'s existing helpers/pattern — `createMock`, `validEnv`/`validPaidTierEnv`, `createSessionToken` — not committed to `tests/`), covering:
  - `free_tier` success end-to-end (real `decodePolyline` against a genuine encoded polyline of 30 points ~15km north of Toronto, generated via a small polyline encoder written for this test) → 14 surviving candidates, response shape correct, **total fetch call count (3) exactly matches `1 + 2*ceil(14/25)`**.
  - `paid_tier` with no cookie → `401 unauthorized`, provider never called (0 fetch calls) — the specific AuthGate-wiring check this project verifies for every new protected endpoint.
  - `paid_tier` with a valid session cookie (`createSessionToken`) → `200`, provider called.
  - Missing `maxDetourMinutes` → `400 invalid_input`, provider never called.
  - Config-load failure (empty env) → `500 config_error`, confirmed the raw `ConfigError` problem list (which names every missing env var) is **not** present in the client-facing JSON body, only in the server-side `console.error` log.
  - Provider error (`REQUEST_DENIED` from the Directions call, with Google's real `error_message: "The provided API key is invalid."`) → `502 provider_error`, confirmed that exact string is **not** present anywhere in the client-facing JSON body.
  - Wrong HTTP method (`POST`) → `405`.
- No real `MAP_API_KEY` was available in this environment — all of the above used mocked `fetch` responses (both Directions-shaped and Distance-Matrix-shaped), consistent with INC-2/INC-3's documented limitation. QA should re-run the success path against a real key before sign-off, particularly to sanity-check realistic candidate counts/detour minutes for a genuine driving route (the mocked matrix responses here use flat, unrealistic per-element durations purely to make the arithmetic easy to hand-verify).

## Known limitations / things for QA and reviewer to be aware of

1. **Interface deviation on `DetourEvaluator.batchEvaluate`'s parameter list** (see above, "Interface deviation flagged to tech-lead") — added an explicit `maxDetourMinutes` parameter not shown in design.md section 5.1's TS listing, because the algorithm cannot compute `qualifies` without it and it isn't part of `AppConfig`. This is a mechanical completion of an apparently-incomplete interface signature, not a reinterpretation of the algorithm's behavior (the formula itself — `detourMinutes <= maxDetourMinutes` — is implemented exactly as section 4.3 step 8 describes). Flagging for tech-lead to confirm/amend design.md, and for reviewer's traceability audit to be aware this isn't silent scope drift.
2. **REV-002 (AuthGate/session exposure growing with each new protected endpoint)**: `api/candidates/evaluate.ts` is the 4th endpoint now wrapped by the identical `AuthGate.check(req, config)` call (after `/api/geocode`, `/api/route/direct`, and implicitly the auth endpoint itself). No new gating logic, no new session/cookie handling code was introduced — this endpoint reuses `src/auth/authGate.ts` as-is. Flagging per the carried-forward note so reviewer can confirm the surface area is still just "one more call site of the same function," not a new code path needing its own security review.
3. **`api/candidates/evaluate.ts` is intentionally a temporary/dev-facing debug endpoint**, matching `api/route/direct.ts`'s INC-3 precedent — not `/api/drop-off-search` (design.md section 5.2). It does not perform the FR-003/FR-004 input-shape/radius-check validation ordering that section 5.2 specifies for the real search endpoint (that ordering is scoped to `/api/drop-off-search`, which doesn't exist until INC-6) — it only validates that the 5 query params are present and numeric/positive. `CandidateGenerator`'s own internal radius filter (design.md section 4.2 step 4) still applies regardless, since that's a candidate-sampling detail, not a request-validation one. QA should not expect `out_of_service_area` semantics from this endpoint.
4. **`routeOrderIndex` is assigned in the raw sampling sequence, including samples later dropped by the radius filter** — i.e., surviving candidates' indices are not necessarily contiguous (e.g., `0, 1, 3, 4` if sample index `2` was dropped). This preserves correct relative route-order for INC-6's tie-break (FR-010) without needing to re-normalize indices after filtering, but QA should not assume returned `routeOrderIndex` values are a contiguous `0..n-1` sequence.
5. **No real `MAP_API_KEY` was available in this environment** (same as every prior increment) — all provider responses were mocked. QA should re-run the full success path against a real key, and specifically sanity-check candidate spacing/detour-minute values against a genuine long driving route (highway vs. surface-street detours can differ meaningfully from the flat mocked values used in dev's smoke tests here).
6. **Floating-point edge case in `CandidateGenerator`**: for a route length that's an exact multiple of `effectiveSpacingMeters * maxRawCandidatesSampled`, the final sample can be dropped by one due to floating-point rounding in the cumulative-distance walk (observed once in smoke testing: expected 20 candidates, got 19, for a route sized to land exactly on the cap boundary). This is a one-sample rounding artifact at an exact boundary, not a systemic under-sampling bug — spacing/count math was otherwise exact in all other tested cases. Flag to QA to confirm this doesn't manifest as an off-by-one in a way that matters for FR-005's requirements; no fix applied since design.md doesn't specify boundary-exact behavior and a fix would add complexity for a cosmetic edge case.
7. **Transit evaluation, shortlist selection, and ranking/fallback are explicitly out of scope** (INC-5/INC-6 respectively) — every returned candidate here has a `qualifies` flag but no transit data of any kind. The CTA and full search flow remain unwired, unchanged from INC-3.

---

# Handoff: INC-5 — Transit evaluation

Status: implemented, smoke-tested, ready for QA.
Covers: FR-006c, FR-006d, FR-006e, FR-008. Config keys consumed (already loaded by INC-1's loader, now actually used): `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, `TRANSIT_MODES_INCLUDED`, `PROVIDER_CONCURRENCY_LIMIT`. No new config keys were needed — all three tunables this increment depends on already existed in the schema.

**Important correction to the orchestrator's brief**: re-reading requirements.md directly, **FR-008 is the live-transit-data requirement** ("The system shall use live transit departure/schedule data (not static timetable-only data)..."), the transit-mode counterpart to FR-007's live-traffic requirement — it is **not** the "no viable transit for this candidate" case, which design.md section 4.4 step 13 describes but never assigns its own FR number to (it's implementation detail in service of FR-012's INC-6 "no viable option" check). Both are implemented this increment (live departure-time-aware calls satisfy FR-008; the `noTransitAvailable` flag implements step 13's data-shape need), so this doesn't change what was built — flagging only so the traceability record is accurate.

## What was built

### Backend

**`src/candidates/shortlistSelector.ts`** (new) — `ShortlistSelector.select(evaluated, config)` implements design.md section 4.4 step 9's exact shortlisting rule:
- Take all `qualifies=true` candidates, ascending by `detourMinutes`, up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`.
- If fewer than the cap qualify, fill remaining slots with the next-smallest-`detourMinutes` **non**-qualifying candidates (so FR-011's INC-6 fallback always has a transit-evaluated pool to search, even when zero candidates qualify).
- `detourMinutes: Infinity` candidates (no viable driving route at all, from INC-4's `detourEvaluator.ts`) sort last within their group by construction — no special-casing needed.
- No tie-break is specified anywhere for *equal*-`detourMinutes` candidates at this shortlisting step (design's route-order tie-break, FR-010, is scoped to the *final* ranking in INC-6, not shortlisting) — relies on `Array.sort`'s stable-sort guarantee to preserve route order among ties, a reasonable default rather than an invented rule. Documented inline.

**`src/transit/types.ts`** (new)
- `TransitResult` — mirrors design.md section 5.1 exactly (`walkTimeMinutes`, `waitTimeMinutes`, `transitTimeMinutes`, `passengerTotalTimeMinutes`, `noTransitAvailable`).
- `TransitEvaluator` interface — mirrors design.md section 5.1's `evaluate(candidate, passengerDestination, departureTime, config)` signature, narrowed to `Pick<AppConfig, "transitModesIncluded">` for `config` (same REV-011-endorsed narrowing pattern every other module in this codebase already uses — reviewer's INC-4 audit explicitly concluded this narrowing is *better* practice, not a risk).
- **`FullyEvaluatedCandidate` added — design.md gap, same category as INC-4's `maxDetourMinutes` addition**: design.md section 5.1's `Ranker.rank(fullyEvaluated: FullyEvaluatedCandidate[], ...)` signature references this type but never defines it anywhere in the document. The only sensible definition — matching exactly what section 4.4 steps 10-13 produce per candidate — is Phase 2's `EvaluatedCandidate` merged with Phase 3's `TransitResult` (`interface FullyEvaluatedCandidate extends EvaluatedCandidate, TransitResult {}`). Added it to make INC-6's `Ranker` signature computable rather than leave it undefined; documented inline with the same "complete an apparent drafting gap, don't silently guess" reasoning INC-4 used. **Flagging to tech-lead for design.md confirmation**, per this project's rule to flag rather than silently deviate.

**`src/transit/googleTransitDirectionsService.ts`** (new) — `createGoogleTransitService({ apiKey, fetchImpl?, endpoint? })` implements `TransitEvaluator` against Google Maps Platform's Directions API, transit mode (design.md section 3's chosen provider/SKU for FR-006c/d/e, FR-008) — same endpoint host as INC-3's driving-mode `googleRoutingService.ts`, different `mode`/response shape.
- Sends `mode=transit`, the caller-supplied `departureTime` (candidate-specific, see `evaluateShortlist.ts` below — this is what makes the call genuinely live/FR-008-compliant, not a generic "now" for every candidate), and `transit_mode=<TRANSIT_MODES_INCLUDED joined with "|">` (Google's documented multi-value separator, distinct from the config's own comma-separated env-var syntax) — omitted entirely when `TRANSIT_MODES_INCLUDED=all`, matching Google's own default of considering every mode.
- **`parseTransitRoute()`** (pure, exported for direct QA unit testing without mocking HTTP) implements design.md section 4.4 step 11's exact formulas by walking a route's steps with a running "clock": `WALKING` steps accumulate `walkTimeMinutes` (this also captures "transfer" walking between two transit legs — Google represents a transfer as an ordinary `WALKING` step between two `TRANSIT` steps, there's no distinct transfer-step type); `TRANSIT` steps accumulate `waitTimeMinutes` (gap between the clock and the step's actual departure time) and `transitTimeMinutes` (in-vehicle time, arrival − departure), then advance the clock to the step's arrival time. This correctly handles multi-transfer itineraries leg by leg, not just a single whole-trip total — verified with a hand-computed 2-transfer fixture (see Smoke test section).
- **`noTransitAvailable` cases (design.md section 4.4 step 13 / requirements.md FR-012's data need)**: `ZERO_RESULTS` status (provider affirmatively found no transit route — an expected, normal outcome for some drop-off points, not a failure) → `noTransitAvailable: true`, not thrown; an empty/missing route → same; **a route with zero actual `TRANSIT` steps (walking-only, which Google can return for very short trips even when `mode=transit` is requested)** → also treated as `noTransitAvailable: true` (dev's interpretation: a route with no transit component isn't a viable transit *option* for this feature's purposes, even if Google technically returned "a" route). All other non-`OK` statuses (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `INVALID_REQUEST`, etc.) throw `RoutingProviderError` (reused from `src/routing/errors.ts` — same provider family/endpoint, same reuse precedent INC-4 set for the Distance Matrix service) as a whole-call failure, distinct from the normal `noTransitAvailable` case.

**`src/transit/evaluateShortlist.ts`** (new) — `evaluateShortlist(transitEvaluator, shortlist, passengerDestination, config, options?)` orchestrates design.md section 4.4 steps 10-13 across the bounded shortlist. **Not itself named in design.md section 5.1** (the design only specifies the single-candidate `TransitEvaluator.evaluate`) — since transit calls can't be batched like Distance Matrix calls (each candidate needs a different `departure_time`, design's own stated rationale), *something* has to fan the shortlist out across parallel calls bounded by `PROVIDER_CONCURRENCY_LIMIT` (step 10's explicit requirement), so this was added as its own small, pure, dependency-injected module rather than inlined in the API handler, so it's independently testable without HTTP mocks.
- Computes each candidate's `departureTime = requestNow + driveTimeToCandidateMinutes` (step 10) from a **single** `now()` call per request (injectable, for deterministic tests) — every candidate's departure time is anchored to the same reference instant, not one clock reading per candidate.
- Runs a bounded worker pool (`Math.min(providerConcurrencyLimit, shortlist.length)` workers pulling from a shared index) rather than `Promise.all` over the whole shortlist unbounded — verified this actually caps concurrency, not just requests it (see Smoke test section).
- A candidate with a non-finite `driveTimeToCandidateMinutes` (INC-4's per-element-failure sentinel — no viable driving route to that point at all) is skipped **without spending a provider call**: there's no meaningful arrival time to evaluate transit from, so it's returned directly as `noTransitAvailable: true`. This is a cost-saving defensive addition beyond what design.md's prose explicitly calls out, but a direct, necessary consequence of INC-4's `Infinity` sentinel existing at all — flagging in case tech-lead wants this made explicit in design.md section 4.4.

**`api/candidates/transit.ts`** (new) — `GET /api/candidates/transit?startLat=&startLng=&destLat=&destLng=&passengerDestLat=&passengerDestLng=&maxDetourMinutes=`.
- Same temporary/dev-facing debug-endpoint pattern as `api/route/direct.ts` (INC-3) and `api/candidates/evaluate.ts` (INC-4) — **not** `/api/drop-off-search` (design.md section 5.2); no FR-003/FR-004 validation ordering, no ranking/fallback (INC-6 scope).
- **Wrapped by `AuthGate.check()`**, identical ordering/pattern to every prior endpoint: `loadConfig()` → `AuthGate.check(req, config)` → `401` before any provider call. This is now the **5th** endpoint wrapped by the identical one-liner (after `/api/geocode`, `/api/route/direct`, `/api/candidates/evaluate`, and implicitly the auth endpoint) — no new gating logic, per the REV-002-adjacent carried-forward note reviewer has tracked at every prior audit.
- Runs the full Phase 0-3 pipeline: `RoutingService.getDirectRoute` → `CandidateGenerator.sampleAlongPolyline` → `DetourEvaluator.batchEvaluate` → `ShortlistSelector.select` → `evaluateShortlist`. Response: `{ directDriveTimeMinutes, rawCandidateCount, shortlistedCount, candidates: FullyEvaluatedCandidate[] }` — `candidates` is **only the shortlisted, transit-evaluated set** (bounded by `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`), not the full raw/detour-only pool (that's already exposed by INC-4's `/api/candidates/evaluate`, no need to re-expose it here).
- New required query params `passengerDestLat`/`passengerDestLng` (the passenger's destination — never needed by a prior debug endpoint since detour evaluation only concerns the driver's own route). Per design's resolved DQ-1, this debug endpoint performs **no** radius check on any input, matching `api/candidates/evaluate.ts`'s already-established scope boundary.
- Error handling: identical REV-009 sanitized pattern (config-load failure → `500 config_error`, fixed generic message, detailed error logged server-side only; provider failure → `502 provider_error`, fixed generic message, detailed error logged server-side only). All three provider calls in this endpoint's pipeline (Directions driving, Distance Matrix, Directions transit) throw `RoutingProviderError` — same provider family, same error-shape needs, per the reuse precedent already established.
- `scripts/viteApiMiddleware.ts` — added the `/candidates/transit` route mapping so local dev (`npm run dev`) serves it the same way as the other five endpoints.

### Frontend

None. Per design.md section 10's INC-5 scope (transit evaluation only — `ShortlistSelector`, `TransitEvaluator.evaluate`, walk/wait/transit/transfer parsing, `TRANSIT_MODES_INCLUDED` filtering), no UI was built. The Input Screen/CTA remain exactly as INC-3/INC-4 left them.

## Data shape produced (for INC-6's `Ranker` to consume)

Each element of `GET /api/candidates/transit`'s `candidates` array is a `FullyEvaluatedCandidate`:

```ts
{
  point: { lat, lng },
  routeOrderIndex: number,
  driveTimeToCandidateMinutes: number,
  driveTimeFromCandidateMinutes: number,
  detourMinutes: number,
  qualifies: boolean,
  walkTimeMinutes: number,
  waitTimeMinutes: number,
  transitTimeMinutes: number,
  passengerTotalTimeMinutes: number,
  noTransitAvailable: boolean,
}
```

INC-6's `Ranker` needs: (a) `qualifies`/`noTransitAvailable`/`passengerTotalTimeMinutes` for step 14/15's sort+filter, (b) `routeOrderIndex` for FR-010's tie-break, (c) `driveTimeToCandidateMinutes`/`driveTimeFromCandidateMinutes` to derive FR-006f's `driverTotalTimeMinutes` (not computed this increment — trivial sum, correctly left for INC-6 per design.md's "Covers" line for this increment not listing FR-006f).

## How to run / smoke-test

1. Same as INC-1/2/3/4: `npm install`, fill in `.env.local` (a real `MAP_API_KEY` needed for a *successful* response; a dummy key still exercises every error path).
2. `GET /api/candidates/transit?startLat=<n>&startLng=<n>&destLat=<n>&destLng=<n>&passengerDestLat=<n>&passengerDestLng=<n>&maxDetourMinutes=<n>` → `{ directDriveTimeMinutes, rawCandidateCount, shortlistedCount, candidates: FullyEvaluatedCandidate[] }`.

## Smoke test performed

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (full existing suite, 266 tests) — all clean, no regressions. `tests/` untouched (QA's file) — no new required config keys were introduced this increment, so the existing suite passes unmodified.
- `parseTransitRoute()` exercised directly against a hand-built, hand-computed 2-transfer route fixture (temporary local script, not committed): walk 5min + 1min transfer walk = 6min; wait 2min + 3min = 5min; ride 10min + 15min = 25min; total = 36min — every component independently verified against manual arithmetic, not just "doesn't crash." Also confirmed a walking-only route (`sawTransitStep: false`) is correctly distinguished from a genuine transit itinerary.
- `createGoogleTransitService` exercised directly with a mocked `fetch` (temporary local script mirroring `tests/routing/googleRoutingService.test.ts`'s pattern, not committed):
  - Confirmed the request URL always includes `mode=transit` and the **candidate-specific** `departure_time` (not a shared/generic "now") — the live-schedule parameter (FR-008) is provably present and per-candidate, not just assumed.
  - Confirmed `TRANSIT_MODES_INCLUDED=["bus","subway"]` produces `transit_mode=bus|subway` in the request; confirmed `"all"` omits the `transit_mode` param entirely.
  - Confirmed `ZERO_RESULTS` → `{ noTransitAvailable: true, ...zeros }`, not thrown — the specific FR-008-adjacent "no viable transit for this candidate" behavior the orchestrator asked about.
  - Confirmed a whole-request failure (`REQUEST_DENIED`, with Google's real `error_message: "The provided API key is invalid."`) still throws `RoutingProviderError` — distinct from `ZERO_RESULTS`, not silently swallowed into `noTransitAvailable`.
  - Confirmed a route with zero `TRANSIT` steps (walking-only) is also correctly mapped to `noTransitAvailable: true`.
- `ShortlistSelector.select` exercised directly against a mixed qualifying/non-qualifying candidate set (temporary local script):
  - Cap respected; ascending-`detourMinutes` qualifying-only selection correct when enough candidates qualify.
  - Confirmed the specific "fill remaining slots with next-smallest-detour non-qualifying candidates" rule (design.md step 9) when fewer than the cap qualify.
  - Confirmed the **zero-qualifying-candidates** case still returns a full, ascending-detour-ordered pool — the exact FR-011-readiness property INC-4's `qualifies:false`-retention work was building toward.
- `evaluateShortlist` exercised directly against a mocked `TransitEvaluator` with artificial delay (temporary local script):
  - Confirmed concurrency is genuinely bounded to the configured `providerConcurrencyLimit` (observed max-concurrent calls ≤ the configured limit, and > 1, confirming real parallelism up to but not exceeding the bound — not fully serial, not fully unbounded).
  - Confirmed each candidate's `departureTime` passed to the evaluator equals exactly `now + driveTimeToCandidateMinutes` for that candidate, from a single injected clock reading.
  - Confirmed a candidate with `driveTimeToCandidateMinutes: Infinity` is skipped without spending a provider call (call count confirmed via a mock counter), returned directly as `noTransitAvailable: true`.
- `api/candidates/transit.ts` handler invoked directly (temporary local script mirroring `tests/api/candidates-evaluate.test.ts`'s existing helpers/pattern — `createMock`, `validEnv`/`validPaidTierEnv`, `createSessionToken`, the shared polyline encoder — not committed to `tests/`), covering:
  - `free_tier` success end-to-end with `MAX_TRANSIT_EVALUATIONS_PER_REQUEST=2` against a route producing more than 2 qualifying candidates → confirmed `shortlistedCount: 2` (correctly capped even though more candidates qualify) and exactly 2 transit-mode Directions calls (verified by inspecting the mocked `fetch`'s call list, distinguishing driving-mode vs. transit-mode calls by the `mode` query param) alongside exactly 1 driving Directions call and the expected Distance Matrix call count — the full per-request provider-call accounting is verifiable, not just the response shape.
  - `paid_tier` with no cookie → `401 unauthorized`, provider never called (0 fetch calls) — the specific AuthGate-wiring check this project verifies for every new protected endpoint.
  - `paid_tier` with a valid session cookie → `200`, providers called.
  - Missing `passengerDestLat`/`passengerDestLng` → `400 invalid_input`.
  - Config-load failure (empty env) → `500 config_error`, confirmed the raw `ConfigError` problem list is **not** present in the client-facing JSON body.
  - Provider error (`REQUEST_DENIED` from the transit call specifically, with Google's real `error_message`) → `502 provider_error`, confirmed that exact string is **not** present anywhere in the client-facing JSON body.
  - A candidate returning `ZERO_RESULTS` on its transit call → `200`, that candidate correctly present with `noTransitAvailable: true` (not treated as a whole-request failure — the request as a whole still succeeds).
  - Wrong HTTP method (`POST`) → `405`.
- **No real `MAP_API_KEY` was available in this environment** — same documented limitation as every prior increment (INC-2/3/4). All of the above used mocked `fetch` responses shaped to match Google's documented transit-mode Directions response schema. **This increment's live-data verification gap is broader than INC-3's (REV-010)**: INC-3's gap was "is `duration_in_traffic` really populated the way docs imply" — a single-field question. This increment's live-transit behavior (FR-008) has more surface area to independently verify against a real key: (a) whether Google's live GTFS-RT-adjusted departure predictions actually differ meaningfully from static schedule times for real TTC/GO/regional-agency data near Toronto (the idea-brief's own risk #3 — smaller regional agencies' RT feed quality/coverage is explicitly called out as uncertain in design.md section 9), and (b) whether real-world multi-transfer itineraries parse correctly through `parseTransitRoute`'s step-walking logic (the mocked fixtures here were hand-built to exercise the formula, not sampled from an actual Google response body, so an unanticipated real-world response shape — e.g., an unusual step ordering, a transit step without `transit_details`, additional step-level fields not represented in this increment's type definitions — could behave differently than the mocks suggest). **QA/release must verify both (a) and (b) against a real `MAP_API_KEY` and real Toronto-area routes before Phase 4 closure** — recommend folding this into REV-010's existing tracked closure condition (same root cause: no real key in this dev environment) rather than opening a new finding, but flagging the broadened scope explicitly here since the live-transit-data gap is materially larger than the live-traffic gap it's grouped with.

## Known limitations / things for QA and reviewer to be aware of

1. **`FullyEvaluatedCandidate` type added to `src/transit/types.ts`, not present anywhere in design.md** — the only sensible definition for design.md section 5.1's `Ranker.rank(fullyEvaluated: FullyEvaluatedCandidate[], ...)` parameter type, which the design document references but never itself defines. Same category of gap as INC-4's `maxDetourMinutes` addition (a mechanical completion of an apparently-incomplete interface listing, not a business-logic reinterpretation) — flagging to tech-lead for design.md confirmation/amendment rather than silently assumed.
2. **`evaluateShortlist.ts`'s fan-out/concurrency-limiting orchestration is not itself named anywhere in design.md section 5.1** — the design only specifies the single-candidate `TransitEvaluator.evaluate`; *something* has to bound the parallel fan-out across the shortlist per step 10's explicit `PROVIDER_CONCURRENCY_LIMIT` requirement, so dev added this as its own small testable module. This is an implementation detail filling an orchestration gap the design's module list doesn't explicitly assign to any named interface, not a deviation from any documented behavior — flagging for visibility, not as an error.
3. **"Walking-only route → `noTransitAvailable: true`" is a dev interpretation, not explicit design.md text.** Google's transit-mode Directions API can return a route with zero actual `TRANSIT` steps for a very short candidate→passengerDestination distance. Design.md section 4.4 step 13 only says "no viable transit itinerary at all" without addressing this specific edge case. Dev's reading: a route with no transit component isn't a transit *option* for this feature's purposes (the whole premise is drop-off-then-transit), so it's treated the same as "no transit available" rather than as a valid (if degenerate) result with `waitTimeMinutes`/`transitTimeMinutes` both `0`. Flag to tech-lead/pm if a walking-only result should instead be surfaced as a legitimate (if unusual) candidate — this is a genuine judgment call, not an obvious-only-one-reading situation like the `maxDetourMinutes`/`FullyEvaluatedCandidate` gaps above.
4. **No tie-break rule exists for shortlisting candidates with exactly equal `detourMinutes`** (`ShortlistSelector.select` relies on `Array.sort`'s stable-sort guarantee to preserve route order among ties) — design.md's route-order tie-break (FR-010) is explicitly scoped to the *final* ranking (INC-6, section 4.5), not this shortlisting step, so this isn't a gap in the same sense as the two `[DESIGN-GAP]`-flagged items above, but QA should know shortlist order among exact-detour ties is an implementation default (stable-sort/input-order), not a documented business rule.
5. **Real-`MAP_API_KEY` live-transit-data verification gap** (see Smoke test section's final bullet) — broader in scope than INC-3's REV-010 (live traffic), since it covers both live-schedule-vs-static-schedule value differences *and* real-world transit-mode response-shape parsing (multi-agency GTFS-RT data quality near Toronto is an explicitly-flagged, not-fully-validated idea-brief risk, design.md section 9). Recommend QA/release treat this as an expansion of REV-010's existing tracked pre-Phase-4 closure condition rather than a separate item, but the broadened scope should be visible in the tracking, not silently folded in.
6. **`api/candidates/transit.ts` is intentionally a temporary/dev-facing debug endpoint**, matching the `api/route/direct.ts` (INC-3) / `api/candidates/evaluate.ts` (INC-4) precedent — not `/api/drop-off-search` (design.md section 5.2). It performs no FR-003/FR-004 validation-ordering (`invalid_input`/`out_of_service_area` semantics belong to the real search endpoint, INC-6) and returns only the shortlisted/transit-evaluated candidates, not the full raw pool (already covered by INC-4's endpoint). Expect this endpoint to be superseded once `/api/drop-off-search` exists.
7. **Ranking, tie-break (FR-010), fallback (FR-011), no-viable-option (FR-012), and full `DropOffSearchResponse` output are explicitly out of scope** (INC-6). Every candidate returned by this increment's endpoint has full transit data or `noTransitAvailable: true`, but nothing is yet sorted/filtered/labeled for end-user display. The CTA and full search flow remain unwired, unchanged from INC-3/INC-4.

---

# Follow-up fix on INC-5 (2026-07-11): walking-only transit response reclassified as a valid result

Status: implemented, smoke-tested (typecheck/lint/build clean, full 266-test suite unaffected/passing since no committed tests exist for `src/transit/` yet). Resolves the judgment call flagged in known limitation #3 above, per the user's explicit decision routed through the orchestrator: a walking-only Google transit response (the candidate is close enough to the passenger's destination that Google's `mode=transit` call returns a route with zero actual `TRANSIT`-mode steps) is **a genuinely good outcome for the family member** and must rank normally alongside real-transit candidates, not be excluded to only the FR-011 fallback path.

## What changed

**`src/transit/googleTransitDirectionsService.ts`**, `evaluate()`: removed the `if (!parsed.sawTransitStep) return { ...NO_TRANSIT_RESULT }` branch. A walking-only route (`parsed.sawTransitStep === false`) now falls through to the same `return` used for a genuine transit itinerary, with `noTransitAvailable: false`. No new arithmetic was needed — `parseTransitRoute()`'s existing formulas already produce exactly the right numbers for this case by construction:
- `walkTimeMinutes` / `passengerTotalTimeMinutes` = the route's full walking duration (there's no separate "walk to stop" leg when the entire route is walking — the whole route IS the walk).
- `waitTimeMinutes` = 0 (nothing ever accumulates into it when there are zero `TRANSIT` steps — no vehicle to wait for).
- `transitTimeMinutes` = 0 (same reason — this is the "near-zero or zero transit-specific time" the orchestrator asked for; in practice it's exactly zero since a walking-only route has no in-vehicle step at all).

Genuine zero-viable-route cases are unaffected and still correctly return `noTransitAvailable: true`: Google's `ZERO_RESULTS` status, and an empty/missing `routes` array or a route with zero legs. Only the "route exists but has no TRANSIT steps" case changed.

**`src/transit/types.ts`**: updated `TransitResult.noTransitAvailable`'s doc comment to state the narrower, correct scope (genuine no-viable-route cases only) and explicitly calls out that a walking-only route is not one of them.

**`src/transit/googleTransitDirectionsService.ts`**, `parseTransitRoute()`'s doc comment: updated to describe `sawTransitStep: false` as a valid near-zero-transit result rather than a de-facto `noTransitAvailable` case, and to note the formulas need no special-casing for it.

## Manual verification performed (no committed tests for this module yet — QA owns `tests/transit/`)

Ran `createGoogleTransitService(...).evaluate()` and `parseTransitRoute()` directly against hand-built mocked-`fetch` fixtures (temporary local script, not committed):
- Walking-only route (one `WALKING` step, 180s, zero `TRANSIT` steps) → `{ walkTimeMinutes: 3, waitTimeMinutes: 0, transitTimeMinutes: 0, passengerTotalTimeMinutes: 3, noTransitAvailable: false }` — confirms the fix's exact intended shape.
- Google `ZERO_RESULTS` status → still `{ ...zeros, noTransitAvailable: true }` — confirms the genuine-no-route case is untouched.
- A real 2-step itinerary (walk 5min + transit ride 10min with a wait) → parsed correctly (`walkTimeMinutes: 5`, `waitTimeMinutes` and `transitTimeMinutes` both nonzero, `noTransitAvailable: false`) — confirms real transit itineraries are unaffected by the change.

## Files touched

- `src/transit/googleTransitDirectionsService.ts`
- `src/transit/types.ts`

## Known limitation / heads-up for QA

QA has not yet run its INC-5 pass, so there is no pre-existing `tests/transit/` fixture set to update — this fix simply needs to be reflected in whatever fixtures QA writes for `parseTransitRoute()`/`createGoogleTransitService()`'s walking-only case (expect `noTransitAvailable: false`, not `true`). INC-6's `Ranker`/fallback logic (not yet built) should treat these candidates as ordinary ranking candidates with a very small `passengerTotalTimeMinutes` — no special-case branch is needed there either, since `noTransitAvailable: false` is now the only signal INC-6 needs to include them in normal ranking.

---

# Maintenance: `@vercel/node` dependency bump (2026-07-11) — `npm audit fix --force`

Status: applied, verified, no code changes were needed. User explicitly approved this breaking bump ahead of time.

## What changed

- `package.json` / `package-lock.json`: `@vercel/node` bumped from `^3.2.24` to `^5.8.23` (latest published version) via `npm audit fix --force`, as reported/expected. No other direct dependency in `package.json` changed — the bump only pulls in `@vercel/node`'s own updated transitive dependency tree (`@vercel/build-utils`, etc., all dev-only, used solely for the `VercelRequest`/`VercelResponse` type declarations and local build tooling — never shipped to the browser bundle or the deployed serverless runtime code itself).

## Code/test adjustments needed

None. `@vercel/node@5.8.23`'s exported `VercelRequest`/`VercelResponse` types are unchanged in shape from v3 (`IncomingMessage`/`ServerResponse` extended with the same `query`/`cookies`/`body`/`send`/`json`/`status`/`redirect` members) — confirmed by reading `node_modules/@vercel/node/dist/index.d.ts` directly. All six `api/*.ts` handlers (`api/config/public.ts`, `api/auth/verify-password.ts`, `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts`, `api/geocode.ts`) and `tests/helpers/mockVercel.ts` import only these two type aliases and needed zero changes. `vercel.json` (framework/buildCommand/outputDirectory only) is unaffected by this bump and was not touched.

## Verification performed (after the bump, before this note)

- `npm run typecheck` — clean, no errors.
- `npm run lint` — clean, no errors.
- `npm run build` — clean (`vite build`, same output shape/bundle size as before).
- `npm test` — all 27 test files / 311 tests pass, no regressions.

## Audit results

- Before: `npm audit` → 9 vulnerabilities (3 moderate, 6 high), all in `@vercel/node@3.2.24`'s transitive dev-only build deps (`tar`, `undici`, `path-to-regexp`).
- After: `npm audit` → 10 vulnerabilities (4 moderate, 6 high), still entirely inside `@vercel/node@5.8.23`'s own transitive dependency tree (`ajv`, `js-yaml`, `minimatch`, `path-to-regexp`, `smol-toml`, `undici`, all pulled in via `@vercel/build-utils`/`@vercel/python-analysis`/`@vercel/static-config`). `@vercel/node@5.8.23` is the newest version currently published to npm (confirmed via `npm view @vercel/node versions`), so there is no further version bump available to reduce this — it is the ceiling of what `npm audit fix --force` and a manual version check can achieve today. `npm audit fix --force` run a second time reports it would need to *downgrade* to `@vercel/node@4.0.0`, which is not a fix (that version predates 5.8.23) and was not applied.
- **Production impact: zero, both before and after.** `npm audit --omit=dev` reports **0 vulnerabilities** in both cases — every flagged package here is a dev-only build/type-checking dependency of `@vercel/node`, never a runtime dependency of the deployed app or the browser bundle. This is a net improvement (moved from an unmaintained-in-this-regard v3 line to the actively maintained latest v5 line) even though the raw vulnerability count ticked up by one (a moderate `ajv` ReDoS newly reported upstream in `@vercel/build-utils`'s own tree) — recommend re-running `npm audit` periodically as Vercel publishes patches for `@vercel/build-utils`'s bundled deps, since no action on our side can currently close the remaining 10.

## Files touched

- `package.json`, `package-lock.json` (dependency bump only)
- No other files changed.

---

# Handoff: INC-6 — Ranking, tie-break, fallback, full results output

Status: implemented, smoke-tested, ready for QA.
Covers: FR-006f, FR-010, FR-011, FR-012, FR-013, config key `MAX_CANDIDATES_RETURNED`. This is the largest increment yet — it assembles INC-3/4/5's pipeline into the real, user-facing search feature.

## What was built

### Backend

**`src/ranking/ranker.ts`** (new) — `Ranker.rank(fullyEvaluated, maxDetourMinutes, config)` implements design.md section 4.5/section 5.1's `RankedResult` union exactly:
- `viable = fullyEvaluated.filter(c => !c.noTransitAvailable)`. If `viable.length === 0` → `{ status: "no_viable_option" }` (FR-012 — this is design's step 16, checked first as a short-circuit; if nothing is viable, nothing can qualify either, so this is a faithful reordering of steps 14→16, not a behavioral deviation).
- Otherwise, sort `viable` candidates that also have `qualifies=true` ascending by `passengerTotalTimeMinutes`, tie-broken by ascending `routeOrderIndex` (FR-010/OQ-2 — earlier on the route wins). If any qualify, return the top `maxCandidatesReturned` as `{ status: "ranked", results }`.
- If none qualify, pick the single smallest-`passengerTotalTimeMinutes` candidate from the full `viable` pool (FR-011/OQ-3 — smallest passenger time, *not* smallest detour or distance) and return `{ status: "fallback", results: [that one], warning }`. The `warning` string is generated here (not left to the frontend) since design.md section 5.1 types `RankedResult`'s fallback variant with a `warning: string` field — copy matches ux-spec.md section 6.5 verbatim, with the configured threshold and the actual detour both rounded to the nearest minute (ux-spec.md section 6.4's "round to nearest minute" rule) and substituted in.
- **Config parameter narrowed to `Pick<AppConfig, "maxCandidatesReturned">`** (`RankingConfig`), continuing the same pattern reviewer already tracks as REV-011 across every other module in `src/` (`AuthGate`, `RadiusValidator`, `CandidateGenerator`, `DetourEvaluator`, `ShortlistSelector`, `TransitEvaluator`) — same rationale (better testability, no caller-side friction since a full `AppConfig` structurally satisfies the narrower type). Flagging this as extending REV-011's already-tracked scope by one more module, not a new issue, so tech-lead can fold it into the next design.md section 5.1 batch cleanup.

**`src/geocoding/labelFinalCandidates.ts`** (new) — `labelFinalCandidates(geocodingService, start, candidates)` implements design.md section 3.1b: reverse-geocodes only the small set of *final* returned candidates (bounded by `MAX_CANDIDATES_RETURNED`, or 1 for the fallback case), never the full raw/shortlist pool, matching section 4.5's cost accounting. Per-candidate reverse-geocode failure (no matchable address, or `GeocodingService.reverseGeocode`'s thrown `GeocodingProviderError` on `ZERO_RESULTS`) is caught individually and falls back to ux-spec.md section 6.4's documented fallback phrasing ("~2.1 km into your route") rather than leaving the candidate unlabeled or failing the whole search over one label. **Known approximation, flagged for tech-lead**: the fallback distance is straight-line (haversine) from `start`, not true along-route distance — `CandidateGenerator` only retains `routeOrderIndex` downstream, not cumulative route meters, so exact along-route distance isn't available at this point in the pipeline without threading an extra field through every phase. This is a rarely-hit fallback path (only triggers when Google's reverse geocoder can't match a point at all), so the approximation was judged acceptable rather than plumbing a new field through INC-4/5's already-shipped interfaces — flag to tech-lead if exact along-route distance is wanted here.

**`src/search/types.ts`** (new) — `DropOffSearchRequest`/`DropOffSearchResponse`/`DropOffSearchCandidate` types shared by both the backend endpoint and the frontend (avoiding the REV-007-style duplication risk). Mirrors design.md section 5.2's `DropOffSearchRequest`/`DropOffSearchResponse` **except one deliberate, flagged omission**: `disclaimer: string` is NOT included. Reasoning: design.md section 10 explicitly scopes "Persistent FR-014 disclaimer on all candidate-bearing responses" to **INC-7**, and section 10's traceability summary maps `FR-014 → INC-7` only (not INC-6). Section 5.1's `RankedResult`/`Ranker.rank` — the algorithmic core this increment literally owns — has no disclaimer field at all; only section 5.2's response-wrapper contract mentions it. Populating the field now would mean inventing its exact condition/copy ownership ahead of the increment that documents owning it, rather than completing an obvious drafting gap (unlike INC-4's `maxDetourMinutes` or INC-5's `FullyEvaluatedCandidate`, where the gap was clearly just an omitted parameter/type in an otherwise-unambiguous spec). **Flagging to tech-lead for explicit confirmation** rather than guessing either direction — INC-7 should add this field back when it builds the actual persistent banner.

**`api/drop-off-search.ts`** (new) — `POST /api/drop-off-search`, the real endpoint design.md section 5.2 specifies. Wrapped by `AuthGate.check()` in the same position/pattern as every prior endpoint (config load → AuthGate → business logic). Pipeline: shape/type validation of the 4 request fields (`invalid_input`) → radius check on `start` + `driverDestination` only, `passengerDestination` exempt per DQ-1 (`out_of_service_area`) → `RoutingService.getDirectRoute` → `CandidateGenerator.sampleAlongPolyline` → `DetourEvaluator.batchEvaluate` → `ShortlistSelector.select` → `evaluateShortlist` → `Ranker.rank` → `labelFinalCandidates` (only on the final ranked/fallback set) → response.
- **Business-outcome statuses are HTTP 200, not varying HTTP codes**: `invalid_input`/`out_of_service_area`/`no_viable_option`/`ranked`/`fallback` are all returned as `200` with `status` describing the outcome, since design.md section 8 says the frontend renders directly off `DropOffSearchResponse.status` — there's no separate per-branch HTTP-status contract documented for these. Only genuine infra-level failures (wrong method → `405`, config load failure → `500 config_error`, AuthGate failure → `401`, provider failure → `502 provider_error`) use non-200 codes, matching every prior endpoint's established convention. **Flagging this interpretation explicitly** since design.md section 5.2 doesn't spell out the HTTP-status-vs-JSON-status split in so many words — this is the most literal reading of "the response shape is `DropOffSearchResponse`, and the frontend renders off `.status`" (section 8), not a guess.
- Error sanitization follows the exact REV-009 pattern (config/provider errors logged server-side via `console.error`, generic fixed strings returned to the client) — this is the 6th endpoint replicating that pattern, and the first spanning **four** provider-call families in one request (Directions driving, Distance Matrix, Directions transit, Geocoding reverse-lookup for labels).
- `requestId` (`crypto.randomUUID()`) and `timingMs` (wall-clock elapsed since handler entry) are included on every response per section 5.2's contract, even though *empirical validation* of `timingMs` against NFR-004 is INC-7 scope (design.md section 10) — the field itself is part of "full `DropOffSearchResponse` wiring," which is this increment's explicit job.
- **Debug endpoints from INC-3/4/5 were NOT removed.** `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts` are unchanged, additive alongside the new endpoint. Reasoning: design.md never instructs deleting them once `/api/drop-off-search` exists — each increment's own note says only "not yet the final endpoint" / "expect this endpoint to be superseded (not necessarily deleted immediately)," never "delete on arrival." QA's existing regression suite (`tests/api/route-direct.test.ts`, `tests/api/candidates-evaluate.test.ts`, `tests/api/candidates-transit.test.ts`) already exercises them directly and passes — removing the endpoints would silently break QA's own passing tests, which isn't dev's call to make unilaterally (tests/ is QA's owned artifact). They remain useful as internal debug/inspection tools for QA per their own documented purpose. **Flagging this decision explicitly per the orchestrator's request** — recommend tech-lead/QA jointly decide if/when to retire them (e.g. at Phase 4 closure), rather than dev removing them silently now.
- `scripts/viteApiMiddleware.ts` — added the `/drop-off-search` route mapping.

### Frontend

**`src/frontend/components/SearchFlow.tsx`** (new) — orchestrates ux-spec.md's Input → Loading → Results | Error flow (screens 1–3 + section 7's failure state) around `POST /api/drop-off-search`. Owns a `stage` state machine (`input | loading | results | error`) and the last-submitted request (in-memory only, per NFR-003) so "Cancel" (Loading → Input), "Edit search" (Results/Error → Input, values preserved), and "Try again" (Error → re-issues the identical request) all work per ux-spec.md sections 5/6.3/7. Replaces `<InputScreen>` as the component `App.tsx` renders directly.

**`src/frontend/components/InputScreen.tsx`** (rewritten) — the CTA ("Find drop-off points") is now **wired for real**: enabled once all three location fields are validly resolved (via a new `onResolvedChange` callback lifted from each `LocationField` up to `InputScreen`) and the detour field is valid; on click, submits a `DropOffSearchRequest` via the new `onSubmit` prop (owned by `SearchFlow`). Gained an `initialValues` prop so "Edit search"/"Try again" can reopen the form pre-populated with the last-submitted values.

**`src/frontend/hooks/useLocationField.ts`** (edited) — added an optional `initialValue` option, read once via `useState`'s initializer so a field can seed as already-resolved on mount (used only by the "Edit search" re-open path — a later prop change does not re-seed an already-mounted field, which is fine since `SearchFlow` fully unmounts/remounts the form on every stage transition).

**`src/frontend/components/ResultsScreen.tsx`** (new, + `.css`) — Screen 3 per ux-spec.md section 6: trip summary + "Edit search" link, fallback warning banner (`status: "fallback"`), ranked/fallback candidate cards with the full FR-013 time breakdown (drive time, detour, driver total; walk, wait+transit, passenger total), rank-1 "BEST OPTION" highlight, fallback "CLOSEST OPTION" badge with danger-colored detour row. Also renders `no_viable_option`'s empty state (section 6.6) and, as a defense-in-depth path, `out_of_service_area`/`invalid_input` (which the backend can return per its own re-validation even though the Input Screen already prevents these client-side) using the same empty-state layout with `response.message` — ux-spec.md doesn't give these two statuses their own Results-screen mockup since they're not expected to normally reach this screen, but rendering *something* clear here (rather than crashing or showing nothing) matches ux-spec.md section 0's "never fail silently" principle. **The persistent FR-014 disclaimer banner is deliberately NOT rendered** — see the `disclaimer` field omission note above; this is INC-7's job per design.md section 10.

**`src/frontend/components/LoadingScreen.tsx`** (new, + `.css`) — Screen 2 per ux-spec.md section 5: spinner, primary/secondary copy, "Cancel" link back to Input. The "swap to 'Still working…' after a threshold" behavior (ux-spec.md section 5) is **not implemented** — ux-spec.md's own section 9 open-questions list flags that this threshold must be coordinated with tech-lead's chosen request-timeout config, which design.md section 10 scopes to `REQUEST_TIMEOUT_MS`/orchestration-timeout work in **INC-7**. Deferred rather than guessed.

**`src/frontend/components/SearchErrorScreen.tsx`** (new, + `.css`) — System/Network Failure State per ux-spec.md section 7: shown whenever `searchDropOffPoints()` reports `ok: false` (network error, `401`, `502`, or any other non-2xx). "Try again" re-issues the identical request; "Edit search" returns to Input. Offline detection via `navigator.onLine === false` swaps the body copy per spec.

**`src/frontend/api.ts`** (edited) — added `searchDropOffPoints(request)`, a thin fetch wrapper around the new endpoint following the same `{ ok, response?, errorCode? }` shape as the existing `geocodeQuery`/`reverseGeocode` wrappers.

**`src/frontend/App.tsx`** (edited) — now renders `<SearchFlow config={...}>` instead of `<InputScreen>` directly.

## How to run / smoke-test

1. Same as INC-1–5: `npm install`, fill in `.env.local` (a real `MAP_API_KEY` needed for a *successful* response; a dummy key still exercises every error path).
2. `POST /api/drop-off-search` with a JSON body `{ start, driverDestination, passengerDestination, maxDetourMinutes }` (each location `{ lat, lng, label }`) → `DropOffSearchResponse` (see `src/search/types.ts`).
3. In the browser: fill all three address fields + detour minutes on the Input Screen → CTA enables → "Find drop-off points" → Loading screen → Results screen (ranked/fallback/no-viable-option depending on data), or the system-failure screen on a network/provider error.

## Smoke test performed

No real `MAP_API_KEY` was available in this environment (same documented limitation as every prior increment) — all provider responses below are mocked, consistent with INC-2 through INC-5's precedent.

- `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (full existing suite, 311 tests) — all clean, no regressions. `tests/` untouched (QA's file); no new required config keys were introduced this increment (`MAX_CANDIDATES_RETURNED` already existed), so the existing suite passes unmodified.
- **`Ranker.rank` exercised directly** (temporary local script, not committed) with 7 contrived scenarios, each independently asserted:
  1. Equal `passengerTotalTimeMinutes` across 3 candidates → confirmed the tie-break sorts strictly by ascending `routeOrderIndex` (`[2, 5, 8]` order out of an input order of `[5, 2, 8]`).
  2. A faster-but-later-route-order candidate beats a slower-but-earlier one — confirms `passengerTotalTimeMinutes` is the primary key and `routeOrderIndex` truly only breaks *exact* ties, not a secondary weighting.
  3. 5 qualifying candidates with `maxCandidatesReturned=3` → confirmed exactly 3 returned (cap respected even with more available).
  4. Fallback: a "worse detour but faster passenger time" candidate correctly wins over a "better detour but slower" one — confirms OQ-3 (fallback picks smallest passenger time, never smallest detour) — and the generated `warning` string correctly names both the actual threshold (15) and the actual detour (40) substituted from the real input values.
  5. Every candidate `noTransitAvailable: true` → confirmed exact `{ status: "no_viable_option" }`, no candidates.
  6. A walking-only candidate (`passengerTotalTimeMinutes: 3`, `noTransitAvailable: false`) correctly **wins** against a normal-transit candidate with a much worse time — confirms DEC-3's walking-only-is-a-valid-result decision is honored all the way through ranking, not just transit evaluation.
  7. A candidate with a deceptively tiny `passengerTotalTimeMinutes` but `noTransitAvailable: true` is correctly **excluded** from the fallback pick even though it would "win" on raw numbers — confirms `noTransitAvailable` candidates can never be selected by either the ranked or fallback path.
- **`POST /api/drop-off-search` handler exercised directly** (temporary local script mirroring `tests/helpers/mockVercel.ts`'s pattern, using a real polyline encoder to produce genuine Toronto-area coordinates rather than Google's out-of-region documentation sample, so `CandidateGenerator`'s radius filter doesn't spuriously drop every candidate), covering:
  - **`ranked`**: normal case, 3 qualifying candidates, confirmed `status`, `candidates.length > 0`, `rank`/`driverTotalTimeMinutes`/`exceedsThreshold: false`/`label` (from the mocked reverse-geocode) all correct, `requestId`/`timingMs` present.
  - **`fallback`**: `maxDetourMinutes` set below every candidate's actual detour → confirmed `status: "fallback"`, exactly 1 candidate, `exceedsThreshold: true`, `warning` present and mentions "minutes".
  - **`no_viable_option`**: every candidate's transit call mocked to `ZERO_RESULTS` → confirmed `status: "no_viable_option"`, 0 candidates, `message` present.
  - **Walking-only (DEC-3) end-to-end**: transit call mocked to a walking-only route → confirmed `status: "ranked"` (not fallback/no-viable), `waitTimeMinutes`/`transitTimeMinutes` both `0` — the full pipeline, not just the `Ranker`/`TransitEvaluator` units in isolation, honors DEC-3.
  - **`invalid_input`**: missing `passengerDestination` → confirmed `status: "invalid_input"`, `candidates: []`.
  - **`out_of_service_area`**: `driverDestination` set to London, UK → confirmed `status: "out_of_service_area"`, message mentions "200 km".
  - **DQ-1 exemption re-verified end-to-end at the real search endpoint** (not just INC-2's client-side check): `passengerDestination` set to London, UK, with `start`/`driverDestination` both in-radius → confirmed the response is **not** `out_of_service_area` (correctly proceeds to compute a real result) — the specific scope check the orchestrator's brief called out as something INC-2's QA should re-verify once the real endpoint existed.
  - **AuthGate wiring**: `paid_tier`, no cookie → `401`, and confirmed **zero** `fetch` calls were made (provider never reached before the gate) — the 6th endpoint now replicating this exact verification.
  - **Provider error sanitization**: transit call mocked to `REQUEST_DENIED` with Google's real `error_message: "bad key"` → confirmed `502 provider_error`, and confirmed the string `"bad key"` does **not** appear anywhere in the serialized response body (only in the server-side `console.error` log).
  - **Config-load failure**: `MAP_API_KEY` unset → confirmed `500 config_error`, confirmed the raw `ConfigError` detail (`"MAP_API_KEY is required..."`) does **not** appear in the client-facing body.
  - **Reverse-geocode failure for a final candidate**: mocked to `ZERO_RESULTS` → confirmed the request still succeeds (`status: "ranked"`, not an error), and the affected candidate's `label` falls back to the documented "~N km into your route" phrasing rather than being blank or failing the whole request.
  - Wrong method (`GET`) → `405`.
- **Frontend rendering exercised directly via jsdom + `react-dom/client`** (temporary local script, not committed, following the same raw-`createRoot`/`act` pattern `tests/frontend/InputScreen.test.tsx` already uses — no test-library dependency needed):
  - `ResultsScreen` renders correctly for `ranked` (BEST OPTION badge, correct time values, `+3 min` detour formatting), `fallback` (CLOSEST OPTION badge, warning banner text, no BEST OPTION), `no_viable_option` (empty state + message), and the defense-in-depth `out_of_service_area` path (empty state + message) — and confirmed the disclaimer text is **absent** in all cases (correctly deferred to INC-7).
  - `LoadingScreen`/`SearchErrorScreen` render without throwing and show their expected copy.
  - `InputScreen`: a fresh, empty mount has the CTA disabled; mounted with `initialValues` fully seeded (simulating "Edit search") the CTA is enabled and clicking it calls `onSubmit` with the exact expected `DropOffSearchRequest` shape (`start`/`driverDestination`/`passengerDestination`/`maxDetourMinutes` all correct) — confirms the lifted-state wiring (`onResolvedChange` → `InputScreen`'s local state → `onSubmit`) actually works end-to-end, not just typechecks.
- No real browser/Playwright walkthrough was performed in this environment (no Playwright installation available this session, unlike prior increments' handoffs) — the jsdom-based checks above cover rendering/wiring correctness but not real-browser layout/CSS/touch-target verification. **Flagging this as a gap relative to prior increments' smoke-test depth** — recommend QA's browser pass be thorough on this increment specifically (mobile viewport, real click/type interactions through the full autocomplete flow into a real submit, not just the seeded-`initialValues` shortcut used here).

## Known limitations / things for QA and reviewer to be aware of

1. **`disclaimer` (FR-014) is intentionally absent from `DropOffSearchResponse` and not rendered on the Results screen this increment** — design.md section 10 scopes it to INC-7 both in the "Covers" line and the traceability summary (`FR-014 → INC-7`), and section 5.1's `RankedResult`/`Ranker.rank` (this increment's actual algorithmic scope) has no disclaimer field at all. Flagged for tech-lead confirmation rather than guessed either direction (build it now vs. defer it) — see the `src/search/types.ts` note above. QA should not expect to see the safety/legality banner yet.
2. **The three INC-3/4/5 debug endpoints (`/api/route/direct`, `/api/candidates/evaluate`, `/api/candidates/transit`) were kept, not removed**, now that `/api/drop-off-search` exists — see the reasoning in `api/drop-off-search.ts`'s own section above. Flagging explicitly per the orchestrator's request in case tech-lead/QA want to schedule their retirement at Phase 4 closure instead of leaving them indefinitely.
3. **Business-outcome HTTP status is always `200`** (`invalid_input`/`out_of_service_area`/`no_viable_option`/`ranked`/`fallback` all return `200` with `status` in the body); only infra-level failures (`401`/`405`/`500`/`502`) use non-200 codes. Design.md section 5.2 doesn't spell this split out explicitly — flagged as an interpretation, not a silent guess, in case tech-lead intended `invalid_input`/`out_of_service_area` to be real `400`-style HTTP errors instead.
4. **`labelFinalCandidates`'s fallback label uses straight-line (haversine) distance from `start`, not true along-route distance** — flagged above; only affects the rare case where Google's reverse geocoder can't match a candidate point at all.
5. **Ranker's config parameter (`RankingConfig = Pick<AppConfig, "maxCandidatesReturned">`) extends the REV-011 stale-doc pattern** reviewer already tracks across 6 other modules — design.md section 5.1 still shows `Ranker.rank(..., config: AppConfig)` (full config). Not a functional risk (same established reasoning), just one more module for tech-lead's next batch documentation pass.
6. **The Loading screen's "Still working — this is taking a little longer than usual" copy swap (ux-spec.md section 5) is not implemented** — correctly deferred to INC-7 per `REQUEST_TIMEOUT_MS`/orchestration-timeout work being that increment's scope (design.md section 10), and ux-spec.md's own section 9 open-questions list already flags this exact coordination point as unresolved.
7. **No real `MAP_API_KEY` was available in this environment** (same as every prior increment) — all provider responses were mocked, including a hand-built Toronto-area encoded polyline (rather than Google's own out-of-region documentation sample) so the full pipeline could be exercised end-to-end without every sampled candidate being dropped by the radius filter. QA should re-run the full success path against a real key before sign-off, per the same standing REV-010 tracked item (now also covering `Ranker`/`/api/drop-off-search`'s real-data behavior, not just the three underlying provider integrations).
8. **No Playwright/real-browser walkthrough was performed this increment** (tooling unavailable in this session) — see the Smoke test section's final bullet. This is a materially different (lower) verification depth than INC-1/INC-2's documented browser walkthroughs for what is otherwise the biggest user-facing UI increment so far. QA should prioritize a full real-browser pass (mobile viewport, full autocomplete-driven form fill through to submit, not just the seeded-`initialValues` shortcut this smoke test used) before sign-off.
9. **`useLocationField`'s new `initialValue` option only seeds on mount** (a later prop change does not re-seed an already-mounted field) — this is intentional given `SearchFlow` fully unmounts/remounts `InputScreen` on every stage transition, but flagging in case QA writes a test that changes `initialValue` on an already-mounted `LocationField` expecting a re-seed; that is not supported and not needed by any real user flow in this app.

---

# BUG-001 fix (INC-6, fix cycle 1): stale in-flight search race in `SearchFlow.runSearch`

**File touched:** `src/frontend/components/SearchFlow.tsx`.

Per QA's write-up in `docs/test-report.md` (BUG-001) and the `it.fails`-marked regression test in `tests/frontend/SearchFlow.test.tsx`: `runSearch()` had no cancellation/staleness guard, so a stale in-flight `searchDropOffPoints()` promise would unconditionally call `setStage(...)` whenever it eventually resolved — silently overwriting the Input screen after a Cancel, or (the compounding case QA flagged) clobbering a *newer* in-progress search if an older one resolved out of order.

**Fix:** added a `useRef`-based monotonically-incrementing token (`currentSearchToken`). `runSearch` captures the token before awaiting `searchDropOffPoints(request)` and, after the await, only calls `setStage` (for both the error branch and the success branch) if that token still matches the current one. `cancelSearch` (now passed to `LoadingScreen`'s `onCancel`) bumps the token in addition to returning to `{ kind: "input" }`. Starting any new search (including "Try again") also bumps the token via the same `++currentSearchToken.current` increment used to capture it — so an older search's stale resolution is a no-op whether it was cancelled, superseded by a newer search, or both. This is the single general mechanism QA asked for, not a separate cancel-only boolean.

**Verification:** `npm run typecheck`, `npm run lint`, `npm run build` all clean. Full suite (`npx vitest run`) — 373/374 passing; the one "failure" is QA's `it.fails`-wrapped BUG-001 regression test itself now passing internally (its assertions no longer throw), which `it.fails` reports as "Expect test to fail" since the wrapper still expects failure — this is the expected signal that the underlying bug is fixed, not a new regression. Zero other regressions across the suite. Did not modify `tests/` — QA owns flipping `it.fails` back to a normal `it(...)` and re-verifying.

**Known limitation:** this guard covers `stage` updates inside `runSearch` only (the code path BUG-001 was filed against). It does not add an `AbortController` to actually cancel the underlying `fetch`/`searchDropOffPoints` call itself — the stale request still completes on the network, it's just ignored on arrival. If a future requirement needs to actually cancel the in-flight HTTP request (e.g., for cost/quota reasons on the provider side), that would need `searchDropOffPoints`'s signature to accept an `AbortSignal`, which is a design-level change out of scope for this bug fix.

---

# Handoff: INC-7 — Disclaimer, latency hardening, timeout handling

Status: implemented, smoke-tested, ready for QA.
Covers: FR-014, NFR-004 (validated, not just designed), config keys `RESPONSE_TIME_TARGET_SECONDS` / `REQUEST_TIMEOUT_MS` / `PROVIDER_CONCURRENCY_LIMIT` (all previously loaded by INC-1's loader, now actually consumed). Resolves **REV-012** (major, logged at the INC-6 audit).

## What was built

### 1. FR-014 disclaimer, resolving REV-012

**`src/search/types.ts`**: added `export const DISCLAIMER_TEXT` — the exact ux-spec.md section 6.2 copy ("This is an estimated drop-off point only. Before stopping, confirm it's safe and legal to pull over here.") — defined once in this shared, framework-agnostic module so backend and frontend both import the same literal rather than risking the REV-007-style drift this project already had to fix once (`MIN_QUERY_LENGTH`/`DEBOUNCE_MS`). Added `disclaimer?: string` to `DropOffSearchResponse`, matching design.md section 5.2's documented contract ("always present when `candidates.length > 0`").

**`api/drop-off-search.ts`**: `disclaimer: DISCLAIMER_TEXT` is now included on both the `"ranked"` and `"fallback"` responses (the only two statuses with `candidates.length > 0`) — `"no_viable_option"`/`"out_of_service_area"`/`"invalid_input"`/`"timeout"` correctly omit it (no candidates).

**Frontend resilience (the part the orchestrator asked to treat seriously)**:
- **`src/frontend/components/DisclaimerBanner.tsx`** (new, + `.css`) — a deliberately static, **prop-less** component. It reads `DISCLAIMER_TEXT` directly and touches zero response/candidate data, so nothing about its own render logic can ever throw due to malformed upstream data. Sticky to the top of the viewport (`position: sticky; top: 0`), warning-colored per ux-spec.md section 6.2's tokens, no dismiss control of any kind (non-dismissible per FR-014).
- **`src/frontend/components/ErrorBoundary.tsx`** (new) — a generic class-based React error boundary (only class components can implement `getDerivedStateFromError`/`componentDidCatch`; there's no hooks equivalent).
- **`src/frontend/components/SearchFlow.tsx`** (edited) — the `"results"` stage branch now renders:
  ```tsx
  {showDisclaimer && <DisclaimerBanner />}
  <ErrorBoundary fallback={<ResultsRenderFailed onEditSearch={...} />}>
    <ResultsScreen ... />
  </ErrorBoundary>
  ```
  `showDisclaimer` is a single flat `response.status === "ranked" || response.status === "fallback"` check — the lowest-risk computation possible (a string comparison on a field that's always present, not a deep candidate-array read). **This is the load-bearing structural choice**: the banner is rendered as a *sibling*, entirely *outside* the `ErrorBoundary` that wraps `ResultsScreen`. If `ResultsScreen`'s data-dependent rendering (candidate-card mapping, trip-summary label interpolation, etc.) throws for any reason — malformed data, a future bug — React's error boundary contract guarantees only the subtree *inside* the boundary is replaced by the fallback; the disclaimer, being outside it, is structurally untouched and keeps rendering. This is not a convention or a code-review rule, it's a property of the component tree itself.
  - `ResultsRenderFailed` (small local component in `SearchFlow.tsx`) is the boundary's fallback — minimal, static, gives the user an "Edit search" way out.
- **`src/frontend/components/ResultsScreen.tsx`** (edited) — explicitly does **not** render the disclaimer itself (the doc comment now documents that the banner lives one level up, in `SearchFlow.tsx`, for the resilience reason above, rather than the old "deferred to INC-7" note).

**Verification of the resilience claim** (temporary scratch test, run via `npx vitest run`, not committed — see Smoke test section): mounted `<DisclaimerBanner />` as a sibling next to `<ErrorBoundary fallback={...}><ThrowingResultsScreen /></ErrorBoundary>` where `ThrowingResultsScreen` unconditionally throws. Confirmed the disclaimer text is present in the rendered output **and** the boundary's fallback is shown, in the same render pass — i.e., a hard crash in the results subtree does not remove the disclaimer. This is the literal ux-spec.md section 6.2 requirement ("must render even if other rendering fails"), verified structurally, not just asserted.

**Does this fully resolve REV-012?** Yes for the specific gap reviewer flagged (FR-014 shipped in INC-6 without the disclaimer, in tension with ux-spec.md's "non-negotiable" framing) — the disclaimer is now implemented, present on every response with `candidates.length > 0`, and structurally resilient per the above. **One scope note to flag, not silently decided**: ux-spec.md section 6.6's own "no viable option" mockup shows the disclaimer banner still present in that empty state ("disclaimer still shown (harmless, consistent — no reason to hide it)"), whereas design.md section 5.2's literal contract and the orchestrator's brief for this increment both scope the disclaimer strictly to `candidates.length > 0` (`ranked`/`fallback`). I implemented the latter (matching the explicit brief and design.md's documented contract) — `no_viable_option`/`timeout`/`out_of_service_area`/`invalid_input` do **not** show the disclaimer. This is a real, small, pre-existing tension between design.md and ux-spec.md (not something I introduced), similar in kind to REV-012 itself; flagging to tech-lead/designer to confirm whether ux-spec.md's broader "every results state" framing should be reconciled into design.md's contract, or vice versa. It does not affect the FR-014/REV-012 core finding (a disclaimer-bearing ranked/fallback response reaching production with no disclaimer at all), which is fully closed.

### 2. NFR-004 latency hardening — per-call timeouts

**`src/http/fetchWithTimeout.ts`** (new) — the single shared implementation of `REQUEST_TIMEOUT_MS` enforcement, used by all four provider services (previously each had its own untimed `fetchImpl(url)` call):
- `fetchWithTimeout(fetchImpl, url, timeoutMs)`: when `timeoutMs` is provided, wraps the call in an `AbortController`, aborts after `timeoutMs`, and throws `ProviderTimeoutError` on abort (distinguished from a genuine network error). When `timeoutMs` is `undefined`, it's a pure passthrough — **no behavior change for any existing unit test that constructs a service without a timeout** (this is why none of the ~50+ existing provider-service tests needed any change).
- Every service's default `fetchImpl` was updated from `(url) => fetch(url)` to `(url, init) => fetch(url, init)` so the abort signal actually reaches the real network call in production.

**`src/geocoding/googleGeocodingService.ts`, `src/routing/googleRoutingService.ts`, `src/routing/googleDistanceMatrixService.ts`, `src/transit/googleTransitDirectionsService.ts`** (all edited): each gained an optional `timeoutMs` option, routed through `fetchWithTimeout`; a caught `ProviderTimeoutError` is mapped to that service's own error class with provider status `"TIMEOUT"` (`RoutingProviderError`/`GeocodingProviderError`), so the existing REV-009 sanitized-error handling at every API handler applies unchanged — **a timeout's raw detail (`"Provider request timed out after 4000ms."`) is logged server-side only, never forwarded to the client**, confirmed in smoke testing (see below).

**All five `api/*.ts` handlers** (`api/geocode.ts`, `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts`, `api/drop-off-search.ts`) now pass `timeoutMs: config.requestTimeoutMs` when constructing every provider service — this is the actual "wiring" step; `REQUEST_TIMEOUT_MS` was already loaded by INC-1's config loader but genuinely unused by any provider call until this increment.

**`PROVIDER_CONCURRENCY_LIMIT` consistency check** (per the orchestrator's ask): confirmed it's already correctly enforced exactly once, in `src/transit/evaluateShortlist.ts`'s bounded worker pool (INC-5) — the only fan-out in this codebase with an unbounded-by-default number of parallel calls (up to `MAX_TRANSIT_EVALUATIONS_PER_REQUEST`, default 8). `detourEvaluator.ts`'s batching issues exactly 2 parallel calls per batch (not unbounded), and `labelFinalCandidates.ts`'s `Promise.all` is bounded by `MAX_CANDIDATES_RETURNED` (default 3, or 1) — both already inherently small and not in need of a separate concurrency cap. No changes made to either; documenting the check rather than adding an unnecessary knob.

### 3. NFR-004 latency hardening — overall orchestration timeout (design.md section 6.3)

**`src/transit/evaluateShortlist.ts`** (edited): added two new optional `EvaluateShortlistOptions` fields, both backward compatible (every existing caller/test that omits them behaves exactly as before):
- `deadline?: Date` — before dispatching a **new** transit-evaluation call, each worker checks `Date.now() >= deadline`. If exceeded, the candidate is reported as `noTransitAvailable: true` (the same sentinel already used for the "no viable driving route" skip case) **without spending a provider call**. Already-in-flight calls are not aborted (each is already bounded by its own `REQUEST_TIMEOUT_MS`), so the maximum overrun past `deadline` is one more per-call timeout, not an unbounded hang.
- `onSkippedDueToDeadline?: () => void` — invoked once per candidate skipped this way, so the caller can distinguish "we ran out of time" from "no candidate had viable transit" without changing this function's return shape (still a plain array).

**`api/drop-off-search.ts`** (edited): computes `orchestrationDeadline = requestStart + config.responseTimeTargetSeconds * 1000` and passes it (with a skip counter) to `evaluateShortlist`. After `Ranker.rank`:
- If `ranked.status === "no_viable_option"` **and every shortlisted candidate was skipped specifically due to the deadline** (`skippedDueToTimeout === shortlist.length`, and the shortlist was non-empty), the response is `status: "timeout"` (a new value added to `DropOffSearchStatus`) instead of `"no_viable_option"` — this is design.md section 6.3's "if literally nothing completed in time, return a distinct timeout-specific message" branch, disambiguated from a genuine "no candidate has viable transit" business outcome so the frontend can invite a retry instead of implying the trip has no viable drop-off point.
- If *some* candidates completed before the deadline and *some* were skipped, `Ranker.rank` naturally produces a `"ranked"`/`"fallback"` result from whatever did complete — this is design.md's "rank and return whatever candidates completed evaluation within budget" graceful-degradation path, verified directly in smoke testing (see below), not just asserted.

**Interpretation flagged, not silently decided**: design.md section 6.3 says the orchestration timeout should be "slightly under `RESPONSE_TIME_TARGET_SECONDS`," but no separate margin/safety-buffer config key exists in section 7's schema. Rather than inventing an unaudited extra tunable, I used `RESPONSE_TIME_TARGET_SECONDS` itself as the deadline (the most literal reading available from the existing schema). Flagging to tech-lead in case a distinct margin key (e.g. a fraction of `RESPONSE_TIME_TARGET_SECONDS`, or a new config key) was actually intended — this is a one-line change to adopt if so.

**`src/search/types.ts`**: `DropOffSearchStatus` gained `"timeout"`, matching design.md section 8's frontend contract ("`timeout` (see section 6.3) — message distinct from the above, inviting retry").

### 4. Frontend timeout UX

**`src/frontend/components/ResultsScreen.tsx`** (edited): `"timeout"` is now handled by the same message-only empty-state branch as `"no_viable_option"`/`"out_of_service_area"`/`"invalid_input"`, with its own title ("This is taking longer than expected") and a **"Try again"** button (design.md section 8's "inviting retry") that calls a new `onTryAgain` prop.

**`src/frontend/components/SearchFlow.tsx`** (edited): passes `onTryAgain={() => runSearch(stage.request)}` to `ResultsScreen` — re-issues the identical request, reusing the exact same re-submission pattern `SearchErrorScreen`'s "Try again" already established.

**`src/frontend/components/LoadingScreen.tsx`** (edited): now accepts `responseTimeTargetSeconds: number` and implements ux-spec.md section 5's previously-deferred "Still working..." copy swap — a `setTimeout` scheduled on mount for `responseTimeTargetSeconds * 1000` ms, swapping the secondary line to "Still working — this is taking a little longer than usual." A missing/non-finite/non-positive value (e.g. an old test fixture that hasn't been updated) safely results in **no timer being scheduled at all** — never a crash, never an immediate/incorrect swap.

**`src/config/schema.ts` / `src/config/publicConfig.ts`** (edited): `responseTimeTargetSeconds` added to `PublicConfig` (not a secret) so the frontend's threshold is driven by the **same** value the backend's orchestration deadline uses — one tunable, not two independently-guessed ones, per `GET /api/config/public`'s already-established pattern for `minGeocodeQueryLength`/`geocodeDebounceMs`.

## Files created

- `src/http/fetchWithTimeout.ts`
- `src/frontend/components/DisclaimerBanner.tsx` (+ `.css`)
- `src/frontend/components/ErrorBoundary.tsx`

## Files changed

- `src/search/types.ts` (`DISCLAIMER_TEXT`, `disclaimer` field, `"timeout"` status)
- `api/drop-off-search.ts` (timeouts wired, orchestration deadline, `disclaimer`/`"timeout"` responses)
- `api/geocode.ts`, `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts` (`timeoutMs` wired into every service construction)
- `src/geocoding/googleGeocodingService.ts`, `src/routing/googleRoutingService.ts`, `src/routing/googleDistanceMatrixService.ts`, `src/transit/googleTransitDirectionsService.ts` (per-call timeout support)
- `src/transit/evaluateShortlist.ts` (`deadline`/`onSkippedDueToDeadline` options)
- `src/config/schema.ts`, `src/config/publicConfig.ts` (`responseTimeTargetSeconds` in `PublicConfig`)
- `src/frontend/components/SearchFlow.tsx`, `ResultsScreen.tsx` (+ `.css`), `LoadingScreen.tsx`

## How to run / smoke-test

1. Same as prior increments: `npm install`, fill in `.env.local`, `npm run dev`.
2. `POST /api/drop-off-search` with a valid body now includes `disclaimer` on `ranked`/`fallback` responses.
3. To exercise the timeout path locally without waiting for a real slow provider: set `RESPONSE_TIME_TARGET_SECONDS` very low (e.g. `0.05`) and/or `PROVIDER_CONCURRENCY_LIMIT=1` with several candidates — see the scratch-script scenarios below, which QA can reproduce as real committed tests using the same technique (inject a slow mocked `fetch`/`TransitEvaluator`, not real waiting).

## Smoke test performed

Timeouts are inherently hard to test deterministically against real wall-clock waits — per the orchestrator's instruction, I used short, injectable, test-only timeout/deadline values (not real multi-second waits) to verify the logic:

- `npm run typecheck`, `npm run lint`, `npm run build` — all clean.
- `npx vitest run` (full existing suite): **372/375 passing.** The 3 failures are expected, exactly-the-same-category collateral as REV-006/REV-007's precedent (a new required field surfacing in an exact-shape test, or a test whose entire premise is a since-fulfilled deferral) — **not regressions**:
  1. `tests/api/config-public.test.ts`, "happy path" — exact `toEqual` snapshot now also has `responseTimeTargetSeconds: 5` (a genuine, intentional new field). QA should add this key to the expected object.
  2. `tests/config/publicConfig.test.ts`, "returns exactly the 7 fields..." — same root cause, now 8 fields. QA should update the expected key list.
  3. `tests/api/drop-off-search.test.ts`, describe block "no disclaimer field yet (FR-014 deferred to INC-7)" — this test's entire premise (the deferral) is exactly what this increment fulfills; its one assertion (`expect(body.disclaimer).toBeUndefined()`) is now correctly false for a `ranked` response. QA should remove/invert this test now that FR-014 is implemented, and add positive coverage instead (disclaimer present + exact text on `ranked`/`fallback`, absent on the other four statuses).
- **Per-call timeout, via `src/http/fetchWithTimeout.ts` directly** (temporary scratch script, `npx tsx`, not committed): confirmed (a) a fast call succeeds untouched, (b) a slow call that genuinely honors `AbortSignal` (matching real `fetch`/undici behavior) is aborted at exactly `timeoutMs` and rejects with `ProviderTimeoutError`, (c) omitting `timeoutMs` is a byte-for-byte passthrough (no `AbortController` machinery at all, confirming zero behavior change for existing tests).
- **Per-call timeout, through the real `/api/drop-off-search` handler** (temporary scratch script constructing the real Google service factories, not mocks of the services themselves — only `global.fetch` is mocked): with `REQUEST_TIMEOUT_MS=50` and a mocked transit call that hangs indefinitely unless aborted, confirmed the handler returns `502 provider_error` with the sanitized generic message, and confirmed via the server-side `console.error` log that the raw detail (`"Provider request timed out after 50ms."`) is what's logged, not what's sent to the client. This proves `REQUEST_TIMEOUT_MS` is wired end-to-end through the real handler → real service construction → real `fetchWithTimeout` path, not just unit-tested at the service layer in isolation.
- **`evaluateShortlist`'s deadline, in isolation** (temporary scratch script): (a) a deadline already in the past skips every candidate with zero real provider calls made; (b) a deadline exceeded partway through a concurrency-limited (`providerConcurrencyLimit: 2`) 6-candidate shortlist results in some candidates completing and some being skipped (confirmed both outcomes present in the result set).
- **Overall orchestration timeout, through the real `/api/drop-off-search` handler** (temporary scratch script, real Google service factories + mocked `global.fetch`, three scenarios):
  1. Normal config (`RESPONSE_TIME_TARGET_SECONDS=5`, fast mocked provider responses) → `status: "ranked"`, `disclaimer` present, ~10ms elapsed.
  2. `PROVIDER_CONCURRENCY_LIMIT=1`, 3 shortlisted candidates each taking 300ms, `RESPONSE_TIME_TARGET_SECONDS=0.15` (150ms) → candidate #1 (already dispatched before the deadline) completes normally; candidates #2/#3 (queued behind the concurrency limit) are skipped once their turn arrives past the deadline → **`status: "ranked"` with exactly 1 candidate** — the graceful partial-degradation path, empirically confirmed, not just designed.
  3. Same setup but `RESPONSE_TIME_TARGET_SECONDS=0.0001` (effectively already elapsed before the first candidate can be dispatched) → **`status: "timeout"`**, `candidates: []`, the distinct retry-inviting message — confirmed this is genuinely reachable, not theoretical.
- **Frontend, via a temporary vitest spec under `tests/` (not committed, deleted after running)**: confirmed (a) `<DisclaimerBanner>` renders the exact required copy with no button/dismiss control; (b) `<ErrorBoundary>` catches a thrown child and shows its fallback; (c) **the core resilience claim** — `<DisclaimerBanner>` rendered as a sibling next to an `<ErrorBoundary>` wrapping a component that unconditionally throws still shows the disclaimer text in the same render pass as the boundary's fallback; (d) `<ResultsScreen>`'s new `"timeout"` status renders the expected copy and its "Try again" button calls `onTryAgain`; (e) `<LoadingScreen>` swaps to "Still working" after `responseTimeTargetSeconds` elapses (via `vi.useFakeTimers()`, not a real wait); (f) `<LoadingScreen>` with a missing/`NaN` `responseTimeTargetSeconds` never swaps and never crashes.

## Empirical latency (NFR-004) — what this increment can and cannot confirm

No real `MAP_API_KEY` was available in this environment (the same standing limitation carried since INC-2, tracked under REV-010). All timing numbers above come from **mocked** provider responses with artificially injected delays, not real Google Directions/Distance Matrix/Transit calls — they prove the *mechanism* (per-call timeout enforcement, graceful degradation, distinct timeout status) works correctly, but they do **not** by themselves confirm the **5-second soft target is met against real-world provider latency**. That empirical validation — comparing `timingMs` on real responses against `RESPONSE_TIME_TARGET_SECONDS` under realistic/staging conditions with a real API key — is explicitly QA's job per design.md section 10's INC-7 "QA can test" line ("latency measurements against target under realistic/staging conditions, graceful behavior when an artificial slow-provider-response is simulated"). Recommend folding this into the existing REV-010-tracked pre-Phase-4 closure condition rather than treating it as newly discovered.

## Known limitations / things for QA and reviewer to be aware of

1. **The orchestration deadline only gates the transit-evaluation fan-out (`evaluateShortlist`), not the earlier direct-route/candidate-generation/detour-evaluation phases.** Those phases are each still individually bounded by `REQUEST_TIMEOUT_MS` per call, but there's no deadline check *between* them — e.g., a request with an unusually large `MAX_RAW_CANDIDATES_SAMPLED` relative to `DISTANCE_MATRIX_BATCH_SIZE` (many sequential detour-evaluation batches) could in principle consume most or all of the orchestration budget before ever reaching the transit phase, at which point every candidate would correctly report as skipped-due-to-deadline (`status: "timeout"`) — so the *outcome* is still graceful, just later than ideal. Extending deadline-awareness to `detourEvaluator.ts`'s batch loop was considered and deliberately not built this increment (would require a new interface parameter, another design.md deviation to flag, and at default config there is always exactly one batch, so this is a non-default-config-only edge case) — flagging for tech-lead/QA to decide if it's worth a follow-up.
2. **No separate "safety margin" config key exists for the orchestration deadline** — see the interpretation note above; `RESPONSE_TIME_TARGET_SECONDS` itself is used as the deadline, not "slightly under" it via a second tunable. Flag to tech-lead if a distinct margin key was intended.
3. **The ux-spec.md section 6.6 vs. design.md section 5.2 tension on whether the disclaimer should also show on `no_viable_option`** (see the "Does this fully resolve REV-012?" note above) — implemented per design.md's literal contract and the orchestrator's explicit brief (candidates.length > 0 only), not ux-spec's broader mockup. Flagging as a small, separate, pre-existing documentation tension, not a new decision made unilaterally.
4. **Three existing QA tests now fail as an expected consequence of this increment** (see Smoke test section) — same category of collateral as the REV-006/REV-007 follow-up pass, not a regression. QA owns updating `tests/api/config-public.test.ts`, `tests/config/publicConfig.test.ts`, and replacing `tests/api/drop-off-search.test.ts`'s "no disclaimer field yet" test with positive disclaimer-presence coverage.
5. **No new tests were added to `tests/` by dev** (per the pipeline rule — `tests/` is QA's owned artifact). All verification in this increment used temporary, uncommitted scratch scripts (`npx tsx` for pure-Node logic, a temporary `tests/_scratch_*.test.tsx` file for jsdom-dependent React rendering, both deleted after use) — QA should write real committed coverage for: `fetchWithTimeout` (timeout/passthrough/non-abort-error paths), each provider service's new `timeoutMs` option end to end, `evaluateShortlist`'s `deadline`/`onSkippedDueToDeadline` options, `/api/drop-off-search`'s `"timeout"` status and graceful-partial-degradation behavior, `DisclaimerBanner`/`ErrorBoundary` in isolation, and `SearchFlow`'s disclaimer/error-boundary composition (the resilience claim itself).
6. **No real `MAP_API_KEY` was available in this environment** (same standing limitation as every prior increment, tracked under REV-010) — see the "Empirical latency" section above. QA must validate the actual 5-second soft target against real provider responses before Phase 4 closure.
7. **`REQUEST_TIMEOUT_MS`/timeout enforcement was added to all four provider services and wired into all five `api/*.ts` handlers**, including the three INC-3/4/5 debug endpoints (`/api/route/direct`, `/api/candidates/evaluate`, `/api/candidates/transit`) — these aren't user-facing but are still real billable calls a QA/dev tester can hit, so leaving them un-timed while hardening only the production endpoint would have been an inconsistency worth flagging; instead all five got the identical one-line `timeoutMs: config.requestTimeoutMs` treatment.

---

# Handoff: INC-8 — Paid-tier hardening, full mobile polish, cross-cutting error handling

Status: implemented, smoke-tested, ready for QA. This is the final planned core increment before Phase 4 closure (INC-9's map view remains optional/conditional per design.md section 10).
Covers: remainder of NFR-001, NFR-002 (re-confirmed), FR-016/FR-017 (full end-to-end incl. re-auth), NFR-006 edge cases (re-confirmed, no code change needed), NFR-003 closure check (re-confirmed, no code change needed). Closes REV-002 (major), REV-004 (minor), REV-005 (minor), REV-014 (minor), and the residual "noted for awareness" `/api/config/public` message-leak item from the INC-1 audit. Resolves REV-013 by retiring its other side (the debug endpoints) rather than aligning conventions.

This was a large, backlog-clearing pass — the summary below is organized by the orchestrator's 8 numbered items.

## 1. REV-002 — session cookie hardening (major, carried since INC-1)

**Problem**: the session token was a deterministic, non-expiring HMAC of a fixed message. A leaked/copied cookie was valid indefinitely, revocable only by rotating `PAID_TIER_ACCESS_PASSWORD` (invalidating every other user's session too).

**Fix**, exactly per reviewer's recommended remediation:
- **`src/auth/session.ts`**: `createSessionToken(paidTierAccessPassword, expiresAtEpochSeconds)` now requires an explicit expiry (unix seconds) and returns `${expiresAtEpochSeconds}.${hmac}`, where the HMAC is computed over both the fixed message *and* the expiry value — tampering with the plaintext expiry (e.g. to extend it) invalidates the signature, it doesn't just get ignored. `isValidSessionToken(token, paidTierAccessPassword, now = Date.now())` now checks both the signature and `now < expiresAtEpochSeconds * 1000`. `now` is injectable (unix ms), matching the same clock-injection pattern already used elsewhere in this codebase (`googleRoutingService.ts`'s `now` option, `evaluateShortlist.ts`'s shared `now()` reading), so QA can test "not yet expired" / "just expired" deterministically without real waiting.
- **`src/auth/authGate.ts`**: `AuthGate.check(req, config, now = Date.now())` gained the same optional, injectable third parameter (backward compatible — every existing 2-arg call site is unaffected).
- **`src/auth/cookies.ts`**: `SessionCookieOptions` gained a required `maxAgeSeconds: number`; `buildSessionCookieHeader` now emits `Max-Age=<value>` so the browser's own cookie also expires (defense in depth — the server-side check above is the actual security boundary, it does not trust the browser to honor `Max-Age`).
- **New config key `SESSION_LIFETIME_SECONDS`** (integer, required, no code-level default — same fail-fast pattern as every other numeric key): added to `src/config/schema.ts`'s `AppConfig`, parsed in `src/config/loader.ts` via the existing `parsePositiveNumber(..., integerOnly: true)` helper, documented in `.env.example` (example value `3600` = 1 hour). **Checked design.md section 7 first, per the brief's instruction**: the key was *not* already in the schema — reviewer's REV-002 finding explicitly names `SESSION_LIFETIME_SECONDS` as the suggested name in `docs/review-log.md`, so this uses that exact name. Not added to `PublicConfig` (no frontend consumer needs it; the frontend doesn't display a countdown or expiry warning, since neither design.md nor ux-spec.md call for one — see the re-auth-UX note below).
- **`api/auth/verify-password.ts`**: computes `expiresAtEpochSeconds = Math.floor(Date.now()/1000) + config.sessionLifetimeSeconds` and passes it to both `createSessionToken` and `buildSessionCookieHeader`'s `maxAgeSeconds`.

**Re-auth behavior** (design.md section 10's own INC-8 scope wording: "session cookie, re-auth behavior"), since the session now genuinely expires mid-use for the first time:
- **`src/frontend/sessionFlag.ts`**: added `clearClientSessionFlag()`.
- **`src/frontend/App.tsx`**: passes `onSessionExpired` to `<SearchFlow>` — clears the client-side session flag and flips back to `authenticated: false`, which re-renders the Password Gate.
- **`src/frontend/components/SearchFlow.tsx`**: if `POST /api/drop-off-search` returns `401 unauthorized`, calls `onSessionExpired()` instead of showing the generic system-failure screen (which would be misleading — the problem is auth, not network/provider).
- **`src/frontend/components/InputScreen.tsx`** / **`src/frontend/hooks/useLocationField.ts`**: the same `onSessionExpired` is threaded down to all three location fields, since a geocode/reverse-geocode call mid-typing can also legitimately 401 once the session has expired. Distinguished from the existing `provider_error` field state (which is for genuine provider/network failures, not auth).

**No logout button was added.** ux-spec.md does not call for one anywhere (§3's password gate spec has no logout affordance, and no other screen has one either), so per this project's no-inference rule, building new UI not authorized by ux-spec would be undocumented scope creep (the same category of issue as REV-008). Flagging this explicitly for designer/pm rather than guessing: now that sessions genuinely expire, a manual "log out" control is a legitimate feature candidate, but it's a product decision, not an implementation detail — the expiry itself already delivers the "short-lived" property FR-016/017's paid-tier language calls for.

**Verified directly** (see Smoke test section) with real HMAC math and a real HTTP round-trip against the local dev server: fresh token valid, expired token rejected, tampered-expiry token rejected, wrong-password token rejected, malformed (missing-expiry) token rejected, exact-boundary token rejected (strict `<`), and a real `POST /api/auth/verify-password` → wait past `SESSION_LIFETIME_SECONDS` → same cookie now genuinely 401s on a real protected endpoint.

## 2. REV-004 — mobile viewport (minor)

**`index.html`**: removed `maximum-scale=1.0` from the viewport meta tag (was disabling pinch-to-zoom, an accessibility anti-pattern per WCAG 1.4.4). Now `width=device-width, initial-scale=1.0` only, exactly as recommended.

## 3. REV-005 — tsconfig (minor)

**`tsconfig.json`**: added `"tests"` to `include`. Verified this doesn't silently break anything that was previously clean — running `tsc --noEmit` with `tests/` excluded still shows zero errors in `src/`/`api/`; every error introduced by this change is confined to `tests/` files. See the "known limitation" section below for the full, itemized breakdown (this interacts significantly with items 1 and 6, since both introduce breaking signature/behavior changes QA's fixtures need to catch up to — which is exactly what REV-005 is for).

## 4. REV-014 — request cancellation (minor)

**Problem**: BUG-001's fix (the `currentSearchToken` guard) prevented a stale/superseded search's result from being *applied*, but never aborted the underlying `fetch`/backend pipeline — a cancelled search still ran its full ~14-17-call-per-submission pipeline server-side for a result nobody would see.

**Fix**:
- **`src/frontend/api.ts`**: `searchDropOffPoints(request, signal?)` now accepts an optional `AbortSignal`, passed straight through to `fetch`'s own `signal` option. A caught `AbortError` (`DOMException` named `"AbortError"`) is mapped to a new `errorCode: "aborted"` (distinct from `"network_error"`), though in practice `SearchFlow.tsx`'s pre-existing token check always discards an aborted result's outcome before it can reach the UI (see below), so this is mostly for accurate typing/future-proofing, not user-visible behavior.
- **`src/frontend/components/SearchFlow.tsx`**: added an `activeAbortController` ref alongside the existing `currentSearchToken` ref. `runSearch` aborts the *previous* controller (if any) before starting a new one; `cancelSearch` aborts the *current* controller in addition to bumping the token. Both the "superseded by a newer search" case and the "user clicked Cancel" case now genuinely abort the in-flight HTTP request, not just ignore its eventual result.

**Verified**: existing BUG-001 regression tests (`tests/frontend/SearchFlow.test.tsx`, mocking `searchDropOffPoints` directly) still pass unmodified (10/10) — the abort wiring is additive at the call-site level and doesn't change the mocked-function contract those tests rely on. Manually traced the control flow: in both the cancel and the superseded-by-newer-search cases, `currentSearchToken`'s mismatch check (already existing, BUG-001) causes `runSearch` to `return` *before* ever inspecting the aborted outcome, so no incorrect "aborted"/error UI is ever shown to the user — the abort is purely a cost-saving network-level effect.

## 5. Full mobile polish pass

Reviewed every screen (InputScreen, LoadingScreen, ResultsScreen, PasswordGate, SearchErrorScreen, DisclaimerBanner) against ux-spec.md section 2's token system and section 2.5's layout/tap-target rules. Found and fixed:

- **`InputScreen.css`/`InputScreen.tsx`**: the CTA ("Find drop-off points") was never actually sticky-positioned at the bottom of the viewport once scrolled past, despite ux-spec.md section 4 explicitly calling for this ("always reachable without scrolling back up"). Added a `.input-screen__cta-bar` wrapper (`position: sticky; bottom: 0`) around the button.
- **`InputScreen.css`**: found a genuine, concrete bug — `.input-screen__cta` had `cursor: not-allowed` unconditionally, with no override for the enabled state (only `:disabled` had its own background rule). This meant the cursor stayed "not-allowed" even once the CTA became genuinely clickable, misleadingly signaling a disabled button. Fixed: `cursor: pointer` on the base rule, `cursor: not-allowed` moved onto `:disabled` only. Also added explicit `width: 100%` (previously relying on implicit flex-stretch from the parent, which happened to work but wasn't guaranteed once the button moved into its own sticky wrapper div).
- **`InputScreen.css`**: `.input-screen__suggestion` (autocomplete dropdown items) only reached ~36px height (`space-sm` padding + `type-body-small` line-height), short of ux-spec.md section 2.5's 44×44px minimum tap target for interactive elements. Added `min-height: 44px; display: flex; align-items: center`.
- **`DisclaimerBanner.css`**: added `min-width: 0` to the text span (the standard flexbox fix so a long sentence can wrap across lines on the narrowest phone viewports instead of a flex child refusing to shrink below its one-line content width) and switched `align-items` from `center` to `flex-start` so the icon stays aligned to the first line once the text wraps to multiple lines.
- **`ResultsScreen.css`**: `.results-screen__card-header` (rank badge + "BEST OPTION" label) had no `flex-wrap`, risking horizontal overflow on the narrowest viewports when both labels don't fit on one line. Added `flex-wrap: wrap` and switched the gap to a row/column pair (`--space-xs --space-sm`) so wrapped lines have sensible vertical spacing too.

**Not changed** (reviewed, found correct as-is): the `>=600px` container-centering rule (already achieved implicitly by `.app-shell`'s `align-items: center` + `.app-shell__container`'s `max-width: 480px`, no separate media query needed); all other buttons/tap targets already met 44px min-height; the password gate, loading screen, and search-error screen's layout/tokens were already compliant on inspection.

## 6. Cross-cutting error handling

Reviewed every error path across all four remaining endpoints holistically (not per-endpoint), per the brief.

**REV-009 sanitization pattern was inconsistent — fixed for full coverage**: `api/geocode.ts` and `api/drop-off-search.ts` already followed the sanitized pattern (generic message to client, detailed error via `console.error` server-side) from earlier increments. **`api/config/public.ts` and `api/auth/verify-password.ts` did not** — both still forwarded the raw `ConfigError.message` (the full `problems` list, naming every missing/malformed env var) directly to the client on a config-load failure. This was explicitly "noted for awareness, not logged as a standalone finding" at the INC-1 review audit (Pass 5) for `/api/config/public`, and never separately caught for `/api/auth/verify-password`. Fixed both to match the established pattern exactly: log the detailed `ConfigError`/error via `console.error`, return the fixed generic string `"The service is temporarily unavailable."` to the client. Confirmed this doesn't break runbook.md section 6's deploy-verification use of `/api/config/public` — that check only inspects the HTTP status/overall shape, never the error message text.

**REV-013 (HTTP-status convention inconsistency between the real endpoint and the debug endpoints) — resolved by retiring the debug endpoints**, not by aligning their conventions. Reasoning, since the brief left this as dev's call:
- The three temporary debug endpoints (`/api/route/direct` INC-3, `/api/candidates/evaluate` INC-4, `/api/candidates/transit` INC-5) have been fully superseded by `/api/drop-off-search` (INC-6) for two increments now — every code path they existed to validate is exercised end-to-end by the real endpoint and by each underlying module's own unit tests (`tests/routing/*`, `tests/candidates/*`, `tests/transit/*`, all untouched and unaffected by this removal).
- Retiring them removes REV-013's inconsistency by eliminating one side of it entirely, rather than reshaping the debug endpoints' response bodies to match the real endpoint's 200-for-business-outcomes convention (which would be equally disruptive to QA's existing tests for arguably less benefit, since those endpoints are going away anyway).
- It also shrinks the number of live, billable, `AuthGate`-protected endpoints from six to three (`config/public` unauthenticated by design, `auth/verify-password`, `geocode`, `drop-off-search`) — directly relevant to this increment's session-cookie hardening theme (fewer endpoints exposed to a leaked/expired-cookie scenario).
- **Files removed**: `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts`. `scripts/viteApiMiddleware.ts`'s route table updated to match. The underlying service modules they called (`src/routing/googleRoutingService.ts`, `googleDistanceMatrixService.ts`, `src/candidates/*`, `src/transit/*`) are all still in active use by `api/drop-off-search.ts` and untouched.
- **QA impact, flagged explicitly**: `tests/api/route-direct.test.ts`, `tests/api/candidates-evaluate.test.ts`, `tests/api/candidates-transit.test.ts` now fail to even import (`Cannot find module ...`) since the files they test no longer exist. These three test files should be deleted/retired by QA to match — there is no reshaping needed, just removal, since the endpoints they covered are gone, not changed.
- Locally, hitting a retired route (e.g. `GET /api/route/direct`) through `npm run dev` now falls through to Vite's SPA history-fallback (returns `200` + `index.html`), since the dev middleware's route table no longer matches it — this is expected local-dev-only behavior (confirmed directly, see Smoke test section), not a production behavior. On Vercel, the corresponding serverless function file simply no longer exists, so the route genuinely 404s at the platform level.

**NFR-006 edge cases — re-verified, no code change needed.** Read `src/geo/radiusValidator.ts` directly: the boundary check is `haversineDistanceKm(point, center) <= radiusKm` (inclusive `<=`, matching the INC-2-established, already-QA'd/reviewed boundary behavior), both `GEOGRAPHIC_CENTER`/`GEOGRAPHIC_RADIUS_KM` remain fully config-driven with no hardcoded fallback anywhere, and the passenger-destination exemption (DQ-1) is enforced both client-side (`InputScreen.tsx`'s `applyRadiusCheck={false}`) and server-side (`api/drop-off-search.ts` never calls `RadiusValidator` on `passengerDestination`). Nothing to fix; this closes the "NFR-006 → INC-2/INC-8" traceability entry with a confirmation, not new code.

## 7. NFR-006 closure — see above (folded into item 6's writeup, same verification pass).

## 8. FR-016/FR-017 end-to-end closure

Walked the whole paid-tier flow, verified against real HTTP (see Smoke test section) rather than only unit-level:
- `free_tier`: every endpoint reachable with zero cookie, as before — unaffected by this increment.
- `paid_tier`, no session: `GET /api/config/public` still open (unauthenticated by design); every other endpoint (`geocode`, `drop-off-search`, and the frontend rendering) blocked until a valid session exists.
- Password verify: wrong password → `401 invalid_password`; correct password → `200` + `Set-Cookie` with the new signed-expiry token and a real `Max-Age` matching `SESSION_LIFETIME_SECONDS`.
- Session cookie: valid immediately after login (passes `AuthGate`, reaches the real provider call — confirmed via a deliberately-invalid dummy key surfacing `502`, not `401`, proving the gate itself passed); genuinely expires server-side once `SESSION_LIFETIME_SECONDS` elapses (confirmed via a real wait-then-retry against the same cookie, now `401`).
- Re-auth: an expired-session `401` on the search endpoint or a geocode call now routes the user back to the Password Gate (see item 1) instead of a generic failure screen.

## Files created

None (no new modules this increment — all changes are edits to existing files, or removals).

## Files removed

- `api/route/direct.ts`, `api/candidates/evaluate.ts`, `api/candidates/transit.ts` (REV-013 retirement, see item 6)

## Files changed

- `.env.example` — added `SESSION_LIFETIME_SECONDS`.
- `api/auth/verify-password.ts` — signed-expiry token/cookie wiring, REV-009 sanitization.
- `api/config/public.ts` — REV-009 sanitization.
- `api/drop-off-search.ts` — module comment updated to reflect debug-endpoint retirement (no behavioral change).
- `index.html` — REV-004.
- `scripts/viteApiMiddleware.ts` — removed retired routes.
- `src/auth/authGate.ts` — injectable `now` parameter.
- `src/auth/cookies.ts` — `Max-Age` support.
- `src/auth/session.ts` — signed-expiry token format (REV-002).
- `src/config/loader.ts`, `src/config/schema.ts` — `SESSION_LIFETIME_SECONDS`.
- `src/frontend/App.tsx`, `src/frontend/sessionFlag.ts` — re-auth wiring.
- `src/frontend/api.ts`, `src/frontend/components/SearchFlow.tsx` — `AbortController` (REV-014), re-auth on search 401.
- `src/frontend/components/InputScreen.tsx`, `src/frontend/hooks/useLocationField.ts` — re-auth on geocode 401, sticky CTA bar.
- `src/frontend/components/InputScreen.css`, `DisclaimerBanner.css`, `ResultsScreen.css` — mobile polish (item 5).
- `tsconfig.json` — REV-005.

## How to run / smoke-test

1. Same as prior increments: `npm install`, fill in `.env.local` (now also needs `SESSION_LIFETIME_SECONDS`, e.g. `3600`), `npm run dev`.
2. To exercise session expiry quickly: set `SESSION_LIFETIME_SECONDS=10` (or similar), log in via the Password Gate, then wait past that many seconds and try any action — you'll be returned to the Password Gate instead of seeing a generic error.
3. The three debug endpoints no longer exist; `GET /api/config/public`, `POST /api/auth/verify-password`, `GET /api/geocode`, `POST /api/drop-off-search` are the only four routes.

## Smoke test performed

- `npm run typecheck` — **zero errors in `src/`/`api/`** (independently confirmed by re-running `tsc --noEmit` against a copy of the tsconfig with `tests/` excluded from `include` — 0 errors). All remaining type errors are confined to `tests/` files; see the itemized breakdown below.
- `npm run lint` — clean, 0 errors, 0 warnings (one new warning surfaced from the `onSessionExpired` dependency in `useLocationField.ts`'s `onUseCurrentLocation` callback; resolved with the same `eslint-disable-next-line react-hooks/exhaustive-deps` + explanatory comment pattern already used elsewhere in that file for the same reason — `options` is a fresh object every render).
- `npm run build` — clean, same output shape.
- **Session token math, directly** (`npx tsx`, temporary scratch script, not committed): fresh token valid; expired token (checked via injected clock past its expiry) rejected; tampered-plaintext-expiry token rejected (signature covers the expiry, not just the fixed message); wrong-password token rejected; malformed/no-expiry token (simulating an old-style single-arg call) rejected outright — **critically, this does not silently degrade to "valid forever," it fails closed**; exact-boundary (`now === expiresAt`) token rejected (strict `<`, not `<=`).
- **Cookie header, directly**: `buildSessionCookieHeader(...)` confirmed to emit `Max-Age=3600` alongside the existing `HttpOnly`/`SameSite=Lax`/`Path=/`.
- **`AuthGate.check`'s injectable clock, directly**: a token expiring in 10s passes `AuthGate.check` immediately, fails when checked with an injected clock 11s later.
- **Real HTTP, against the actual local dev server** (`npm run dev`, `curl`), with `APP_MODE=paid_tier`:
  - `GET /api/config/public` → `200`, unauthenticated, as before.
  - The three retired routes (`GET /api/route/direct`, `/api/candidates/evaluate`, `/api/candidates/transit`) fall through to the SPA shell locally (confirmed via response body inspection — genuine `index.html`, not a stale cached response), consistent with the dev-middleware's `next()` fallback behavior once a route is removed from its table; on Vercel these paths have no corresponding function and would 404 at the platform level.
  - `GET /api/geocode` with no cookie → `401`.
  - `POST /api/auth/verify-password` wrong password → `401 invalid_password`; correct password → `200` + `Set-Cookie` with a real signed-expiry token and `Max-Age` matching the configured `SESSION_LIFETIME_SECONDS`.
  - Reusing that cookie immediately → `502 provider_error` (passed `AuthGate`, failed only at the dummy `MAP_API_KEY` against the real Google endpoint) — proves the gate is genuinely passed, not coincidentally bypassed.
  - Reusing the same cookie after waiting past `SESSION_LIFETIME_SECONDS` → `401 unauthorized` — proves the session genuinely, server-side, expires on its own schedule for the first time in this project's history.
- **Full existing test suite** (`npx vitest run`, unmodified `tests/`): **289/366 passing, 77 failing** — every failure is precisely accounted for below, none are unexplained. Confirmed via a temporary, uncommitted one-line patch to `tests/helpers/testEnv.ts` (adding `SESSION_LIFETIME_SECONDS: "3600"` to `validEnv()`, reverted immediately after) that this single fixture addition alone drops the failure count to **7 failing tests + 3 failing-to-import files** — i.e., the other ~67 "failures" are all the identical root cause cascading through every test that calls `loadConfig()`/`validEnv()`, exactly the REV-006/007 precedent.
- **Existing SearchFlow/InputScreen/App/LoadingScreen/PasswordGate/ResultsScreen/DisclaimerBanner frontend tests** — all pass at runtime unmodified (`61/61` across those 7 files) despite some pre-existing type-only issues surfaced by REV-005 (see below) — confirms the `AbortController`/re-auth/mobile-CSS changes are runtime-safe against the existing suite.

## Known limitations / things QA needs to do before re-running the suite

This increment intentionally introduces breaking changes to two security/architecture-critical, long-flagged items (REV-002, REV-013) plus a coverage fix (REV-005) that, for the first time, surfaces pre-existing test-code issues that were always there but never checked. All of the below is expected, accounted-for fallout — not a "the increment broke things" situation. Itemized exactly, same level of detail as the REV-006/007 precedent:

### A. One-line fixture fix that resolves the bulk of the failures
`tests/helpers/testEnv.ts`'s `validEnv()` needs `SESSION_LIFETIME_SECONDS: "3600"` added to its base object (same pattern as every other required key). `tests/config/loader.test.ts`'s `ALL_16_KEYS` array (drives the "missing key fails fast" and "every key individually missing" loops) should become `ALL_17_KEYS` including `"SESSION_LIFETIME_SECONDS"` — this alone will give it the same missing-key/invalid-value/configurability coverage every other key already has, no new test-writing logic needed. Verified directly (temporary, reverted patch) that this single change alone drops the failure count from 77 to 7.

### B. Remaining failures after (A), each independently confirmed and explained
1. **`tests/config/loader.test.ts` "loads a fully-specified free_tier environment into the exact AppConfig shape"** — exact-shape `toEqual` assertion needs `sessionLifetimeSeconds: 3600` added to the expected object literal (same as INC-7's `responseTimeTargetSeconds` precedent).
2. **`tests/auth/session.test.ts` "validates a token created with the same password"**, **`tests/auth/authGate.test.ts`'s two session-cookie tests**, and **the "valid session cookie" tests in `tests/api/geocode.test.ts`/`tests/api/drop-off-search.test.ts`** — all call `createSessionToken("some-password")` with one argument. This now produces a malformed token (no expiry embedded) that `isValidSessionToken` correctly rejects — **this is the intended, load-bearing behavior of the REV-002 fix**, not a bug. Every one of these call sites needs a second argument, e.g. `createSessionToken("correct-password", Math.floor(Date.now() / 1000) + 3600)`, or a small shared test helper (e.g. `validSessionToken(password)` defaulting to "1 hour from now") to avoid repeating this at every call site — QA's call which pattern to use.
3. **`tests/api/config-public.test.ts` "paid_tier with no PAID_TIER_ACCESS_PASSWORD fails fast with 500"** — asserts `body.message` contains the literal string `"PAID_TIER_ACCESS_PASSWORD"`. This is now false **on purpose** (item 6's fix): the response body is the fixed generic string `"The service is temporarily unavailable."`; the detailed message is only in the server-side `console.error` log. Recommend updating this assertion to check for the generic message and the *absence* of `"PAID_TIER_ACCESS_PASSWORD"`/`"is required but was not set"` from the body, mirroring the existing REV-009-style leak-check tests already present in `tests/api/geocode.test.ts`.
4. **`tests/auth/cookies.test.ts`** — 4 calls to `buildSessionCookieHeader(..., { secure: ... })` are missing the now-required `maxAgeSeconds` field. These are **type errors only** (TS `tsc --noEmit` catches them; vitest's esbuild transpile does not, so they pass at runtime as-is, silently not testing the new `Max-Age` behavior at all). Recommend adding `maxAgeSeconds: 3600` (or similar) to each call, plus a new test asserting `Max-Age=<value>` appears correctly in the output.
5. **`tests/api/route-direct.test.ts`, `tests/api/candidates-evaluate.test.ts`, `tests/api/candidates-transit.test.ts`** — fail to import at all (`Cannot find module ...`) since the endpoints they test were retired (item 6/REV-013). These three files should be deleted, not repaired — there is no replacement behavior to test, the endpoints are simply gone.

### C. Pre-existing test-code type debt, newly surfaced by REV-005 (item 3) — not caused by this increment's other changes
Running `tsc --noEmit` with `tests/` now included surfaces a number of **pre-existing** type errors in QA's test files that were always there but never checked (this is precisely REV-005's whole point — flagging it, not silently fixing QA's files):
- `tests/candidates/candidateGenerator.test.ts` (2 spots): object literals missing `GeoPoint`'s required `label` field.
- `tests/frontend/App.test.tsx`, `tests/frontend/InputScreen.test.tsx`, `tests/frontend/LoadingScreen.test.tsx`: missing `responseTimeTargetSeconds` in hardcoded `PublicConfig`/`LoadingScreenProps` object literals — this is **carried over from INC-7's own already-documented known limitation** (INC-7's handoff explicitly flagged 2 of these 3 exact-shape breaks; this is the same debt, just now caught by `tsc` instead of only by `vitest run`'s runtime failures QA already knew about).
- `tests/frontend/SearchFlow.test.tsx` (4 spots), `tests/api/verify-password.test.ts` (1 spot): loosely-typed `Promise` executor / possibly-`undefined` env access — pre-existing, unrelated to any change in this increment.
- `tests/routing/googleDistanceMatrixService.test.ts`, `tests/routing/googleRoutingService.test.ts`, `tests/routing/polyline.test.ts`, `tests/transit/evaluateShortlist.test.ts`, `tests/transit/googleTransitDirectionsService.test.ts`: multiple `noUncheckedIndexedAccess`-driven "possibly undefined" errors from array-index access without a guard (e.g. `arr[0]` assumed non-undefined). These are real, if low-severity, gaps in test-code type safety — exactly the category REV-005 was filed to catch — and none of them affect whether the tests currently *pass* at runtime (esbuild transpiles without type-checking), only whether `npm run typecheck` is clean.

**None of Bucket C is something dev fixed or should fix** (`tests/` is QA's owned artifact per CLAUDE.md) — flagging comprehensively, file-by-file, so QA can address it in one pass rather than discover it piecemeal. Recommend QA treat Buckets A/B (this increment's direct, necessary fallout) and Bucket C (pre-existing debt REV-005 was designed to reveal) as two separate, clearly-labeled batches of fixture/assertion work.

### D. Other notes
- **No logout UI was added** — flagged in item 1 above for designer/pm as a legitimate follow-up product question now that sessions genuinely expire, not silently built without ux-spec authorization.
- **`SESSION_LIFETIME_SECONDS` is not exposed via `GET /api/config/public`** — no current frontend behavior needs it (no expiry countdown/warning is specified anywhere), consistent with only adding fields to `PublicConfig` when there's a documented reader (the same reasoning already established for `responseTimeTargetSeconds` in INC-7). Flag to tech-lead/designer if a "your session will expire soon" UX is wanted later — that would need this value threaded through.
- **The retired debug endpoints' local-dev SPA-fallback behavior** (200 + `index.html` instead of a clean 404) is a pre-existing property of `scripts/viteApiMiddleware.ts`'s `next()` call for unmatched routes, not something this increment's removal introduced — any route not in the `ROUTES` table has always fallen through to the SPA shell locally. Production (Vercel) behavior is a genuine 404 since the function file doesn't exist. Not a discrepancy worth fixing given this tooling is explicitly dev-only and never shipped (per its own module comment).
- **REV-003, REV-008, REV-011, REV-015** (already RESOLVED or routed to pm/tech-lead/designer, not dev, per the Findings Register) were not touched this increment — out of scope for dev's ownership.
- **REV-010** (real-`MAP_API_KEY` empirical verification, all four sub-conditions) remains open and untouched by this increment — still no real key available in this environment; this is a qa/release pre-Phase-4 closure item, not something dev can close from here.

---

# Handoff: INC-9 (conditional/optional) — Visual route + candidate map view

Status: implemented, smoke-tested, ready for QA. Covers no FR/NFR directly (design.md section 10: "pure UX enhancement... every FR/NFR is already satisfied by the text/card-based output of INC-1..8"). New config keys: `MAP_TILE_URL_TEMPLATE`, `MAP_TILE_ATTRIBUTION` (both optional/nullable — see below).

Also includes a small bonus fix requested by the orchestrator: **REV-017** (stale comments in `src/routing/googleRoutingService.ts`/`src/routing/types.ts` still naming the three INC-8-retired debug endpoints as current/sole callers) — see its own subsection at the end.

## Tile provider chosen, and why

**CARTO's free "Positron" raster basemap** (`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png`), attribution `© OpenStreetMap contributors © CARTO`.

Reasoning, weighed against the two alternatives design.md/ux-spec.md name as examples (MapTiler, Stadia Maps):
- Both MapTiler and Stadia Maps require an account + API key to use at all (even their free tiers). This sandbox has no such account/key, and — per the orchestrator's brief — the realistic expectation is that **the user will need to do this setup themselves** for their own deployment regardless of which provider dev picks in code. Given that, I picked a provider that is genuinely **keyless/anonymous** for CARTO's basemap tiles specifically, so (a) the app works out of the box with zero setup for anyone who clones this repo (including this sandbox — see Smoke test section, where real tile *requests* were fired, just blocked by this environment's network proxy allowlist, not by any missing credential), and (b) it's a real, managed, non-Google, non-raw-OSM-demo-server provider, satisfying design.md section 3.1a's explicit constraint ("not the raw OpenStreetMap demo tile server").
- This is not a permanent-production recommendation at high volume — CARTO's free anonymous basemap tiles are rate-limited for exactly that reason, the same caveat design.md already applies to every free tier in this project (Google's own credit, etc.). It's the right default for "works immediately, zero setup, satisfies the licensing/ToS constraint," not necessarily the right choice forever.
- **Nothing about this choice is hardcoded.** Per the project's no-hardcoded-tunables rule, the tile provider itself is a config value (`MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION`), not a literal baked into `MapView.tsx` — switching to MapTiler or Stadia Maps (or any other Leaflet-compatible XYZ tile provider) later is a **pure `.env`/deployment-config change, zero code change**.

## What the user needs to do to get real tiles showing in their own deployment

**Nothing, by default** — `.env.example`'s shipped default (`MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` set to the CARTO values above) will render real tiles out of the box once deployed somewhere that can actually reach `basemaps.cartocdn.com` (this sandbox's outbound network proxy blocks arbitrary third-party domains not on its allowlist — confirmed via direct `curl` to `basemaps.cartocdn.com`, `api.maptiler.com`, and `tiles.stadiamaps.com`, all `403`'d identically by the proxy, while `maps.googleapis.com` is allowlisted; see Smoke test section for how this was worked around for verification purposes). This is a sandbox-network limitation, not a code or config defect.

**For a real production deployment at meaningful volume**, get a free-tier account with MapTiler (https://www.maptiler.com/cloud/) or Stadia Maps (https://stadiamaps.com/) and set two env vars (no code change):
- `MAP_TILE_URL_TEMPLATE` — the exact XYZ URL template your provider's dashboard gives you, with your API key already embedded in the string (e.g. `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=YOUR_KEY`).
- `MAP_TILE_ATTRIBUTION` — the exact attribution text/HTML that provider's terms require, so the on-map attribution control (a licensing requirement for OSM-family tiles, not optional) stays accurate for whichever provider is actually in use.

Both are documented with this exact guidance directly in `.env.example`.

## Design decision: made both new config keys optional, not required-with-no-fallback

Every other config key in this schema (~20 of them) is required with no code fallback — operators must set every one or `loadConfig()` throws. I deliberately did **not** follow that pattern for `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION`: both are optional, `null` when unset (mirroring the existing `paidTierAccessPassword: string | null` "conditionally present" pattern, not inventing a new one).

**Why**: design.md section 10 explicitly frames INC-9 as conditional/optional — "not required for FR/NFR compliance... every FR/NFR is already satisfied by the text/card-based output of INC-1..8." Making the tile config mandatory would force every existing and future deployment (including ones with zero interest in the map) to configure a tile provider just to avoid the whole app failing to start with a `ConfigError`, which directly contradicts that "optional enhancement" framing. Instead: unset tile config = map view gracefully disabled (same graceful-degradation behavior ux-spec.md section 6.7 already specifies for a *runtime* tile-load failure — "fail silently, simply omit the panel" — just triggered by absent config instead of a network error), while the rest of the app (INC-1-8's full feature set) is completely unaffected.

I verified this concretely reduces the regression footprint from adding a new config field: initially building this as a required key (my first draft) broke `loadConfig()` broadly across **77 existing tests** (every test using the shared `validEnv()` fixture, which doesn't know about the two new required keys). Making them optional instead reduced that to **3 tests failing**, all in one file (`tests/config/publicConfig.test.ts`'s and one `loader.test.ts`/`config-public.test.ts` exact-object-shape assertion each) — see "Known limitations for QA" below. **Flagging this design choice to tech-lead for design.md section 7 confirmation** (schema changes technically belong to tech-lead, not dev) — I made the call in the direction that best matches the increment's own documented "optional" framing rather than leave the schema silently inconsistent with it, but want it confirmed/reflected in design.md's config table rather than left only in code + this handoff.

## What was built

### Backend

**`src/config/schema.ts` / `loader.ts` / `publicConfig.ts`** — added `mapTileUrlTemplate: string | null` / `mapTileAttribution: string | null` to `AppConfig` and `PublicConfig` (optional, see above). `GET /api/config/public` now returns both.

**`src/search/types.ts`** — added `route?: Array<{ lat: number; lng: number }>` to `DropOffSearchResponse`. **Design-doc gap, same category as INC-4's `maxDetourMinutes` and INC-5's `FullyEvaluatedCandidate`**: design.md section 5.2's `DropOffSearchResponse` listing predates INC-9 and never defines a route field, even though section 3.1a/10's own text requires exactly this data ("render the route polyline... using data already fetched") reach the frontend. Added as the literal completion of that requirement — present exactly when `candidates.length > 0` (`ranked`/`fallback`), mirroring `disclaimer`'s own presence rule. **Flagged to tech-lead for design.md section 5.2 confirmation**, per this project's established "flag, don't silently guess" precedent for this exact category of gap.

**`api/drop-off-search.ts`** — both the `ranked` and `fallback` response bodies now include `route: directRoute.polyline`. `directRoute` was already computed earlier in the same handler by the existing `RoutingService.getDirectRoute` call (INC-3) — this adds **zero new provider calls**, it only exposes already-fetched, already-in-memory data in the response. Verified directly (see Smoke test section) that no additional outbound provider request is triggered by this change.

### Frontend

**`src/frontend/components/MapView.tsx` (new) + `MapView.css` (new)** — the map panel itself, per ux-spec.md section 6.7:
- Raw Leaflet (`leaflet` + `@types/leaflet`, added as dependencies — no `react-leaflet` wrapper; a plain `useEffect`-managed `L.Map` instance was simpler and avoided a second mapping-abstraction dependency for what's a fairly small, self-contained component).
- Renders the route polyline (`response.route`) and one marker per candidate (`response.candidates`), using Leaflet's `divIcon` (not the default `L.Icon` — avoids the well-known Vite/Leaflet default-marker-image-path issue entirely, and lets marker colors come from CSS tokens instead of inline JS literals, matching ux-spec.md section 2's "reference tokens, not inline literals" rule).
- Marker colors per ux-spec.md section 6.7: rank-1 gets `--color-brand-primary` (matches the card's "BEST OPTION" accent), ranks 2-3 get a neutral `--color-text-secondary`-based color, and the single fallback-state candidate gets `--color-warning-border` (matches the card's "CLOSEST OPTION" badge).
- Tap-to-highlight: clicking a marker calls `onSelectCandidate(rank)`; `ResultsScreen` uses this to scroll the matching card into view and apply a brief CSS-animation "flash" (`results-screen__card--flash`, `ResultsScreen.css`) — a pure CSS `@keyframes` animation, not a JS timer, so it always settles back to the card's normal resting background on its own. Tapping a card does not re-center the map, per spec ("keeps interaction one-directional and simple").
- Display-only for v1 (no pan/zoom-driven re-querying, no draggable pins, no custom recenter control) — exactly per ux-spec.md section 6.7.
- Attribution: Leaflet's built-in attribution control renders `tileAttribution` automatically (both "Leaflet" itself and the configured provider attribution) — satisfies the OSM-family licensing requirement with no custom code.

**`src/frontend/components/ResultsScreen.tsx` (edited)** — map panel inserted between the trip summary and the fallback-warning-banner/candidate-cards, exactly per ux-spec.md section 6.7's layout. `showMap` is `true` only when: status is `ranked`/`fallback` **and** `response.route` is present **and** both tile-config values are non-null — i.e., gracefully omitted (not shown broken) on `no_viable_option`/`out_of_service_area`/`invalid_input`/`timeout`, and equally gracefully omitted if the operator hasn't configured a tile provider at all. The map itself is additionally wrapped in an `<ErrorBoundary fallback={null}>` (reusing the existing `ErrorBoundary` component from INC-7/REV-012's disclaimer-resilience work) so a Leaflet init failure can only ever remove the map panel, never take down the disclaimer or the text-based cards below it — the same structural "fail silently, isolate the blast radius" pattern already established for the disclaimer, now applied to the map per ux-spec.md section 6.7's own explicit requirement ("if the map tile/script fails to load, fail silently and simply omit the panel").

**`src/frontend/components/SearchFlow.tsx` (edited)** — passes `config` (the already-fetched `PublicConfig`) through to `<ResultsScreen mapConfig={config}>` — no second fetch, same pattern already used everywhere else in this codebase for config plumbing.

**`.env.example`** — documented both new keys, including the "these two are optional, unlike everything else in this file" callout and the MapTiler/Stadia Maps production-swap guidance.

**`package.json`/`package-lock.json`** — added `leaflet` (dependency) and `@types/leaflet` (devDependency).

## How to run / smoke-test

1. Same as INC-1-8: `npm install`, fill in `.env.local`. Map view specifically: leave `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` unset to confirm the "disabled" path, or copy `.env.example`'s CARTO defaults to see the map attempt to render (real tile imagery requires outbound network access to `basemaps.cartocdn.com`, which this sandbox's proxy blocks — see below; a real deployment environment will not have this restriction).
2. Run a search (`POST /api/drop-off-search`) that returns `status: "ranked"` or `"fallback"` — the response now includes a `route` field; the Results screen renders the map panel above the candidate cards.

## Smoke test performed

- `npm run typecheck`, `npm run lint`, `npm run build` — all clean (lint had one `react-hooks/exhaustive-deps` warning on `MapView.tsx`'s marker-cleanup ref access, fixed by capturing the ref's current value in a local variable before the effect's cleanup closure, per the rule's own suggested fix — confirmed zero warnings after).
- `npm test` — 392/395 passing, 3 pre-existing-shape-assertion failures, all expected fallout from adding two new `PublicConfig` fields (see "Known limitations for QA" below) — no other regression across the full existing suite.
- Real dev server (`npm run dev`) + `GET /api/config/public` confirmed `mapTileUrlTemplate`/`mapTileAttribution` come through correctly both when set (CARTO URL/attribution string) and when unset (`null`).
- **Full Playwright browser walkthrough** (390×844 mobile viewport, chromium, headless) against the local dev server, with `/api/geocode` and `/api/drop-off-search` responses intercepted at the network layer (so this is deterministic and doesn't depend on a real `MAP_API_KEY`, same pattern every prior increment's frontend smoke test has used):
  - Filled all three location fields + detour minutes through the real Input Screen UI, submitted, landed on Results with a mocked `"ranked"` response carrying 2 candidates + a `route` polyline.
  - **Map container mounts**: `.map-view` present in the DOM, correct bounding box (~358×220px, matching ux-spec.md section 6.7's "200-240px tall, full-width" spec).
  - **Markers appear at correct positions**: 2 `.map-view__marker` elements rendered, rank-1 marker text reads `#1`; each marker's on-screen pixel position (`getBoundingClientRect`) was distinct and non-zero, confirming Leaflet actually projected each candidate's lat/lng into real screen coordinates rather than stacking everything at the origin.
  - **Attribution text is present**: `.leaflet-control-attribution` textContent read back as `"Leaflet | © OpenStreetMap contributors © CARTO"` — both Leaflet's own required attribution and the configured provider attribution render, satisfying the OSM-family tile licensing requirement.
  - **Tap-to-highlight**: clicking the rank-2 marker resulted in `results-screen-card-2` gaining the `results-screen__card--flash` class (scroll+highlight fired correctly).
  - **Console/page errors observed**: exactly 3 `net::ERR_TUNNEL_CONNECTION_FAILED` errors, all from the actual tile image `<img>` requests Leaflet fired to `basemaps.cartocdn.com` — this is this sandbox's outbound-network-proxy allowlist blocking a domain that isn't on it (confirmed independently via direct `curl` to the same host returning a `403` at the proxy/CONNECT layer, while `maps.googleapis.com` — evidently allowlisted for this project — returns a normal `200`/API response). **This is a sandbox network-policy limitation, not a code defect**: the map correctly *attempted* real tile requests to a real, reachable-in-production provider; a real deployment environment (or QA's own machine) will not have this restriction and should see actual basemap imagery. This matches exactly what the orchestrator's brief anticipated ("map rendering can be checked... even without live tile imagery, by confirming the container mounts, markers appear at correct positions, and attribution text is present") — all three were confirmed independent of the blocked tile images.
  - **Fallback variant**: a mocked `"fallback"` response (1 candidate, `exceedsThreshold: true`) rendered the map with a single marker using the `.map-view__marker--fallback` (warning-colored) class, not the rank-1/rank-other classes.
  - **Graceful omission, no_viable_option**: a mocked `"no_viable_option"` response resulted in `.map-view` count `0` — panel correctly absent, not shown broken/empty.
  - **Graceful omission, tile config unset**: restarted the dev server with `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` both blank; a mocked `"ranked"` response (with `route` and candidates both present) still resulted in `.map-view` count `0`, while the candidate card itself still rendered normally (count `1`) — confirms the map is the *only* thing gated by tile config, not the rest of the Results screen.
- **No new provider (Google Maps Platform) calls were introduced.** `api/drop-off-search.ts`'s change is additive-field-only on an already-computed value (`directRoute.polyline`, from INC-3's existing `RoutingService.getDirectRoute` call) — no new call site was added anywhere in the request pipeline. Confirmed by re-reading the diff: the only change to `api/drop-off-search.ts` is two new object-literal keys in the JSON response bodies, no new `await`/service-call lines.

## Known limitations / things for QA to be aware of

1. **Tile imagery could not be visually confirmed loading in this sandbox** (network-proxy restriction, not a code issue — see Smoke test section). QA should re-run the same browser walkthrough on a machine/environment with normal outbound internet access to confirm actual basemap tiles render, in addition to the container/marker/attribution checks already performed here.
2. **New `PublicConfig` fields break 3 pre-existing exact-shape assertions** (same category of fallout as REV-006/007's `MIN_GEOCODE_QUERY_LENGTH`/`GEOCODE_DEBOUNCE_MS` precedent, just much smaller in scope this time since the two new keys are optional rather than required — see the "Design decision" section above for why that mattered):
   - `tests/config/publicConfig.test.ts` — "returns exactly the 8 fields..." now needs `mapTileAttribution`/`mapTileUrlTemplate` added to its expected key list (10 fields total).
   - `tests/config/loader.test.ts` — "loads a fully-specified free_tier environment into the exact AppConfig shape" needs the same two keys added to its expected shape (as `null`, since `validEnv()` doesn't set the two new env vars).
   - `tests/api/config-public.test.ts` — "happy path: free_tier returns 200 with the correct non-secret shape" — same fix.
   No other test in the suite is affected (392/395 passing unmodified).
3. **`tests/frontend/ResultsScreen.test.tsx` will need a `mapConfig` prop added to its existing `<ResultsScreen>` render calls** (a new required prop on the component) — this only surfaces as a `tsc --noEmit` type error currently (not a runtime failure, since vitest's esbuild transpile doesn't type-check), consistent with the REV-005 pattern already established (type errors in `tests/` are QA's to pick up, don't block `vitest run` itself). Recommend QA also add coverage for `MapView`'s new behavior (map presence per status, graceful omission when tile config is null, marker variant/count, tap-to-highlight) — none of that exists yet since `tests/` is QA-owned and dev did not add any test files this increment, per the pipeline rule.
4. **The card-flash highlight animation doesn't replay on a second click of the same already-highlighted marker** (React won't touch the DOM `className` attribute if the computed string is unchanged between renders, so the CSS animation doesn't restart) — a minor, cosmetic-only limitation of the simple state-driven approach, not a functional bug (the scroll-into-view still fires every time). Not fixed since ux-spec.md section 6.7 only asks for "a brief flash" on tap generally, and the core interaction (map pin -> correct card highlighted/scrolled) works correctly on every click, including repeated clicks of different markers.
5. **Design-doc gaps flagged to tech-lead** (see "What was built" above for full detail): (a) `DropOffSearchResponse.route` field addition to design.md section 5.2, (b) the "optional, nullable" config-key pattern for `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` vs. this schema's otherwise-universal "required, no fallback" convention, both should be reflected in design.md's own tables per this project's "docs stay in sync with reality" rule, even though no user-facing behavior is in question for either.
6. **No pan/zoom-driven re-querying, draggable pins, or recenter control** — deliberately out of scope for v1 per ux-spec.md section 6.7 ("keeps it a presentation layer over already-computed results, not a new input surface"), not an oversight.
7. **This increment does not touch anything from INC-1-8** other than the two additive fields on `DropOffSearchResponse`/`PublicConfig` described above — every existing screen/flow/status is otherwise byte-for-byte unchanged. If tech-lead/QA/pm ultimately decide the map view isn't worth keeping (e.g. tile-provider reliability concerns at scale), it can be removed by deleting `MapView.tsx`/`.css` and the `showMap`/`mapConfig` wiring in `ResultsScreen.tsx`/`SearchFlow.tsx` alone, with zero impact on any other feature.

## REV-017 (bonus fix, same session) — stale "sole caller" comments in `src/routing/`

**`src/routing/googleRoutingService.ts`**: the `GoogleRoutingServiceOptions.timeoutMs` doc comment and `createGoogleRoutingService`'s own doc comment both still named `api/route/direct.ts` as "the sole caller" (and separately listed all three retired INC-3/4/5 debug endpoints as current callers of `timeoutMs`) — stale since INC-8/REV-013 deleted those three endpoints, leaving `api/drop-off-search.ts` as the actual (and only) caller. Updated both comments to say so, with a parenthetical noting the three debug endpoints were retired rather than just silently dropping the historical context.

**`src/routing/types.ts`**: `RoutingService`'s doc comment listed `api/route/direct.ts` as a current caller and described the INC-4+ candidate/detour pipeline as a future consumer — updated to reflect that both are now true simultaneously via `api/drop-off-search.ts` (which directly calls `RoutingService.getDirectRoute` and orchestrates the candidate/detour pipeline that also depends on it), rather than the stale future-tense framing.

Comment-only change, no behavior/logic touched. Verified via `grep` across `src/` that no other stale reference to the three retired debug endpoints remains outside of this now-accurate historical note.

## Files touched (INC-9 + REV-017)

- `src/config/schema.ts`, `src/config/loader.ts`, `src/config/publicConfig.ts`
- `src/search/types.ts`
- `api/drop-off-search.ts`
- `src/frontend/components/MapView.tsx` (new), `src/frontend/components/MapView.css` (new)
- `src/frontend/components/ResultsScreen.tsx`, `src/frontend/components/ResultsScreen.css`
- `src/frontend/components/SearchFlow.tsx`
- `.env.example`
- `package.json`, `package-lock.json`
- `src/routing/googleRoutingService.ts`, `src/routing/types.ts` (REV-017)

---

# Critical production hotfix (2026-07-12): ESM relative-import resolution (`ERR_MODULE_NOT_FOUND`)

Status: fixed, verified, ready for QA. This is a bugfix on already-QA'd/reviewed increments (INC-1 through INC-9), not a new increment — no FR/NFR behavior changed, no design.md content changed.

## Bug

Production (Vercel) was down: every deployed `api/*.ts` handler crashed at cold start with `FUNCTION_INVOCATION_FAILED`, before reaching any of our own try/catch blocks. Vercel's runtime logs showed:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/src/config/loader' imported from /var/task/api/config/public.js
```

**Root cause**: `package.json` has `"type": "module"`, so Node's real ESM module loader is used at runtime on Vercel. Node's ESM loader requires explicit file extensions on relative import specifiers (`from "../../src/config/loader.js"`); the codebase wrote every relative import extensionless (`from "../../src/config/loader"`). This is valid under `tsconfig.json`'s `"moduleResolution": "bundler"`, which is what Vite (dev server + `npm run build`) and Vitest both use — so it type-checked, built, and passed the entire test suite locally and in CI, and the break was invisible until an actual Node-ESM-runtime cold start (Vercel prod) hit it. No test in `tests/` (Vitest, bundler resolution) can catch this class of bug, by construction — flagging this explicitly since it's a structural blind spot in the current toolchain, not something QA missed.

## Fix

Added explicit `.js` extensions to every relative (`./`, `../`) import/export specifier in every file transitively reachable from an `api/*.ts` handler — i.e., every `api/*.ts` file plus every non-frontend `src/**/*.ts` file. TypeScript's `moduleResolution: "bundler"` explicitly permits writing `.js` in a `.ts` file's specifier even though the on-disk file is `.ts` (it resolves it to the sibling `.ts` file for type-checking, then leaves the specifier as-written in the ESNext-module output) — this is the standard, documented pattern for TS-authored ESM projects, not a workaround. No behavior, exports, or types changed in any file; every edit is purely `"./foo"` -> `"./foo.js"` / `"../bar"` -> `"../bar.js"` on an import/export specifier.

**Files changed (22, all mechanical import-specifier edits only):**
- `api/auth/verify-password.ts`, `api/config/public.ts`, `api/drop-off-search.ts`, `api/geocode.ts`
- `src/auth/authGate.ts`
- `src/candidates/candidateGenerator.ts`, `src/candidates/detourEvaluator.ts`, `src/candidates/shortlistSelector.ts`
- `src/config/loader.ts`, `src/config/publicConfig.ts`
- `src/geo/radiusValidator.ts`
- `src/geocoding/googleGeocodingService.ts`, `src/geocoding/labelFinalCandidates.ts`, `src/geocoding/types.ts`
- `src/ranking/ranker.ts`
- `src/routing/googleDistanceMatrixService.ts`, `src/routing/googleRoutingService.ts`, `src/routing/polyline.ts`, `src/routing/types.ts`
- `src/transit/evaluateShortlist.ts`, `src/transit/googleTransitDirectionsService.ts`, `src/transit/types.ts`

**Files deliberately not touched** (confirmed via a full import-chain trace from every `api/*.ts` handler, not just inspection): `src/auth/cookies.ts`, `src/auth/session.ts`, `src/auth/verifyPassword.ts`, `src/config/schema.ts`, `src/geo/types.ts`, `src/geocoding/errors.ts`, `src/http/fetchWithTimeout.ts`, `src/routing/errors.ts`, `src/search/types.ts` — each has zero relative imports of its own, so there was nothing to fix. All of `src/frontend/**` was left untouched (confirmed no `api/*.ts` or reachable `src/*.ts` file imports anything under `src/frontend/`; the reverse dependency-scan direction — frontend importing backend — is irrelevant here since frontend is never executed by the Node ESM loader in Vercel's serverless function runtime, only bundled by Vite).

## Verification method (why this actually proves the fix, not just "tests still pass")

Per the bug's own root cause, Vitest/`tsc --noEmit`/`vite build` all use bundler-style resolution and are structurally blind to this exact class of bug — so passing them is necessary but explicitly not sufficient proof. Two additional steps were done:

1. **Compiled the real emitted JS with `tsc` (not `vite`) and executed it with a bare `node --input-type=module -e "await import(...)"` against every one of the 4 `api/*.ts` handlers**, using a scratch `tsconfig` (`module: ESNext`, `rootDir` = repo root, `outDir` = a scratch dir) that preserves the exact same `api/...` / `src/...` relative directory layout Vercel deploys under `/var/task/`. This forces Node's real ESM resolver (no bundler, no Vite, no Vitest) to resolve every relative import in the compiled output. All 4 compiled handlers (`api/config/public.js`, `api/geocode.js`, `api/auth/verify-password.js`, `api/drop-off-search.js`) imported successfully with zero `ERR_MODULE_NOT_FOUND`.
2. **Negative control**: `git stash`'d the fix, recompiled the same way, and re-ran the identical `node --input-type=module -e "await import(...)"` check against the pre-fix code. All 4 handlers failed with exactly the reported production error shape, e.g.:
   ```
   Error: Cannot find module '.../out-broken/src/config/loader' imported from '.../out-broken/api/config/public.js'
   ```
   This confirms the test methodology genuinely detects the bug (i.e., isn't a false-negative-prone check) before trusting its positive result on the fixed code. `git stash pop` restored the fix afterward; `git diff --stat` was re-checked to confirm all 22 files came back intact.
3. Additionally invoked the compiled, real-Node-ESM-loaded `api/config/public.js` handler function directly (mock `req`/`res` objects, no HTTP server) end-to-end — it executed its own logic (config validation, `res.status/json` calls) correctly post-import, confirming the fix doesn't just resolve modules but that the resulting code still runs correctly.
4. `npx vercel build` was attempted (per the orchestrator's suggested option) but requires an authenticated/linked Vercel project (`project_settings_required`) unavailable in this sandbox, so it was not usable here; the `tsc`-compile-plus-bare-`node`-ESM-import approach above was used instead since it directly reproduces Node's real ESM resolver against the exact same file layout Vercel's runtime uses. Recommend QA/release additionally confirm via a real `vercel build` (or an actual redeploy) before considering this fully closed, since that sandbox limitation means the Vercel-specific bundler/build step itself (as opposed to Node's ESM loader, which is what actually threw the reported error and is what this fix targets) hasn't been exercised here.

**Standard regression checks** (necessary but, per above, not sufficient alone): `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` (36 files / 433 tests) all pass cleanly with the fix applied, no changes needed to any test file.

## Known limitations

- `npx vercel build` itself could not be run in this sandbox (no linked Vercel project/credentials) — see point 4 above. This is the one verification gap; everything else needed to prove the fix (real Node ESM module resolution against the exact Vercel-mirrored file layout) was directly reproduced and is deterministic/re-runnable.
- No test files were added or modified by dev (per scope — qa owns `tests/`); qa should decide whether/how to add a regression test for this exact class of bug (e.g. a CI step that runs `tsc` + bare `node --experimental-vm-modules`/`node --input-type=module` import checks against compiled output, since Vitest itself cannot catch it, as established above).
- This fix does not touch `src/frontend/**` at all — the frontend bundle (built via `vite build`) was already unaffected by this bug (Vite's bundler resolves extensionless imports at build time regardless of the emitted-module-format concern that only applies to code executed by Node's native loader).

---

# REV-018 recurrence prevention (2026-07-12): ESLint rule + CI-runnable ESM verification script

Status: implemented, smoke-tested, no FR/NFR behavior change. Implements both of reviewer's two recommendations from `docs/review-log.md`'s "Post-Closure Incident Audit — REV-018" section, item 2 (numbers 1 and 2 in that section).

## 1. ESLint rule: `import-x/extensions` (`eslint.config.js`)

Added `eslint-plugin-import-x` (the actively-maintained ESLint-9-flat-config-native fork of `eslint-plugin-import`; chosen over the original because it has first-class flat-config support and its built-in Node resolver needs no separate `eslint-import-resolver-node` install — both `eslint-import-resolver-node` and `@typescript-eslint/utils` are optional peers, confirmed via `npm view`, so nothing extra was pulled in beyond the plugin itself). New devDependency: `eslint-plugin-import-x`.

`eslint.config.js` gained one new flat-config block:

```js
{
  files: ["api/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
  ignores: ["src/frontend/**"],
  plugins: { "import-x": importX },
  rules: {
    "import-x/extensions": ["error", "always", { ignorePackages: true }],
  },
},
```

- Scoped via flat config's documented `files` + `ignores` combination (files matching `files` minus anything matching `ignores`), exactly the `api/**` + non-frontend `src/**` scope reviewer specified — confirmed this works as intended by deliberately breaking an extensionless import in `src/frontend/components/DisclaimerBanner.tsx` (0 lint errors, correctly out of scope) vs. the same pattern in `api/geocode.ts` (1 `import-x/extensions` error, correctly caught).
- `ignorePackages: true` so bare/npm specifiers (`"react"`, `"vite"`, etc.) and Node built-ins are unaffected — only relative (`./`, `../`) specifiers are required to carry an extension.
- Type-only imports (`import type { X } from "./y"`) are not checked by this rule's default (`checkTypeImports: false`), which is correct for this specific bug class: `import type` is fully erased by `tsc` at compile time (no runtime import statement is ever emitted), so it cannot trigger `ERR_MODULE_NOT_FOUND` regardless of whether it carries an extension — confirmed this reasoning directly by testing (see Verification section below).
- Also added a small `**/*.mjs` flat-config block (`languageOptions.globals: globals.node`, `sourceType: "module"`) so the new verification script below (a plain `.mjs` file, not matched by the existing `**/*.{ts,tsx}` block) doesn't fail lint on `no-undef` for `process`/`console`.
- Ran `npm run lint` across the whole repo after adding the rule: **0 new violations** anywhere, including `scripts/viteApiMiddleware.ts` (explicitly double-checked per the orchestrator's flag — it already carries `.js` on its dynamic `import("../api/...")` calls from the original hotfix, and `scripts/` is dev-only tooling outside this rule's scope in any case) and every file across `api/**`/non-frontend `src/**`. This confirms the REV-018 hotfix's extension coverage was already complete — the rule found nothing new to fix.

## 2. CI-runnable real-Node-ESM-resolution script (`scripts/verify-esm-resolution.mjs`)

New file, plain Node ESM (`.mjs`, no TS-execution tool like `ts-node`/`tsx` was added as a dependency — the script needs no types itself and this avoids a new toolchain dependency). New npm script: **`"verify:esm": "node scripts/verify-esm-resolution.mjs"`**, run via `npm run verify:esm`.

What it does, mirroring exactly the methodology dev used in the hotfix (this file's "Critical production hotfix" section above) and QA independently reproduced (`docs/test-report.md`'s "Hotfix Verification" section):

1. Recursively discovers every `api/**/*.ts` handler file (no hardcoded list — currently resolves to the 4 handlers: `api/config/public.ts`, `api/auth/verify-password.ts`, `api/geocode.ts`, `api/drop-off-search.ts`).
2. Generates a scratch `tsconfig` (`extends: "./tsconfig.json"`, so it stays in sync with the real project config's `lib`/`strict`/etc.) that overrides only `module: "ESNext"`, `noEmit: false`, `outDir`/`rootDir` (an OS-tempdir scratch directory and the repo root, respectively — this preserves the same `api/...`/`src/...` relative layout Vercel's `/var/task/` uses), and `include`/`exclude` (`api/**/*.ts` + `src/**/*.ts`, excluding `src/frontend/**`).
3. Compiles with the local `node_modules/typescript/bin/tsc` binary (via `execFileSync`) — if compilation itself fails, prints the compiler output and exits 1 (a distinct failure mode from an ESM-resolution failure, but still a real gate).
4. Imports each compiled handler with a real, unbundled `await import(pathToFileURL(...))` — this is genuine Node ESM resolution, no Vite/Vitest/bundler involved.
5. Reports per-handler OK/FAIL, and on any failure, prints the full error (including the `ERR_MODULE_NOT_FOUND` stack) plus a fixed explanatory message pointing at the REV-018 failure class, then exits 1. Cleans up the scratch tsconfig file and scratch output directory in a `finally` block regardless of outcome.

### Proof this is a real regression guard, not decoration

1. **Ran against the current (fixed) codebase**: `npm run verify:esm` → compiles cleanly, all 4 handlers import cleanly, exit 0, `PASS` message.
2. **Negative control**: temporarily removed the `.js` extension from a genuine **value**-level relative import — `src/auth/authGate.ts`'s `import { parseCookies } from "./cookies.js"` → `"./cookies"`. (Note: the task's suggested example file, `src/config/loader.ts`, turned out to have only a `import type` relative specifier, which `tsc` fully erases at compile time and therefore can never produce `ERR_MODULE_NOT_FOUND` regardless of extension — verified this directly before choosing a different file, so the negative control would actually exercise a real runtime failure rather than a no-op.) Re-ran `npm run verify:esm`:
   - Exit code 1.
   - `api/auth/verify-password.ts` and `api/config/public.ts` still `OK` (neither reaches `authGate.ts`'s import chain — `config/public.ts` is deliberately unauthenticated per design.md, `auth/verify-password.ts` doesn't call `AuthGate.check`).
   - `api/geocode.ts` and `api/drop-off-search.ts` both `FAIL`, with the exact reported production error shape reproduced verbatim:
     ```
     Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/auth/cookies' imported from '.../src/auth/authGate.js'
     ```
   - The script's explanatory footer correctly printed, pointing at REV-018 and instructing to add the missing extension.
3. **Restored the fix** (`git diff` confirmed `src/auth/authGate.ts` byte-identical to before the test, zero stray changes), re-ran `npm run verify:esm` → clean `PASS` again, exit 0.

This confirms the script both passes on correct code and — genuinely, not by construction/assumption — fails with the exact REV-018 error shape on a reintroduced instance of the bug, then passes again once reverted.

## Files touched

- `eslint.config.js` — new `import-x/extensions` rule block (scoped `api/**` + non-frontend `src/**`) + a small `**/*.mjs` globals block.
- `package.json` — new devDependency `eslint-plugin-import-x`; new script `"verify:esm"`.
- `package-lock.json` — updated for the new devDependency.
- `scripts/verify-esm-resolution.mjs` — new file (the verification script itself).
- `src/config/loader.ts` — no functional change; its one relative specifier (`import type ... from "./schema"`) now carries `.js` for stylistic consistency with every other relative import in the codebase (harmless no-op for emitted output, since `import type` is erased entirely).

## How to run

- Lint (includes the new rule): `npm run lint`.
- ESM verification: `npm run verify:esm`. Exits 0 with a `PASS` summary listing all 4 handlers on success; exits 1 with a per-handler error (including the raw Node error) and a fixed explanatory footer on failure. No environment variables, network access, or Vercel credentials required.

## Known limitations

- The ESLint rule and the verification script are complementary, not redundant, exactly per reviewer's framing: the lint rule catches a new extensionless relative import the moment it's typed (editor-visible, no compile step), but only the verification script also catches other real-Node-ESM-incompatible code a lint rule wouldn't (e.g. a stray `require()`, a case-sensitivity mismatch on a case-insensitive dev filesystem) — neither substitutes for the other.
- Per reviewer's item 3, a real `vercel build`/deploy dry-run remains explicitly out of scope for both of these additions (and for this sandbox) — that is release's job at the actual deploy step, not a per-PR CI gate. `npm run verify:esm` requires no Vercel credentials and gets CI to the same *correctness* guarantee (real Node ESM resolution) without that coupling, per reviewer's own reasoning for recommending it as the primary fix.
- Wiring `npm run verify:esm` into `.github/workflows/ci.yml` itself is explicitly **not** done here — per the task's scope, that's release's job to coordinate separately; this pass only adds the script and the lint rule.
