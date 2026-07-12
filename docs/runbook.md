# Runbook: DropSpot

Status: Established pre-INC-1 per NFR-005 and the Phase 2 -> Phase 3 gate in `CLAUDE.md`.
Owner: release. Do not edit outside this agent.
Source: `docs/design.md` (Gate 3, section 2 architecture, section 3 provider/cost analysis, section 7 config schema, DQ-4), `docs/requirements.md` (FR-016/017, NFR-005/006/007).

---

## 0. Scope note

This app is a stateless SPA + stateless backend API with no database (design.md section 2). Nothing here manages data migrations, backups, or stateful rollback — there is no state to roll back except the deployed code/config themselves.

No application code exists yet at the time this runbook is written (pre-INC-1). Sections below that reference build/test commands describe the contract dev must satisfy starting at INC-1 (see section 5, "Contract this runbook assumes dev will deliver").

**Update (2026-07-11, Phase 4 closure)**: all 9 increments have now landed. The contract described below is fully satisfied in practice, not just anticipated — see section 5's closure-time verification note and section 10's release log.

---

## 1. Hosting platform: Vercel

### Recommendation
**Vercel**, deploying the SPA frontend and the stateless backend API routes together as a single project.

### Justification
- Design (section 2) explicitly calls for a stateless, serverless-friendly backend and suggests "Vercel/Netlify Functions" as a natural fit — no idle-cost server to manage, scales automatically with bursty public traffic, matches NFR-003's request-scoped-only processing model.
- Single project serves both the static frontend and the `/api/*` routes with no separate frontend/backend deploy pipeline to coordinate — reduces moving parts for a small team.
- Native Git integration: every PR gets its own isolated preview deployment with a unique URL automatically (no custom Actions deploy job required); every merge to `main` triggers an automatic production deployment. This satisfies "deploy-on-merge-to-main" without hand-rolled deploy scripting.
- Built-in environment-variable management per environment (Production / Preview / Development) with values entered directly in the Vercel dashboard — never in the repo (see section 4).
- Built-in atomic, immutable deployments with one-click/one-command instant rollback to any prior deployment (see section 6) — satisfies "rollback must be defined before first deploy."
- HTTPS by default on every deployment, including preview URLs, with no separate certificate management.
- Free tier ("Hobby") is sufficient for MVP validation traffic; upgrading to a paid Vercel plan is a separate, independent decision from the `APP_MODE`/Google Maps Platform cost story (design section 3) — Vercel hosting cost and Google Maps Platform API cost are two different billing relationships to track.

### Alternatives considered (brief)
- **Netlify Functions** — comparable fit, was the other option design explicitly named. Vercel chosen for equally strong serverless-JS support and slightly simpler combined frontend+API project model; no strong differentiator either way. Netlify remains a reasonable fallback if the user has an existing account/preference.
- **Render / Fly.io (always-on container)** — rejected as primary choice: introduces idle-cost and manual scaling considerations design flagged as unnecessary for a fully stateless, bursty-traffic-shaped workload. Would only be reconsidered if dev's chosen framework turns out to need a long-running process incompatible with serverless function cold starts (flag to tech-lead if so).

**Open item for user**: Vercel requires an account. See section 8, item 1.

---

## 2. Environments

| Environment | Trigger | Purpose |
|---|---|---|
| Production | Merge to `main` | The live, publicly reachable URL (NFR-005) |
| Preview | Every open pull request | Isolated per-PR deployment for QA/reviewer to inspect before merge; automatically commented on the PR by Vercel's GitHub App |
| Development | Local `vercel dev` / local dev server | Local iteration; developer's own local env vars (`.env.local`, gitignored) |

`APP_MODE` recommendation per environment: **`free_tier` for Preview and Development**, regardless of what Production is set to. Rationale: Preview URLs are still public HTTPS endpoints reachable by anyone with the link; gating them with the same `PAID_TIER_ACCESS_PASSWORD` as production would require that secret to be usable (and potentially guessable via preview traffic) outside the intended production control point, with no corresponding benefit since preview traffic volume is expected to be low and short-lived. If the user wants Preview password-gated too, say so explicitly and this section will be revised.

---

## 3. Deployment process

