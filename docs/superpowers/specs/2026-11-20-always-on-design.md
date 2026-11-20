# Always-on gaps: durable approvals, memory, inbox, outbox — design

Status: approved by the user 2026-11-20 (Option A). RED ZONE: L1 and the L3 trust classes.
Base: stacks on `feat/risk-reviewer` (6e150b5). Ships as one epic, four tickets, one `gh stack`:
L1 → L3 → L4, L2 independent. Source article: claude.com/resources/articles/building-always-on-agents.
Open questions: `work-tasks/2026-11-20/open-questions.md` rows 16–27 (all resolved).

## Problem

Legion's waits and dedup live in process memory or are spread per source:

- Consents wait in `tools.consents` (Tools.ts:185, `Tools.ask_user` Tools.ts:812) as a held Promise.
- Appeals wait in `tools.appeals` (Tools.ts:186, `Tools.appeal` Tools.ts:753, `APPEAL.ms` 10 min Tools.ts:747).
- Dedup is per source: GChat `posted`/`acted` (Gchat.ts), review routines' `seen` (Server.ts `Chat.automate`).
- Memory is the compacted transcript (Memory.ts tree), pins, and the global `local/rules.md` (`Tools.rules` Tools.ts:564).
- GChat gets every open question, note, todo and decision once (`Gchat.gchat_items`); nothing paces it.

A restart drops every pending approval. Notes about the user fade with transcript age. There is
no single inbox and no outbox policy.

## Patterns reused (do not replace)

- `mem.questions`: persisted in view.json; the answer returns as a message that starts a turn (Tools.ts:1624, Server.ts:1755 `Chat.reply`).
- `mem.work` + `Chat.resume`/`Chat.wake`: after a restart each cut agent is told "go on" (Server.ts:1072, :1084).
- `SAYS` gate (Server.ts:257): device acts that speak for the user (`consent`, `approve`, `answer`, `mode`, `plan`) are refused.
- `Memory.save` (Memory.ts:413, write `.new` then rename) and load guards like `Memory.routines_read` (Memory.ts:345).
- `/api/act` (Server.ts:3084): authenticated, rate-limited (`Main.spend`), attributes browser vs device (`Cloud.speaks`).

## Decision: Option A — ledgers in view.json; disk never says yes

Three capped lists in view.json, each with a load guard that drops malformed entries:
`pending` (approvals), `events` (inbox), `outbox` (delivery). One deterministic drain per chat runs
on `Chat.ticked` (60 s) and on each push. The live Promise stays the fast path while the process
lives; the persisted record only re-shows the request after a restart.

**Core invariant (RED ZONE, ADR 1): nothing read from disk can authorize anything.** A record read
at load only produces a request shown to the user again. Only a live user act (through the existing
`consent` act, in `SAYS`) creates an in-memory one-shot grant bound to
`fp = sha256(who, tool, canonical args incl. device)`, with an expiry. The agent is told to re-issue
the call. `Tools.review` (Tools.ts:654) consumes the grant and skips only the reviewer; `Tools.moded`,
`Hooks.pre` and the device guards still run (Tools.ts:888–906). Agents run as the user and can write
view.json from a shell, so a forged record must never become a yes.

Rejected:
- **B, harden each source in place**: about 1/3 the code, but no crash-retry, no batching, N dedup schemes; agents still cannot keep notes.
- **C, append-only `events.jsonl`**: a second persistence idiom with replay, compaction and torn lines; approval and event state no longer change in one atomic write.
- **SQLite table**: `bun:sqlite` exists (Disk.ts:11, Cloud.ts:19) but the user ruled out a new database.

## Data model (view.json additions; all capped; malformed entries dropped at load)

```ts
// L1: an approval waiting (re-shown after a restart; never authorizes)
type Pending = { id: number; kind: "consent" | "appeal"; who: string; boss?: string; tool: string;
  what: string; reason?: string; fp: string /* sha256(who,tool,args) */; made: number; until: number;
  state: "open" | "yes" | "no" | "cut" | "expired" };
// L3: an inbox event
type Event = { id: number; src: "view" | "terminal" | "gchat" | "device" | "routine" | "timer";
  key: string /* src-namespaced dedup key */; kind: "approval" | "reply" | "notify" | "work";
  to: string /* "main" or an agent */; body: string /* capped; untrusted unless src is a user origin */;
  ref?: number; at: number; tries: number; state: "new" | "taken" | "done" | "parked" | "failed" };
// L4: something to deliver; the "reported" record once sent
type Out = { id: number; key: string; kind: "approval" | "question" | "outcome" | "note" | "todo" | "decision";
  text: string; made: number; must: boolean; state: "queued" | "sent" | "dropped"; via?: "gchat"; sent?: number };
// view.json: pending?, pended?, events?, evented?, outbox?, outed?, pace?: "quiet" | "digest" | "all"
// memory only: grants: Map<fp, { who; until; used: false }>; live resolvers by Pending.id
```

Event status machine: `new → taken → done`. At load, `taken` returns to `new` with `tries + 1`;
after 3 tries it becomes `failed` with a note. Exception: an approval event found `new` or `taken`
at load becomes `done` and its request is re-shown. Disk never says yes.

