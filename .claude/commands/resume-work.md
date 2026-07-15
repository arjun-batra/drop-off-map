---
description: "Resume the multi-agent delivery pipeline in a fresh session. Reads docs/ to reconstruct state and continues from the exact point work stopped. Usage: /resume-work"
---

The user wants to resume work on this project in a fresh session. You are the Orchestrator. The documents are the memory — reconstruct state from them, never from assumptions.

## 1. Reconstruct state (read, don't guess)
Read in this order and note what exists:
- CLAUDE.md (the workflow you must follow)
- docs/idea-brief.md — does it exist? Was go decided?
- docs/requirements.md — exists? Approved (check changelog)? Any FR/NFR marked deferred?
- docs/design.md — exists? Approved? What is the increment plan (INC-1..N)?
- docs/handoff.md — last increment dev completed
- docs/test-report.md — last QA verdict; any open BUG-NNN?
- docs/review-log.md — any open blockers/majors? Any ACCEPTED-DEBT?
- docs/runbook.md — exists? (release agent active)
- `git log --oneline -15` — verify the docs match reality (last INC merged, open branches via `git branch -a`)

## 2. Determine the resume point
- No idea-brief -> project never started: suggest /spin-up-team.
- Brief but no approved requirements -> resume Phase 1 (pm).
- Requirements approved but no approved design -> resume Phase 2 (tech-lead).
- Design approved -> find the first increment that is NOT merged-and-cleared: open bugs -> dev fixes; passed QA but no reviewer clearance -> reviewer; cleared but unmerged branch -> merge per git workflow; otherwise -> dev starts the next increment.
- All increments done -> resume Phase 4 closure steps not yet completed.

## 3. Confirm before acting
Present a 5-line status summary to the user: phase, last completed increment, open bugs/blockers, and the exact next action you intend to take. Wait for the user's confirmation, then continue the pipeline per CLAUDE.md. If the docs contradict the git history, STOP and flag the discrepancy to the user instead of picking a side — a stale doc is a bug that must be fixed first (route to its owning agent).
