Legion
======

OnCorps' local AI agent: one chat that never ends, run on your own Mac,
through the OnCorps LiteLLM gateway. You talk to the same orchestrator
for days or weeks and it remembers. It hands the work to a crew of
managers and workers that run shell commands, edit repos and drive
Claude Code on your machine, under the same OnCorps guard hooks Claude
Code uses.

**AI agents wrote and reviewed most of this code.** Treat it as an
internal tool, not a product: read it before you trust it.

How it works
------------

- **One chat, a memory tree.** Every message gets a one-line summary,
  and neighbouring lines merge in pairs, again and again, into a binary
  tree. Each call sees the whole chat in at most 128 KB: recent
  messages a line each, older ones under fewer, broader lines. Detail
  fades with age, but nothing is deleted.
- **Zoom.** The agent can open any line into the two it was made from,
  down to the original message, so the past is never thrown away.
- **Built in the background.** A cheaper model (the compactor, Haiku by
  default) writes the summaries as messages arrive. A turn waits for the
  summaries before it, 60 s at most, then goes on with the missing ones
  marked "(not summarized yet)". While it waits, the status says why
  ("compressing earlier messages… (compactor: HTTP 429 …)").
- **A crew, not one agent.** The orchestrator does no hands-on work. It
  spawns managers, managers spawn workers (or Claude Code workers), and
  each agent has a title, repos and a todo list. The web's Crew view and
  the terminal's `/crew` show the tree; questions the orchestrator has
  for you wait in a Questions pane, and what only you can do (approve a
  PR, run a login) waits on the Todo page (`#todo`, the terminal's
  `/todos`), where Done tells the agent that filed it. The Tracks page
  (`#tracks`, `g x`, the terminal's `/tracks`; `#explain` and `/explain`
  still open it for one version) has one card per track: each agent
  Legion started. On top, an observer (config `observer`, Haiku 5.5 by
  default, no tools) says in plain words what the track builds and why.
  It rewrites the cards once the crew, the plan or your PRs change, at
  most every 5 minutes, and answers your questions there, never in the
  chat. It reads only each track's item counts, never the items, and
  nothing it writes reaches an agent. Below is the track's checklist:
  the agent's own items, then your pinned items. You add, edit, move and
  drop pins in a view only (the web, or `/tracks add|edit|move|drop`); a
  device's socket is refused (a Red Zone draft). The agent can't undo
  your pins: its `todo` list never touches them, and it may only set a
  pin's status. Each edit reaches the agent as one fixed-text note per
  10 s; an idle agent gets no turn, and the track shows "queued, agent
  idle" till its next turn reads it. An item `doing` for 20 min with no
  change gets one reminder (its number only), at most 3 an agent an
  hour, and only while the agent is at work. Caps: 10 pins a track, 500
  characters a pin, 30 edits a minute. Claude Code and computer agents'
  tracks are read-only. Dismissing an agent drops its pins; pins of an
  agent gone after a restart stay read-only till you drop them.
  Away from your desk, a private Google Chat space can be a second
  Questions pane (the GChat bridge, off by default; a Red Zone draft):
  each new question, note, todo and super auto decision is posted once
  through the space's incoming webhook, one thread each, so your phone
  rings; your reply in its thread answers it (a question's option by
  number or your words; a todo `done` or `drop`; a decision `undo [what
  instead]` or `keep`), and only yours counts. On with config
  `gchat_space` (`spaces/...`), `gchat_user` (your id, as in
  `~/.unii/users/<id>`: only that chat is bridged; unset, none is) and the
  webhook's URL in the login
  Keychain (service `GCHAT_WEBHOOK_URL`), a key (never logged): the
  server `legion` starts reads it there itself (`UNII_GCHAT_KEYCHAIN=1`,
  set by the launcher), so it is never in the server's environment, which
  any process of yours could read (`ps -wwE`); don't export it. Keep it
  there from the clipboard (copy the URL from the space's Apps &
  integrations, Webhooks):
  `security add-generic-password -U -a "$USER" -s GCHAT_WEBHOOK_URL -w "$(pbpaste)" && pbcopy < /dev/null`.
  Not `-w` alone: its prompt keeps 128 characters, cutting the URL's
  token (Google then answers "Missing or malformed token"). A server run
  by hand (`bun Server.ts`, tests) reads `GCHAT_WEBHOOK_URL` from its
  environment instead. Posts are scrubbed of secret-shaped strings
  (`local/prime/redact.ts`'s shapes) before they leave.
  Reading replies uses your Google sign-in (`legion google-login`; a
  sign-in from before 2026-11-18 lacks `openid`, which says who you are,
  so sign in again or no reply counts): the server reads it once at start (one Keychain prompt; deny it and the
  bridge only posts). Keep `legion device` running while away: if no view
  or device is left, the space is told "Legion stopped listening".
- **Claude Code parity.** Device tools are shell, read, write, edit,
  glob and grep, each passed through the Claude Code PreToolUse and
  PostToolUse hooks in your managed, user and project settings and of
  oc-coding-assistant (so the OnCorps guard blocks here too; a managed
  or oc-coding-assistant hook that crashes or times out refuses the
  call). `!cmd` runs a shell command yourself,
  as Claude Code's `!`: a `!` typed first puts the box in shell mode (a
  `! shell` badge, another color; Backspace over the `!` leaves it), and
  the command runs as you, in Unii's folder on your device (`!@name`: that
  one), past the hooks, the reviewer and Legion's gating, stopped after
  10 minutes; its command and output (30,000 characters at most) join the
  chat as a note Legion reads. Only what speaks for you may send it (the
  web, or `legion` signed in with the terminal's own key), never a
  device's socket, an agent, a routine or the GChat bridge (a Red Zone
  draft). Legion gives a command for you to run in a code block of its
  own: the web's Copy, or the terminal's `/copy` (Ctrl+Y, through your
  terminal's OSC 52), copies it.
  A shell command running (your `!cmd`, or Legion's own; an agent's on
  its page) shows over the input as Claude Code's: the command, who and
  where, its time ticking, its last lines, and "ctrl+b to run in
  background · esc to stop" (the web adds Background and Stop buttons).
  Ctrl+B (`/bg`) sends it to the background: it runs on, and the agent
  that waited on it goes on at once, told its number; agents read and
  stop their own with `shell_output` and `shell_stop`, and Legion is told
  when one ends. The background list (the web's, over the input;
  `/shells`, `/kill <n>` in the terminal) shows each with Stop; your Stop
  of all work ends them all. Only what speaks for you may send one away
  or stop it (the web, or `legion` on its own key; signed in with the
  device key only, the terminal's Ctrl+B sends what runs on it away to a
  file as before); at most 4 a caller and 8 a chat run in the
  background, each stopped 10 minutes after it began, their output kept
  to its head and tail (Red Zone drafts). A device that predates this
  sends no live lines; the rest works as before.
  Permission modes are plan (read-only), auto (a cheap-model reviewer
  checks each change; anything it can't decide comes to you), super
  auto (the default: as auto, and a question of a kind you answered with
  Legion's pick 85% of the time, over 20 answers or more, is decided with
  it, shown on the Questions page to undo; access, Red Zone, money,
  outward and prod merges always ask) and full. Shift+Tab cycles them.
  A call waiting for your yes survives a restart: it is shown again, and
  a yes then lets that exact call (same agent, tool, arguments, device)
  run once, if the agent makes it again within 30 minutes (a Stop, or
  dismissing the agent, takes that yes back). Nothing saved
  on disk counts as a yes. A wait expires as a no after 24 hours, and a
  boss's appeal cut by a restart closes as a no (Red Zone draft).
  Everything that reaches Legion goes through one inbox: your consents,
  your GChat replies, and events a device posts (the `event` act: a note
  or work for Unii, one per source and key, at most 50 waiting). A
  device's event waits until a view is open and reaches Unii fenced as
  untrusted; it can never answer an approval. After a restart nothing
  read back from disk counts as yours: an undelivered event waits for a
  view and arrives fenced, a half-done approval or reply is closed, and
  an event cut three times is dropped with a note (Red Zone draft).
- **A cockpit.** The web has Home (who needs you, stats, agents with an
  estimated cost, activity), an Inbox (review requests, your PRs and
  their CI state, Jira tickets, worktrees to clean up), Routines and a
  team Digest, beside a sidebar of agents by ticket and spaces, and a
  palette (⌘K). A device reads the inbox with your own `gh`, `acli` and
  `git`, read-only, every 5 minutes. Its repos (spaces) are found: git
  repos under `/Volumes/dev/git` and `~/.claude`, and the home repo
  (`UNII_SPACES`, comma-separated folders, changes the roots). Review or Fix on an
  inbox row starts a native Legion agent per PR (Claude Code workers if
  you tick it); nothing is posted to GitHub or Jira. Routines start an
  agent daily, every N hours, or on each new review request.
- **Agents wait and set timers.** Any agent can `wait` up to 10 minutes
  within a call, or set a `timer` (1 minute to a day) and end its turn:
  it is woken with a `[Timer n]` message, Unii by a turn of its own.
  Timers are kept across restarts and checked once a minute. Unii can
  also propose a routine: it is added off, marked "proposed by Unii"
  with its reason, and runs only once you turn it on (web Routines page
  or `/routine on <n>`). Routines change only from a view, never from a
  device's socket.
- **Every window is a view.** The server owns the chat. A browser tab
  or `legion` in a terminal shows it live, and any of them can send a
  message, stop the work or change the model.
- **Pins, a map and a search of your memory.** A message's 📌 keeps it
  whole in every call's view, however old (12 pins, 16 KB, taken from
  the 128 KB; only you can pin, from the web). The Memory page
  (#memory) walks the tree from its roots down to each message, and
  searches the whole chat word for word on the server (no model call,
  50 hits, newest first). It also lists Unii's notes: facts about you and
  your work that Unii keeps across runs (up to 32, 4 KB each, redacted,
  in ~/.unii/users/<id>/notes/). Their index reaches Unii fenced, as
  something Legion wrote, not as instructions, on every call; only Unii
  writes them, and you edit or drop each one on the web.
- **Unii checks its own replies.** A reply that ends asking you something,
  with no question filed in your questions pane, gets one nudge to file
  it with `ask`. If Unii keeps a note named `directives` (its standing
  orders, which Unii writes itself), that note reaches every call whole,
  so a compaction never squashes it, and a checker (`checker` in config,
  Haiku by default, no tools) judges each reply against it. If the
  checker says a directive was skipped, Unii gets one nudge, labelled as
  the checker's and not yours. A nudged turn is never checked again. A
  failed check shows "No directives check" in the chat.
- **PRs and branches carry a Jira key.** An agent's `gh pr create` or
  `gh pr edit` title, and a branch it names in `git push`, must hold a
  ticket key (as `PLP-123`), in every mode. A PR with no `--title` is
  refused too. Ticket-less work is yours: run it as a `!command`.
- **Undo an agent.** Before an agent's first change in a turn, the
  device snapshots each repo it changes under the roots as
  `refs/legion/undo/<agent>/<turn>` (a temporary index: your working
  tree, index and stash are untouched; untracked files in, ignored and
  secret ones out; 20 kept per agent and repo). The Crew card's "Undo
  last turn" puts the files back after asking; the state before is
  kept as `refs/legion/redo/…`, and it refuses if the agent committed
  since. "Open in Claude Code" opens Terminal running `claude` in the
  agent's repo with a brief of its title, todo and last words.
- **While you were away.** Back after 2 h or more, Home opens with one
  card: agents done or failed (and why), routines run, and counts of
  new questions, notes and inbox changes linking to their panes. Got it
  hides it. Your last look is kept per browser.
- **Web fetch.** `fetch` reads a public page as text from the server's
  computer: GET only, no cookies, 80/443, 3 redirects each checked
  again, 2 MB, 15 s. Private, loopback, link-local and metadata
  addresses and local names are refused. Auto mode reviews every fetch
  (a URL can carry data out), plan mode refuses it; `fetches: 0` turns
  it off.

The design is in the header comment of each file. Start with Memory.ts
(the tree and the view), Server.ts (the chat and its turns), Tools.ts
(agents and tools) and AskAI.ts (model calls and the cache).

Run it
------

You need [Bun](https://bun.sh), the gateway's `LITELLM_API_BASE` and
`LITELLM_API_KEY` in your environment, and optionally Docker (for web
search through a local SearXNG). The launcher hands the server the key
on fd 3 (`UNII_ANTHROPIC_KEY_FD=3`), never in its environment, which any
process of yours can read (`ps -wwE`); so no workers then. A server run
by hand (`bun Server.ts`) reads `ANTHROPIC_API_KEY` instead.

    local/legion              # starts the server if needed, opens the chat
    local/legion web          # the web UI, signed in as your terminal
    local/legion stop         # stops the server and SearXNG
    local/legion log          # the server's log (no sign-in link prints there)

The header of local/unii-local.sh lists the rest (device, knowledge,
mcp-login). Symlink it onto your PATH as `legion`. The server only
listens on 127.0.0.1:8788 (the browser and the iOS app) and on
~/.unii/server.sock ($UNII_DIR/server.sock: 0600, in a 0700 dir). The
terminal and `legion device` reach it only over that socket, never over
TCP, so a process that took the port first never gets their session.
A server with `workers` above 0 (the hosted setup) opens no socket, so
devices on that computer can't connect; run local devices against a lone
server.
One server runs per user on a computer, whatever its `$UNII_DIR`: a second
one ends, naming the one that runs (pid, port, dir). `UNII_ANOTHER=1` runs
one beside it on its own dir (the tests do).

Signing in (`legion login`, or `legion` the first time) makes two keys
with the one code the browser asks for. The device key is a file
(~/.unii/<host>/token): jobs, `legion device` and the launchd device run
on it, and since an agent's shell can read it, its acts that are the
user's say (mode, plan, approvals, answers, routines, timers, todos,
pins, notes, decisions) are refused. The terminal key is kept only in the
Keychain (service `legion-terminal-<host>`), read only by legion-key
(below): the full-screen `legion` reads it once as it starts (Touch ID
or your password), and with it those acts work from the terminal. A
terminal signed in before 2026-11-19 has no terminal key and says so:
run `legion login` once. `/logout` ends both keys' sessions and deletes
the Keychain item.

legion-key (local/legion-key/main.swift; draft, awaiting sign-off) is
the one program the terminal key's and the sign-in secret's Keychain
items trust. The launcher builds it with `swiftc` into
~/.unii/bin/legion-key (0700, ad hoc signed, hardened runtime) before
`legion`, `legion login` and `legion web` run, and again only when its
source changes. Before every read it asks for Touch ID (or your login
password), with nothing remembered: once per `legion` start, `legion
login` on a local Legion, and `legion web`. macOS may also ask whether
legion-key may use a key (the first read after a new build): "Always
Allow" there is fine for a build you expect, since it trusts only that
exact build, which still asks for Touch ID each time (see the known
limitation below). Never click "Always Allow" on a
prompt naming `security` for these items: that trusts
/usr/bin/security, which any agent can run to read them unasked. Items
kept before legion-key (by `security`) are read that way once (one
`security` prompt: Allow) and kept by legion-key from then on. With no
`swiftc` the launcher says so loudly (get it with `xcode-select
--install`), and until then approving from the terminal is off and a
local sign-in is refused; nothing falls back to `security`.

A local Legion (no `RESEND_API_KEY`) mails no sign-in link and never
prints one (an agent's shell reads the log, and could start a sign-in
itself, knowing its code). There `legion login` confirms the sign-in
itself, with the code and the sign-in secret: a token kept only in the
Keychain (service `legion-signin-<host>`, read by legion-key after Touch
ID), sent over the server's socket. The server keeps only
its sha256, in ~/.unii/signin-hash ($UNII_DIR, 0600). The first
`legion login` makes and registers it (trust on first use, once: run it
yourself right away); after that a sign-in without it is refused, and so
is registering another. To start over (a new Mac, a lost Keychain item),
delete ~/.unii/signin-hash yourself, then run `legion login`. A browser
signs in there by `legion web`; a server with a mail key mails links as
before. Agents' tools refuse Legion's trust state (cloud.db and its
-wal/-shm, signin-hash, server.log, the token files): no read, grep or
write, and a shell command naming one by its path is refused in every
mode (one naming the dir or the file is reviewed in auto mode). They run
as you, though: a disguised command in full mode can still reach those
files; the reviewer, the hooks and these refusals are the boundary, not
the disk.

The Google grant and the Harvest token sit behind macOS Keychain
prompts (no app is trusted to read them). Allow the Google one when you
start a terminal or `legion device` yourself, and the Harvest one when
you press Submit or an agent reads your timesheet; Deny any other, and
never click Always Allow on those. The terminal key and the sign-in
secret ask for Touch ID through legion-key instead (above). An agent
can't read any of them without a prompt, but it could restart the device
or run legion-key to make one appear at a time you'd expect: if a prompt
or a Touch ID request comes and you didn't just start Legion, Deny it.

    bun run test              # the tests, each file on its own
    bun run web               # rebuilds web/app.js from web/src

Your chat lives in ~/.unii/users/<id>, one JSON line per message
(main/) and per summary (tree/). That is the memory: back it up.

Config
------

`~/.unii/config.json` (optional; the dir is `$UNII_DIR`). Each key can
also be set as `UNII_<KEY>`. The ones that matter here:

- `anthropic_url`: the Claude API origin (local/legion points it at
  the gateway).
- `pick`: what the chat runs on, `vendor:model:effort:speed` (default
  `claude-api:sonnet-5.5:medium:slow`).
- `compactor`: what writes the summaries and reviews auto-mode changes
  (default `claude-api:haiku-5.5:high:slow`).
- `agents`: what sub-agents run on (default: the chat's pick).
- `work`: the agents' working dirs (default ~/.unii/work).
- `rules`: a file appended to every system prompt; local/rules.md
  imports your ~/.claude/CLAUDE.md, ~/.claude/rules/ (`@dir/` loads a
  folder's .md files) and the skills index. Imports resolve from a
  symlinked file's real folder, as Claude Code's do. A repo's own
  CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md and
  .claude/rules/ come with the result of the first call that touches it
  (a read, write, edit, glob or grep path, or a shell's leading `cd`),
  root down to the touched folder, once per agent and again when one
  changes (Rules.ts, Device.device_rules, Tools.instructions).
- `mcp`: a JSON file of MCP servers whose tools the agents get
  (local/mcp.ts makes one; `legion mcp-login atlassian` keeps the
  OAuth grant in the Keychain). It includes `okf-wiki`
  (local/okf-wiki.ts): search and read the OnCorps Knowledge Framework
  wiki, and `record_gap` for what it lacks (~/.unii/okf-gaps.jsonl, never
  sent anywhere), and `okf` (local/okf-mcp.sh): OKF's own read-only
  ontology server, from the checkout of `0.x` that ~/.unii/okf links to (or
  $OKF_CHECKOUT); it rebuilds the internal dataset when the checkout moves.
  Claude Code can use the same one (`claude mcp add okf -s user --
  <uniichat>/local/okf-mcp.sh`); a name Claude Code has, Legion takes from
  it. To trust their lookups (agents cannot: config.json is refused to
  their write and edit), list them in `mcp_reads`, and auto mode skips
  their review and plan mode runs them; record_gap stays reviewed.
- `searches`: 0 turns off the vendor's web search (Bedrock behind
  LiteLLM rejects it); `searxng_url` is the local search instead.
- `after`: a shell command run after each turn.
- `mcp_reads`: exact MCP tool names (`mcp__server__tool`, a list or
  comma-separated) that only read, so auto mode skips reviewing them.
  Every other MCP call is reviewed; a shipped list covers Atlassian,
  Playwright and Chrome DevTools reads (Modes.MCP_READS). A malformed
  entry stops the server.
- `UNII_PROXY=1`: the server sits behind a reverse proxy, so the client's
  address is the last `X-Forwarded-For` entry. Off (the default), the
  header is ignored, since a client reaching the server directly could
  write it. A hosted deploy behind a proxy needs it, or sign-in rate
  limits treat every user as the proxy.

Today's LiteLLM spend shows in the status line when a cost cache is
kept (Cost.ts reads it; it never calls the gateway itself).

Working on Legion with Claude Code: local/memory.dist holds generic
project memories (native subagents first, how the tests run, PRs to
your fork, how a change is checked). Copy them into Claude Code's
memory for your checkout, then fill in your fork's name:

    m=~/.claude/projects/$(pwd | tr / -)/memory
    mkdir -p "$m" && cp -n local/memory.dist/*.md "$m"/

`-n` keeps any memory you already have; merge MEMORY.md by hand if
you have one.

Gaps
----

What is known not to work, or not checked yet:

- **Local sign-in rests on the Keychain.** No SSO, no mail: `legion
  login` proves it is you by the sign-in secret (legion-key's Touch ID).
  Its first registration is trust on first use, and an agent in full mode
  running disguised commands as you can still forge Legion's files.
- **legion-key is built from a file an agent can edit.** Agents run as
  you, so one could change local/legion-key/main.swift (or Term.ts);
  the next start rebuilds it, and its first read of each key then asks
  whether this new build may use it. Always Allow there is safe only
  for a build you expect: if that prompt comes when you didn't just pull
  a change to legion-key, Deny it and check `git diff local/legion-key`.
- **A repo's instruction files steer agents, as they steer Claude
  Code.** Only repos under a device's work dir, home repo, spaces and
  their worktrees count, and secret files are never read. Their
  imports may point anywhere but a secret, as Claude Code's do once you
  approve them, with no prompt here: a clone with a hostile CLAUDE.md in
  a space can tell agents what to do and pull your non-secret files into
  their chat. Keep untrusted clones out of your spaces. A shell call that works in a repo without a leading `cd`
  brings no files (the agent reads them as local/rules.md says).
- **Atlassian OAuth (commit 36e97d8) was merged as a draft.** It is a
  Red Zone change that no one has reviewed yet.
- **Web fetch has a DNS-rebinding window.** Bun's fetch resolves the
  name itself, so a name that turns private only for that lookup gets
  through; the name is resolved again after each fetch and a change is
  refused, and auto mode's reviewer sees every URL.
- **Over budget, summaries are rough.** New lines are a message's first
  sentence, marked "(rough)", with no model call. The compactor tries
  once every 30 minutes or at the next UTC day, and once that works it
  rewrites the rough lines in the background, oldest first.
- **Undo covers writes and edits.** A shell run in its own folder is
  snapshotted there; `cd /repo && sed -i …` from elsewhere is not,
  unless a write or edit in that repo came first in the turn. Claude
  Code workers' changes aren't covered. Pins, search and note edits are
  web only.
- **Cockpit limits.** Jira tickets need `acli jira auth login` on the
  device. Agent cost on Home is an estimate at list price, not the
  gateway's bill; the 7-day spend sums the daily cost caches present.
  Routines run while the server runs: a chat with a routine on by the
  clock stays open with no tab or terminal, and one missed while the
  Mac slept runs once on waking. `UNII_KEY_HELPER=<absolute path to a
  program that prints the gateway key> legion server --install` keeps
  the server running at login (`--uninstall` removes it). Google
  (calendar, transcripts, Gmail, Chat, read-only) needs `legion
  google-login` on the device, and Chat needs a Chat app configured in
  the Google Cloud project; agents read it with the `google` tool. The
  inbox is read by a running terminal or `legion device` (`legion device
  --install` keeps one running at login). Harvest needs `legion
  harvest-login`; agents only draft entries (the Timesheet page), and
  only your Submit posts them. The Files page shows what is under the
  device's work dir, home repo, spaces and their worktrees
  (`<repo>-worktrees/<slug>`): workspaces as trees, ⌘P to find a file,
  ⌘⇧F to search text, a path's `:line` opened at it, git's views and an
  agent's **changes** since the default branch (a fork's `upstream`
  first). Secrets (`.env`, keys) are listed but never shown: **Open in
  editor** opens them, and any file, in VS Code (else your default
  editor). **Edit** saves a shown file from the browser, only if it is
  unchanged since shown, never a secret's or Claude Code's or Legion's
  settings. The status line shows the gateway's daily budget for your
  key and "AI service busy" after a busy answer in the last 5 minutes.
- **Tracks edit notes wait up to 10 s in server memory.** If the server
  restarts or the chat moves process in that window, the pin is kept but
  the agent gets no note (it still sees the pin in its `todo` result).
- **The directives check is advice from a model.** Unii writes its own
  directives, so text an agent read can end up in them, and the checker
  can misjudge. Its nudge only names what was skipped and orders
  nothing. A turn whose chat moves process while the checker runs gets
  no check.
- **`gh stack submit` is not key-checked.** It pushes branches and opens
  PRs with titles from commits, which the key gate does not read.
- **Not checked live yet:** the directives checker on the real gateway,
  recall over the imported history, a turn
  with the gateway down (the 60 s go-ahead and the shown reason), the
  auto-mode reviewer on the real gateway, sub-agents getting their own
  worktrees when their edits could collide.
- **Three tests fail** (`link_ask` and two `logs` tests) and have done
  so since before the OnCorps work. `tsc` reports only missing Bun type
  definitions.
- **Upstream names stay in the data and code.** ~/.unii, `UNII_*`
  settings, the package name `uniichat`, the AI's own name "Unii" in its
  prompt, and the `unii` command (an alias of `legion`).
- **ios/ isn't built or used.** Phones are off by default and the app
  still points at upstream's hosted service.
- Upstream's hosted-service parts are still in the code but not used
  here: billing (Billing.ts), emailed sign-in links (Resend), multiple
  worker processes, iOS push and the OpenAI vendor.

Origin
------

Legion is a fork of [uniichat](https://github.com/VictorTaelin/uniichat)
by Higher Order Company, used under the Apache License 2.0. The OnCorps
changes, on top of upstream's main:

- runs on the LiteLLM gateway, loopback-only, with no telemetry,
  installer or self-update;
- local web search (SearXNG), MCP tools with Keychain OAuth, live rules
  and the skills index, import of redacted Claude Code and Codex history;
- the agent hierarchy (orchestrator, managers, workers, Claude Code
  workers), the Crew view, agent labels and todo lists, the questions
  backlog;
- Claude Code hooks on device tools, glob and grep, `!cmd`, plan, auto
  and full permission modes, notifications with their own sound, and
  the web status line;
- renamed UniiChat to Legion.

`git log` has the details; tasks/todo.md has the plan and proof of each
step.

License
-------

Apache-2.0 (LICENSE). Copyright 2026 Higher Order Company; OnCorps
changes as described in Origin.
