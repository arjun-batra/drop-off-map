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
| REV-002 | SECURITY | major | `src/auth/session.ts`, `design.md` §5.2 | Session token is a deterministic, non-expiring HMAC of a fixed message keyed by the shared password; contradicts design.md's "short-lived session cookie" language; a leaked cookie is valid indefinitely, revocable only by rotating the password for all users. | tech-lead (design), dev (implement) | OPEN |
| REV-003 | SECURITY | minor | `api/auth/verify-password.ts` | No rate-limiting/lockout on password verification (explicit ux-spec decision) undermines the password gate's stated cost-control rationale (design.md §3) if the password is weak/guessable. Recommend pm re-confirm with user. | pm | OPEN |
| REV-004 | SCOPE-CREEP | minor | `index.html:5` | `maximum-scale=1.0` disables pinch-zoom; not specified in ux-spec/design, accessibility anti-pattern (WCAG 1.4.4). | dev | OPEN |
| REV-005 | TEST-GAP | minor | `tsconfig.json` | `include` list omits `tests/`, so typecheck doesn't cover QA's test files. | dev | OPEN |

---

## Changelog

| Date | Change |
|---|---|
| 2026-07-11 | Initial review log created. INC-1 5-pass audit complete: 0 blockers, 1 major (REV-002), 3 minor (REV-003, REV-004, REV-005). Cleared to proceed to INC-2. |
