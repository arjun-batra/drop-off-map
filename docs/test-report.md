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

## Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Initial test report for INC-1: PASS, 99/99 tests across 11 files, 0 bugs filed, explicit verdicts recorded on the two dev-flagged items (unauthenticated public-config endpoint, client-side-only gate). |
