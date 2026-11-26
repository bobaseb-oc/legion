---
name: native-subagents-first
description: "In Legion features, start native Legion subagents; Claude Code workers only as an opt-in option"
metadata:
  type: feedback
---

When a Legion feature starts agents (the cockpit's Review/Fix, routines, automations), start native Legion workers (Tools.start). Offer Claude Code workers only as an explicit option, e.g. an "as Claude Code workers" tick that asks Legion to spawn as "claude" (each still waits for the user's yes).

**Why:** Legion's own crew (the orchestrator and its workers; no managers since 2026-11-26) does the work; Claude Code is a fallback tool, not the default path.

**How to apply:** start a worker for single-task agents (one PR, one routine run). Never make Claude Code the default path: the orchestrator spawns one only as "claude", one per coding task, saying why. Related: [[check-a-change]]
