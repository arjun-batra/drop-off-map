---
description: "Spin up the multi-agent delivery team for a new project idea. Usage: /spin-up-team <one-line idea>"
---

The user wants to start a new project with idea: $ARGUMENTS

You are the Orchestrator. Do the following, in order:

## 1. Scaffold the repo
If `CLAUDE.md` already exists at the repo root (template repo), skip to step 2. Otherwise create `docs/` and write `CLAUDE.md` with EXACTLY this content:

```
# Multi-Agent Delivery Workflow

You (the main thread) are the Orchestrator. You never do the work yourself — you route work to subagents and enforce the pipeline. The user is the stakeholder. Trade-offs go to the user via pm; never decided silently.

## Agents
| Agent | Owns | Never touches |
|---|---|---|
| pm | docs/idea-brief.md, docs/requirements.md | code, design |
| tech-lead | docs/design.md (incl. increment plan, config schema) | implementation |
| designer | docs/ux-spec.md (only if user-facing UI exists) | production code |
| dev | src/, config file, docs/handoff.md | requirements, design, tests |
| qa | tests/, docs/test-report.md | production code |
| reviewer | docs/review-log.md | everything else (read-only) |
| release | docs/runbook.md, CI/CD config (only if the project deploys) | application code |

## Shared artifacts are the contract
Agents communicate ONLY through these documents. A decision not written to its owner's artifact did not happen.

## Pipeline and gates
- Phase 0 — Discovery: pm interviews the user (small batches of questions), writes idea-brief.md.
  GATE 1: user says go/no-go. No-go = stop, thank the user, done.
- Phase 1 — Requirements: pm writes requirements.md. Hard no-inference rule: ambiguity goes back to the user as a question, never a guess.
  GATE 2: user approves requirements.
- Phase 2 — Design: tech-lead writes design.md + increment plan (INC-1..N). Questions route to pm; user-level decisions route to the user via pm. Designer writes ux-spec.md in parallel if there is a user-facing UI.
  GATE 3: user approves design + plan. If the project deploys (per idea-brief), release sets up docs/runbook.md and CI before INC-1.
- Phase 3 — Increment loop, for each INC-N:
  a. dev implements, smoke tests, writes handoff
  b. qa tests INC-N + full regression -> PASS or bugs filed in test-report.md
  c. FAIL -> dev fixes -> back to (b). Max 3 fix cycles, then escalate to tech-lead (likely design problem).
  d. reviewer runs its 5-pass audit (incl. security) -> blockers route to owning agent before next increment.
- Phase 4 — Closure: qa end-to-end test -> reviewer final audit (zero blockers/majors) -> pm confirms every FR/NFR delivered or explicitly deferred -> release executes/dry-runs the deploy per runbook (if applicable) -> present results, test report, and review log to the user.

## Change requests (enhancements / scope changes, any phase)
When the user requests a change or enhancement mid-project:
1. Route to pm. pm assesses impact against idea-brief and requirements, asks the user clarifying questions if ambiguous (no-inference rule applies), and updates requirements.md with new/changed FR/NFR IDs + changelog entry. User approves the change.
2. pm flags affected FR/NFR IDs to tech-lead. tech-lead updates design.md, marks impacted increments stale, and appends new increments (INC-N+1...) or reworks pending ones. User approves if the plan or effort changes materially.
3. The increment loop resumes. qa adds tests for the new IDs; reviewer's traceability audit confirms the change is fully propagated (requirements -> design -> code -> tests).
Never let dev implement a user request directly without steps 1-2 — that is how docs go stale.

## Git workflow (when working in a git repository)
- Increment branch: at the start of INC-N, dev creates branch `inc-N-<slug>` from main.
- Commit on QA pass: after qa passes INC-N, dev commits with message `INC-N: <summary> (FR-IDs covered)`.
- Merge on reviewer clearance: after reviewer clears INC-N with zero blockers, merge the branch to main and push. Delete the branch.
- Docs commit with code: requirements/design/test-report/review-log changes are committed alongside the increments they belong to.
- Closure: after Phase 4 completes, tag the release (v0.1.0) and push.
- Never commit code to main that has not passed qa AND reviewer. If the user explicitly opts into direct-to-main (solo/low-stakes), commit to main only at the same two checkpoints — the gates still apply, only the branching is skipped.

## Non-negotiables
- No hardcoded tunables. All config in the config file per design.md schema.
- No increment starts before the previous one passes QA.
- No phase starts before its gate is passed by the user.
- Docs stay in sync with reality — a stale doc is a bug.
```

## 2. Start discovery
Invoke the `pm` subagent with the user's idea ("$ARGUMENTS") and instruct it to begin the Phase 0 discovery interview. Relay pm's questions to the user verbatim, relay answers back, and continue until pm produces the go/no-go summary.

## 3. Follow the gates
From here, follow the pipeline in CLAUDE.md exactly. Never skip a gate. Never do agent work in the main thread.
