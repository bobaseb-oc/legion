# Tracks page — design spec (RED ZONE DRAFT)

Date: 2026-11-20 · Jira project: PLP · Base: `main` · Tests: `bun run test` only
Status: approved by the user (Option A, with the open-question answers below).

## Intent

Replace the Explain page with a **Tracks** page. One card per track. Each card shows
the observer's summary (what / why / status / watch, Haiku, read-only) on top and the
track's checklist below. The user can steer a track's checklist; the agent cannot undo
the user's items; nothing the observer writes ever reaches an agent.

## Constraints

- A track = one live top-level agent under Legion (`parent === "main"`, `role.$ === "sub"`)
  plus its helpers. Track identity comes from the crew tree, never from the observer.
- Legion has no `todo` tool (Tools.ts:624), so Legion has no track.
- One writer per list. The agent writes `agent.todo` via the `todo` tool. The server
  writes the pin list, only on a user act from a view.
- The observer stays read-only: its output reaches `chat.mem.explain` and views only.
- Claude Code (`cli`) and computer (`hands`) top agents: track shown read-only, edits refused.
- Edits only on live agents. The page key is `tracks`; the terminal keeps `/explain` as an
  alias for one version. The `todo` page (user todos filed by agents) is unchanged.
- RED ZONE: user authority over agents, view-only act gating. The human reviews and merges.

## Success criteria

1. The `track` act from a device socket (`device !== ""`) is refused.
2. An agent's whole-list `todo` call that omits pins leaves every pin in place.
3. An agent can set a pin's status only, by `n`; it can't add, reword, reorder or drop pins.
4. Each accepted edit reaches the owning agent as a fixed-template note; an idle agent
   gets no turn.
5. A stall reminder carries no agent or snapshot text, fires once per stall, only to an
   agent with a live call.
6. A malicious snapshot (PR body or agent words with instructions) changes no agent log.
7. Pins persist across `Memory.load`; caps and rate limits hold.
8. Web and terminal both show and edit tracks; all text is escaped or cleaned.

## Chosen design: Option A — server-owned pin list beside the agent's list

Rejected: B (pins inside `agent.todo` with a server merge — the merge is attack surface,
and `agent.todo` is lost on restart, Tools.ts:1870); C (edits as messages only — no
server enforcement, breaks the "agent cannot undo the user" rule).

### Data model

```ts
// View.ts
export type Mine  = { n: number; text: string; status: Todo["status"]; at: number; since?: number; reminded?: boolean };
export type Track = { pins: Mine[]; next: number };   // next: last n issued, never reused
// Todo gains server-set fields only, stripped from agent input: since?, reminded?
// Explain.ts Card gains `track: string` (a given track name)
// Memory.ts: mem.tracks: Record<string, Track>, saved and load-guarded like `assigned`, file mode 0600
```

| Constant | Value | Meaning |
|---|---|---|
| `PINS` | 10 | pins per track |
| `PIN_TEXT` | 500 | characters per pin |
| `STALL` | 20 min | `doing` with no status change before a reminder |
| `REMINDS` | 3 / hour / agent | reminder cap |
| `EDITS` | 30 / min / chat | user edit rate cap |
| `NOTE_GAP` | 10 s | edit notes to one agent batched |

### Acts and messages

- View → server: `{ $: "track", name, op: "add" | "edit" | "move" | "drop", n?, text?, to? }`
  routed `Chat.act` → `Chat.track(chat, id, device, msg)`. First check: `device !== ""` → refuse
  (same rule and wording style as `Chat.assignment`).
- Refusals: not a live top agent of role `sub`; unknown `n`; empty or over-cap text; `PINS`
  reached; over `EDITS`.
- "edit" of an agent-written item = pin an edited copy; the server tells the agent to drop
  its original once. "drop" of an agent item = the agent is told; no tombstone (it may re-add).
- Server → view: `Chat.state` gains `tracks` (not `pins`: that name is taken by chat pins).
  The `{ $: "explain" }` message is unchanged except `Card.track`.
