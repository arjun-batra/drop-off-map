---
description: "Adopt the multi-agent delivery team into an EXISTING project: copies workflow files from the template repo, then reverse-documents the codebase. Usage: /adopt-team"
---

The user wants to adopt the multi-agent delivery workflow into this existing project. You are the Orchestrator. Do the following, in order:

## 1. Copy workflow files from the template repo
Template: https://github.com/arjun-batra/delivery-team-template

- Clone it shallow to a temp dir: `git clone --depth 1 https://github.com/arjun-batra/delivery-team-template /tmp/delivery-team-template` (use `gh repo clone` if plain git auth fails).
- Copy into the current repo: `.claude/agents/`, `.claude/commands/`, `.claude/settings.json`, and `CLAUDE.md`.
- Do NOT overwrite this repo's README.md or anything in docs/ if they exist. Create `docs/` if missing.
- Delete the temp clone.
- Commit: "Adopt multi-agent delivery workflow".
- Tell the user: if this session doesn't recognize the new agents, restart the session once to load them.

## 2. Adoption pass — reverse-document the existing code (BUILD NOTHING)
This is an existing project: skip Gates 1-3. Do not implement features or refactor. Run:

1. **pm**: read the codebase, then interview the user — "here is what the code appears to do; is that intended? what is the actual purpose and scope?" Write docs/idea-brief.md and docs/requirements.md (FR/NFR IDs) describing the system as it SHOULD be. Flag drift both ways: behavior the user never wanted, and wanted behavior that is missing. If README.md is template boilerplate or missing, rewrite it as a high-level project description per pm rules.
2. **tech-lead**: write docs/design.md AS-BUILT — actual architecture, module boundaries, and config surface as they exist today, plus an increment plan ONLY for gaps pm flagged (vertical-slice rule applies).
3. **qa**: establish a baseline regression suite — map existing tests to FR IDs, add smoke/e2e coverage for untested critical paths. No production code changes.
4. **reviewer**: run the full 5-pass audit against the fresh docs.

## 3. Debt triage (with the user)
The first audit on an existing codebase will be long. Route it as:
- [SECURITY] blockers (e.g., committed secrets): fix immediately via dev.
- Everything else: present to the user in one summary; the user decides fix-now vs. accepted debt. Mark accepted items "ACCEPTED-DEBT" with rationale in docs/review-log.md. Do NOT start an unprompted refactor campaign.

## 4. Done
Commit the docs ("Adoption pass: reverse-engineered requirements, as-built design, baseline tests, audit"). From here the repo follows CLAUDE.md exactly — change requests, gates, and vertical-slice increments all apply to future work.