## Layers

### L1 — Durable approvals (RED ZONE R4)
- Persist each consent and appeal as a `Pending` record when it starts; close it when answered.
- At load: an open consent within `until` is re-shown (questions pane, GChat as `must`); past `until` it becomes `expired` = no.
- Consent expiry: 24 h (row 22). An appeal cut by a restart closes as "no" at load (row 21); the sub-agent re-issues and is re-reviewed.
- A live yes after restart creates a one-shot grant (fp-bound, expiring, memory only); the agent is told to re-issue.
- Changed args → different fp → the user is asked again (fail closed).

### L2 — Memory beyond the transcript (independent)
- Notes index (≤ ~2 KB, loaded each run for Unii) plus note files (≤ ~4 KB each, mode 0600) under `UNII_DIR/users/<id>/notes/`; on-demand `notes` tool reads details.
- Only Unii writes notes (row 26). Notes are fenced as Legion-written, not instructions. A page lists them; the user can edit or drop each.
- Names match an allowlisted slug regex (no traversal). Text is redacted before writing (`local/prime/redact.ts`).
- No new instructions file (row 27): `Tools.rules` already loads `local/rules.md` each call.
- Index format follows Claude Code's MEMORY.md (see `local/memory.dist`) so import/export stays cheap (ADR 3).
- Agent todos and task progress: out of scope, owned by PLP-2895 Tracks (row 18).

### L3 — Durable event inbox (trust classes RED ZONE, ADR 2)
- New producers first: approval answers, GChat replies (`Chat.bridged`, Server.ts:2410), and a new `$: "event"` act through the existing `/api/act`. No new listener.
- Timers and routines unchanged (already match the article); they may become producers later.
- Source-key dedup; batching of pending events into one turn; handlers idempotent by `Event.key`.
- Device-origin events (reachable from an agent's shell) can never be approvals and never start a turn with no view open: they are `parked` until a view is open (row 25). R4 is not widened.
- Untrusted bodies are wrapped with `Google.fence` on delivery. Flooding limited by `Main.spend` and list caps.
- If timers ever become producers, persist `tools.rung` (Tools.ts:187) first, or a restart widens R4.

### L4 — Outbox pacing
- A policy in front of `Gchat.gchat_items`. Default `quiet` + a 30 min digest (row 24); `all` keeps today's behavior.
- Approvals (`must`) always go out at once; questions go out at once; notes, todos and decisions go into the digest.
- The `outbox` list is the "reported" record (row 23): what was already told the user, so it is never repeated.
- Keep `redact` on everything leaving the Mac; Notify.ts control-char cleaning stays.

## Threats

| Layer | Threat | Mitigation |
|---|---|---|
| L1 | Replay of an old yes | grants one-shot, fp-bound, expiring, memory only |
| L1 | Device forges a yes | `consent` stays in `SAYS` |
| L1 | Forged view.json record | records never authorize; only re-show |
| L1 | Stale yes, changed context | TTL; any arg change changes fp |
| L2 | Persistent prompt injection via notes | Unii-only writes, fenced, user-visible page with drop |
| L2 | Secrets / traversal / bloat | redact; slug allowlist; size caps; 0600 |
| L3 | Forged events from agent shell | device src never approves, parked with no view |
| L3 | Untrusted content | `Google.fence` |
| L3 | Duplicate side effects on retry | idempotent handlers by `Event.key` |
| L4 | Pacing hides an approval | `must` bypasses pacing |
| L4 | Data leaving the Mac | `redact` kept |

## ADR candidates
1. Disk never authorizes; grants bound by call fingerprint (L1, RED ZONE).
2. Event record shape and source-trust classes (which `src` may start work) (L3, RED ZONE).
3. Notes store format and location (L2).
4. Outbox default policy (L4).

## Assumptions
- Must: agents re-issue a call with the same args when told (untested; a miss only re-asks). Restarts are local stop-start (`Tools.give`/`Moved` carry neither consents nor appeals). view.json stays small enough to rewrite whole with caps.
- Should: GChat replies stay the only user-origin channel from off the Mac. A 60 s tick plus drain-on-push is fast enough.
- Might: 30 min is the right digest period. Only Unii needs the notes index.

## Not doing
New database or `bun:sqlite` table; changes to timers/routines; public webhook; agent todos (PLP-2895);
a new instructions file; multi-worker or chat-move support for the new lists; model-decided send/no-send.

## Success criteria
1. A consent pending at restart is shown again after restart; answering yes lets the re-issued identical call run once; a second identical call asks again.
2. A forged `pending` record with `state: "yes"` in view.json authorizes nothing.
3. A consent older than 24 h, or an appeal open at restart, is a "no".
4. A duplicate event key is stored once; a `taken` event at load is retried, then `failed` after 3 tries.
5. A device-origin event with no view open is `parked` and starts no turn; it never resolves an approval.
6. Unii's notes index loads each run, fenced; a note name with `../` is refused; secrets are redacted.
7. With `quiet`, an approval posts to GChat at once; a note posts only in the digest; nothing posts twice.
8. Each layer's tests fail if its rule is removed (mutation-checked for L1 and L3).
