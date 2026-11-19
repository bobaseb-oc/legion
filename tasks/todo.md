# Legion (OnCorps): plans and proof

Plan: ~/.claude/plans/can-you-make-me-idempotent-waterfall.md

## Patches (branch local/litellm)
- [x] Tests first: `Local.test.ts` (anthropic_url config, Term default URL, update refused)
- [x] `Config.ts`: `anthropic_url` key (UNII_ANTHROPIC_URL), default https://api.anthropic.com
- [x] `Anthropic.ts`: messages and count_tokens URLs from `ANTHROPIC_URL`
- [x] `Term.ts`: default server http://127.0.0.1:8788; `update` refuses
- [x] `bun run test` passes; new tests fail with the patches reverted

- [x] `searches` config (UNII_SEARCHES=0): Bedrock behind LiteLLM rejects web_search_20260318

- [x] Hard block: loopback-only server, telemetry removed, installer refused, guard test
- [x] `search` tool: Search.ts on a local SearXNG (Docker, pinned digest, 127.0.0.1:8888)

## Run locally
- [x] Smoke test: LiteLLM /v1/messages + /v1/messages/count_tokens with x-api-key (status only)
- [x] `local/unii-local.sh` wrapper (serve, stop, default: start + terminal)
- [x] Alias in ~/.zshrc
- [ ] Server starts, sign-in, "hi" answered by Opus 5.5

- [x] Live rules: `@`-imports in `rules`; local/rules.md imports ~/.claude/CLAUDE.md + repo-file instruction
- [x] Skills index (local/skills.ts → ~/.unii/skills.md, 66 skills) imported by the rules
- [x] Rules: subagents get a git worktree only when their edits could collide (local/rules.md "Parallel work in git repos")
- [x] `stop` tool for the main agent (a `tell` "STOP" only reads between tool calls, so 3 hung agents could not be ended)
  - [x] Tests first (Tools.test.ts): stops the named, says which were not at work, refused to a subagent, listed for main only
  - [x] Tools.ts: `stop` spec in BOSS, `case "stop"` → Tools.stop; suite passes; tests fail with it reverted
  - [x] Proof: 3/3 Tools tests, suite 117/117; guard or stop call removed each fails a test
  - [ ] User: restart the server (`unii stop`, then `unii`) to load it
- [ ] Live check: two subagents editing one throwaway repo → two worktrees, main checkout untouched; one alone → no worktree
- [ ] MCP client, browsers, LSP: see "MCP, browsers, LSP" below
- [ ] Restart server after the import (loads live rules + skills)

## Prime the memory tree
- [x] `local/prime/collect.ts` → manifest.txt (user review)
- [x] `local/prime/redact.ts` + tests → ~/.unii-prime (user check-in)
- [x] `local/prime/export.ts` → ~/.unii-prime/context.json (587 chats)
- [x] `UNII_IMPORT_DIRS`: /import reads only the redacted copy (not ~/.claude, ~/.codex)
- [x] Local estimate: 763 sessions, 9,404 msgs, 10.2 MB ≈ $23.44
- [x] `/import` estimate → user go-ahead → import (running, started by the user; includes instruction files)
- [ ] Recall check

## MCP, browsers, LSP
Plan: ~/.claude/plans/can-you-make-me-idempotent-waterfall.md (check in with the user after each phase)
1. `Mcp.ts` → verify: `bun test Mcp.test.ts`; each test fails with its feature reverted
   - [x] Tests first: fake HTTP server (JSON, SSE), fake stdio server
   - [x] Paging, names (64-char cap, hash suffix, unique), schema cleanup
   - [x] Errors: won't start, missing ${VAR}, timeout, isError, bad JSON; one line, no secret
   - [x] Children: own process groups, killed by `Mcp.end()`; pid-file sweep (start time checked)
   - [x] Proof: 10/10 pass, full suite 72/72; 15 mutations, each fails ≥1 test; no leftover processes
   - Note: tests need `ps` and local ports, so they run outside the Claude Code sandbox
2. Wiring and browsers
   - [x] `local/mcp.ts` → ~/.unii/mcp.json: placeholders + paths into ~/.claude.json (user: read key from json, no Keychain)
   - [x] `Mcp.load`: secrets read at connect, never in env; children get PATH/HOME/locale only
   - [x] Tools: main + subagents get mcp__*, hands don't; Server: per-worker pid sweep, end() on exit
   - [x] claude-mem excluded (shared EXCLUDE); rules line; wrapper `mcp_make`; README `mcp` key
   - [x] local/tools lockfile (26 pkgs, integrity, no scripts), `npm ci --ignore-scripts` (user approved)
   - [x] Flags checked: Playwright origins need `:*` for any port; chrome-devtools telemetry + CrUX off, URL allow-list
   - [x] Live: context7 answers; Playwright page + screenshot image, example.com blocked; chrome-devtools console read, example.com blocked; 0 files in default Chrome profile; 0 processes left; 0 secret hits in mcp.json
   - [x] Proof: 80/80 tests; 4 new mutations each fail a test
   - [ ] User: `unii stop` then `unii` (restart loads MCP); then 0 secret hits in server.log
3. `Lsp.ts` and the `lsp` tool → verify: `bun test Lsp.test.ts`; live on this repo (TS) and a Python repo
   - [x] TS 7 has no tsserver.js, so typescript-language-server can't use it: use `tsc --lsp --stdio` (tsgo), dropped typescript-language-server (lock 26 → 25)
   - [x] Tests first: fake LSP server (split frames, multibyte), each operation, push and pull diagnostics, didChange on mtime, server requests answered, root detection, bad input
   - [x] `Lsp.ts`: one server per (root, language), idle close, children via `Mcp.child`/`Mcp.peer` (shared JSON-RPC, moved out of `Mcp.stdio`)
   - [x] Wiring: `lsp` section in mcp.json (local/mcp.ts), `lsp` tool for main + subagents
   - [x] Bug found by a flaky test: the idle timer could close a server mid-request → `busy` count, test with idle < request
   - [x] Bug found live: pyright 1.1.408 hangs after initialize if the client declares `workspace.workspaceFolders` → dropped; the fake hangs the same way
   - [x] Live: TS (this repo) definition/hover/references/workspaceSymbol/diagnostics < 1 s; Python (agent-foundations) definition 0.8 s, hover, symbols, diagnostics; 0 processes left; 0 files changed in either repo
   - [x] Proof: 89/89 tests; 5 mutations each fail a test
   - [x] pyright told the nearest `.venv` at or above the root (uv workspaces): agent-foundations unresolved imports 4 → 0
   - Later: `Mcp.ts` has the same idle-mid-request pattern (unreachable with defaults)
4. Atlassian OAuth: red zone, user drives
   - [x] Draft on branch `local/atlassian-oauth` (36e97d8): Auth.ts, `unii mcp-login`; spec, invariants I1-I9, checklist in tasks/atlassian-oauth.md there
   - [x] Proof: 99/99 tests; 10 invariant mutations each fail a test; live discovery passes all checks
   - [x] Merged into local/litellm at the user's request (2026-10-20), before the checklist was run
   - [ ] User: run the checklist in tasks/atlassian-oauth.md; answer the scope question