### 3.1 One-time setup (before INC-1 merges to main) — requires user action, see section 8
1. Create/confirm a Vercel account and connect it to the `arjun-batra/drop-off-map` GitHub repository, importing it as a new Vercel project.
2. In the Vercel project's Settings -> Environment Variables, add every variable in section 4's table, scoped to the correct environment(s) (Production / Preview / Development) using the platform's secret storage. **Never commit values to this repo.**
3. Confirm build settings: framework preset (auto-detected once dev's INC-1 scaffolding lands — see section 5), root directory `/` (single combined project, no monorepo split), build command and output directory as dev defines them in `package.json`.
4. Confirm the production branch is set to `main` in Vercel project settings (this determines what "merge to main = production deploy" actually targets).
5. Decide on a custom domain vs. the default `*.vercel.app` subdomain (see section 8, item 2 — open question for user).

### 3.2 Ongoing deploy flow (after setup, ordinary operation)
1. Dev opens a PR for `inc-N-<slug>` per `CLAUDE.md`'s git workflow. Vercel automatically builds and deploys a Preview URL for that PR; GitHub Actions CI (section 5) runs lint/typecheck/test/build as a required PR check.
2. QA and reviewer can use the live Preview URL to test the increment in a deployed (not just local) environment, in addition to local/automated testing.
3. On merge to `main` (after QA pass + reviewer clearance per `CLAUDE.md`), Vercel automatically builds and deploys to Production. No manual deploy step is required in the ordinary case.
4. Release verifies the deploy per section 6 after every production deploy that corresponds to an increment merge, and explicitly at Phase 4 closure (per `CLAUDE.md` Phase 4).

### 3.3 Manual/emergency deploy (if automatic Git integration is unavailable)
- `vercel --prod` from a local checkout with the Vercel CLI authenticated (`vercel login`) and linked to the project (`vercel link`), run only by someone with access to the Vercel project. Use only if the Git integration itself is broken; prefer the Git-triggered flow otherwise so every production deploy has a traceable corresponding commit/PR.

---

## 4. Environment variables and secrets

All values below come from `docs/design.md` section 7 (which supersedes/expands `docs/requirements.md` section 3). **Names only — no values are recorded anywhere in this repo.** Secret values are entered directly by the user/operator into the Vercel dashboard's Environment Variables screen (or the local `.env.local` file for Development, which must stay gitignored).

| Variable | Secret? | Required | Notes |
|---|---|---|---|
| `MAP_ROUTING_PROVIDER` | No | Yes | Fixed value `google_maps_platform` per design section 3 |
| `MAP_API_KEY` | **Yes** | Yes | Google Maps Platform API key. Server-side only — never sent to the browser (design section 2). See section 8, item 3 for setup. |
| `GEOGRAPHIC_CENTER` | No | Yes | Default: Toronto (43.6532, -79.3832, "Toronto, ON") |
| `GEOGRAPHIC_RADIUS_KM` | No | Yes | Default: 200 |
| `MAX_CANDIDATES_RETURNED` | No | Yes | Default: 3 |
| `APP_MODE` | No | Yes | `free_tier` or `paid_tier`. Operator-controlled switch — see section 7 for how this is operated in production. |
| `PAID_TIER_ACCESS_PASSWORD` | **Yes** | Only if `APP_MODE=paid_tier` | Config loader must fail fast if `APP_MODE=paid_tier` and this is unset (design section 10, INC-1) |
| `RESPONSE_TIME_TARGET_SECONDS` | No | Yes | Default: 5 |
| `TRANSIT_MODES_INCLUDED` | No | Yes | Default: `all` |
| `CANDIDATE_SPACING_METERS` | No | Yes | Default: 1000 |
| `MAX_RAW_CANDIDATES_SAMPLED` | No | Yes | Default: 20 |
| `MAX_TRANSIT_EVALUATIONS_PER_REQUEST` | No | Yes | Default: 8 |
| `DISTANCE_MATRIX_BATCH_SIZE` | No | Yes | Default: 25 |
| `REQUEST_TIMEOUT_MS` | No | Yes | Default: 4000 |
| `PROVIDER_CONCURRENCY_LIMIT` | No | Yes | Default: 10 |
| `MIN_GEOCODE_QUERY_LENGTH` | No | Yes | Default: 3. Added INC-2 follow-up (REV-006/REV-007) — promoted from a hardcoded constant. Cost-control lever: every character at/above this length triggers a billable Geocoding API call. |
| `GEOCODE_DEBOUNCE_MS` | No | Yes | Default: 300. Added INC-2 follow-up (REV-006/REV-007) — promoted from a hardcoded constant. Shapes billable call frequency during typing. |
| `SESSION_LIFETIME_SECONDS` | No | Only if `APP_MODE=paid_tier` | Added INC-8. Default: 3600 (1 hour). Lifetime in seconds of the session cookie issued by `POST /api/auth/verify-password`; the expiry is signed into the token itself and re-checked server-side on every request, not just left to the cookie's own `Max-Age`. Config loader requires this whenever `APP_MODE=paid_tier`, same fail-fast pattern as `PAID_TIER_ACCESS_PASSWORD`. Not exposed via `GET /api/config/public` (no frontend reader needs it yet). |
| `MAP_TILE_URL_TEMPLATE` | No\* | No (optional) | Added INC-9. Leaflet XYZ tile-layer URL template for the optional Results-screen map panel. `null`/unset is a fully supported "map view disabled" state (ux-spec.md section 6.7's fail-silent/omit-panel behavior) — no FR/NFR depends on this. \*If pointed at a paid tile provider (e.g. MapTiler, Stadia Maps), the provider's API key is embedded directly in this URL string by the operator — see note below the table. |
| `MAP_TILE_ATTRIBUTION` | No | No (optional, but required alongside `MAP_TILE_URL_TEMPLATE` if that one is set) | Added INC-9. Attribution text/HTML the tile provider's license terms require. Must be updated to match whichever provider `MAP_TILE_URL_TEMPLATE` points at. |

### 4.1 Quick-start default values (copy-paste block for Vercel)

The block below is a convenience reference only — it reproduces the same 20 keys and defaults from the table above (and `.env.example`'s exact value formatting) as literal `KEY=value` lines, so they can be bulk-pasted into Vercel's Environment Variables screen (Vercel's bulk-add box accepts `.env`-style paste, including `#` comment lines) or used as a quick local reference. **This is not a new source of truth** — the table above and `.env.example` remain authoritative; if they ever drift from this block, this block is the one that's wrong.

18 of the 20 keys below are non-secret and shown with their real, sensible defaults. The remaining 2 (`MAP_API_KEY`, `PAID_TIER_ACCESS_PASSWORD`) are true secrets (section 4 above) — they are shown only as `KEY=<your-value-here>` placeholders. **Never replace those placeholders with a real value in this file, in chat, or in any commit.** Enter their real values directly into the Vercel dashboard (or a gitignored `.env.local` for Development) per section 8, item 3.

```
# --- Provider ---
MAP_ROUTING_PROVIDER=google_maps_platform
MAP_API_KEY=<your-value-here>

# --- Service area (NFR-006, FR-004) ---
GEOGRAPHIC_CENTER={"lat":43.6532,"lng":-79.3832,"label":"Toronto, ON"}
GEOGRAPHIC_RADIUS_KM=200

# --- Results shaping ---
MAX_CANDIDATES_RETURNED=3

# --- Access control (FR-016, FR-017) ---
APP_MODE=free_tier
# The next two are only required if APP_MODE=paid_tier above; the config
# loader fails fast if APP_MODE=paid_tier and either is unset. Leave unset
# (or omit) if running free_tier.
PAID_TIER_ACCESS_PASSWORD=<your-value-here>
SESSION_LIFETIME_SECONDS=3600

# --- Latency (NFR-004) ---
RESPONSE_TIME_TARGET_SECONDS=5
REQUEST_TIMEOUT_MS=4000

# --- Transit ---
TRANSIT_MODES_INCLUDED=all

# --- Geocode autocomplete cost controls ---
MIN_GEOCODE_QUERY_LENGTH=3
GEOCODE_DEBOUNCE_MS=300

# --- Candidate generation / evaluation tuning ---
CANDIDATE_SPACING_METERS=1000
MAX_RAW_CANDIDATES_SAMPLED=20
MAX_TRANSIT_EVALUATIONS_PER_REQUEST=8
DISTANCE_MATRIX_BATCH_SIZE=25
PROVIDER_CONCURRENCY_LIMIT=10

# --- Map view (INC-9) — both keys below are OPTIONAL. Leave unset and the
# Results-screen map panel is simply omitted; no FR/NFR depends on this.
# Default shown points at CARTO's free, keyless "Positron" basemap — fine
# for low-volume use, rate-limited at production scale (see .env.example
# for the MapTiler/Stadia Maps alternative for real production volume).
MAP_TILE_URL_TEMPLATE=https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png
MAP_TILE_ATTRIBUTION=&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>
```

---

**`MAP_TILE_URL_TEMPLATE` is marked "No" under Secret? deliberately, even though a paid tile provider's API key may be embedded in its value.** This is architectural, not an oversight: Leaflet fetches map tiles directly from the browser (no server-side proxy — see design.md section 3.1a/handoff.md INC-9), so any key embedded in this URL is necessarily visible in the browser's own network requests regardless of how the value is stored server-side. Do not treat this the same as `MAP_API_KEY`/`PAID_TIER_ACCESS_PASSWORD` (which never reach the browser) — if the operator is concerned about a paid tile-provider key being publicly visible this way, that provider's own dashboard should be used to restrict the key by HTTP referrer, the same mitigation recommended for `MAP_API_KEY` in section 8 item 3(c) below.

**Only two true secrets exist in this system: `MAP_API_KEY` and `PAID_TIER_ACCESS_PASSWORD`.** Neither is ever required by GitHub Actions CI (section 5) — CI runs against mocked provider responses per design section 10 (INC-6 QA notes), so no live Google Maps Platform key is stored as a GitHub Actions secret. This deliberately minimizes where the secret lives (Vercel only) and avoids duplicating it across two secret stores.

If `MAP_API_KEY` is ever needed for a genuine end-to-end smoke test against the real provider (as opposed to mocks), that should run manually/locally with a developer's own `.env.local`, or as a deliberate, explicitly-approved step at Phase 4 closure — not as a routine CI step.

---

## 5. CI pipeline

File: `.github/workflows/ci.yml`.

Runs on every push to `main` and every pull request targeting `main`. Steps: checkout, Node setup (version pinned via `.nvmrc`, not hardcoded in the workflow — see that file), install, lint, typecheck, test (the qa suite), build.

### Contract this runbook assumes dev will deliver (INC-1)
The workflow expects, once INC-1 lands:
- A `package.json` at repo root with `lint`, `test`, and `build` npm scripts (`typecheck` optional, run only `--if-present`).
- A `package-lock.json` (workflow uses `npm ci`, which requires a committed lockfile).
- The `test` script running the qa test suite, per `CLAUDE.md`'s pipeline (qa tests INC-N + full regression before every increment is considered passing).

### Why the workflow doesn't hard-fail before INC-1 exists
The workflow checks for `package.json` first. If it's absent (true today, pre-INC-1), it prints a notice and skips install/lint/test/build steps rather than failing — this repo's own setup commits (this one included) would otherwise show a permanently red CI check for no actionable reason. Once dev adds `package.json` in INC-1, the same workflow automatically starts enforcing real lint/test/build gates with no further edits needed to this file. This is intentional, not a gap — reviewer/QA should confirm at INC-1 that CI is actually gating (i.e., the "skip" branch is no longer taken) once that increment's PR is open.

**Confirmed at Phase 4 closure (2026-07-11)**: `package.json` has existed since INC-1 and the `pkgcheck` step's condition (`steps.pkgcheck.outputs.exists == 'true'`) is what actually runs on every push/PR now — the `exists == 'false'` skip branch is dead code at this point in the project's life (harmless to leave in place; it only ever fires if `package.json` is ever removed, which would itself be a build-breaking regression the workflow should catch some other way). Verified directly in this session via a fresh `npm ci` + `npm run lint` + `npm run typecheck` + `npm test` + `npm run build`, all exiting 0 against the real 9-increment codebase (36 test files, 433 tests) — this is exactly the sequence the workflow's real-gate branch runs, confirming the workflow is gating on substance, not the skip notice.

### What CI does NOT do
- CI does not deploy. Deployment is handled by Vercel's native GitHub integration, triggered by the same push/PR events, running independently of this workflow (section 3.2). This workflow is the required quality gate; Vercel's build+deploy is the delivery mechanism. Both must succeed, but they are separate systems by design (avoids duplicating Vercel build logic inside Actions, avoids needing `VERCEL_TOKEN`/org/project IDs as GitHub Actions secrets for a deploy step Vercel already performs natively).
- CI does not call the real Google Maps Platform API (see section 4).

### Recommended follow-up (user/orchestrator action, not a file I can set myself)
Enable GitHub branch protection on `main` requiring the CI workflow's job to pass before merge. This is a repository settings change (not a committed file), so it isn't something release can configure from within this repo — flagging as an action item (section 8, item 4).

---

## 6. Verifying a deploy succeeded

After every production deploy (ordinary increment merges, and explicitly at Phase 4 closure):

1. **Vercel dashboard/CLI status**: confirm the deployment shows `Ready` (not `Error` or `Canceled`) for the `main`-triggered production deployment. `vercel ls` from a linked local checkout also shows this.
2. **Frontend loads**: `curl -sI https://<production-domain>/` returns `200`.
3. **Config/health check**: `curl -s https://<production-domain>/api/config/public` returns valid JSON reflecting the environment variables actually set for Production (e.g., `appMode` matches what the operator intended, `geographicRadiusKm` matches expectation). This endpoint requires no secret, no auth, and triggers zero billed Google Maps Platform calls (per design section 5.2), making it a safe, free smoke check that config loaded successfully (a bad/missing required env var — e.g., missing `MAP_API_KEY` — should surface as a config-loader failure per design section 10, INC-1, which this check would catch as a non-200 or error response).
   - **Confirmed still accurate at Phase 4 closure**: the endpoint's implementation (`api/config/public.ts`) is unchanged in shape/behavior since INC-1 — still unauthenticated regardless of `APP_MODE`, still a pure `loadConfig()` + `toPublicConfig()` call with zero outbound provider calls. Its response shape now also includes `minGeocodeQueryLength`, `geocodeDebounceMs`, `mapTileUrlTemplate`, `mapTileAttribution` (added INC-2 follow-up and INC-9 respectively — see section 4's table). `mapTileUrlTemplate`/`mapTileAttribution` will legitimately be `null` in the response if the operator hasn't configured a tile provider — that's an expected, valid Production configuration (INC-9 is optional), not a failure signal for this check. `sessionLifetimeSeconds` intentionally does **not** appear in this response (no frontend reader needs it) — its presence/correctness can only be confirmed indirectly (e.g., by observing session-expiry behavior), not via this endpoint.
4. **One real end-to-end request** (only when deliberately budgeted for — this does spend Google Maps Platform calls, see section 3 accounting in design.md): submit one real drop-off search with a known-good, in-radius start/destination pair and confirm a `ranked` or `fallback` response comes back within a reasonable time and with a sane time breakdown. Do this after the first true production deploy and at Phase 4 closure; not on every routine merge (cost discipline, ties to section 7 below).
5. Record the result (pass/fail, timestamp, deployment URL/hash) in this runbook's Release Log (section 9) at Phase 4, and informally note any failures immediately if they occur mid-project.

**Flag to tech-lead (not a blocker, a suggestion)**: a dedicated `/api/health` endpoint that reports config-loaded-OK without any dependency on the geographic/config-shape details of `/api/config/public` would be a cleaner long-term health check. Not required — `/api/config/public` already serves this purpose adequately per design section 5.2 — but worth considering if `/api/config/public`'s shape changes in a way that makes it awkward as a health probe.

---

## 7. Billing / cost-ceiling alerting for Google Maps Platform (DQ-4)

This directly addresses tech-lead's DQ-4 flag (design.md section 1.2): the free-tier monthly usage credit (~$200 USD/month, **verify current amount in Google Cloud Console before launch — this changes over time**, per design section 3) is a pooled, shared budget across all Maps Platform SKUs used by this app (Geocoding, Directions, Distance Matrix). Nothing in the application code enforces a ceiling automatically (FR-017/NFR-007 explicitly leave automatic switching out of scope) — this section is the operational backstop.

### 7.1 Set up a budget alert (required, one-time, in Google Cloud Console)
1. In the Google Cloud project that owns the Maps Platform API key, go to **Billing -> Budgets & alerts -> Create budget**.
2. Scope the budget to that specific project (not the whole billing account, if other projects share it).
3. Set the budget amount to a value below the full free credit as an early-warning margin — recommend **75% of the current credit amount** (verify the credit's current dollar figure first; do not hardcode "$200" as a permanent assumption).
4. Set alert thresholds at 50%, 75%, 90%, and 100% of that budget, with email notifications sent to the operator (the person who will actually flip `APP_MODE` if needed — not a generic/unmonitored address).
5. **Important caveat, must be understood by whoever owns this**: Google Cloud budget alerts are **notifications only** — they do not automatically stop billing, throttle usage, or disable the API key. Reaching 100% of the budget does not stop the app from continuing to make (and pay for) calls. The only enforcement mechanism in this system is the operator manually setting `APP_MODE=paid_tier` (which password-gates the whole app, reducing audience/traffic) after seeing an alert — this is consistent with the already-accepted risk in NFR-007. Do not assume the budget alert is a safety net that prevents overspend by itself.

### 7.2 Optional secondary safety net: per-API quota caps
As defense in depth (not a replacement for 7.1), consider setting explicit daily quota caps on the individual APIs (Directions, Distance Matrix, Geocoding) under **APIs & Services -> Quotas** in Google Cloud Console. A hard quota cap will actually reject requests once exceeded (unlike a billing alert), which caps worst-case cost at the price of a hard outage for users once the cap is hit that day. This is a genuine cost/availability trade-off — flagging it here as optional, not defaulting to it, since imposing it silently could cause exactly the kind of "silent failure" the project's design principles (ux-spec section 0) explicitly want to avoid. If the user wants this enabled, they should decide the cap value explicitly (see section 8, item 5).

### 7.3 Who does this
This is a Google Cloud Console configuration step tied to the Google Cloud project/billing account the user controls — release cannot perform this from within the repo (no credentials, no access to the user's GCP account). See section 8, item 3.

---

## 8. Open items requiring user input (before or shortly after INC-1 starts)

1. **Vercel account**: Does the user have an existing Vercel account, or should one be created? Either way, the user (not release) needs to connect the `arjun-batra/drop-off-map` GitHub repo to a Vercel project and grant the necessary GitHub App permissions — this is an account-level action release cannot perform.
2. **Custom domain**: Use the default `*.vercel.app` subdomain, or a custom domain (e.g., `dropspot.app`, referencing the product name from `ux-spec.md`)? If custom, the user needs to own/purchase the domain and add DNS records Vercel provides — a decision and a possible purchase, not something release can decide unilaterally.
3. **Google Cloud project + API key**: The user needs to (a) create/confirm a Google Cloud project, (b) enable the Geocoding API, Directions API, and Distance Matrix API, (c) create an API key restricted appropriately (recommend restricting by API and, if feasible, by server IP/referrer once the Vercel deployment's outbound IPs or domain are known), (d) set up billing on that project, and (e) provide the key's **value** directly into the Vercel dashboard's environment variables (never to release/Claude, never into the repo). Tell the user this explicitly: enter the key directly into Vercel, not in chat or in any file.
4. **GitHub branch protection**: Recommend enabling a required-status-check rule on `main` for the CI workflow (section 5). This is a repo settings change outside release's file-based ownership — needs the user or orchestrator with repo admin access to enable it.
5. **Per-API quota cap value** (section 7.2): optional; if wanted, the user should specify the daily cap explicitly, understanding the availability trade-off described there.
6. **Preview environment `APP_MODE`**: confirmed default recommendation is `free_tier` for Preview/Development regardless of Production's setting (section 2). Flag if the user wants this different.
7. **Vercel plan tier**: Hobby (free) is likely sufficient for MVP traffic per the stated success criteria (idea-brief: "validated... on at least 3 real trips"), but if the user anticipates meaningfully more traffic than that during validation, a paid Vercel plan may be worth discussing — separate decision from Google Maps Platform's `APP_MODE` cost story.
8. **Map tile provider (INC-9, optional)**: `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` are optional — leave both unset in Vercel and the Results-screen map panel is simply omitted (no FR/NFR depends on it). If the user wants the map view live in Production, they need to either (a) use `.env.example`'s default CARTO/OpenStreetMap "Positron" basemap URL as-is (free, keyless, but rate-limited for high production volume per CARTO's own terms), or (b) create a free-tier account with MapTiler or Stadia Maps and set `MAP_TILE_URL_TEMPLATE` to that provider's URL template (with the provider's own API key embedded in the string) plus the matching `MAP_TILE_ATTRIBUTION` text their terms require. Either way, enter the values directly into the Vercel dashboard, same as any other environment variable (see section 4's note on why this key is not treated as a secret despite potentially containing a provider API key).

None of the above blocks writing this runbook or the CI workflow file, but items 1-3 must be resolved before INC-1's code can actually be deployed (the CI quality gate can run without them; the Vercel deploy step cannot). Item 8 does not block deploy at all — the app runs correctly with the map view omitted.

---

## 8.1 Final pre-deploy checklist (confirmed accurate at Phase 4 closure, 2026-07-11)

All 9 increments have landed, QA's end-to-end test passed, and reviewer's final audit cleared with zero blockers/majors (the sole remaining tracked item, REV-010, is addressed by step 6 below, not a blocker to starting deploy). Everything below was re-confirmed against the actual codebase in this session (fresh `npm ci` + `npm run build`/`lint`/`typecheck`/`test`, config schema cross-reference, CI workflow re-read) — none of it is carried over unverified from when this runbook was first drafted pre-INC-1.

1. **Vercel account + repo connection** (section 8 item 1): connect `arjun-batra/drop-off-map` to a Vercel project if not already done. This is the one step release cannot perform — needs the user's own Vercel account access.
2. **Set every environment variable in section 4's table** in the Vercel dashboard, scoped to Production (and Preview/Development per section 2's `APP_MODE` recommendation). 20 keys total; only `MAP_API_KEY` and `PAID_TIER_ACCESS_PASSWORD` are true secrets — enter their real values directly into Vercel, never into this repo or into chat. `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` may be left unset (section 8 item 8).
3. **Google Cloud project + API key** (section 8 item 3): Geocoding, Directions, and Distance Matrix APIs enabled, billing set up, key restricted appropriately, budget alert configured per section 7.1 before real traffic depends on it.
4. **Confirm build settings** in Vercel match `vercel.json` (framework `vite`, build command `npm run build`, output directory `dist`) — auto-detected, but worth a one-time visual confirmation in the dashboard per section 3.1 step 3.
5. **Deploy** (merge to `main`, or the one-time initial import triggers the first build) and run section 6's verification steps 1-3 (deployment status, frontend loads, `/api/config/public` smoke check) immediately.
6. **Run section 6 step 4 (one real end-to-end drop-off search)** against the live Production deployment with the real `MAP_API_KEY` now in place. This single step is also how **REV-010** (review-log.md's sole open Findings Register item — real-provider-response empirical verification, five sub-conditions: live-traffic driving duration, live-traffic transit duration/breakdown, real-provider error-path behavior, real-world latency vs. `RESPONSE_TIME_TARGET_SECONDS`, and real tile-imagery rendering if the map view is enabled) gets closed — it is folded into this first real deploy's verification, not a separate exercise. Record the outcome against all five sub-conditions in this runbook's Release Log (section 10) and flag back to reviewer/qa to close REV-010 in review-log.md/test-report.md (those are their files, not release's, to update).
7. **Dry-run the rollback procedure** (section 9) once against this first real deployment, per section 9.4 — record the result (pass/fail) in section 10 alongside the initial deploy entry.
8. **Enable GitHub branch protection on `main`** (section 8 item 4) requiring the CI workflow to pass before merge, if not already done.

---

## 9. Rollback procedure

Defined now, before any real deploy exists, per the non-negotiable that rollback must be defined before the first deploy, not after the first bad one.

### 9.1 How rollback works on Vercel
Every deployment (Preview or Production) is immutable and independently addressable. Rolling back means **promoting a previously-known-good deployment back to the Production alias**, not reverting/rebuilding from a git revert (though a git revert + new merge is also a valid, slightly slower alternative that keeps `main` and the live deployment in sync going forward).

### 9.2 Steps (fast path — instant rollback)
1. In the Vercel dashboard, go to the project's **Deployments** tab.
2. Identify the last deployment known to be good (the one before the problematic merge) — cross-reference against this repo's commit history / merge timestamps if needed.
3. Use Vercel's **"Promote to Production"** (a.k.a. Instant Rollback) action on that prior deployment. This re-points the production domain at the previously-built artifact immediately, with no rebuild required — typically seconds, not minutes.
4. Equivalent CLI path: `vercel rollback <deployment-url-or-id>` from a linked local checkout with appropriate access.
5. Re-run section 6's verification steps against production immediately after rollback to confirm the rollback itself succeeded.

### 9.3 Follow-up after any rollback
1. Do not just leave `main` pointing at the bad commit — open a fix or revert PR through the normal pipeline (qa pass, reviewer clearance) so the next ordinary merge to `main` doesn't accidentally re-deploy the same bad state.
2. Record the rollback in this runbook's Release Log (section 10) with: what broke, which deployment was rolled back to, and the fix PR reference.
3. If the incident involved a secret/config problem (e.g., wrong `APP_MODE`, missing/rotated `MAP_API_KEY`), verify the corrected environment variable in the Vercel dashboard as part of the same incident, since a code rollback alone won't fix a bad env var.

### 9.4 Rollback tested
**No — still untested against a real scenario, as of the 2026-07-12 post-closure incident, but for a different reason than originally recorded here.**

At Phase 4 closure (2026-07-11) this section correctly said no real Vercel production deployment had ever been created for this project. **That is no longer true**: a real first production deployment happened after closure (commit `1e82b22`), and it broke immediately (`FUNCTION_INVOCATION_FAILED` / `Error [ERR_MODULE_NOT_FOUND]` on every `api/*.ts` handler — see section 10's Release Log and `docs/review-log.md`'s "Post-Closure Incident Audit — REV-018" for full detail). So the premise "no deploy has ever existed to test rollback against" is now stale and is corrected here.

However, this incident still did not exercise the rollback procedure itself: it was resolved **fix-forward** — a hotfix commit (`c12510a`, 22 files, mechanical `.js`-extension edits only, no behavior change) was independently verified by dev and QA, merged to `main` as `4af40b4`, and redeployed, rather than by promoting a prior known-good deployment per section 9.2. This was a deliberate, reasonable operational choice for this specific incident (there was no prior known-good *production* deployment to roll back to in the first place — `1e82b22` was the first production deploy — so "promote the previous deployment" was not actually an available option this time; a fix-forward was the correct path, not a shortcut around rollback), not an oversight and not evidence the procedure doesn't work.

**Net effect: section 9's rollback procedure (9.1-9.3) remains genuinely untested against a real scenario.** This is still an open, accurate item, not closed by this incident, and should be dry-run tested at the next opportunity — e.g., deliberately promoting the current good production deployment to a prior one and back, or the first time a future deploy actually does have a prior known-good production deployment available to roll back to — with the result recorded in section 10.

---

## 10. Release Log

To be filled in as real deploys happen (first entry expected after INC-1 merges; closure entry at Phase 4 per `CLAUDE.md`).

**Status at Phase 4 closure (2026-07-11)**: still empty. No real Vercel deployment has been created for this project yet — everything to date (INC-1 through INC-9, QA's full regression, reviewer's 5-pass audits) has run against local dev servers and mocked/direct-call provider tests, per handoff.md. Per this session's explicit scope, release has verified and prepared everything short of the real deploy itself (build reproducibility, config completeness, CI gating, this runbook's own accuracy) — the actual first production deploy is a real, costed, hard-to-reverse action requiring the user's own Vercel account access and explicit go-ahead, handled separately from this session. The first row below should be filled in once that deploy happens, per section 8.1's checklist.

**Update (2026-07-12, post-closure incident)**: the above is no longer current. A real first production deployment did happen after Phase 4 closure, and it broke on arrival — see the Release Log row below and `docs/review-log.md`'s "Post-Closure Incident Audit — REV-018" section (also `docs/handoff.md`'s "Critical production hotfix" section and `docs/test-report.md`'s "Hotfix Verification" section) for full incident detail. This entry is recorded here for history, not corrected in place, consistent with this runbook's own practice of appending rather than silently rewriting past status notes.

| Date | Version/commit | Target | Verification result | Rollback tested? |
|---|---|---|---|---|
| 2026-07-12 | Initial prod deploy: commit `1e82b22`. Hotfix: commit `c12510a`, merged to `main` as `4af40b4`. | Production (Vercel) | **Initial deploy (`1e82b22`) broke immediately**: every `api/*.ts` handler crashed at cold start — `FUNCTION_INVOCATION_FAILED` (`Error [ERR_MODULE_NOT_FOUND]`), root cause: extensionless relative imports valid under `tsconfig.json`'s bundler module resolution but invalid under Node's real ESM loader mandated by `package.json`'s `"type": "module"` (see handoff.md/test-report.md/review-log.md REV-018 for full root-cause and dual dev+QA verification). Fixed forward via commit `c12510a` (22 files, mechanical `.js`-extension-only edits, no behavior change), independently verified by dev and QA via real-Node-ESM-loader reproduction with a negative control against the pre-fix commit. Merged to `main` as `4af40b4` and redeployed. **Post-hotfix-deploy verification: PASS** — `GET /api/config/public` independently confirmed returning `200` with zero runtime errors, checked live via Vercel MCP tooling (not just a self-report from dev/QA's pre-merge checks). | **No** — this incident was resolved fix-forward (new commit `c12510a` merged and redeployed), not by invoking the rollback procedure in section 9. This was a deliberate operational choice for this incident (the fix was fast, mechanical, and low-risk to verify — see verification method above), not an oversight or an inability to roll back. Section 9's rollback procedure itself therefore still has not been exercised against a real scenario — see section 9.4, which remains an open item. |

---

## 11. Logging & data retention (design section 9 flag)

Design.md section 9 flags: "Operational log retention for request-scoped coordinate data ... flagged to release for `docs/runbook.md`, not a design mechanism itself." This is the response:

- Consistent with NFR-003 (no persistence of user-submitted location data beyond serving a single request), application-level logs should **not** log raw lat/lng coordinates or full free-text addresses at normal (info) log level in Production. If dev needs coordinate-level detail for debugging, it should be behind an explicit debug/verbose log level that is not enabled in Production by default — this is a dev/tech-lead implementation concern, flagged here so it isn't missed, not something release implements directly.
- Vercel's own platform request/build logs are retained per the plan tier (shorter on Hobby, longer on Pro) and are outside application control — this is acceptable for infra-level logs (status codes, timing, request paths) but reinforces why coordinate data specifically should not appear inside application log *messages* that flow into that same log stream.
- No third-party persistent log aggregation/analytics service should be added without confirming it does not retain coordinate-bearing log lines beyond a short window — if one is added later (not currently planned for v1 per idea-brief risk #5: "no usage data feedback loop"), that's a new decision requiring the same scrutiny as any other data-retention choice, routed through pm/user like any other requirement change.

---

## 12. Changelog

| Date | Change | Reason |
|---|---|---|
| 2026-07-11 | Initial runbook created: Vercel hosting recommendation + justification, environment variable/secrets table (names only), CI pipeline description, DQ-4 billing-alert setup, deploy verification steps, rollback procedure (untested — no deploy exists yet), open items requiring user action, logging/retention guidance (design section 9) | Phase 2 -> Phase 3 gate requirement (NFR-005): CI/CD + hosting + runbook established before INC-1 begins |
| 2026-07-11 | Phase 4 closure prep pass: added the 5 config keys introduced across INC-2 follow-up/INC-8/INC-9 (`MIN_GEOCODE_QUERY_LENGTH`, `GEOCODE_DEBOUNCE_MS`, `SESSION_LIFETIME_SECONDS`, `MAP_TILE_URL_TEMPLATE`, `MAP_TILE_ATTRIBUTION`) to section 4's table (had drifted since initial drafting — table previously only listed the original 14 keys); confirmed via fresh `npm ci`/`npm run build`/`lint`/`typecheck`/`test` that the build is reproducible and CI's real gate (not its pre-INC-1 skip branch) is what actually runs; confirmed `/api/config/public`'s shape and zero-cost/unauthenticated behavior are unchanged since INC-1 despite new response fields; added section 8 item 8 (optional map tile provider) and new section 8.1 (final consolidated pre-deploy checklist, folding REV-010's real-API-key verification into the first deploy's section 6 step 4 rather than treating it as a separate exercise); updated section 9.4 to reflect that no real deploy has ever existed to test rollback against, clarifying this is a scope fact, not a missed step; updated stale "no application code exists yet" framing in sections 0 and 5. No secret values added anywhere. | Phase 4 closure step per `CLAUDE.md` ("release executes/dry-runs the deploy per runbook"); config table had genuinely drifted from the shipped `AppConfig` schema and needed correcting before the real deploy checklist could be trusted |
| 2026-07-11 | Added section 4.1, "Quick-start default values": a copy-paste `KEY=value` block reproducing section 4's 20-key table (18 non-secret keys with real defaults sourced from `.env.example`; `MAP_API_KEY`/`PAID_TIER_ACCESS_PASSWORD` shown only as `<your-value-here>` placeholders, never real values) for bulk-pasting into Vercel's Environment Variables screen. Explicitly notes `PAID_TIER_ACCESS_PASSWORD`/`SESSION_LIFETIME_SECONDS` apply only when `APP_MODE=paid_tier`, and `MAP_TILE_URL_TEMPLATE`/`MAP_TILE_ATTRIBUTION` are optional (INC-9 map view). No secret values added anywhere; the table in section 4 and `.env.example` remain the authoritative source. | Requested documentation convenience: a single copy-pasteable reference for operator setup in Vercel, without duplicating or contradicting the authoritative sources |
| 2026-07-12 | Post-closure incident documentation fix (flagged by reviewer, `docs/review-log.md` REV-018): section 10's Release Log was still showing the empty "(none yet)" placeholder despite a real production deployment now existing, breaking, and being fixed — added the real entry (initial deploy `1e82b22` broke with `FUNCTION_INVOCATION_FAILED`/`ERR_MODULE_NOT_FOUND` on every API endpoint; hotfix `c12510a` merged to `main` as `4af40b4`; post-hotfix `GET /api/config/public` independently confirmed returning `200` with zero runtime errors via live Vercel MCP tooling; rollback not used — resolved fix-forward). Corrected section 9.4, which still read "no real Vercel production deployment has ever been created for this project" — that premise is now false; reframed to record that a real deployment now exists and did not need rollback (fix-forward was the correct, deliberate choice given there was no prior known-good production deployment to roll back to), while keeping accurate the still-true, still-open fact that section 9's rollback procedure itself has never been exercised against a real scenario. No secret values added anywhere; no application code touched; this is a documentation-accuracy correction, not a new deploy action. | Runbook must stay in sync with reality (`CLAUDE.md` non-negotiable) — a real incident occurred and this file's own artifacts (Release Log, rollback-tested claim) had gone stale relative to it |
