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