## Ask to import new Claude Code chats at each start
- [x] Tests first: `local/prime/logs.test.ts` (new/grown restaged, unchanged kept, claude-mem and manifest "-" skipped, env secret never staged)
- [x] `local/prime/logs.ts` + shared `stage_log` (redact.ts) and `mem_logs` (collect.ts)
- [x] Term: `UNII_IMPORT_ASK=1` runs the `/import claude` dry run at the first view, silent when nothing is new
- [x] Wrapper: plain `unii` runs `logs_make`, then the terminal with the ask on
- [x] Live: sync 25 restaged / 170 kept in 2.2 s, then 0 / 195 in 0.13 s; the terminal showed "Found 500 new messages … about $1.13 … /import claude go"
- [ ] Not checked live: the silent case (needs nothing new, i.e. after that import)
- [x] Bug (user): a key sent itself and the terminal quit. Cause: Bun 1.3.8 ends a raw stdin at the next key after Bun.file streams (the ask's log scan; a manual /import too). Fix: Term reads import files whole (`import_blob`); guard test; live: key + backspace, terminal stays open, nothing sent
- [ ] Ask user: upgrade Bun 1.3.8 → 1.3.14 (upstream's, per Term.ts note); may fix this and the zip_file hang at the root

## Knowledge import (OKF, graphify guides, repo digests and cards)
- [x] Tests first: `local/prime/knowledge.test.ts` (OKF from git at a branch, guides by name, digest contents/cap/no rules files/no credentials, cards, grouping)
- [x] `local/prime/knowledge.ts` → ~/.unii-prime/knowledge.json; `export.ts` groups cards into one chat (oldest first)
- [x] Found in the real data: OKF keeps copies of the 4 security audits → excluded from every source (AUDITS), with a test
- [x] Proof: 8/8 tests, 3 mutations each fail a test; real run 43 s, 0 skipped; 0 secret env values, 0 key shapes, 0 URL credentials, 0 audit sources
- [x] `unii knowledge` rebuilds it (not at every start: ~40 s)
- [x] Cards for OnCorps repos not cloned here (gh, read only): 51 (11 active, 40 archived); description, else README's first paragraph, else top-level files; archived: description only
- [ ] User: `/import ~/.unii-prime/knowledge.json` in the chat (estimate shown first)

## Ctrl+B background, /agent for the person
Plan: ~/.claude/plans/shall-we-consider-adding-quizzical-pine.md
- [x] Fix (user): Tab back to UniiChat showed the last agent's end; `term_went` reprints the page's last screen (`term_recap`)
- [x] Part 1 tests first (Machine.test.ts): `away` answers early, the file gets the rest and the exit; no `away` still waits (and writes no file when sent late); a stop still kills. Red before, green after
- [x] Part 1: `Machine.shell`/`run` take `away`; Term `t.jobs` keeps it (`Run`); `/bg`, Ctrl+B (`term_bg`)
- [x] Part 2 tests first (View.test.ts, Server.test.ts): `/agent` → spawn; a person's agent reports without a turn; the AI's still takes one. Red before; mutations (gate removed, `/agent` unmatched) each fail a test
- [x] Part 2: `spawn` Client act, `Tools.begin`, `Agent.user`, `Chat.report` gate, `/agent` row
- [x] Proof: full suite outside the sandbox, 120 pass, 2 fail (the known `local/prime/logs.test.ts` ones); tsc: no new errors in changed files
- [ ] By hand in unii (Ctrl+B on `sleep 60; echo done`, `/agent`, `/bg` idle): needs the user's terminal
- [ ] Ask user: rebuild `web/app.js` for the site's `/agent` (Bun 1.4.4's bundle renames ~180 unrelated lines)

Review: the test harness found that an idle chat with no view closes itself (`Chat.free`), so the Server test keeps a stand-in view open. Backgrounded jobs aren't stopped by `/stop`; quitting unii ends them. The output kept before Ctrl+B is the head and tail if it was already cut.

## Agent hierarchy (orchestrator → managers → workers), in place
Plan: ~/.claude/plans/can-we-totally-remake-precious-ripple.md · branch `feat/hierarchy`
- [x] 0. Pending work committed on local/litellm in 4 topic commits; baseline outside the sandbox 124 pass, 2 known logs fails
- [x] 1a. A Memory tree per agent (own view in `Tools.ask`, parent snapshot kept); old .jsonl logs read on; handover carries agent summaries. Proof: agents.test.ts 4/4, 4 mutations each fail a test; suite 128 pass, 2 known fails; tsc: no new errors
- [x] 1b. Brief (the view's latest 8 KB of lines) and the agent's own tree replace the parent snapshot; `zoom`/`date`: id own, `^id` the starter's chat, `Name`/`Name:id` Unii's or its own. Proof: agents.test.ts 6/6, 3 mutations each fail one test (re-run after a parse error made the first run void); suite 130 pass, 2 known fails; tsc: no new errors
- [x] 1c. Roll-over: past ROLL (150K tokens in, as the API tells them) a call ends after a tool step and is asked again from its tree view (agents and main chat); the task / user's message stays word for word. Proof: agents.test.ts 8/8 and the Server roll test; 5 mutations each fail one test (baseline 13/13 first); suite 133 pass, 2 known fails; tsc: no new errors
  - Edge: an entry held while an upload logs (Chat.hold) could land after a roll's next call is built; it's in the tree, just not in that call's raw tail
- [x] 2. Tiers: `manager`/`worker` config keys (sonnet-5.5 default; `agents` sets both), model override downward only (`Tools.child`), depth 3, spawn/tell/stop scoped to one's own (`Tools.under`), subtree stop, a worker's report wakes its manager (`Tools.up`), a manager reports only with no workers at work; the note carries tier, starter, model, effort (`Tools.note`/`noted`, older notes read as workers of Unii); prompt.txt: Unii orchestrates. Proof: Tools.test.ts + agents.test.ts 16/16; 8 mutations each fail a test (baseline first); suite 138 pass, 2 known fails; tsc: no new errors. Found by crash.test: a throwing hook after the run could skip its report; the report now goes first and the last hook is guarded
  - Unii's own model is still the chat's pick (`pick`, default sonnet-5.5): for Opus at the top, `/model opus-5.5` or `UNII_PICK=claude-api:opus-5.5:high:slow`
- [x] 3. View model: `state.crew` (each agent's starter, tier, model, status working/waiting/failed/stopped/done, since; `Tools.crew`), `view_crew` rows (under their starter, failed first) and `view_attention`; an agent's events only to views on its page (`Chat.to`, `sock.data.watch`); typing on an agent's page sends `tell`; `dismiss` hides a done agent; `Chat.afford` shared by spawn and tell. Proof: View/Tools/Server tests 19/19; 6 mutations each fail a test (baseline first); suite 140 pass, 2 known fails + 2 flaky Mcp (also on HEAD, 1 in 6 runs); tsc: no new errors
- [x] 4. Terminal UI: a crew panel in the footer (not a sidebar: that needs the alternate screen, which loses the terminal's scrollback): UniiChat as orchestrator, each agent under its starter with status mark, tier, model, age; page shown ▸ bold; failed red; 8 lines, rest counted (`Paint.crew_lines`). Tab cycles the crew in its order, `/tab` matches crew names (`View.view_named`), `/crew` toggles, `/dismiss [name]`; on an agent's page the input says "Tell Name" and sends to it. VERSION 1.0.139. Proof: View/Paint tests 7/7; 6 mutations each fail a test (one survived first: test tightened); suite 145 pass, 2 known fails; tsc: no new errors
  - [ ] By hand in unii: the panel at a real width, Tab through a crew, type to an agent
- [x] 5. Web UI: the footer nav shows the crew as rows (`Html.crew_html`: UniiChat, agents under their starters, page shown marked, failed red, done dim, × dismisses: a `Dismiss` Act shared in View.ts); typing on an agent's page tells it (View.ts, shared); web/app.js rebuilt (`bun run web`; most of its diff is the bundler's renaming). Proof: Html/View tests 7/7, 4 mutations each fail a test; suite 146 pass, 2 known fails + the Screen perf test under load (passes alone 3/3); tsc: no new errors
  - [ ] By hand on the site: the crew at a real width, click to zoom, × to dismiss
- [x] 5b. Desktop notifications (desktop only, as decided): alerts worked out by each client from the state it hears (`View.view_alerts`: an agent turning failed, Unii's turn ending; none on connect; each key at most once in 20 s), not a server event. Terminal: focus reporting (CSI ?1004h → FocusIn/FocusOut keys) so only a terminal in the back notifies, OSC 777 (default; Terax/Ghostty), OSC 9 (iTerm), osascript (Terminal.app; text as argv, script fixed), `UNII_NOTIFY` overrides or `off`; coming back to the front shows the alert's agent. Site: Notification API while hidden (asked at the first message), a click shows the agent. Notify.ts strips control characters (no escape injection from server text). VERSION 1.0.140; web/app.js rebuilt. Proof: View/Notify/Screen 20/20, 7 mutations each fail a test; suite 150 pass, 2 known + 2 flaky Mcp; tsc: only env noise added
  - [ ] By hand: a failed worker or a turn ending while Terax is in the back shows a notification; a terminal that tells no focus never notifies
- [x] Home repo (user's ask): `UNII_HOME_REPO` on a terminal; Unii's own jobs run there (agents keep `<work>/<Name>`); the Devices line names it and the devices doc says to read its AGENTS.md/CLAUDE.md, which point to the other repos. (`UNII_HOME` already meant ~/.unii.) VERSION 1.0.141. Proof: Machine/Tools tests, 2 mutations caught; suite 155 pass, 2 known
- [x] Status line (user's ask, as Claude Code's): under the input, offline · folder ⎇ branch · Unii's model · agents at work · today's LiteLLM spend (* stale). The spend is read from Claude Code's own cache (~/.cache/statusline/litellm-<day>.json), its refresher (~/.claude/hooks/litellm-cost.js) run detached when due: no key or fetch in unii (`UNII_COST_CACHE`, `UNII_COST_REFRESH`). VERSION 1.0.142. Proof: Cost.test 3/3, 4 mutations caught; real cache read ($498.11 today); suite 158 pass, 2 known
- [ ] 7. Hardening
  - [x] Memory `hold[0]` "never set": not a bug here (Billing.open is the free billing; the paid wallet holds its payee's mem, by the Payee contract). But agent trees (1a) had a `hold` of their own no wallet sets: a refused agent summary was asked in a hot loop (reproduced: the test hung). Agent trees now share the chat's `hold`, and the chat's pump pumps them (credit back: they go on). Proof: agents.test.ts 10/10, both mutants caught (one hangs); suite 153 pass, 2 known fails
  - [x] Failed children report "failed: …" (Tools.run's catch; crash.test) and show ✗ in the crew
  - [x] Subtree cost caps: not built (user: LiteLLM manages budgets)
  - [x] Open agent trees: at most `OPEN` (16) per chat; past that the idle one (no summary running) used longest ago closes, files too (`Memory.agent_trim`); used again it opens anew whole; its pending summaries go on as the chat's pump or a call's `agent_blocks` starts them (opening never pumps: a handover's take attaches first). Proof: agents.test.ts, 4 mutations caught (one survived first: test tightened); suite 165 pass, 2 known
- [x] 6. Claude Code workers (decided with the user): headless `claude -p --permission-mode auto --output-format stream-json --verbose` (not a PTY: its events go into the worker's tree), in its own process group, in its work dir or the `dir` given; `spawn as: "claude"` (Unii or a manager) with `device`, `dir`. Each waits for the person: crew status `asking` (first, `?`), an alert, `/approve [name]` / `/deny [name]` or the site's ✓/×; denied or stopped before it starts, it reports so. Transcript (unii/tool/echo lines, end kept under 1 MB) logged as an echo in its tree, its result its report. Tell is refused (Claude Code takes no messages). Opus at the top: already, `local/unii-local.sh` sets UNII_PICK opus-5.5:high and the chat saved no pick. VERSION 1.0.143; web/app.js rebuilt. Proof: agents/View/Machine/Html/Tools tests, 5 mutations caught (one survived first: test tightened); suite 163 pass, 2 known
  - Note: `-p` skips Claude Code's workspace-trust dialog: the person's approval is the gate. A chat moving to another process while one runs: fixed: its job moves with the device, and the new process's take has its worker wait on it there, so its report comes from where the chat is (agents.test.ts; mutation caught)
- [x] `export UNII_HOME_REPO=~/repos/home` in ~/.zshrc (user's ask); ~/repos/home doesn't exist yet: clone the home repo there (an empty one is made at Unii's first job)
  - [ ] By hand: `spawn as claude` on a real repo, /approve, the report
- [ ] By hand: `UNII_HOME_REPO=~/repos/home unii`; the status line's branch and spend

## Crew UI and local sign-in (branch feat/crew-ui, off feat/hierarchy; user's ask 2026-11-12)
Intent: the web is much more dynamic. Toggle Chat | Crew; Crew lets you watch and steer every agent's session.
Before that: no email sign-in locally, and no phone features (phones aren't allowed at OnCorps).
Decided with the user: watch and steer both; about 5-10 managers with an unknown number of workers;
no cost display; desktop only.
- [x] A. `unii web` (RED ZONE: sign-in; a draft for the user's review, not merged without them).
      The terminal's Bearer token mints a 60 s, single-use ticket bound to its user id. /auth?t= uses
      it up and sets the cookie for that same account. The cookie can't mint one, nor can someone
      signed out. Proof: Cloud tests, incl. negative cases (cookie, no auth, reuse, expiry).
      Done as a draft, AWAITING USER REVIEW (Red Zone). Cloud.web_link / Cloud.web_auth, Term.ts `web`,
      launcher `web)`, web hint. Proof: Cloud.test.ts 7/7; 6 mutants (cookie accepted, reusable ticket,
      15-min ttl, counted as a mailed link, web ticket via billing path, GET allowed) each 6 pass 1 fail,
      unmutated 7/7 first (the "counted" mutant survived at first: test tightened to 3 open tickets).
      Full suite 166 pass, the 3 baseline fails. tsc on changed files 71 → 72, the one new is the same
      no-@types/node noise (process.platform). app.js rebuild: HEAD reproducible, +3 lines.
- [x] B. Phone features hidden behind a setting (UNII_PHONE, default off): no APNs pushes,
      no AASA, no phone-pairing UI. The code stays, so it's easy to undo.
      Done: Config.PHONE (UNII_PHONE=1), cloud.phone gates Cloud.push, /api/push, AASA. No pairing UI
      existed; the web's iOS bridge (APP) is only in the iOS web view, so desktop shows none.
      Proof: Cloud.test.ts 8/8; mutants (push route ungated, default on) each 7 pass 1 fail. The AASA and
      APNs-send gates aren't test-killable (tests have no APPLE/APNS set); covered by reading.
- [x] C1. Web Crew view: a Chat|Crew toggle (#chat, #crew, #crew/<name>, keys g c / g m); a tree
      with managers collapsed and their workers rolled up; a focus pane with the agent's live
      session and its actions (tell, stop, approve/deny, dismiss); a "needs you" lane on top.
      In Chat mode, a pill shows "N working, M need you".
      Done: View.view_tree/view_needs/view_pill/view_route/view_hash, acts Stop and Expand; Html.tree_html,
      needs_html, focus_html, mode_html; #crew column, header switch, hash routes, keys g c / g m; the
      focus's session is its agent page (live transcript, tools folded, tell by typing).
      Proof: View.test.ts 12/12, Html.test.ts 9/9; View mutants (all open, no focus ancestors, needs order,
      no decode, expand never folds, stop all) each kill one test (needs order survived at first: test
      tightened); Html mutants (no stop, pill unmarked, no roll-up, raw name) killed; "href unescaped" is
      equivalent (encodeURIComponent already escapes " < > &). Suite 178 pass, 3 baseline fails; tsc on
      changed files 8 → 8. Headless Chrome render of a demo crew (8 managers, 40 workers) checked: the
      first had no status glyphs (.mark clashed with the logo's class: renamed .st) and roll-ups cut off
      (a folded manager now shows only its roll-up; tier and model in the tooltip).
- [x] C2. A pulse per agent for every view (status, current activity, last line); a view can
      watch several agents at once (the visible tiles).
      Done: Tools.pulse/status ({status, act, last}, lines ≤ 120, thoughts as "thinking…"); Chat.pulse sends it
      to every socket once PULSE (1 s) after an agent's first delta or entry (a burst: one); a socket's
      `watch` replaces its watch set (known agents, ≤ 16); the web keeps pulses (v.pulses), shows each tree
      row's activity line, and watches its focus (View.view_watch; C3's tiles join it).
      Proof: Tools.test.ts pulse test; Server.test.ts pulse/watch test (20 deltas → 1 pulse to each socket,
      20 deltas only to the watcher, none after watch []); View/Html tests 23/23. Mutants killed: no
      coalescing, pulse to watchers only, unknown names watched, watch adds (re-run: the first try didn't
      parse; both versions checked with Bun.Transpiler), always act, watch nothing, first pulse kept.
      Not killed by a test: the 16 cap (it needs 17 live agents). Suite 182 pass, 3 baseline fails; tsc
      75 → 75 (one new error, an unknown[] in watch, fixed).
- [x] C3. A grid of manager tiles with dots for their workers; a timeline lane per agent;
      the terminal's full-screen Crew mode (/crew full, Esc goes back to scrollback); a demo crew
      (8 managers, 40 workers) for layout and tests.
      - [x] Grid and demo: Demo.ts (8 managers × 5 workers, a sub-manager, a Claude Code worker asking);
        View.view_tiles, view_watch(v, tiles) (focus + tiles in sight, ≤ 16), act Tell; Html.grid_html;
        #crew with no focus shows the grid (the footer keeps only toasts; a tile's box tells its agent);
        /?demo=1#crew draws the demo crew locally. Fix found end to end: boot() cleaned the URL to "/"
        and dropped #crew, so a link to the Crew opened the chat; it keeps the hash now. Also
        `$("form")` bound the first form on the page: now `form.composer` (tiles add forms).
        Proof: View 17/17, Html 12/12; suite 188 pass, 3 baseline fails; tsc on changed files: the same
        one pre-existing error. End to end on a throwaway server (port 9555, temp UNII_DIR): sign-in by
        /api/web-link with a Bearer (a cookie-only mint: 401), headless Chrome over CDP on /?demo=1#crew:
        9 tiles, pill "18 working, 7 need you", g m → #chat, g c → #crew grid, the tree's caret opens a
        manager; no page errors.
      - [x] Timeline lane: View.view_lane (messages with a date by kind, thoughts left out; a spawn per
        agent it started; a stall per gap past 2 min, and a quiet end while at work), Html.lane_html under
        the focus card; a message's mark jumps to its row (one row per message: page_rows). The server's
        agent entries now carry their date. Proof: lane tests (View, Html); mutants (no stalls, always to
        now, no spawns, thoughts marked, no jump, label raw) each kill one; suite 190 pass, 3 baseline
        fails; tsc on changed files 62 → 62 (the earlier "0 → 0"s were void: see lessons.md, zsh).
      - [x] Terminal: /crew full: the alternate screen with Paint.crew_full (head with the pill and keys,
        who needs you, at most a third of the screen, the tree with activity lines, the selection kept in
        sight); keys by View.view_full (↑↓/jk, →←/hl/Space, Enter focus, s, a/d, x, Esc/q/Ctrl+C);
        Screen.grab sends every key to Term while it shows; Esc gives back the scrollback as it was.
        Proof: View keys test, Paint test (24 and 8 rows: the first try had no room for the tree on 8
        rows: the needs lane is capped to a third); suite 192 pass, 3 baseline fails; tsc on changed files
        71 → 76, all 5 the no-@types/node noise (process). PTY smoke (script, throwaway server, token
        file): /crew full enters the alternate screen and draws its head, j moves, q leaves, the footer
        is drawn again.
- [x] D. Headless device mode (user's question: the web can't run shell commands without a TUI open):
      a background process that connects as a device and runs jobs (Machine.run), with no screen.
      It gets the same approvals as the terminal.
      Done: Device.ts holds the job rules both use (Term.ts's term_jobs/term_run moved there): run once,
      computer use only with UNII_COMPUTER=1, an output over the frame refused by its size, a job the
      server drops stopped; approvals stay server-side (a Claude Code worker waits for ✓ from any view).
      `unii device [url]` (Term.ts word; launcher `device)`) connects as this device with no screen; the
      server gives a job to the newest live tab of a device, so it and a terminal can both be open.
      (`serve` was checked first: it runs a server, not a device.)
      Proof: Device.test.ts 5/5 against a fake server socket (Bearer and device name sent, once, refused
      computer job never runs, size cap, stop on a dropped id); mutants (computer allowed, no size cap,
      runs twice, never stops, stops all) each 4 pass 1 fail, unmutated 5/5. Suite 197 pass, 3 baseline
      fails. tsc: only missing Bun/Node type noise (Buffer moved with the code). Live: signed out it
      refuses ("sign in first"); signed in it connects and stays up, no errors.

## Agent labels (user's ask 2026-11-12: names that say the work, its repos and goal)
Decided with the user: keep the short name as the handle (memory, tell/stop, #crew/<name>), and show a
title (the goal) and repos as labels on top of it; the parent sets them at spawn and changes them on the
fly, and an agent can relabel itself.
- [x] L1. Server: Agent.title / repos; spawn's titles and repos (by task, in order); a Claude Code
      worker's repo defaults to its dir's folder; a `label` tool (itself, or an agent under it: name);
      inputs trimmed and capped (title ≤ 80, ≤ 8 repos ≤ 60 each, no newlines); in the crew (Tools.crew).
      Proof: tests incl. refusing another's agent and capping.
      Done: Agent.title/repos, Tools.labels (cleans and caps), Tools.label (the crew's agents; itself, or
      one under it), `label` in every thinking agent's tools, spawn's titles/repos, the Claude Code
      worker's dir folder as its repo. Proof: Tools.test.ts label test, agents.test.ts spawn labels and
      the Claude worker's default repo; mutants (anyone labels anyone, no caps, dupes kept, spawn ignores
      labels, no default repo, empty label accepted) each 24 pass 1 fail (the first "anyone" try hit
      zoom's same text and didn't parse: redone on the label line, checked with Bun.Transpiler).
- [x] L2. Views: the title as the main line, repo chips, the name under it (web tree, tiles, focus,
      needs; terminal panel and /crew full); the demo crew labelled. Proof: View/Html/Paint tests, a
      demo-crew render.
      Done: Html.who_html/repos_html (title or name, repo chips), tiles get a row of repo chips, the
      focus card and needs lane lead with the title; the narrow tree shows the title and roll-up, its
      name and repos in the row's tooltip (the first render showed chips crowding out the roll-up);
      View.view_label for the terminal ("Fix login tests (FireAnt) [auth-api]"), used by the panel and
      /crew full; Demo.ts labelled. Proof: View/Html/Paint 35/35; mutants (name not title, repo raw,
      terminal no title, tile no repos, tree tooltip no repos) killed; suite 199 pass, 3 known fails;
      headless renders of the labelled demo crew checked.

## Claude Code parity: guard hooks, tools, `!` (feat/crew-ui)
Intent: Legion's device tools get gated by the same Claude Code hooks as Claude Code itself (above all the
OnCorps guard in managed settings), it gains the Claude Code tools it lacks, and `!cmd` runs a shell
command from the input box. Decided with the user 2026-11-12: hooks from managed + user + project
settings (no plugin hooks yet); fail closed only for managed hooks; tools glob, grep, todo (no webfetch:
SearXNG search covers finding pages); `!` in the TUI and on the web.
Constraints: device side only (Machine.ts imports nothing of the server); guard.py runs unchanged (it
sees Claude Code tool names and input shapes); the `claude` worker is real Claude Code, already guarded.
- [x] H1 (RED ZONE: 7c3c5fe, signed off by the user 2026-11-12) Hooks.ts: load PreToolUse/PostToolUse from
      /Library/Application Support/ClaudeCode/managed-settings.json (+ managed-settings.d),
      ~/.claude/settings.json, <repo>/.claude/settings.json and settings.local.json; match by tool regex;
      run each with Claude Code's stdin JSON ({hook_event_name, tool_name, tool_input, cwd, session_id});
      exit 2 or permissionDecision "deny" refuses the call with the reason; systemMessage shown as a
      warning; 60 s timeout. A managed hook that can't run (missing, crash, timeout) refuses; others warn.
      Names: shell→Bash {command}, read→Read {file_path, offset, limit}, write→Write {file_path, content},
      edit→Edit {file_path, old_string, new_string, replace_all} once per edit, glob→Glob, grep→Grep.
      Wired into Machine.run before the tool; PostToolUse after. → verify: Hooks.test.ts with fake hooks
      (deny exit 2, deny JSON, warn, crash managed vs user, timeout, matcher miss) + the real guard.py
      refusing `git push --force origin main`-class critical commands; mutants killed.
      Proof: Hooks.test.ts 10/10 written before Hooks.ts (incl. the installed guard.py refusing a critical
      command); 10/10 mutants killed (managed fails open, exit 2 ignored, deny/ask ignored,
      allowManagedHooksOnly ignored, user disableAllHooks drops managed, no timeout, unreadable managed
      file ignored, only first edit gated, Machine.run ignores deny); live Machine.run with default
      sources: the real managed guard refuses `echo … rm -rf /`, allows `echo hello`; suite 209 pass,
      the 3 known fails; tsc: Machine.ts 18 → 18, Hooks.ts only missing bun/node type noise.
      Invariants for review: a managed hook that can't run, an unreadable managed file, a managed
      non-command hook or a bad managed matcher refuse (closed); user/project hooks can't switch off
      managed ones; OC_GUARD_BYPASS is read from the device's env, never the command's.
- [x] T1 glob + grep device tools (Machine.ts TOOLS): glob by pattern sorted by mtime; grep via rg if on
      PATH, else a JS walk; output capped like read. → verify: Machine.test.ts cases.
      Proof: Machine.test.ts glob/grep (rg and the walk, same answers: files, content with context,
      count, case, glob filter, no match, bad regex; via Machine.run) + Hooks mapping to Glob/Grep; 7/7
      mutants killed (the "not routed" one after adding the run test); suite 213 pass, 3 known fails;
      tsc: only missing bun/node type errors. Found: rg's -g lets hidden files back in, so `!.*` goes last.
- [x] B1+B2 `!cmd` in the TUI and on the web, one path: View.view_act turns a Send of "!cmd" (any page)
      into a "bang" act; the server (Chat.bang) runs it as main's shell job on the device it came from
      (a terminal), else the only one open, else says which are; its command and output come back as a
      note the AI reads, no turn. Changed from the plan: it goes through the hook gate like any shell
      job (a job flag to skip hooks would be a bypass anything that sends jobs could set); the user's
      own destructive commands run in a plain terminal. Proof: View.test.ts and an in-process
      Server.test.ts fixture (fake devices: no device, the only one, the sender's over another, empty
      command, the note's text, no turn); 5/5 mutants killed; suite 215 pass, 3 known fails; web/app.js
      rebuilt (+5 lines). By hand still: `!git status` in a live TUI and in the web chat.
- [x] T2 todo: a per-agent checklist tool (set the whole list, as TodoWrite) for managers and workers (not
      the orchestrator: no hands-on work), cleaned (one line, 120 chars, 20 items, unknown status
      pending), in the crew; the web focus card lists it, a tile says done/all, /crew full says
      "1/3: the step". Demo workers carry one. Proof: Tools/Html/Paint tests; 9/9 mutants killed; suite
      218 pass, 3 known fails; tsc: nothing new; headless render of the focus card checked.

## Questions backlog (feat/crew-ui)
Intent: the orchestrator's questions for the user collect in a backlog the user can answer in due course,
without scrolling the chat. Decided with the user 2026-11-12: a new `ask` tool (orchestrator only;
managers ask it); an answer box per question, the answer sent to the orchestrator as a message quoting
it; shown in a web side pane beside Chat, in the Crew "needs you" lane, and in the terminal
(/questions, a count in the status line).
- [x] Q1 server: Memory keeps the open questions (view.json, beside goal); `ask` (question, options;
      close: id withdraws one) for main only, capped; state carries them; an "answer" act (id, text)
      logs a user message quoting the question and starts a turn, or with no text dismisses it (a
      note, no turn). → verify: agents.test (ask, caps, persisted across a reload), Server fixture
      (answer: message + turn; dismiss: note; unknown id refused), mutants.
      Proof: agents.test (ask: main only, cleaned, capped at 20 open, refused past them, close, ids
      never reused across a reload) + Server fixture (state lists them; answer = the user's message
      quoting it + a turn; dismiss = a note, no turn; unknown refused); 8/8 mutants killed; suite 221
      pass, 3 known fails. tsc caught two real bugs the tests didn't (lessons.md): a second
      `Chat.answer` replacing the socket handler (now Chat.reply), and the act's `id` field clashing
      with the act's own (now `q`). Prompt: the orchestrator files waiting questions with ask.
- [x] Q2 web: a side pane in Chat (count badge, each question with its options as quick answers and
      an answer box, dismiss), and the questions first in the Crew "needs you" lane.
      → verify: View/Html tests, headless render.
      Proof: View.test (Answer/Drop acts, pill counts questions with and without a crew) + Html.test
      (pane escaped with lines kept, quick answers, box, dismiss; needs lane lists them first linking
      to #chat; the ? n toggle); 5/5 mutants killed (pill after a fix to the test); suite 223 pass,
      3 known fails; headless render of the pane checked; main.ts tsc: only its known error.
- [x] Q3 terminal: /questions lists them; /answer <n> <text> (a bare number picks an offered answer),
      /drop <n>; "N questions (/questions)" in the status line. Parsing and listing are View functions
      (view_questions_note, view_answer, view_drop). Proof: View/Paint tests; 4/4 mutants killed; suite
      225 pass, 3 known fails; tsc 2 → 2; Term.ts builds. By hand still: the commands in a live TUI.

## Permission modes: plan / auto / full (feat/crew-ui) - RED ZONE, signed off by the user 2026-11-12 (9aa44b4, e665a8e)
Intent: Claude Code's plan and auto modes for Legion's agents, chat-wide. Decided with the user
2026-11-12: modes plan / auto / full (full = today: hooks only; new chats auto); plan mode's shell is a
read-only allowlist; when auto's reviewer can't answer, the call waits for the user's yes/no; Shift+Tab
cycles the mode (speed keeps /speed and the pick menu). The gate runs on the server before a job goes
to a device (it knows the mode and has the models); the device's hooks still run after it.
- [x] M1 (signed off) plan mode: Modes.ts (the mode type; readonly(cmd): the allowlist, quotes-aware, no redirects,
      substitutions or writers; which tools a mode allows); the mode kept with the chat (view.json),
      in the state, set by a "mode" act; Tools.call refuses what plan mode doesn't allow (write, edit,
      a non-read-only shell, computer, Claude Code workers) saying so; the orchestrator's `plan` tool
      files its plan for approval; approve: the mode the user picks, the orchestrator told; reject
      with feedback: stays plan, the feedback a message. → verify: Modes.test (allowlist cases incl.
      bypass attempts), Tools/Server tests, mutants.
      Proof: Modes.test (14 read-only lines pass; 36 refused incl. $() in double quotes, backticks,
      <(), redirects, &, newline, env/path, find -exec/-delete, rg --pre, sort -o, tree -o, uniq out,
      git commit/push/-c/--output); Tools.test (plan refuses write, edit, mutating shell, computer, MCP,
      Claude Code workers before any device; reading goes on; the devices block says the mode);
      agents.test (plan tool: main only, plan mode only, kept across a reload); Server fixture (switch
      = a note, no turn; approve = the picked mode + a turn; reject = plan mode + feedback + a turn).
      Mutants: 11 killed; 4 equivalent (env/path/git -c also fail the list check; fd>/dev/null is
      harmless). Suite 231 pass, 3 known fails; tsc 5 → 5. Invariants for review: the gate is on the
      server, before any job/MCP call; an unknown or missing mode reads as auto, never full;
      rejecting a plan never leaves plan mode; only the orchestrator files plans.
- [x] S1 (user: "no LiteLLM cost on the web; same info as the TUI") the web's status line: each device
      reports its folder, branch and today's spend (Device.device_status, shared by the TUI and
      `legion device`; on connect, then every minute / on change); the server keeps the latest (only a
      device's, fields checked) in the state; View.status_text is the one line both views draw (now
      with the mode). Proof: View/Device/Server tests; 2/2 mutants killed; suite 234 pass, 3 known
      fails; tsc: one more TS2339 on setInterval().unref() (DOM-lib noise, as Term.ts's). By hand
      still: the line in the live web UI.
- [x] M2 (signed off) auto mode: a reviewer call (cheap model) per shell/write/edit: the user's latest message,
      the agent's task, the call → allow, or refuse with a reason (the agent sees it); no answer
      (error, timeout, bad reply) → the call waits for the user's yes/no in Needs you. → verify:
      faked-model tests (allow, refuse, error → asks, yes runs, no refuses), mutants.
      Proof: Tools.test with AskAI.ask stubbed (allow goes on; refuse says why; reading never
      reviewed; an error, an error reply holding allow JSON, prose, a non-boolean: the user decides,
      yes runs, no refuses; a stop while waiting refuses and leaves the list; full reviews nothing);
      Server fixture (waiting calls in the state, consent answers, unknown refused); 10 mutants
      killed after 2 tests were tightened. Reviewer: the compactor's model, REVIEW prompt (allow
      unless destructive beyond the task, off-machine, secrets, system/packages, outside its folder,
      beyond the ask), 60 s cap. By hand still: a real reviewer call through LiteLLM.
- [x] M3 views: mode chip (web header, terminal status), Shift+Tab and /mode, the plan card
      (approve as auto/full, or reject with feedback), pending calls in Needs you and /allow, /refuse.
      Proof: View.test (Mode cycles from the state's mode, /mode, /plan show/yes/no, Verdict and
      Consent acts, the pill counts them), Html.test (chip, plan card and waiting calls escaped, first
      in the pane and the needs lane), Paint.test (status: mode, N waiting); 3 mutants killed after
      tightening. Shift+Tab is the mode now (Term and the web box); speed keeps /speed and the pick.
- [x] N1 (user: "notifications don't work; a distinctive sound and a desktop box") Notify.notify_cmds:
      afplay Hero (UNII_NOTIFY_SOUND: a name, a path, off; not Claude Code's Submarine/Glass), the box by
      terminal-notifier if installed, else osascript; the TUI notifies when away or when its terminal
      never reports focus (Apple Terminal); new alerts, once each, for a question, a plan ready, a
      waiting call; the web chimes (WebAudio, two notes) with its notification when hidden. Proof:
      Notify/View tests; mutants (sound off, name check, re-alerting) killed; Hero played and an
      osascript box appeared here (user confirmed).


## A turn no longer hangs on summaries (feat/settle-deadline; user's ask 2026-11-12)
Seen: "compressing earlier messages…" for good. The compactor's calls (patient: they ask again every
60 s, forever) failed at the LiteLLM gateway (HTTP 429 "Budget has been exceeded", 502s, 300 s
silences), and a turn waits (Memory.settle) on every summary before it, with no limit and no reason shown.
Intent: a turn waits on summaries at most SETTLE, then goes with the lines not built shown as
"(not summarized yet: zoom it)" (prompt.txt already says so), and the wait says the compactor's last error.
Constraints: no change while summaries build fine; held-for-credit still answers at once; compaction views
unchanged (they end at the first line not built).
- [x] D1 settle's deadline: Memory.settle resolves null after SETTLE (60 s); Memory.view lists a line not
  built as WAIT, not dropped. Tests first (failsafe.test.ts: vendor down, settle null by the deadline, the
  view holds every message, WAIT lines) → verify: they fail, then pass; full suite.
- [x] D3 the reason shown: End keeps the vendor's words (why); a patient call tells them (Ask.again) before
  asking again; Memory keeps mem.trouble (cleared by a summary answered), Server sends it in the state, the
  wait reads "compressing earlier messages… (compactor: <why>)". Tests first (failsafe, View) → verify:
  they fail, then pass; mutants; full suite.
- Proof (2026-11-12): both tests failed first, then pass (failsafe 9/9, View); 6/6 mutants caught (no
  deadline, view drops unbuilt, no again, never cleared, no vendor why, view hides trouble); full suite 244
  pass, only the known logs fails; tsc 85 errors before and after (Bun typings). Not under test: Server's
  state field and troubled broadcast (one line each); a chat moved to another process doesn't relay its
  summaries' trouble. By hand still: a live turn with the gateway down shows the reason, then goes at 60 s.

## Cockpit: Herdr parity (branch feat/cockpit; user's ask 2026-11-12: "parity all the way through")
Intent: Legion's web gets Herdr's cockpit (screen recording 2026-11-11, frames in /tmp/claude-501/herdr-frames):
a home digest, a GitHub/Jira inbox with pick-and-act, a sidebar of agents by ticket and spaces, a
command palette, routines, a team digest. Agents it starts are native Legion subagents; a Claude Code
worker only when the user ticks it (then a manager starts one, as today).
Constraints: the device reads GitHub/Jira/git with the user's own CLIs (gh, acli, git), read-only, like
its status report; no new sign-in or token code (Red Zone); the server only checks, caps and keeps a
device's report; nothing is posted to GitHub/Jira by Legion (File issue opens GitHub's own page).
Success: each page renders from the demo crew + a fixture inbox, unit-tested and checked end to end in
headless Chrome; every act tested on the server; mutants caught; suite stays at the 3 known fails.
- [x] C1 inbox data: Inbox.ts (pure: the gh GraphQL query; PRs' state from checks/review/mergeable:
      failing, blocked, ready, conflicts, draft, pending; review requests split you / team; Jira rows
      from acli JSON; worktrees to clean up from `git worktree list --porcelain` + status counts +
      merged branches; GitHub notifications as activity/alerts); the device runs them every 5 min and
      on the server's ask, async with timeouts; "inbox" act checked and capped by the server, kept,
      in the state. → verify: Inbox.test (fixtures), Server act test, Device test with a fake run.
      Proof: Inbox.test 8/8 (states, you/team/bot, body cut, GraphQL read + errors, search vars, acli
      both shapes + links, worktree porcelain, notification kinds/links, the check: caps, cuts,
      https-only links, bad kinds/counts refused, extra fields dropped); Device.test (fake gh/acli/git:
      merged + dirty worktrees kept, clean unmerged left out, acli signed out said, gh missing said, only
      read commands run); Server fixture (device-only, checked, kept, sent as its own message; fetch to
      every socket). Live run: 17 reviews, 27 PRs, 42 merged this week, states right; acli signed out.
      Mutants 11/11 killed (one test added for a review asked of another user). Suite 253 pass, 3
      known fails; tsc: only Bun/process type noise added. Sent as its own "inbox" message (on change,
      and on join), not in every state: ~60 KB.
- [x] C2 inbox page (#inbox): sections Alerts / Reviews / Your PRs / Tickets / To clean up, folding,
      counts, filter, j/k/space/tab/enter, a details card (PR body, checks), "N changed since you
      looked", refresh, open, File issue (GitHub's new-issue page). → verify: Html/View tests, e2e.
- [x] C3 pick and act: pick rows (v, "pick all review requests"), a panel with Review / Fix / Open /
      Drop picks; Review and Fix start one native worker per PR (labelled repo#n, its repo), or with
      "Claude Code" ticked a manager told to use a Claude Code worker; plan mode still gates them.
      → verify: Server act tests (spawns, labels, caps, unknown PR refused), View tests.
      Proof (C2+C3, one commit): Cockpit.test 10/10 (routes, sections, you/team/bot, old folded for
      reviews only, tags/tones, alerts from failed agents + failing PRs + CI notes, Jira's note, filter,
      changed-since-looked, badge, acts); Pages.test 6/6 (escaping, fold, row acts, cursor, picks, details
      card, picked panel, head); Html.test (Home/Inbox in the switch). Server fixture: a native worker per
      PR labelled "review o/r#5" (repos [r]), a manager with claude, user-started (no turn), only the
      inbox's PRs, at most 10, tasks say "post nothing" / "don't push". Found on the way: started
      through Tools.begin, the second PR waited on the first one's note being summarized; PR agents
      now start with Tools.start, their task standing alone. E2E (headless Chrome, real clicks/keys,
      demo inbox): 5 sections, 22 rows, badge 5, fold/unfold, j/k cursor, click → details, Tab, v → "1
      picked", Drop picks, Fix → the server's refusal toast (demo PRs aren't the server's), filter,
      Chat and back. Fixed after looking: links styled as `.open` blocks (class clash), PR rows of
      the user folded as old. Mutants 15/15 killed (one test added for the acts). Suite 271 pass, 3
      known fails; tsc 194 → 194 (a `Page` name clash with View's agent page caught and renamed Deck).
- [x] C4 home (#home): greeting, "N need you · M working", stat cards (agents, reviews for you, your
      PRs to fix, merged this week, agent spend today / 7 days), Working and Done cards (repo,
      ticket, PR, est. cost, age; Go to agent, Archive, Archive all), Apps (Inbox, Questions, Routines),
      Activity. Per-agent cost: an estimate at list price (Price.ts) from each request's usage, shown
      "≈"; billing untouched. 7-day spend: the cost cache's daily files. → verify: tests, e2e.
      Proof: Ask.used (each request's usage, beside Ask.again; Agent.ts calls it after grant.end) →
      Tools.spent (list price, a model with no price adds nothing) → Crew.spent; failsafe.test (the
      fake vendor's usage told once), Tools.test. Cost.cost_week (the last 7 UTC days' caches summed)
      → the status report's week, checked by the server (Cost/Device/Server tests). Cockpit.test 4 more
      (greeting, line, stats, cards: Unii's own agents, working then done, ticket/PR/cost; Archive →
      a dismiss each; apps; activity newest first); Pages.test (escaping, Archive only on done, Archive
      all). E2E on the demo: stats, groups, 9 cards, Focus on/off, stat → #inbox, New agent → #chat with
      "/agent " in the box, Archive → the server's refusal (demo agents aren't its own). Fixed after
      looking: `.chip` was the account page's button class (renamed hchip). Mutants 11/11; suite 279
      pass, 3 known; tsc 208 → 208.
- [x] C5 sidebar, palette, bar: a left column (search or run, page icons with badges, agents grouped
      by ticket key, spaces with their worktrees, Settings, Add machine), Ctrl+P / ⌘⇧P palette
      (pages, agents, PRs, commands, New agent), focus mode, bottom bar need you · working · ready ·
      done. → verify: tests, e2e with real clicks on the demo crew in every mode.
      Proof: Cockpit.test 4 more (agents by ticket, none last, with how many under; spaces from agents,
      worktrees and the device; the bar; the palette: every word must match, labels starting so first,
      pages / commands / agents / PRs and what each does); Pages.test (side + palette markup, escaped).
      E2E on the demo: sidebar 230 px on Home and Chat, hidden on the Crew (its own column), Ctrl+K →
      palette, "inbo" → Inbox + Refresh, Enter → #inbox, a space → the inbox filtered, Add machine →
      its popover, Esc closes it (found: the inbox's Esc key swallowed it; page keys now stand aside
      while a popover or the palette is open), the sidebar's search button, a click on an item. Mutants
      8/8 after 3 tests were tightened (bar counts equal, "any word" and "starts first" untested, a space
      only a worktree has). Suite 284 pass, 3 known; tsc 56 → 56.
- [x] C6 routines: a prompt that starts a native agent daily at a time / every N hours / on a new
      review request (Herdr's inbox automations); kept in view.json, run by the server's tick, listed
      and toggled on #routines and by /routine in the terminal. → verify: Server tests with a fake
      clock, View tests.
      Proof: Routines.test 6/6 (the check: name, task unless a review one, daily HH:MM, every 1-168 h,
      tier; when due: daily once past its time and not run since, made after it → tomorrow; every N h
      after the last run; review never by the clock; the terminal's parse; the views: act, /routines,
      /routine, the page, the Home count). Server fixture: added, checked, run now, the tick runs it once
      when due and not again, off, unknown refused, a review routine seeds on its first inbox and then
      starts one review per new request of the user's (a team's ignored), at most 20, kept in view.json.
      E2E against the real throwaway server: add (every 4 h), off, on, delete, a bad one refused with
      the server's reason. They run while the server runs and a view or a device is connected (Chat.free
      ends an idle chat with no socket, and its tick): said on the page. Mutants 11/11; suite 291 pass,
      3 known; tsc: one more setInterval().unref (the DOM-lib noise already known); Term.ts builds.
- [x] C7 team digest (#digest): merged PRs of the last 7 days in the spaces' repos by author, and open
      ones; a theme line per author from the compactor, asked for by the user (Summarize by theme),
      asked again only for a new digest. → verify: tests, e2e.
      Proof: Inbox.test (repos from remotes, the searches, PRs read, checked with the report: links
      https-only, none = null); Device.test (the spaces' origins → one digest search; no GitHub space: no
      search); Server fixture (one compactor call, its JSON kept only for the digest's authors, lines
      capped at 8 and cut at 200, the same digest not asked again, a reply not JSON refused, told every
      view); Pages.test (by author, most first; themes in place of PRs once summarized; open ones; acts).
      Live: this repo's two merged PRs read. E2E: the demo digest drawn; Summarize → the server's "Nothing
      merged" (it holds no device's inbox). Mutants 8/8 (one test added: a device with no GitHub
      space). Suite 294 pass, 3 known; tsc: the same setInterval().unref noise.
- [x] C9 (user's ask 2026-11-12) spaces found, not listed: git repos under the roots (UNII_SPACES now
      lists roots; default /Volumes/dev/git and ~/.claude) and the home repo, 4 folders deep, not in a
      repo, node_modules, build or hidden folders; a linked worktree's .git file skipped; found anew every
      30 min. All checked for worktrees (git only where .git/worktrees is); the active ones (git files
      changed in 14 days) feed the digest (40 at most, upstream remote before origin: forks) and the
      sidebar (12 shown, the rest in the palette). The digest's repos split into searches that fit
      GitHub's 256-character queries, 5 at most. Live: 538 repos found in ~4.5 s, 55 active, 23 worktrees
      to clean. Found: the gh sign-in can't see OnCorps repos (404: its token isn't authorized for the
      org's SSO), so the digest of OnCorps repos is empty until it is. Mutants 11/11; suite 296 pass, 3
      known (one run had 7 failsafe.test failures that didn't recur, alone or in the suite: its timers
      run 1000x fast, a load flake).
- [x] C8 RED ZONE, DRAFT built 2026-11-12 to the design below, awaiting the user's code review before merge (user chose Google sign-in; decided: they register the OAuth client, drive.readonly is fine, meeting text may go to the gateway for summaries):
      Up next (calendar) and meeting transcripts. Design:
      - Sign-in: Google OAuth 2.0 for a desktop app (installed-app flow, PKCE, loopback redirect on
        127.0.0.1), run on the device by `legion google-login` (as `legion mcp-login`); an OAuth client
        of OnCorps' Google Cloud project, Internal (oncorps.io accounts only). Scopes read-only and
        narrow: calendar.events.readonly, drive.readonly (transcripts are Docs in Drive).
      - Tokens: the device's Keychain only (as Auth.keychain), never a file, the server, a log or a
        prompt; refreshed on the device; `legion google-logout` revokes at Google and deletes them.
      - Reads: on the device with the inbox, like gh: today's and tomorrow's events (title, time, Meet
        link, attendee count, not attendee emails), and the last 14 days' transcript Docs (title, date,
        id). A transcript's text is fetched only when the user opens it.
      - Summaries: a transcript summarized (the compactor, through the LiteLLM gateway) only on the
        user's click, the summary kept with the chat; the full text never kept.
      - Fail closed: no or expired grant → the pages say "sign in with legion google-login"; any error
        → nothing shown, never a partial page.
      Invariants for review: no token leaves the device; scopes read-only; nothing written to Google;
      nothing sent to a model but on a click; logout revokes.
      Built: Google.ts (login/token/refresh/logout/events/docs/text on Auth's Keychain, callback and
      grant checks), local/google-login.ts + `legion google-login [client.json]` / `google-logout`;
      the device reads events and Docs with each inbox (both or neither); the server takes a Doc's text
      only from a device, only for a Doc it asked for (a view's Summarize of a listed Doc), summarizes
      it with the compactor and keeps the summary (50 newest), never the text; Home's Up next,
      #transcripts (summary or Summarize, Open full transcript). Proof: Google.test 6/6 against a fake
      Google (S256, offline, read-only scopes, state refused, fewer scopes refused and nothing kept,
      non-https refused, one refresh for many askers, failed refresh says sign in again, logout revokes
      then deletes, no attendee address asked, Meet/Docs links only, ids checked, text cut); Device,
      Inbox, Server (asked/unasked/view-sent text, summary kept not text, not read twice, failure said)
      and Pages tests; e2e on demo data (Up next, list, pick, Summarize refused clears). Mutants 18/18
      after 2 tests added (fail closed when only Docs fail; no second read). Found by tsc: a new
      SUMMARIES constant shadowed View's wait (lesson recorded). Suite (bun run test, --isolate) 308
      pass, 2 known. Not run live: a real Google sign-in (needs the user's client).

## Connect: Refresh, auto mode, Gmail/Chat, files pane (branch worktree-feat-connect-files; user's ask 2026-11-13) - PLAN, awaiting decisions

Intent: four separate, reviewable changes, in this order (one commit set each):

- [x] K1 Refresh works (bd10f8c; Server/Device tests, launchd plist checked with plutil and a stub launchctl; Term wiring has no test). Today the button only reaches a running `legion device`; the terminal `legion` never reads the inbox, and the page says nothing when no device answers.
  - Server answers Fetch with an error note ("no device reads the inbox: run legion device") when no device socket is up; the page shows "reading..." until the inbox arrives or 60 s pass.
  - The terminal `legion` reads the inbox too (it is a device already: same Device.device_inbox, same 5 min timer).
  - Optional: `legion device --install` writes a launchd agent so reads keep going with no window open (decision D2).
  - verify: Server test (Fetch with no device returns the note), e2e (button shows reading..., then updated time).
- [x] K2 Auto mode more lenient (RED ZONE: permission engine; signed off by the user 2026-11-13, 26bc591). Proof: Modes/Tools tests 20/20, 6/6 mutants killed (work-tasks/mut-k2.sh). Secret-reading commands (env, .env, .ssh, token...) are still reviewed even when read-only.
  - Read-only shell (Modes.readonly says null) skips the reviewer, as Claude Code does.
  - The reviewer sees the last 3 user messages, not only the latest one (a "yes, go" carries no context).
  - The prompt changes from "refuse if any of 6 things" to "refuse only clear harm": deletes beyond the task, off-machine sends (push/deploy/publish/send), secrets/.env, system changes, piped-from-internet code. Dropped: "goes beyond what the user asked", "outside the repo". Installing from a lockfile is allowed.
  - Invariant: still fails closed (no answer from the reviewer: ask the user), and plan mode's rules are unchanged.
  - verify: Tools/Modes tests: `git status` never reaches the reviewer; `rm -rf ~` still goes to the reviewer; a reviewer timeout still asks the user. Negative tests kill mutants.
- [x] K3a Gmail and Google Chat reads and the agents' `google` tool (RED ZONE, signed off by the user 2026-11-13). One tool, 7 read-only actions, output fenced <untrusted>; plan mode allows it, auto mode doesn't review it. Proof: Google.test.ts 8/8, Modes 3/3, full suite 312 pass / 2 known fails. Not built (K3b): unread mail and Chat mentions in the inbox. Not live-checked: needs the user's re-login.
- [x] K3 (original plan) Gmail and Google Chat, read-only, and agent tools for Google (RED ZONE: OAuth scopes, PII).
  - Scopes added: gmail.readonly, chat.spaces.readonly, chat.messages.readonly. Users re-run `legion google-login` once.
  - Device reads (the Keychain grant stays on the device): gmail search/read, chat spaces/messages; inbox gains unread threads that need the user and recent Chat mentions.
  - Agent tools (native, read-only, run on the device): google_mail_search, google_mail_read, google_chat_read, google_calendar, google_doc_read. Tool output is marked untrusted (an email can carry instructions); in auto mode, a tool call right after reading mail still goes to the reviewer.
  - Console setup the user does: enable the APIs (done), add scopes on the consent screen, configure the Chat app (the Chat API needs one even for user reads).
  - verify: fake-Google tests (as Google.test.ts), scope check fails closed, tool output tagged untrusted.
- [x] K5 Harvest timesheets (RED ZONE, signed off by the user 2026-11-13: K5a b9236d6 client + read tool + login; K5b drafts, Timesheet page, Submit). Built: Harvest.ts (token checked, Keychain only; projects, entries; post checked whole), harvest tool (read-only), timesheet tool (any agent files checked drafts, kept with the chat), #timesheet page (g s; by day, totals, Drop, Submit, a 17:30 daily routine offered), Submit -> Chat.timesheet (unsent only, ONE device's terminal) -> Device.device_harvest (posts each once) -> Chat.harvested (only a device's, once; sent/failed, a chat note). Proof: Harvest 4, agents timesheet, Server timesheet, Device harvest, Pages timesheet; 12/12 mutants killed (work-tasks/mut-k5.sh); suite 328 pass / 2 known; no new tsc errors beyond env noise. Not live-checked: needs the user's Harvest token. Not built: weekly routine (routines are daily / every N h / on review), update or delete of entries.
- [ ] K5 (original plan) Harvest timesheets (RED ZONE: billable hours written to Harvest). Token in the Keychain (legion harvest-login), read tools for agents, a routine that drafts entries from calendar, PRs, Jira and commits; D5 (user, 2026-11-13): drafts only; the user approves on a Timesheet page and one click submits; nothing reaches Harvest without it.
- [x] K6 (prompt.txt + the ask tool's text; a guard test in Tools.test.ts; behavior not live-checked) The orchestrator decides more on its own (user's ask 2026-11-13): its prompt (Tools.MASTER) makes reversible, in-scope calls itself and reports them; it asks only for Red Zone items, outward or irreversible acts, and real forks in what the user wants.
- [x] K7 Notes beside questions (user's ask 2026-11-13): notify tool for the orchestrator; notes in the questions pane (after questions, dismissable, not needing you, counted apart in the header), in /questions, /drop; dismissing one is silent, a reply quotes it; NOTES=30 oldest dropped. Proof: agents/Html/View/Server tests, suite 315 pass / 2 known.
- [x] K10 Auto mode, more lenient again (RED ZONE; user's ask 2026-11-13: "still feels overly strict"; the four loosenings chosen by the user). Evidence: since the 12:23 restart (K2 live), the reviewer refused 5 calls, all push/fetch, each because the agent's task said "never push/fetch" (copied from local/rules.md), one after the user had approved shipping (work-tasks/refusals.py reads the agent logs). Built:
  - Network reads are read-only (Modes.readonly): git fetch (not --upload-pack), gh pr/issue/repo/run/workflow/release view/list (and pr diff/checks), gh search, gh auth status (not --show-token/-t, not --web), gh api GETs with no fields. So they skip the reviewer, and plan mode allows them.
  - A feature branch's plain push skips the reviewer (Modes.feature_push): `git push [-u|-q|-v] origin <branch>` or `origin HEAD:<branch>`, one command, not forced (+), not deleting (:x), not main/master/develop/trunk/release/N.x/gh-pages, not to upstream. Every other push is still reviewed.
  - The reviewer sees the user's last 8 messages (was 3). Its prompt says the user's messages outrank a task's written limits, network reads aren't sends, and it never refuses over step order, checks not yet run, or report format; pushes are refused only when forced, or to a default/shared/release branch the user didn't ask for.
  - local/rules.md: worktree agents may push their own branch when the task or the user asks, and may fetch; never force-push, push to the default branch, merge or remove a worktree.
  - The SECRETS check no longer matches `--set-upstream` (its `\bset\b`); the env/set part was dead (neither is read-only) and was removed.
  Proof: Modes/Tools tests 24/24, 11/11 mutants killed plus one that exposed the dead check (work-tasks/mut-k10.sh), suite 330 pass / 2 known, no new tsc errors. Not checked live: replaying the old refusals through the new reviewer (their full context isn't kept).
- [x] K9 Shell commands from the web (user's ask 2026-11-13, option 2): !command already ran from the web box; now !@name picks the device (several open: the error says how), the Files page has a box that runs a command in the shown file's folder or repo (cd quoted first), and the chat box's hint says so. Proof: View/Server/Pages tests, 5/5 mutants killed (work-tasks/mut-k9.sh), suite 328 pass / 2 known. Not built: a live interactive terminal (option 3).
- [x] K8 (Tools.titled/titling, spawn's titles described as always, prompt; agents.test spawn labels) Every manager gets a label (user's ask 2026-11-13): spawn's managers always titled; one not given gets a title from its task.
- [x] K4 Files pane + Git tab (Terax-style), read-only. Built: #files page (g f, palette): each agent's touched files (Tools.touched, crew.files), a file's lines numbered, git status/log/diff/branches of the shown file's repo (else the home repo), a log's commits open as `git show`; inline-code paths in the chat open there (View.view_path). Path: view -> server (Chat.look: shape, a device up, pending ids) -> device (Device.device_look: roots = work dir, home repo, spaces; realpath; secret names refused before and after links; 512 KB; no binaries; fixed git argv, rev checked) -> server (Chat.looked: only a device's, once per id) -> views. Agents can't reach it (not a tool). Proof: Device 11, Server look test, Tools touched, Pages files, View view_path; 11/11 mutants killed (work-tasks/mut-k4.sh); suite 320 pass / 2 known; no new tsc errors on added lines. Not done: an e2e in a browser against a live device; a 'mentioned' list (paths named in messages open on click, but aren't listed).
  - Paths come from the agent's own tool calls (read, edit, write, grep hits), plus paths it names in its messages that exist under its work dir or a space.
  - The web view gets a Files pane: a tree of those paths for the watched agent, and a viewer (syntax-highlighted, line anchors; diff for edited files). A path in a message turns into a link that opens it.
  - Reading goes through the device (read job), limited to the agent's work dir and the spaces; no symlink escape, size cap.
  - A Git tab beside the files (user's ask 2026-11-13, as Terax): the space's status, branches, log, and a commit's or the working tree's diff, read-only, through the device's read-only git (Modes.readonly).
  - Writes later (an edit sent as a reviewed edit call, so modes and the reviewer apply).
  - verify: Pages/View tests, path allowlist tests (../, symlink, outside the space refused), e2e.

Decisions (user, 2026-11-13): D1 Claude Code-like reviewer; D2 terminal reads + `legion device --install` launchd; D3 gmail.readonly; D4 tool calls + mentions.

## Later
- Web page reading: webfetch doesn't work on Bedrock; agents read pages with curl in the (guarded) shell. Our own fetch tool only if it can be made safe (results as data, SSRF/local-address refusal).
- `Mcp.test.ts` process-group tests ("children have their own process groups…", "the next start kills children…") fail 2 of 13 about 1 run in 6, at HEAD too: timing.
- Upstream test `Cloud.test.ts` "link_ask caps links … a day" fails in the full suite at some times of day (also at HEAD without local changes); passes alone.
- SearXNG engines: DuckDuckGo (captcha), Brave and Wikipedia fail; only Google CSE answers. Tune engines in ~/.unii/searxng/settings.yml.
- Upstream bug to report: Bun 1.3.8 DecompressionStream hangs on a Bun.file slice stream (Import.ts zip_file).
- Bigger import: tool I/O, older/full chat history, more pdf/xlsx, subagent transcripts.

## Review
- 2026-11-12, Crew UI and local sign-in (feat/crew-ui, A → D, one commit each, nothing pushed):
  `unii web` (Red Zone, reviewed and approved by the user), phones off by default, the web Crew view
  (Chat | Crew, tree with roll-ups, needs-you lane, focus card with actions, grid of tiles, timeline
  lane, pulses, multi-watch, demo crew at /?demo=1#crew), /crew full in the terminal, `unii device`.
  Suite 164 → 197 pass, the same 3 known fails. Found only end to end: boot() dropped the #crew hash.
  By hand still: a real crew (managers with workers) watched and steered from the web.
- 2026-11-12 fix (user report: "can't switch back to chat after clicking Crew"): with a crew, Chat mode drew
  the old footer crew list (Html.crew_html, from feat/hierarchy), one row per agent: with the demo crew it
  was taller than the window and covered the chat and the header (elementFromPoint at the Chat/Crew links
  hit footer rows). The footer shows no list with a crew now (the pill and Crew view do); crew_html, its
  CSS and its 3 tests removed (escaping and approve/deny are covered by the tree's tests). Proof: real
  clicks over CDP with the demo crew, Chat ↔ Crew 4 times, each hit the header link; footer 112 px in Chat;
  Html.test.ts 10/10; full suite below.
- 2026-11-12 fix 2 (user: still stuck on #crew, no agents): crew_bars rewrote the hash to the Crew's on
  every paint, so a paint between the click's new hash and its hashchange put #crew back, and the late
  hashchange read it. The mode is now read from the address at each paint, never written there;
  crew_sync writes it only when an act (Goto) or the server ("agent": none) moves the focus. Proof:
  CDP repro (replaceState to #chat with no event, a paint, then the hashchange): before, "#crew |
  crewmode"; after, "#chat"; an unknown agent and the logo still bring the address back to #crew; demo
  crew clicks Chat ↔ Crew ×4 pass; suite as before.
- 2026-11-12 rename (user: "Legion"; scope: name + command, keep data): "UniiChat" → "Legion" wherever it is
  shown (web, terminal, mail, greeting, README, tests); the command is `legion` (local/legion, a symlink
  to unii-local.sh; `unii` still works), and every "run unii …" a person is told says legion. Kept as
  they were: ~/.unii, UNII_* settings, the cookie, localStorage keys, the OAuth client name (MCP grants),
  the "unii" message kind, server log prefixes, ios/ (phones off), and the AI's own name "Unii" in its
  prompt and memories (asked separately). Proof: no "UniiChat" left outside ios/ and history; suite 194
  pass, the 3 known fails; `local/legion version` / `help` print legion, aligned.

## S: Security review fixes (main 0450e14 review, 2026-11-13), branch feat/security-review

Intent: close every finding of the 5-slice security review. Constraints: TDD (failing test first), each
slice touches only its owned files, Red Zone items (auth, sessions, credentials, access control, gating)
land as DRAFT for the user's sign-off. Success: every finding has a test that fails if the fix is removed,
full suite stays at baseline (328 pass, 2 known log-staging fails) plus the new tests.

- [x] SA gating (Modes.ts, Tools.ts, Mcp.ts): C1 zsh glob/brace bypass, git grep -O / reflog / sort
      --compress-program / file -C / flag-prefix matching; H2 refuse over-long actions instead of cutting;
      H3 review mcp__* (except a read-only allowlist) and computer, fence MCP output; M4 SECRETS on
      unquoted words + globbed paths reviewed; L reviewer reply must be exactly one JSON object.
- [x] SB device (Term.ts, Device.ts, Machine.ts, Hooks.ts, local/unii-local.sh, local/legion, new Proof.ts):
      H1 device proves the server (HMAC of a nonce with a 0600 per-install key) before sending its token
      or taking jobs; M2 job shells get an allowlisted env; M3 refuse writes to .claude/settings*, ignore
      project disableAllHooks; L hardened git args everywhere (fsmonitor, textconv, filters); L look_file
      blocks .git/config, token, *.json keys and opens with O_NOFOLLOW; M4 read/grep secret-path denylist.
- [x] SC server (Server.ts, Cloud.ts, Memory.ts, web/index.html): M1 single-use sign-in link + confirm
      click; M6 body size caps; M7 per-socket backpressure; L session expiry + sign-out-everywhere; L XFF
      rightmost hop; L generic client errors; L CSP + frame-ancestors + Origin/Host allowlist; H4 review
      routines run in plan mode; /api/proof route for SB; Memory.save 0600.
- [x] SD integrations (local/prime/redact.ts, Google.ts, local/google-login.ts, Import.ts, Config.ts,
      Harvest.ts, Auth.ts, local/harvest-login.ts): M5 redaction boundary + missing shapes; L revoke result;
      L import cycle/depth/inflate caps; I gateway URL must be https; H5 Harvest token readable only with a
      Keychain prompt.
- [x] SE iOS + CI (ios/**, .github/workflows/ios.yml): M8 session in Keychain (ThisDeviceOnly); L web view
      allows only the site origin + blob:, bridge and mic check origin; L XcodeGen sha256, actions pinned
      to SHAs, permissions: contents: read.

Review (2026-11-13): all five slices done test-first, every Red Zone change marked DRAFT awaiting the
user's sign-off. Proof: full suite 367 pass, 3 fail: the known log-staging pair and `link_ask`, which
fails the same way on a clean 0450e14 when cache.test.ts runs first (a frozen clock it leaves behind).
Mutation checks: SA 16/16, SB 36/37 (the survivor is the look_file re-check after open, a race no test
can trigger), SC 35/35, SD 10/10, H4 2/2. iOS: both targets typecheck against the iOS 27.2 SDK; not
built, signed or run on a device. Left open, by design or for the user: Google's Keychain grant is
still readable by an agent's shell (a prompt per inbox read is unworkable; documented in Google.ts);
the proof is checked just before a socket opens, not bound to it; no UI button for /api/logout-all yet;
the request ceiling is 4 GiB for imports.

Round 2 (an independent check of the branch, 2026-11-13): the settings guard now ignores case (an
agent could plant .claude/SETTINGS.LOCAL.JSON) and covers $CLAUDE_CONFIG_DIR, which Hooks.ts now
reads; one case-insensitive secret-path list for shell, read/grep/glob and the files pane; read-only
gh views and GET-only gh api, so unattended PR reviews can read the PR; proxy and CA vars kept in job
envs; MCP names with replace/reset/run/exec/query reviewed; redaction catches *_KEY, *_SECRET_*,
empty-user and @-in-password URLs, and no pattern is quadratic (14 crafted 1 MB lines < 200 ms);
the old Harvest token moves to the guarded store once; X-Forwarded-For only with UNII_PROXY=1; old
sessions keep 90 days once. Suite 379 pass, the same 3 fails; mutants 35/35 killed. Left for a
follow-up PR: devices reach the server over a 0700 unix socket, so the proof can't be relayed.

Final check (2026-11-13): the Mac folds Unicode lookalikes as well as case (ſettings.local.json is
settings.local.json), so the settings guard and read's secret check now compare NFKC-folded paths;
a shell command that isn't plain ASCII, or greps the whole home or disk, goes to the reviewer; gh -R
takes only OWNER/REPO, never another host. Suite 382 pass, the same 3 fails; 5/5 mutants killed.
Still open, by design: MCP review by name is a deny-list (an allowlist of read-only servers is the
sound version); a *_KEY value with no digit isn't redacted.

Round 4 (close what was left open, user's ask 2026-11-13):
- [x] U1 devices link to the server over a unix socket in the 0700 dir (no TCP proof to relay)
- [x] U2 Google grant behind a Keychain prompt, read once per device start and kept in memory
- [x] U3 MCP review by an exact read-only allowlist; a sign-out-everywhere button; *_KEY values
      redacted unless they look like identifiers
Round 4 proof: Proof.ts and /api/proof deleted (the 0700 dir's unix socket is the proof; a lone server
binds TCP without reusePort); the Harvest guarded token got its own item (it had shared the old,
bun-readable one, so the move never ran: found while doing U2); suite 393 pass, the same 3 fails;
mutants U1 20/20, U2 13/13, U3 12/12. Left: launchd start order on a real login, the prompts, and
iOS on a device are the user's checks; the K10 conflict is resolved when the second PR merges.
Round 4 check: an allowlisted MCP "read" given a file, path or dir argument is reviewed (playwright's
browser_console_messages takes a filename and writes it: an agent could have written ~/.zshenv); a
*_KEY value with digits before a dot is redacted; a multi-worker server says it opens no device socket;
the README says when to Allow a Keychain prompt. Suite 395 pass, the same 3 fails; mutants 2/2 (a
SECRETS entry for security/launchctl survived: both are already reviewed as not read-only, so it was
dropped).
## K: OKF knowledge for local agents (feat/okf-knowledge, from feat/security-review 3b77f8c)

Intent: Legion's agents look up company knowledge first, from the OKF MCP server
(oncorps-knowledge-framework, branch 0.x, `src/scripts/okf_mcp_server.py`, stdio, read-only,
one access-scoped build) and the OKF wiki (MkDocs, `search/search_index.json` at
https://ui-prototypes.oc-dev.oncorps.io/financial-services/ontology/). When they find nothing,
or something stale, they record a gap; gaps are batched into a DRAFT PR to OKF for a human.

Constraints: reuse Mcp.ts and local/mcp.ts (no new tool plumbing in Tools.ts); tool names fit
Modes.MCP_READS (search_/get_), so plan and auto modes allow reads unreviewed; one pinned wiki
host, response size cap, cache with TTL; OKF's agent write path (PLP-2837/2853) holds: agent
knowledge is Proposed, never self-approved, a human merges. RED ZONE: client segregation, a gap
found on client work must not carry client data into the shared repo.

- [x] K1 OKF MCP registered: local/mcp.extra.json "okf" entry (uv, OKF_DATASET_MANIFEST from
      ~/.unii/mcp.local.json, skipped with a note if the checkout or manifest is missing).
      → verify: local/mcp.test.ts case, live list shows mcp__okf__* tools.
- [x] K2 wiki MCP: local/okf-wiki.ts, tools search_wiki(query, k) and get_wiki_page(location),
      host pinned, https only, 5 MB cap, cached index, HTML to text. → verify: red-first tests
      (wrong host refused, oversize refused, ranking, page fetch), Modes allows both read-only.
- [ ] K3 agent brief: rules.md says look up OKF (mcp__okf__ then wiki) before guessing company
      facts, cite page or record, and on a miss call record_gap.
- [x] K4 gap log: tool record_gap(topic, wanted, evidence) appends to ~/.unii/okf-gaps.jsonl,
      redacted (local/prime/redact.ts), client names refused (RED ZONE draft). Note: name has
      "record" → MCP_WRITES? check; it is a local write, review in auto mode is fine.
- [ ] K5 gap loop: routine (Chat.automate) weekly, read-only agent dedupes gaps against OKF,
      writes Proposed docs in a fork worktree, runs OKF gates, opens a DRAFT PR to OnCorps:0.x;
      never merges. Stale side: `list_stale_records.py --as-of` drives refresh proposals.
      RED ZONE draft, needs sign-off before it runs unattended.

K review (2026-11-13): K1 is config only. OKF's server registered with Claude Code reaches Legion through
local/mcp.ts, proven live: 7 mcp__okf__* tools, list_cqs answered through Mcp.pool against an
internal build of 0.x@8904fff. K2+K4 are in local/okf-wiki.ts (one server, 3 tools; tests 9/9,
red first; live search checked). K3 is in local/rules.md. Full suite: 376 pass, 3 fail, the known
three (link_ask, two log-staging).
K6 (RED ZONE draft): plan mode runs exactly the MCP reads that auto mode lets by unreviewed:
Modes.MCP_READS (U3's list, unchanged) or the user's mcp_reads, with no file argument. Agents'
write and edit now refuse ~/.unii (or $UNII_DIR) config.json, mcp.json and mcp.local.json, in any
case. 6 of 6 mutants killed. K7: local/okf-mcp.sh starts OKF's server from ~/.unii/okf (a link)
or $OKF_CHECKOUT, rebuilding the internal dataset when the commit moves; mcp.extra.json lists it,
and an extra server that Claude Code already names is skipped. Proven live through Legion's own
config: 10 tools, list_cqs and search_wiki answered. Full suite: 411 pass, 3 fail (the known 3).
Open: a full-mode shell can still write ~/.unii/config.json, as it can write settings files. (b) K5
is not built: design below, RED ZONE draft for sign-off.

K5 design (RED ZONE draft, not implemented): `legion okf-propose`, by hand first, as a weekly
read-only routine (Tools.start plan=true) only after sign-off. 1) It reads ~/.unii/okf-gaps.jsonl
and drops gaps OKF now answers (search_wiki, okf list_cqs). 2) Egress gate, fail closed: it
refuses a gap that names any okf-fs:Client (from the okf MCP server, internal scope), any
client-named repo path, or any redact.ts hit. Refused gaps stay local and are listed to the user.
3) It writes Proposed docs in an OKF worktree off upstream/0.x, runs verify_bundle, pytest and
mkdocs --strict, and opens a DRAFT PR from the user's fork with every gap cited (repo@commit).
It never merges and never self-approves (PLP-2853). 4) Stale side: list_stale_records.py --as-of
today feeds the same path.

## Files pane: highlighting, Markdown, HTML preview (2026-11-13, feat/files-render)
- [x] Hl.ts: in-house highlighter (comments, strings, numbers, keywords; ts/js, py, sh, json, yaml, sql, css, toml), escaped → verify: Hl.test.ts red then green
- [x] .md rendered via md_parse/block_html, "source" toggle → verify: Pages.test.ts
- [x] .html previewed in `<iframe sandbox srcdoc>` (no scripts, opaque origin), "source" toggle → verify: Pages.test.ts (sandbox attr, srcdoc escaped)
- Proof: Hl 2/2, Pages 15/15; mutants 4/4 killed (no sandbox, srcdoc unescaped, toggle not reset, no highlight); suite 419 pass, 3 known fails (link_ask, two log-staging).

## Files explorer (2026-11-13, feat/files-explorer)
- [x] Device: Look kind "dir" (`@roots`: the roots; a folder: its entries, dirs first, capped, .git skipped, secrets marked locked) and kind "open" (a file under a root in VS Code, else `open -t`; no shell) → verify: Device.test.ts
- [x] Server: look/looked accept dir and open → verify: Server tests
- [x] View: folder cache + expanded set, Tree act (asks once), dir answers never replace the shown file → verify: View/Pages tests
- [x] Page: Explorer tree above agents' files, roots loaded on open; file → Look; Open in editor button → verify: Pages.test.ts
- Also (user's ask): several workspaces at once, picked from the roots, kept per browser.
- Proof: Device 17/17, Server look test, Pages 15/15; mutants 7/7 killed; suite 422 pass, 3 known fails.
- Next, separate Red Zone PR: in-browser edit + save (user's ask).

## Memory and crew extras (feat/memory-crew, one PR)
Five slices, each in its own worktree off feat/memory-crew, red tests first, merged here.
- [x] M1 Pins: user-only pin act (web; device refused, no agent tool), <pinned> block in the chat's view, 12 pins / 16 KB off HIGH, kept in view.json → verify: Pins.test.ts
- [x] M2 Memory page (#memory): roots via root/zoom reads, lines unfold to messages, Seek jumps to the chat → verify: Pages/View tests
- [x] M3 Search: server-side case-insensitive substring over main/, q ≤ 200, ≤ 50 hits, yields every 256 messages, newer search cancels → verify: Recall.test.ts
- [x] Undo: snapshot per agent/repo/turn before the first write/edit/non-plan shell (Undo.ts, Device.device_snap), temp index, secrets out, 20 kept; "Undo last turn" (confirmed, user act only) keeps a redo ref, refuses HEAD moved / outside roots / home dir → verify: Undo.test.ts, Tools/Server tests
- [x] Open in Claude Code: brief (Tools.handoff) to a 0600 file, 0700 .command reads it, single-quoted device paths only → verify: injection test
- [x] Away card on Home (Cockpit.away, Pages.away_html): ≥ 2 h away, failed first, cap 5, questions/notes as counts + links only → verify: Cockpit/Pages tests
- [x] Fetch.ts `fetch` tool: SSRF guard (v4/v6 ranges, literal IP forms, local and own hosts, every address, per-hop redirect check, re-resolve after), 2 MB, 15 s, content types, HTML to text; auto reviews, plan refuses, `fetches: 0` off → verify: Fetch.test.ts, Modes test
- [x] Routines with no tab: cause was Chat.free dropping viewless chats, Chat.wake skipping routine chats, no launchd server; Routines.timed keeps/wakes them; `legion server --install` (key via UNII_KEY_HELPER, none in the plist) → verify: Server/Routines/Launcher tests
- [x] Rough summaries while the budget is spent (Agent.spent, Memory.rough/redo), persisted, redone oldest first once the gateway answers → verify: rough.test.ts
- [x] Consent and reviewer text name "the server" for a call with no device (fetch) → verify: Tools.test.ts
- Proof: mutation checks per slice (pins/map/search 21, undo/handoff 16, away 10, fetch 31, routines/rough 14), all killed; merged suite 474 pass, 2 known fails (local/prime logs).
- [ ] RED ZONE sign-off: Fetch.ts address guard; Undo.ts restore; UNII_KEY_HELPER launch path
- [ ] User: `legion stop`, then `UNII_KEY_HELPER=/Users/Shared/bin/get-litellm-key.sh legion server --install`
- [ ] By hand: Open in Claude Code (sandbox blocks `open`), Undo on a throwaway repo, away card after 2 h, 📌 and Memory page in a browser

## Security review 2 (fix/security-review-2, one draft PR, RED ZONE)
Review of 8facfc1..main (PRs #9–#20). Red test first for each, then the fix.
- [x] S1 undo/handoff refused from a device socket, as pin is (Server.crew_op) → verify: Server.test.ts
- [x] S2 undo recorded (Chat.mark), so a resent act doesn't undo a second turn → verify: Server.test.ts
- [x] S3 write/edit refuse the repo's local/mcp.extra.json and the scripts it starts (Machine.gating) → verify: Machine.test.ts
- [x] S4 fetch and web search answers fenced as untrusted (Google.fence) → verify: Tools.test.ts
- [x] S5 undo restore skips gating paths (.claude/settings*.json) as it skips secrets → verify: Undo.test.ts
- [x] S6 Files grep splits on NUL (-z), so a colon in a folder can't hide a secret's line → verify: Device.test.ts
- [x] S7 handoff script: `claude -- "$brief"` → verify: Device/Undo test
- [ ] S8 dropped: SuccessfulExit=false wouldn't help (a killed server and a failed key helper both exit unsuccessfully); a real fix is `legion stop` booting the launchd job out: follow-up
- [x] S9 Md links: `/\host` refused → verify: Md test
- Open (user's design call): a terminal and an agent's shell share one device identity, so consent/plan/approve/routine can't be refused to devices without breaking `legion`.
- Review: 8 fixes, red test first for each; 9/9 mutants (each fix reverted alone) killed; suite 490 pass, 3 known fails (link_ask, two local/prime logs); bundle builds.
- Left as Low follow-ups: fetch metadata before the re-resolve, dids cap, gateway text to users, view.json rough/pins checks, search cost, <pinned> escaping, key-helper owner check, key in env's argv, okf-wiki caps, undo deleting a re-unignored file, mcp.extra.json personal paths.

## One Legion server at a time (branch fix/one-server)
Why: three e2e servers from 12 Nov ran side by side on 9555 for five days. Main.lock is per
UNII_DIR, and the e2e run deleted its dir between starts, which removed the lock file, so every
start took a fresh lock. A server on another UNII_DIR is never blocked at all.
Promise: by default, one Legion server per user on this machine. A second start ends at once
with a clear message (who holds it: pid, dir, port) unless UNII_ANOTHER=1. Restarts by launchd
still work (a holder that is ending is waited on briefly).
Edit scope: Server.ts (Main.lock + serve), Server.test.ts / Secure.test.ts (spawned servers set
UNII_ANOTHER=1), README (one line), local/unii-local.sh only if `legion serve` needs a flag.
- [x] Red test: with a live holder at the machine lock, a second `Server.ts` on a fresh UNII_DIR
      exits non-zero and names the holder; with UNII_ANOTHER=1 it serves
- [x] Red test: deleting the holder's UNII_DIR doesn't free the machine lock
- [x] Server.ts: machine lock at ~/.unii/one.lock (fixed, outside any other UNII_DIR), same
      unix-socket mechanism as Main.lock; the holder answers a connect with its pid/dir/port
- [x] Spawned-server tests pass with the real Legion running (they set UNII_ANOTHER=1)
- [x] Proof: suite green apart from the 3 known failures; mutants (no machine lock, override
      ignored) each fail a test
- [x] Found mid-way: the holder ending each connection made the next start see ECONNRESET,
      take it as stale, delete the live lock and serve. Now the holder only writes, and only
      ECONNREFUSED/ENOENT means stale; a non-socket lock is left alone (fail closed)

Review: full suite 495 tests, 493 pass, 2 fail (the known log-staging pair); 4/4 mutants
killed (lock per dir, override ignored, any error = stale, holder silent); a kill -9'd
holder's lock is taken over; tsc adds only environment errors (no node/bun types).

## Open tabs pick up new web code (separate PR, after the one above)
Why: a tab opened before a server restart keeps running its old app.js; it reconnects to the
new server but never reloads (the 16 Nov drop fix looked broken for this reason).
Promise: the server sends a hash of the app.js it serves when a socket opens; a tab whose hash
differs reloads once (or shows "Legion was updated: reload"), with any unsent text in the box kept.
- [ ] Plan the details once the first PR is merged

## TUI parity with the web UI (2026-11-17, feat/tui-parity)

Intent: the terminal (Term.ts + Paint.ts) can do what the web UI does, by reusing
View.ts / Cockpit.ts helpers and the existing acts. No new server acts, no logic
copied out of web/src. Constraints: one slice per commit, a red test first in
Paint.test.ts / View.test.ts style (pure View -> lines), tsc clean, full suite
shows no new failures (3 known baseline fails).

- [x] T1 Status line shows gateway budget + busy: Term builds StatusLine without
      budget/busy (Term.ts:1161); share one builder with view_status (View.ts:1293)
- [x] T2 `/attach <path>`: image -> drop_image path, text -> drop_text fenced block
      in the box; a bracketed paste that is one existing path does the same
- [x] T3 Pins + recall: pin key on a message, `/pins`, `/recall <words>` showing
      `recalled` hits, Seek jumps to the hit
- [x] T4 `/undo <agent>` (typed y/N confirm) and `/handoff <agent>` via the
      existing Undo/Handoff acts; show the device's `did` answer
- [x] T5 `/home`: cockpit cards + "While you were away" card + Archive (Cockpit.home_cards, away)
- [x] T6 `/inbox`: inbox_sections, Review / Fetch acts, badge in the status line
- [x] T7 Files, read-only: `/look <path[:line]>`, `/ls [dir]`, `/find`, `/grep`, git view
- [x] T8 Files, writes: edit + save (separate slice; same server guards as the web)
- [x] T9 Code highlighting in the terminal: split Hl.ts into tokens + HTML renderer, add ANSI renderer
- [x] T10 `/digest`, `/transcripts`, `/timesheet` pages; agent timeline lane on agent pages
- Out of scope: voice/mic, HTML preview iframe (show source instead), Ctrl+K palette (`/help` stays)

Review (2026-11-17): T1-T10 done, one red test first per slice, no server change.
Choices: a pasted path attaches only images (a text file's path stays text, as
Claude Code); /undo confirms by a trailing yes (as /delete <name>); the away card
prints on FocusIn after AWAY; /edit runs $VISUAL/$EDITOR on a 0600 temp copy and
saves by the web's Save (device checks the hash); /open was taken, so /editor;
T6's status-line badge dropped (home stats and /inbox's changed count instead).
Shared with the web now: View.view_status_line, minute, undo_ask; Cockpit.MARK,
TIMESHEET_ROUTINE; Hl.hl_spans under hl_lines.
Proof: full suite 512 pass, 2 fail (the known log-staging pair); tsc on changed
files: only no-bun-types noise, plus main.ts:545 (`code` possibly null, on main
before this branch); 4 mutants (undo yes, paste take, review fit, edit error)
each killed; web/app.js rebuilt. Not run by hand in a live terminal.

## TUI elements that feel like the web UI (2026-11-17, feat/tui-elements, on main after #24)

Intent: the terminal looks and moves like the web: a full-screen deck of pages
(the web's #home, #inbox, #crew, questions pane, #memory, a file view) reached
by the web's g-chords and a `/` menu, and a footer with the web's nav badges,
bottom bar and toasts. Constraint: the chat stays inline scrollback (native
scroll/select/copy); the deck is the alternate screen, as /crew full is now.
Rendering and keys only: data from View.ts / Cockpit.ts, acts as they are, no
server change. One slice per commit, red test first (pure: View -> lines, key
-> state), tsc on changed files, full suite no new fails (2 known log-staging).
#24 merged mid-way; the branch is on main, first commit a fix to #24 (notes printed squashed).

Design: new Deck.ts (imports View, Cockpit, Paint, Hl): the deck's state
`{ page, sel, top, ... }`, `deck_key(v, deck, key) -> { deck, acts, done, ... }`
and `deck_lines(v, deck, w, h, now)`; crew stays View.view_full + Paint.crew_full,
called from it. Term.ts swaps `t.full` for `t.deck`; on a pipe, commands print
text as now.

- [x] E1 Deck frame: Deck.ts, head line as the web's nav (Home · Inbox n · Chat ?n ·
      Crew pill · mode), `g h/i/c/q/m` switch pages, Esc/q leave; /crew full is its crew page
- [x] E2 Crew keys: u undo (asks View.undo_ask, y confirms), o handoff, A archive done
- [x] E3 Home page: away card on top, stats, working/done cards, up next; j/k, Enter focus, A archive
- [x] E4 Inbox page, the web's page_keys: j/k, space fold, Tab detail, Enter open, v pick,
      / filter, r review / f fix the picks (claude with Shift), R refresh
      -> checkpoint with the user here (diff ~300 lines)
- [x] E5 Questions page: j/k, 1-9 an offered answer, Enter types `/answer n ` in the box, x drop; notes under
- [x] E6 Memory page: pins and the last recall's hits; Enter seeks, p unpins, / types `/recall `
- [x] E7 File page: the file shown, Hl-colored, numbered, scrolled (j/k, PgUp/PgDn, g/G),
      / find in it, n/N, e edits; /look on a terminal opens it when the file comes
- [x] E8 Footer: the nav badge line in place of the bare tabs line, Cockpit.bar_text on the
      crew panel, toasts (a note gone after 7 s) for confirmations
- [x] E9 Wide terminal (>= 120 cols): a home column beside the crew panel (needs you, inbox, up next)
- [x] E10 `/` menu: input starting `/` shows matching commands and palette items (pages, agents,
      PRs, spaces) above the box; Up/Down pick, Tab completes, Enter runs (Screen key hook)
- [x] E11 Mouse in the deck (SGR 1006: click selects, wheel scrolls), a spinner on working agents

Review (2026-11-17): E1-E11 done, a red test first per slice, no server change.
Found on the way, fixed with tests: #24's multi-line notes printed squashed
(View.note_rows); the web's picked panel sent an Alerts row's key
("alert:<url>") as the PR to fix (Cockpit.picks_acts, now shared).
Choices: page commands open the deck on a terminal, print on a pipe (asked:
keep); from the chat the chord is Ctrl+G + letter (a bare g is typing); the
mouse is reported only in the deck (the chat keeps native selection); /look
opens the file page only for the path this terminal asked (the server tells
every view what a device showed); a chord starts its page anew.
Shared with the web now: Cockpit.CHORDS (web gains g p: memory),
picks_acts, FIX (Pages' copy gone), card_text, stats_text.
Proof: full suite 542 pass, 2 fail (the known log-staging pair); tsc on
changed files: only no-bun/node-types noise; 4 mutants (picks by URL, keys
hook, undo asks first, Esc drops picks) each killed. Not run by hand in a
live terminal.
Open: the terminal also prints looks another view asked for (since #24).

## Todo page: what agents need the user to do (2026-11-17, feat/todo-page, after #25)
Why: agents have `ask` (decisions) and `notify` (FYI) but no place for "only you can do this":
approve PR #352 on GitHub, run `! gcloud auth login`, send Dan the draft. These get buried
in notes or the chat. (Planned before TUI parity, never built: picked up now.)
Promise: any agent (main and native subagents) files an action for the user with a new
`assign` tool; it shows on a #todo page (web) and the deck's Todo page (terminal) with who
filed it and when, until the user ticks it Done or Drops it. Done: the filer hears it (main:
a message quoting it and a turn, as an answer; a subagent at work: told, as a tell; gone:
main's note). Drop: a note, no turn. An agent withdraws its own with `close`.
Names: tool `assign`, type `Assignment`, state `assigned` (`Todo`/`Tools.todo` is the agents'
own checklist), act `Assignment` / client `assignment`; chord `g o`.
RED ZONE (access control, DRAFT for the user's sign-off): Done/Drop is a view's act only;
a device's socket (within an agent's reach) is refused, as `Chat.pin` refuses it.
- [x] Red tests: Todo.test.ts (server: filed by main and a subagent, cleaned and capped, at
      most ASSIGNS open, close only your own; Done/Drop from a view only; filer told once;
      the state tells the list); Pages/Cockpit (#todo page, sidebar count, Home Apps, palette);
      Deck (the Todo page: pick, d done, x drop)
- [x] Implement until green; mutation check (who-check, device guard, cap, told-once)
- [x] End-to-end: one real page load of #todo (lessons 2026-11-12: routing changes get one)
- [x] Proof: full suite, bundle rebuilt, tsc on changed files

Review (2026-11-17): built web + terminal. Also a Todo tab in the web's top bar (with its
count) beside the sidebar's, and `/todos [done|drop <n>]` + the deck's Todo page (d, x).
Proof: full suite 547 pass, 2 fail (the known log-staging pair); tsc on changed files: no
diagnostic on a changed line (Server.ts's are old: Agent, BodyInit, ImportMeta); 4 mutants
(close anyone's, no device guard, not removed so told twice, no cap) each killed; end to end
on a throwaway server in headless Chrome over CDP: #todo lists both seeded todos with who and
when, the sidebar and top bar show 2, a real click on × drops one (page and view.json), g o
from Home goes to #todo, no page errors.
RED ZONE signed off by the user 2026-11-18: the view-only guard in Chat.assignment.

## Super auto: Legion takes its own pick where you always would (2026-11-18, feat/super-auto)
Why: auto mode reviews tool calls, but the attention cost is the questions: 445 answered in
about a week. Where its pick was readable, the user took it 75%+ of the time (push/branch 8/8,
ticket scope 12/14, PR approve/merge 49/65, retry 14/21, access 1/3).
Promise: a 4th mode, `super`, the new default. It answers a question with the orchestrator's
own pick, without asking, only for a question kind that has earned it; every other question
is asked as in auto. Tool review is unchanged (auto's reviewer still runs).
- Data: `ask` gains `kind` (push | scope | retry | merge | access | redzone | money | outward |
  other) and `pick` (index of the option it recommends). Each answer records (kind, picked?).
- Unlock (per kind): >=20 answered with a pick and >=85% taken (17/20). A new user has
  nothing unlocked, so super behaves like auto; the mode picker shows progress per kind.
- Floor, never unlocked: access, redzone, money, outward; a missing/unknown kind or no pick
  (fail closed); a merge marked `prod: true` (depends on other merges/deploys first, or can
  affect prod). The prompt tells the orchestrator when to set it.
- Decided for you: an auto-taken answer goes to the chat as "Decided for you (super auto): ..."
  and to a list on the Questions page with Undo, for 24 h or until dismissed. Undo sends
  "The user reversed decision N: <their answer>" (a turn) and counts as an override.
  2 undone in a kind's last 10 auto-decisions: the kind relocks and needs 20 new answers.
- Learn from overrides: an answer that is not the pick is added (one line, deduped, capped)
  to a preferences note in the orchestrator's prompt, so its picks get better.
- Bootstrap: an import of past answers from the chat log (the "my pick"/"(rec)" matcher used
  for the numbers above), counted as estimated, so this user starts with history.
RED ZONE (who decides: access-control policy, DRAFT for the user's sign-off): Modes.ts gains
`super`; the unlock rule, the floor and the relock are pure functions there.
- [x] Red tests: Modes (unlock at 17/20 not 16/20, floor never unlocks, no kind/pick asks,
      merge prod asks, relock at 2 of 10); Tools/Server (super answers with the pick and
      logs it, auto still asks, Undo sends the reversal once and counts); bootstrap matcher
- [x] Implement until green; mutation check (floor, threshold, relock, prod flag)
- [x] Web + terminal: mode picker shows `super` with per-kind progress; Decided-for-you list
- [x] Proof: full suite, tsc on changed files, end to end on a throwaway server

Review (2026-11-18): Modes.unlocked/decides/took/counted/decided/undone/relocks/guess/
imported (pure, RED ZONE); Tools.question files or Tools.decide answers; Chat.tally counts
answers and Chat.like learns overrides (Tools.likes: a block in main's call context, not the
system prompt, so the cache holds); Chat.decision (view only) undoes or dismisses; Memory
imports past answers once (Memory.past_answers) when view.json has no tallies. Web: the
Questions pane's Decided-for-you list (Undo, a box for what instead, ×) under the kinds'
progress, the green super chip, the palette; terminal: the deck's Questions page (u, Enter
/reverse, x), /reverse <n> [answer], /drop of a decision. Choice: a merge decides only when
marked prod: false (unset asks: fail closed).
Proof: full suite 556 pass, 2 fail (the known log-staging pair); tsc on changed files: one
diagnostic on a changed line, Memory.ts readdirSync's untyped callback (no node types, as the
old line 377); mutants (no floor, 80%, relock at 3, prod only when true, no prod check, no
device guard, decision not removed) each killed; end to end on a throwaway server (9555) in
headless Chrome over CDP: the pane shows "Decided for you", "push 20/20 ✓ unlocked · retry
14/21 estimated (needs 85%)", the item and Undo; a real click on Undo removes it, view.json
holds no decision, push at n 21 took 20, the log holds "The user reversed decision 5
(Push AO-1 to origin?): do not do this, ask me"; no page errors.
RED ZONE signed off by the user 2026-11-18: Modes' unlock/floor/relock, Tools.decide, Chat.tally,
Chat.decision's guard. With it, two follow-ups (red tests first, each reverted once and caught):
the kind guess checks access before merge, and a live question worded as access always asks
(Modes.decides, whatever kind it says); approving a plan lands in super (/plan yes [super|auto|full],
web Approve: super). Suite 556 pass, 2 known log-staging fails.

## Explain tab: what the crew is building, for a manager (after super auto, feat/explain-tab)
Why: the user wants one page saying, at a manager's level, what new behavior is being built
right now and why, kept current, and a place to ask about it without interrupting the
orchestrator.
Promise: an #explain page (web) and deck page (terminal). An observer (config `observer`,
default Haiku 5.5, like `compactor`) rewrites it when the crew, the plan or open PRs change
(debounced, at most once per 5 min, and only after a change): one card per workstream with
what, why, status and what to watch, in plain words with no code detail. A box on the page
asks the observer. Its answer shows on the page only: no chat message, no main turn, no tools
(it reads the snapshot it is given), budget checked as for any call (Chat.afford).
- [x] Red tests: summary refresh (debounce, only on change, kept in view.json); Q&A never
      reaches main's chat or queue; the observer gets no tools; page + nav + chord (g x)
- [x] Implement; prompt for manager-level summaries (agent output treated as data)
- [x] Proof: full suite, tsc, end to end (a real load of #explain, one question answered)

Plan (2026-11-18, feat/explain-tab from origin/main):
Edit scope: new Explain.ts (pure: snapshot text, hash, due, cards parse, Q&A kept, prompts,
"updated N min ago") + Explain.test.ts; Config.ts OBSERVER; Memory.ts (mem.explain in
view.json); Server.ts (Chat.snapshot, Chat.observe on the routines' tick, Chat.explain the
view-only ask act, Chat.explained tells views an "explain" message, sent on join too; RED
ZONE guard); View.ts ("explain" page, route, message, act); Cockpit.ts (g x, palette,
/explain text and cmd); Deck.ts + Term.ts (deck page, "/" types /explain, /explain [q]);
web Pages.ts/Html.ts/main.ts/style.css (page, sidebar, top bar, Home app, ask box); README.
1. Red: Explain.test.ts (pure + server subprocess, AskAI.ask stubbed) → verify: fails for
   the missing module/functions, not syntax
2. Red: Pages/Html/Cockpit/Deck/View tests → verify: only the new tests fail
3. Implement Explain.ts, Config, Memory, Server → verify: Explain.test.ts green
4. Implement View, Cockpit, Deck, Term, web → verify: those suites green
5. Proof: full suite (2 known log-staging fails only), tsc strict on changed files, mutants
   (Q&A into chat, no debounce, no device guard, observer with tools), bun run web, e2e

Review (2026-11-18): shipped as planned. Explain.ts is pure (snapshot text with no times, FNV
hash, explain_due, cards parsed and cut, Q&A kept, "updated N min ago"); Server.ts adds
Chat.snapshot, Chat.observe (on the routines' 60 s tick: due only on a changed snapshot and 5
min after the last try; nothing going on: no call), Chat.explain (the ask) and Chat.explained
(an "explain" message to views, sent on join). The observer's calls go through AskAI.ask with
searches 0 and server "" (no tools), bill "explain", 90 s cap. Deck's nav lists Explain last
so the 100-column nav keeps Questions; its old "g x is no chord" tests now use z.
Proof: red first (missing module/functions); Explain.test.ts 5/5 (pure + server subprocess with
AskAI.ask stubbed: no tools, snapshot in <snapshot>, debounce, device refused, one ask at a
time, answer on the page, main's chat count/wait/sent/turns unchanged, kept in view.json);
full suite 557 pass, 2 fail (the known log-staging ones); each commit's tree green on the
touched suites. Mutants (work-tasks/mutate.sh, baseline 5/0 first): Q&A noted in the chat,
no debounce, no device guard, observer with web searches: each 4 pass 1 fail (no debounce:
3/2); the debounce and device mutants fail the server test by its 5 s timeout. tsc strict on
the 11 changed files: per-file counts as HEAD's but Server.ts +1, a setTimeout(...).unref on
`number` (no @types/node noise, as themes' identical line). End to end (work-tasks/
explain-e2e.ts: Server.ts on 9555, temp UNII_DIR, AskAI.ask stubbed, headless Chrome over
CDP): #explain shows the card and "updated just now", top bar and sidebar link it, a real
click and typed question is answered in the page's thread and kept in view.json, the chat
page doesn't show it, g x from Home goes to #explain, no page errors; the observer asked
twice (OBSERVE, ASK) with searches 0 and no server.
RED ZONE signed off by the user 2026-11-18: the view-only guard in Chat.explain.

## GChat bridge: reach Legion while AFK (feat/gchat-bridge)
Why: the user is AFK often; Tailscale is against policy; the web UI is loopback-only.
gchat_daemon (skunkworks) proved the Chat loop but posts as the user (no notification) and
scrapes a terminal. Legion already has structured questions, notes and todos.
Promise: one private Chat space (config `gchat_space`, e.g. spaces/AAQAN3re3K8) is a second
view of the questions pane.
- Out: each new question, note, todo and super-auto decision is posted once, through the
  space's incoming webhook (key `GCHAT_WEBHOOK_URL`, read like the other keys in Config.VARS,
  never logged), as a bot message, so the user's phone pings. One thread per item; text
  capped like gchat_daemon's chunking (4000 chars).
- In: Legion polls the space (every 15 s, while there is an open item) with the existing
  read-only grant (chat.messages.readonly); a reply in an item's thread goes to the same
  path as the web UI: a question -> Chat.reply; a decision -> Chat.decision (undo); a todo
  -> done / drop; a note -> a user message. Nothing else is read.
- Off unless both `gchat_space` and the key are set. No new OAuth scope, no public endpoint.
RED ZONE (who may answer: access control; signed off by the user 2026-11-18): a reply counts only
if its sender is the signed-in Google user (users/<id> from the token), in that one space, in
the thread of an item still open, and newer than the item. Bot, webhook and anyone else's
messages are ignored (deny by default); a reply is acted on once (message name kept).
Answers that Chat.reply refuses (credit, device-only acts) are refused here too.
- [x] Red tests: post once per item (no repost on restart); text cap; sender check
      (other user, bot, webhook, wrong space, closed item, older than item: ignored);
      replay once; reply -> Chat.reply / Chat.decision / todo; off when unset; key not logged
- [x] Implement (Gchat.ts: post, poll, route; Server.ts tick wiring); mutation check
      on the sender, space and once rules
- [ ] Proof: full suite, tsc on changed lines (done); end to end against the real space
      (user runs it: one question answered from the phone). 2026-11-18: posting proven (the
      phone notified); replies not: every poll stopped at "who is signed in is unknown",
      as tokeninfo gives no sub without the openid scope. Fix (the user's pick, A): openid
      added to SCOPES, Google.me reads OpenID userinfo's sub; the user signs in again
- [x] RED ZONE signed off by the user 2026-11-18 (A): openid added to Google's scopes (who is
      signed in, no data) for the bridge's sender check; Google.test: every other scope still
      .readonly, me's token in a header only, an old grant or an odd sub throws
- [x] RED ZONE signed off by the user 2026-11-18 (option A): the server reads the guarded
      Google grant itself when the bridge is on (Chat.gchat_token; U2 widened to the server),
      read once at start so its one Keychain prompt comes while the user is there; a refused
      read leaves the bridge posting only. Not B: a device relay would let an agent forge
      replies. The user keeps `legion device` running while away; when the chat is let go
      (no view or device) Chat.unbridge posts "Legion stopped listening" to the space, once.
      Proof: Gchat.test.ts 7 pass; mutants (no goodbye on free, no token source) killed.
Done: the webhook rotated 2026-11-18 (the pasted URL dead); the new one in the Keychain.

Review (2026-11-18, feat/gchat-bridge). Gchat.ts is pure but its post: gchat_items (open
questions q<id>, notes n<id>, todos t<n>, decisions d<id> within DECIDED_MS), gchat_chunks
(4000 with a "[i/n]" label, cut at a blank line, a line, else hard), gchat_post (threadKey +
REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD; a failure says its HTTP status or "not reachable", never
the URL), gchat_replies (RED ZONE: sender == users/<sub> and HUMAN, name and thread in the space,
the thread of an item posted and still open, createTime after the post's createTime, not in
acted), gchat_act (a reply as the view's act). Google.replies lists the space's messages since
the oldest open post (chat.messages.readonly); Google.me is OpenID userinfo's sub (the openid
scope, added 2026-11-18; the token in a header). Server.ts Chat.bridge (a 15 s timer next to the tick, only when on): posts new items
(10 a pass, a failed one next pass), forgets closed ones, then Chat.bridged keeps each reply's
name as acted before sending it through Chat.act(..., device "") so Chat.reply's, assignment's
and decision's own checks (open item, credit) apply; a refusal or a reply not understood is
posted back into the thread. State in view.json (gchat: posted, acted, the last 500).
Proof: Gchat.test.ts 7 pass (pure: on/off, chunks, post, the reply rules, the act mapping;
server in its own process with fetch stubbed: 5 items posted, a failed post retried, none
again after a restart, the 4 replies routed to Chat.reply x2 / todo done / decision undo,
none acted on twice, other user / bot / older ignored, off with either config unset, the key
in no output nor view.json). Mutation check (work-tasks/mutate.ts, baseline 7/0): sender,
HUMAN, open item, time -> 5/2; space, acted filter, acted kept, unknown signed-in user -> 6/1.
Full suite 573 pass, 2 fail (the known log-staging pair). tsc (strict, no bun/node types) on
changed lines: only the timer's .unref on `number` (as the tick's line beside it).
Also: Chat.free still lets a chat with no view or device go (the bridge's timer with it):
keep `legion device` running while away.

## Agents wait, set timers, propose routines (feat/agent-timers, user's ask 2026-11-18)
Intent: agents wait for time, not only for reports. Constraints: reuse Routines.ts, Chat.ticked,
Machine.nap; no new UI beyond a label. Success: tests green, full suite at baseline.
- [x] wait({seconds}) 1..600, everyone (OWN): Machine.nap on the call's signal; a stop cuts it
- [x] timer({minutes, note} | {close}) 1..1440 min, 5 each, 20 a chat; Memory timers/timered (view.json)
- [x] Chat.ticked -> Chat.rang: Unii's timer a turn (as Chat.report), an agent's via Tools.tell
- [x] Chat.free / Chat.wake keep or open a chat with a pending timer (Routines.timed)
- [x] Tools.stop drops a stopped agent's timers
- [x] routine({name, task, when, why, tier}) Unii only, by the clock only: added off, by/why, a note
- [ ] RED ZONE (DRAFT, needs the user's sign-off): an agent-written routine runs only after the
      user's own Turn on; Chat.routine (add, toggle, drop, run) refuses a device's socket (an
      agent's shell can reach it), as Chat.assignment does. Was unguarded before this branch.
- [x] Labels: web Routines "Proposed by Unii: why. Turn it on to approve."; /routines the same
- [ ] Live check: a 1-min timer for Unii fires as a turn; a proposal shows off; Turn on runs it

Review: Timer.test.ts (spawned server) + 6 Routines tests. Mutation check, each mutant 0/1 on a 1/1
baseline: proposal on:true, no Unii-only, no device guard, stop keeps timers, close another's,
Unii's timer no turn. Full suite 581 pass, 2 fail (the known log-staging pair). tsc (strict, 6.0.3
from another repo's node_modules, no install) on changed lines: only environment noise after
adding View State.timers. Timer granularity is the 60 s tick.

## Legion uses oc-coding-assistant for PR work (feat/oc-coding-flows)

Intent: Legion's agents open, review, fix and rebase PRs only through oc-coding-assistant's own flows (source: oncorps-shared-skills, 0.x), enforced by the plugin's own gate, not a copy of it.
Constraints: Legion side only, plugin untouched; resolve the plugin via installed_plugins.json (no hardcoded version); oc only (coding-assistant@home left out of Legion).
Success: an unpolished `gh pr create` by a Legion agent is refused by the plugin's PreToolUse hook; the review/fix-pr/rebase commands and pr-reviewer agent are in the index; the rules send PR review through /oc-coding-assistant:review.

- [x] Red: Hooks.test.ts: an enabled, allowlisted plugin's hooks.json is a source with its root; a disabled, unlisted or excluded one is not; its hook runs with CLAUDE_PLUGIN_ROOT; a user's disableAllHooks drops it; the installed oc gate refuses unpolished `gh pr create` and allows after mark-polished
- [x] Red: local/skills.test.ts: commands/*.md and agents/*.md indexed; coding-assistant@home excluded
- [x] Hooks.ts: Hooks.plugins + HOOKED allowlist, plugin sources, CLAUDE_PLUGIN_ROOT (RED ZONE: a new gate source, DRAFT awaiting sign-off) → verify: Hooks tests green
- [x] skills.ts: commands and agents, EXCLUDE coding-assistant → verify: skills tests green
- [x] local/rules.md: "PR work: oc-coding-assistant" section
- [x] Mutation check on the plugin-source and allowlist lines; full suite

Review: Hooks.ts runs oc-coding-assistant's own hooks.json (HOOKED allowlist, enabled + user-scoped via installed_plugins.json, CLAUDE_PLUGIN_ROOT set; a failing plugin hook only warns, the user's disableAllHooks drops it). The real installed gate refuses an unpolished `gh pr create` through Hooks.pre and allows it after mark-polished (Hooks.test.ts). skills.ts indexes plugin commands/agents ([command]/[agent]) and excludes coding-assistant@home; real index: 85 entries, 32 oc. rules.md routes all PR review through /oc-coding-assistant:review. Mutants 7/7 killed. Full suite 583 pass; 2 known logs.test.ts failures, plus Cloud.test.ts link_ask flaky under load (passes 3/3 alone, Cloud.ts untouched). Cost: two python3 spawns per Legion shell call (Pre + Post hooks). RED ZONE: the new gate source awaits the user's sign-off. Review itself is rule-enforced only: no hook can tell an improvised review from the command's.

## Security review 3 (fix/security-review-3, one draft PR, RED ZONE)
Review of 7a7bba5..a39f467 (PRs #22–#33), four auditor slices, each finding re-checked in code.
Intent: close every finding. Constraints: red test first for each, mutation check (fix reverted alone
fails a test), Red Zone items land as DRAFT for the user's sign-off. Success: suite at baseline (known
logs.test.ts + flaky link_ask) plus the new tests; web bundle builds.
User's call 2026-11-18: one PR, all findings; keep super as the default mode.

- [x] R1 (High, RED) view vs device decided by how the session was made (cookie = view; Bearer/terminal never a view), not by ?device=; /api/act same → verify: Server.test.ts / Secure.test.ts
- [x] R2 (High) every terminal run cleaned once in Paint.line_ansi (ESC/C0/C1 stripped) → verify: Paint/Deck test with \x1b]52 in PR body, event title, routine why
- [x] R3 (Med, RED) mode, plan, consent, approve, answer refused from a device, as routine is → verify: Server.test.ts
- [x] R4 (Med, RED) timers: shown with a close act (web + TUI); user Stop clears all; a timer-fired turn with no view can't set a timer; worker's note delivered as a note → verify: Timer.test.ts
- [x] R5 (Med, RED) super auto floor from the question's text (redzone/money/outward patterns), import drops floor-kind questions; unreadable saved mode falls back to auto, new chats stay super → verify: Modes.test.ts / Super.test.ts
- [x] R6 (Med, RED) server reads GCHAT_WEBHOOK_URL from Keychain itself; server_exec strips it → verify: Launcher.test.ts / Config test
- [x] R7 (Med, RED) view.json gated for write/edit (Machine.gating) and validated on load (routine_check/timer_check, tallies) → verify: Machine.test.ts / Memory test
- [x] R8 (Med, RED) GChat bridge only for the configured owner's chat → verify: Gchat.test.ts
- [x] L1 plugin hook source: full key allowlist, installPath under ~/.claude/plugins, missing/broken hooks.json refuses → verify: Hooks.test.ts
- [x] L2 rules.md says the polish gate is a process reminder, not enforcement
- [x] L3 pending routine proposals visibly marked (web + TUI), agent text quoted, task shown → verify: Routines/Pages test
- [x] L4 GChat item text scrubbed with the secret patterns before posting → verify: Gchat.test.ts
- [x] L5 gchat_why also redacts the encoded token and the original url → verify: Gchat.test.ts
- [x] L6 Main.lock: exclusive pid lockfile, no unlink-then-bind race → verify: Server.test.ts
- [x] L7 Explain observer skips when no view is open → verify: Explain.test.ts
- [x] L1+ (found while fixing L1, RED) a plugin's own hooks.json disableAllHooks no longer drops the user's hooks → verify: Hooks.test.ts
- Review: 16 fixes, red test first for each; mutants per fix all killed (R1 4/4 after dropping a redundant check, R3 5, R4 13, R5 8, R7 7, R8 3, L1 7, L4–L5 3, L6 3, L7 2, R2 3, L3 5, R6 6); suite 601 pass, 3 known fails (link_ask, two local/prime logs); bundle builds.
- User's calls 2026-11-18: R3 kept (mode/plan/consent/approve/answer refused from the terminal too, web only for now); gchat_user "10" set in ~/.unii/config.json.
- Follow-ups: terminal gets its own token (Keychain, prompt on every read) so R3 can re-allow it; GCHAT_WEBHOOK_URL Keychain item re-stored prompt-on-read; gateway key (ANTHROPIC_API_KEY) still in the server's env (ps -wwE); terminal can't close a timer (device act); device-typed messages clear the timer no-view flag; plugin hooks that crash only warn; browsers on pre-2026-11-13 cookies must sign in again (R1); ~/.zshrc legion() should go back to the plain alias.

## Tests never touch the real ~/.unii (fix/test-isolation)
Why: on 2026-11-18 a full `bun test` replaced the user's real ~/.unii/cloud.db with Cloud.test.ts fixtures (all sessions and the email → account 10 row lost; restored by hand 2026-11-19), and left test dirs in ~/.unii/work and lines in ~/.unii/okf-gaps.jsonl. Bun runs every test file in one process with one module cache, so Config.DIR is fixed by whichever file imports Config first; Cloud.test.ts sets UNII_DIR then deletes config.DIR/cloud.db. Other paths use os.homedir() + "/.unii" directly (Server work default, lock, okf-wiki, Computer, Term).
Promise: `bun test` (whole suite or one file) runs with HOME and UNII_DIR in a fresh temp dir set before any test file loads, and fails loudly if not; Cloud.test.ts refuses to delete a cloud.db outside that dir.
Edit scope: bunfig.toml (new), test/setup.ts (new), Isolation.test.ts (new), Cloud.test.ts, any test that breaks under a temp HOME (minimal), tasks/lessons.md.
- [x] Red: Isolation.test.ts asserts os.homedir(), config.DIR and UNII_DIR sit under the preload's temp root → fails without the preload
- [x] test/run.sh (`bun run test`) sets a temp HOME, UNII_DIR and git identity before bun starts (bun reads HOME once, so a preload can't move it), --isolate; the preload (bunfig.toml, test/setup.ts) refuses a bare `bun test` → Isolation green; mutants (no HOME in run.sh, no refusal) caught
- [x] Cloud.test.ts guard dropped: with the wrapper and the refusal it could never fire (untestable), so not added
- [x] Full suite via bun run test: 603 pass, 2 known logs fails (link_ask no longer fails: it was this bug); real ~/.unii untouched (cloud.db inode, work dirs, okf-gaps size, users same before and after)
- [x] Lesson in tasks/lessons.md
