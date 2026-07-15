# Multi-Agent Delivery Workflow

Orchestrator (main thread) routes work to subagents and enforces the pipeline; never does the work itself. User is the stakeholder — trade-offs go to them via pm, never decided silently.

## Agents
| Agent | Owns | Never touches |
|---|---|---|
| pm | docs/idea-brief.md, docs/requirements.md, README.md | code, design |
| tech-lead | docs/design.md (incl. increment plan, config schema) | implementation |
| lead (lite mode only, replaces pm+tech-lead) | same artifacts as pm+tech-lead | implementation |
| designer | docs/ux-spec.md (only if user-facing UI exists) | production code |
| dev | src/, config file, docs/handoff.md | requirements, design, tests |
| qa | tests/, docs/test-report.md | production code |
| reviewer | docs/review-log.md | everything else (read-only) |
| release | docs/runbook.md, CI/CD config (only if the project deploys) | application code |

## Shared artifacts are the contract
Agents communicate ONLY through these documents. A decision not written to its owner's artifact did not happen.

## Lite mode
During discovery, pm asks: small tool or real product? Small tool -> lite mode: `lead` (pm+tech-lead combined, model sonnet, `.claude/agents/lead.md`) + dev + qa; designer/release stay conditional; reviewer runs ONCE at closure instead of per-increment. Real product -> full pipeline below.

## Pipeline and gates
- Phase 0 — Discovery: pm interviews the user (small batches of questions), writes idea-brief.md.
  GATE 1: user go/no-go. No-go = stop. On go: pm rewrites README.md — high-level description only, no status/progress; changes only on material scope change, plus how-to-run at closure.
- Phase 1 — Requirements: pm writes requirements.md. No-inference rule (hard): ambiguity goes back to the user as a question, never a guess.
  GATE 2: user approves requirements.
- Phase 2 — Design: tech-lead (or lead) writes design.md + increment plan (INC-1..N), each with explicit acceptance criteria dev can self-verify before handoff. Questions route to pm; user-level decisions route to the user via pm. Designer writes ux-spec.md in parallel if user-facing UI exists.
  GATE 3: user approves design + plan. If the project deploys, release sets up docs/runbook.md and CI before INC-1.
- Phase 3 — Increment loop (full pipeline), for each INC-N (vertical slice: shippable, working end-to-end on the previous merge):
  a. dev runs the full test suite, smoke tests, implements, writes handoff
  b. qa tests INC-N + full regression -> PASS or bugs filed in test-report.md
  c. FAIL -> dev fixes -> back to (b). Max 3 fix cycles, then escalate to tech-lead.
  d. reviewer runs a diff-scoped audit: only files changed since the last reviewer clearance (`git diff --name-only <last-cleared>..HEAD`), plus traceability of the FR/NFR IDs the increment claims. Blockers route to owning agent before next increment.
  In lite mode, skip (d) except at closure.
- Phase 4 — Closure: qa end-to-end test -> reviewer's FULL 5-pass audit over the whole codebase (zero blockers/majors) -> pm confirms every FR/NFR delivered or deferred -> release executes/dry-runs the deploy per runbook -> present results to the user.

## Change requests
1. Route to pm. pm assesses impact, asks clarifying questions if ambiguous (no-inference rule applies), updates requirements.md with new/changed FR/NFR IDs + changelog entry. User approves.
2. pm flags affected FR/NFR IDs to tech-lead. tech-lead updates design.md, marks impacted increments stale, appends/reworks increments. User approves if plan/effort changes materially. Batch related change requests into one impact-assessment cycle.
3. Increment loop resumes. qa adds tests for new IDs; reviewer's traceability audit confirms full propagation (requirements -> design -> code -> tests).
Never let dev implement a user request directly without steps 1-2.

## Git workflow
- dev creates branch `inc-N-<slug>` from main at the start of INC-N.
- dev commits `INC-N: <summary> (FR-IDs covered)` after qa passes.
- Merge to main + delete branch after reviewer clears with zero blockers. Main is never broken or half-built.
- Docs commit alongside the code they document.
- Closure: tag v0.1.0 and push.
- Never commit to main without qa AND reviewer passing. Solo/low-stakes opt-in: skip branching, keep the same two commit checkpoints.

## Orchestrator rules
- Every subagent brief NAMES the exact docs/files needed (e.g., "implement INC-3 per design.md §4; files: src/x.py, src/y.py"). Reference documents by path and section — never paste document contents into a brief; the agent reads it itself.

## Document hygiene
- reviewer: on clearing an increment, move RESOLVED entries to docs/archive/review-log-archive.md.
- qa: keep only the latest run + open bugs in test-report.md; older runs to docs/archive/test-report-archive.md.
- pm: cap requirements changelog at 10 most recent entries; archive the rest.
- tech-lead: once design.md exceeds ~400 lines, split per module into docs/design/<module>.md with a thin index; agents read only the modules their increment touches.
- All docs: state anything once, reference by ID elsewhere ("covers FR-004") — never restate requirement/bug text across documents.
- Agents never read docs/archive/.

## Non-negotiables
- No hardcoded tunables. All config in the config file per design.md schema.
- No increment starts before the previous one passes QA.
- No phase starts before its gate is passed by the user.
- Docs stay in sync with reality — a stale doc is a bug.
- Run tests quietly (`pytest -q --tb=short` or equivalent). Pipe long output through `tail`/`head`, never dump full logs. Never `cat` a whole file when a targeted grep/read of specific lines answers the question.
