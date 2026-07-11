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