- Server → agent: a `"note"` via `tools.hooks.push`, fixed template, e.g.
  `[Tracks] The user added pinned item #4: «<user text>».` Batched per `NOTE_GAP`. A working
  agent reads it between tool calls; an idle agent gets it queued, no `Tools.run`, no turn.
- `todo` tool: new optional `pinned: [{ n, status }]` — status only, existing `n` only. Its
  result lists the pins "(pinned by the user)". It strips `by`, `since`, `reminded` from input
  and never writes `mem.tracks`.
- Stall: `Chat.stalls(chat, now)` on the existing server tick (Server.ts:391) →
  `Tools.remind(name, "[Tracks] Item #<n> has been doing for 20 min with no change: mark it done, or say what blocks it.")`
  — number only, live-call agents only, once per stall; a status change clears `reminded`.

### Observer

- The snapshot gives a `Tracks:` list of names plus per-track item **counts**, not item text
  (bounds re-writes; resolves OQ3). `OBSERVE` asks for one card per given name.
- `explain_cards` keeps only cards whose `track` is in the given set. Unmapped track → card
  with empty summary. The checklist renders live from `state`, never from the observer.

### Lifecycle

- Dismissing a top agent prunes its pins. After a restart, pins whose agent is not live
  show read-only ("orphaned") until the user clears them.

## Threats

| Threat | Defence |
|---|---|
| Snapshot injection reaches an agent | No path from cards/snapshot to `hooks.push`/`tell`; templates only; test asserts |
| Agent forges a user edit | Device-socket refusal; no tool writes `mem.tracks`; `todo` strips server fields |
| Agent clobbers pins | Structural: whole-list replace never touches pins; `pinned` sets status only |
| Agent spoofs user authority in text | Authority is server data; `tell` pushes `"user"` kind, never `"note"`, and makes no pin |
| Flood | `PINS`, `PIN_TEXT`, `EDITS`, `NOTE_GAP`, `REMINDS` |

## Files

Explain.ts (prompt, `Card.track`, pure `track_*` helpers, `track_stalls`) · Tools.ts (`todo`
`pinned`, `since`, strip) · Server.ts (`case "track"`, `Chat.track` RED ZONE, `Chat.stalls`,
`state.tracks`, note batching) · Memory.ts (`tracks`) · View.ts (`PAGES` rename, hash regex
~1861, `Track` act, types) · Cockpit.ts / Term.ts / Deck.ts (`/tracks`, `/explain` alias, page
key) · web/src/Pages.ts + main.ts (render, escape, edit form) · web/app.js (rebuild) · README.

## Tests (red first)

- Explain.test.ts: helpers, caps, `n` never reused, move bounds, unknown-track cards dropped,
  `track_stalls` once per stall and reset.
- Tracks.test.ts (child-process server, like Todo.test.ts): every success criterion above,
  including the malicious-snapshot negative case and the queued-note-read-on-next-turn check (OQ10).
- Mutation targets: device refusal, `todo` writing tracks, `by` strip, caps, `reminded` gate,
  live-call gate, template-only text, top-agent check, `EDITS`.

## Resolved open questions

3 counts only · 4 Legion has no track · 5 pins 10 × 500 · 6 prune on dismiss, orphans read-only
· 7 live calls only · 8 cli/hands read-only · 9 no tombstones · 10 red test, not assumption.

## Addendum after steel-man review (user decision, 2026-11-20)

- **Delivery:** one PR (prototype). Commits are ordered by layer so the PR reviews in steps:
  L1 Tracks view + observer mapping (read-only) → L2 pins, `pinned`, view-only `track` act →
  L3 edit notes + stall reminders. Red Zone process still applies: draft, human review and merge.
- **View marks:** pins show "you"; an agent item the user dropped shows "dropped by you" until
  the agent removes it; an edited copy links "edited from #n" to its original.
- **Idle agents:** a pending edit for an idle agent shows "queued, agent idle" until it is read.
- **Reminder spend:** reminders go only to a live call; their tokens bill through the existing
  `pay` path. A test asserts a reminder's tokens are counted against the budget.
