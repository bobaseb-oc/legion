// Cockpit test
// ============
// `bun test Cockpit.test.ts`. The cockpit's pages as the views work them
// out (Cockpit.ts), before any markup: the inbox's sections, rows, tags,
// filter and what changed since the user looked; the routes to the pages.

import { expect, test } from "bun:test";
import * as Cockpit from "./Cockpit.ts";
import type * as Inbox from "./Inbox.ts";
import * as View from "./View.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const DAY = 86400e3;

function pr(over: Partial<Inbox.Pr> = {}): Inbox.Pr {
  return {
    repo: "o/r", number: 1, title: "A change", url: "https://github.com/o/r/pull/" + (over.number ?? 1), author: "ann", bot: false, updated: new Date(NOW - 3600e3).toISOString(),
    add: 1, del: 0, files: 1, branch: "b", state: "ready", failing: [], body: "", you: true, ...over,
  };
}
function inbox(over: Partial<Inbox.Inbox> = {}): Inbox.Inbox {
  return { at: NOW, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: [], clean: [], notes: [], errors: [], ...over };
}
const ids = (s: Cockpit.Section[]) => s.map((x) => x.id + ":" + x.count);

test("the routes: the cockpit's pages by their hash, and back", () => {
  for (const mode of ["home", "inbox", "routines", "digest"] as const) {
    expect(View.view_route("#" + mode)).toEqual({ mode, name: null });
    expect(View.view_hash(mode, null)).toBe("#" + mode);
  }
  expect(View.view_route("#crew/W1")).toEqual({ mode: "crew", name: "W1" });
  expect(View.view_route("#nope")).toEqual({ mode: "chat", name: null });
});

test("the inbox's sections in order, each counted; none read yet: no sections, a word why", () => {
  expect(Cockpit.inbox_sections(null, [], "", NOW)).toEqual([]);
  const all = Cockpit.inbox_sections(inbox({ reviews: [pr()], mine: [pr({ number: 2 }), pr({ number: 3 })] }), [], "", NOW);
  expect(ids(all)).toEqual(["alerts:0", "reviews:1", "mine:2", "tickets:0", "clean:0"]);
});

test("reviews: for you, a team or bots counted; older than 60 days folded apart", () => {
  const s = Cockpit.inbox_sections(inbox({ reviews: [
    pr({ number: 1 }), pr({ number: 2, you: false }), pr({ number: 3, bot: true, you: false }),
    pr({ number: 4, updated: new Date(NOW - 90 * DAY).toISOString() }),
  ] }), [], "", NOW).find((x) => x.id === "reviews")!;
  expect(s.sub).toBe("2 for you · 1 team · 1 bot");
  expect(s.rows.filter((r) => !r.old).map((r) => r.key)).toEqual(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2", "https://github.com/o/r/pull/3"]);
  expect(s.rows.filter((r) => r.old).length).toBe(1);
  expect(s.count).toBe(4);
});

test("your PRs: each state's tag and tone; failing checks named; a row's age", () => {
  const rows = Cockpit.inbox_sections(inbox({ mine: [
    pr({ number: 1, state: "failing", failing: ["ruff", "unit"] }), pr({ number: 2, state: "blocked" }), pr({ number: 3, state: "ready" }),
    pr({ number: 4, state: "conflicts" }), pr({ number: 5, state: "draft", updated: new Date(NOW - 5 * DAY).toISOString() }),
  ] }), [], "", NOW).find((x) => x.id === "mine")!.rows;
  expect(rows.map((r) => [r.tag, r.tone])).toEqual([
    ["Failing: ruff, unit", "bad"], ["Blocked: needs an approving review", "warn"], ["Ready to merge", "ok"],
    ["Conflicts: resolve them first", "bad"], ["Draft: mark it ready for review", ""],
  ]);
  expect(rows[0]).toMatchObject({ title: "A change", sub: "o/r#1", age: "1h" });
  expect(rows[4].age).toBe("5d");
  const ancient = Cockpit.inbox_sections(inbox({ mine: [pr({ updated: "2020-01-01T00:00:00Z" })] }), [], "", NOW).find((x) => x.id === "mine")!.rows;
  expect(ancient[0].old).toBe(false); // the user's own PRs are never folded apart
});

test("alerts: CI and security notifications, failed agents, my failing PRs; tickets; worktrees to clean up", () => {
  const crew: View.Crew[] = [{ name: "W1", parent: "main", tier: "worker", model: "m", status: "failed", since: NOW, title: "fix AO-1" }];
  const s = Cockpit.inbox_sections(inbox({
    mine: [pr({ state: "failing", failing: ["ruff"] })],
    notes: [{ kind: "ci", title: "CI failed on main", repo: "o/r", url: "https://github.com/o/r", at: "", unread: true }, { kind: "assign", title: "x", repo: "o/r", url: "https://github.com/o/r", at: "", unread: true }],
    tickets: [{ key: "AO-1", title: "Do it", status: "In Progress", priority: "High", updated: "", url: "" }],
    clean: [{ repo: "r", path: "/r/.wt/a", branch: "a", changes: 3, merged: false }, { repo: "r", path: "/r/.wt/b", branch: "b", changes: 0, merged: true }],
  }), crew, "", NOW);
  const of = (id: string) => s.find((x) => x.id === id)!.rows.map((r) => r.title);
  expect(of("alerts")).toEqual(["fix AO-1 failed", "Failing: A change", "CI failed on main"]);
  expect(of("tickets")).toEqual(["AO-1 Do it"]);
  expect(of("clean")).toEqual(["3 uncommitted changes in r a", "worktree of merged r b: nothing left in it"]);
});

test("Jira not read (acli missing or signed out): its section says how, from the device's error", () => {
  const s = Cockpit.inbox_sections(inbox({ tickets: null, errors: ["acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate"] }), [], "", NOW);
  expect(s.find((x) => x.id === "tickets")!.note).toBe("acli: ✗ Error: unauthorized: use 'acli jira auth login' to authenticate");
});

test("the filter: rows whose title, repo, ticket or branch hold it, any case; counts follow", () => {
  const s = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, title: "AO-7 fix" }), pr({ number: 2, repo: "o/other" }), pr({ number: 3, branch: "feat/zz" })] }), [], "other", NOW);
  expect(s.find((x) => x.id === "mine")!.rows.map((r) => r.sub)).toEqual(["o/other#2"]);
  const t = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, title: "AO-7 fix" }), pr({ number: 3, branch: "feat/zz" })] }), [], "ZZ", NOW);
  expect(ids(t)).toEqual(["alerts:0", "reviews:0", "mine:1", "tickets:0", "clean:0"]);
});

test("changed since the user looked: rows new or updated since the stamps kept, and the stamps to keep", () => {
  const first = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1 }), pr({ number: 2 })] }), [], "", NOW);
  expect(Cockpit.inbox_changed(first, null)).toBe(0); // never looked: nothing called changed
  const seen = Cockpit.inbox_seen(first);
  expect(Cockpit.inbox_changed(first, seen)).toBe(0);
  const later = Cockpit.inbox_sections(inbox({ mine: [pr({ number: 1, updated: new Date(NOW).toISOString() }), pr({ number: 2 }), pr({ number: 9 })] }), [], "", NOW);
  expect(Cockpit.inbox_changed(later, seen)).toBe(2);
});

test("the inbox's count: review requests for the user and their PRs to fix; the demo inbox is a whole one", async () => {
  expect(Cockpit.inbox_badge(null)).toBe(0);
  expect(Cockpit.inbox_badge(inbox({ reviews: [pr(), pr({ number: 2, you: false })], mine: [pr({ number: 3, state: "failing" }), pr({ number: 4, state: "ready" })] }))).toBe(2);
  const Demo = await import("./Demo.ts");
  const Inbox = await import("./Inbox.ts");
  expect(typeof Inbox.inbox_check(Demo.demo_inbox(NOW))).toBe("object");
});

test("the cockpit's acts: Review sends the PRs' links, how, and whether as Claude Code; none picked: nothing; Fetch asks the devices", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Review", prs: ["https://github.com/o/r/pull/1"], how: "fix" })).toEqual([{ $: "review", prs: ["https://github.com/o/r/pull/1"], how: "fix", claude: false }]);
  expect(View.view_act(v, { $: "Review", prs: ["u"], how: "review", claude: true })).toEqual([{ $: "review", prs: ["u"], how: "review", claude: true }]);
  expect(View.view_act(v, { $: "Review", prs: [], how: "review" })).toEqual([]);
  expect(View.view_act(v, { $: "Fetch" })).toEqual([{ $: "fetch" }]);
  View.view_hear(v, { $: "inbox", inbox: null });
  expect(v.inbox).toBe(null);
});

// Home
// ----

const agent = (name: string, status: View.Status, over: Partial<View.Crew> = {}): View.Crew => ({ name, parent: "main", tier: "worker", model: "m", status, since: NOW - 120e3, ...over });

test("home: a greeting by the hour; who needs the user and who works", () => {
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 9))).toBe("Good morning");
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 13))).toBe("Good afternoon");
  expect(Cockpit.home_greeting(new Date(2026, 10, 12, 19))).toBe("Good evening");
  const v = View.view_new();
  expect(Cockpit.home_line(v)).toBe("no agent needs you · 0 working");
  v.crew = [agent("A", "working"), agent("B", "failed"), agent("C", "asking", { tier: "claude" }), agent("D", "working", { parent: "A" })];
  v.questions = [{ id: 1, text: "q", at: 0, date: "" }];
  expect(Cockpit.home_line(v)).toBe("3 need you · 2 working");
});

test("home: the stat cards: agents, reviews for you, your PRs to fix, merged this week, agent spend", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working"), agent("B", "done"), agent("C", "done", { parent: "A" })];
  v.inbox = inbox({ reviews: [pr(), pr({ number: 2, you: false })], mine: [pr({ number: 3, state: "failing" }), pr({ number: 4 })], merged: 28, today: 1 });
  v.status = { device: "mac", dir: "x", branch: null, spend: 2.5, stale: false, week: 17.94 };
  expect(Cockpit.home_stats(v).map((s) => [s.label, s.value, s.sub])).toEqual([
    ["Agents", "3", "1 working · 2 done"],
    ["Reviews for you", "1", "1 for your team"],
    ["Your PRs", "2", "1 to fix"],
    ["Merged this week", "28", "1 today"],
    ["Agent spend", "$17.94", "$2.50 today"],
  ]);
  const none = Cockpit.home_stats(View.view_new()).map((s) => s.value);
  expect(none).toEqual(["0", "–", "–", "–", "–"]);
});

test("home: agent cards (Unii's own), working then done; their repo, ticket, PR, estimated cost; Archive all takes the done", () => {
  const v = View.view_new();
  v.crew = [
    agent("A", "working", { title: "review o/r#5 for AO-10852", repos: ["r"], spent: 2.437 }),
    agent("B", "done", { title: "fix the login AO-1201" }),
    agent("C", "failed"),
    agent("D", "working", { parent: "A" }),
  ];
  const { working, done } = Cockpit.home_cards(v, NOW);
  expect(working.map((c) => c.name)).toEqual(["A"]);
  expect(working[0]).toMatchObject({ title: "review o/r#5 for AO-10852", repo: "r", ticket: "AO-10852", pr: "#5", cost: "≈$2.44", age: "2m", under: 1 });
  expect(done.map((c) => [c.name, c.ticket, c.cost])).toEqual([["B", "AO-1201", ""], ["C", null, ""]]);
  expect(View.view_act(v, { $: "Archive", names: ["B", "C"] })).toEqual([{ $: "dismiss", name: "B" }, { $: "dismiss", name: "C" }]);
});

test("home: the apps' lines and the activity, newest first", () => {
  const v = View.view_new();
  expect(Cockpit.home_apps(v)).toEqual({ inbox: "not read yet", questions: "none open", routines: "none scheduled" });
  v.inbox = inbox({ mine: [pr({ state: "failing" })], notes: [
    { kind: "assign", title: "old", repo: "o/r", url: "https://github.com/x", at: "2026-11-10T00:00:00Z", unread: false },
    { kind: "review", title: "new", repo: "o/r", url: "https://github.com/y", at: "2026-11-12T00:00:00Z", unread: true },
  ] });
  v.questions = [{ id: 1, text: "q", at: 0, date: "" }];
  expect(Cockpit.home_apps(v)).toMatchObject({ inbox: "1 PR failing", questions: "1 open" });
  expect(Cockpit.home_activity(v).map((n) => n.title)).toEqual(["new", "old"]);
});

// Sidebar, bar, palette
// ---------------------

test("the sidebar's agents: Unii's own, grouped by their ticket (none last), each with how many under it", () => {
  const v = View.view_new();
  v.crew = [
    agent("A", "working", { title: "review o/r#5 AO-10852" }), agent("B", "done", { title: "AO-10852 docs" }),
    agent("C", "working", { title: "triage" }), agent("D", "working", { parent: "A" }), agent("E", "failed", { title: "AO-1201 fix" }),
  ];
  expect(Cockpit.side_groups(v, NOW).map((g) => [g.ticket, g.agents.map((a) => a.name + (a.under ? "+" + a.under : ""))])).toEqual([
    ["AO-10852", ["A+1", "B"]], ["AO-1201", ["E"]], [null, ["C"]],
  ]);
});

test("the spaces: repos the agents, the worktrees and the device work in, each with its agents and worktrees to clean", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working", { repos: ["web", "api"] }), agent("B", "done", { repos: ["web"] })];
  v.inbox = inbox({ clean: [{ repo: "api", path: "/p", branch: "b", changes: 2, merged: false }, { repo: "ops", path: "/q", branch: "c", changes: 0, merged: true }] });
  v.status = { device: "mac", dir: "legion", branch: "main", spend: null, stale: false };
  expect(Cockpit.side_spaces(v)).toEqual([
    { repo: "web", agents: 2, clean: 0 }, { repo: "api", agents: 1, clean: 1 }, { repo: "ops", agents: 0, clean: 1 }, { repo: "legion", agents: 0, clean: 0 },
  ]);
});

test("the bar: need you, working, ready (waiting for a word), done", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working"), agent("A2", "working"), agent("B", "waiting"), agent("C", "done"), agent("D", "stopped"), agent("E", "failed")];
  expect(Cockpit.bar_text(v)).toBe("1 need you · 2 working · 1 ready · 2 done");
});

test("the palette: pages, commands, agents and inbox PRs; the words typed filter them, all must match, best first", () => {
  const v = View.view_new();
  v.crew = [agent("Mgr", "working", { title: "Fix flaky login" })];
  v.inbox = inbox({ reviews: [pr({ number: 5, title: "Add custodians" })] });
  const all = Cockpit.palette(v, "");
  expect(all.slice(0, 8).map((i) => i.label)).toEqual(["Home", "Inbox", "Todo", "Chat", "Crew", "Routines", "Digest", "Transcripts"]);
  expect(all.some((i) => i.label === "New agent…")).toBe(true);
  expect(all.find((i) => i.label === "Fix flaky login")!.go).toEqual({ href: "#crew/Mgr" });
  expect(all.find((i) => i.label === "Add custodians")!.go).toEqual({ open: "https://github.com/o/r/pull/5" });
  expect(Cockpit.palette(v, "flaky log").map((i) => i.label)).toEqual(["Fix flaky login"]);
  expect(Cockpit.palette(v, "inb")[0].label).toBe("Inbox"); // a label starting so first
  expect(Cockpit.palette(v, "plan mode")[0].go).toEqual({ act: { $: "Mode", mode: "plan" } });
  expect(Cockpit.palette(v, "zzz")).toEqual([]);
  v.inbox = inbox({ spaces: ["bank-recon"] });
  expect(Cockpit.palette(v, "bank")[0]).toEqual({ label: "bank-recon", hint: "space · a repo", go: { space: "bank-recon" } });
  expect(Cockpit.palette(v, "inbox page").map((i) => i.label)).toEqual(["Inbox"]); // every word, not any
  v.crew.push(agent("T", "working", { title: "Inbox triage" }));
  expect(Cockpit.palette(v, "inbox").map((i) => i.label)).toEqual(["Inbox", "Inbox triage", "Refresh the inbox"]); // starting so first
});

// While you were away (Cockpit.away): away at least AWAY since the last
// look and something happened since: the agents done (Unii's own) or
// failed (any, its last line why), the routines run, new open questions
// and notes only counted (their text is the Questions pane's), the inbox's
// rows changed; lists capped; else nothing to show
test("away: only after AWAY since the last look, and only if something happened", () => {
  const v = View.view_new();
  v.crew = [agent("A", "done")];
  const seen = (at: number, crew: Record<string, View.Status> = {}): Cockpit.Seen => ({ at, crew });
  expect(Cockpit.away(v, null, NOW)).toBeNull(); // the first look: nothing called new
  expect(Cockpit.away(v, seen(NOW - Cockpit.AWAY + 60e3), NOW)).toBeNull(); // not away long enough
  expect(Cockpit.away(v, seen(NOW - Cockpit.AWAY), NOW)?.agents.map((a) => a.name)).toEqual(["A"]);
  expect(Cockpit.away(v, seen(NOW - 3 * 3600e3, { A: "done" }), NOW)).toBeNull(); // done already when last looked
  expect(Cockpit.AWAY).toBe(2 * 3600e3);
  expect(Cockpit.away_seen(v, NOW)).toEqual({ at: NOW, crew: { A: "done" } });
});

test("away: agents failed first (why: its last line), then done; capped with a count of the rest", () => {
  const v = View.view_new();
  const at = NOW - 5 * 3600e3;
  v.crew = [
    agent("W", "working"), agent("S", "stopped"), agent("Sub", "done", { parent: "M1" }), agent("Old", "done"),
    agent("F", "failed", { parent: "M1", title: "fix <ci>" }),
    ...["D1", "D2", "D3", "D4", "D5"].map((n) => agent(n, "done", { title: "task " + n })),
  ];
  v.pulses.set("F", { $: "pulse", name: "F", status: "failed", act: "", last: "tests red\nmore" });
  const a = Cockpit.away(v, { at, crew: { Old: "done", F: "working" } }, NOW)!;
  expect(a.span).toBe("5h");
  expect(a.done).toBe(5);
  expect(a.failed).toBe(1);
  expect(a.agents[0]).toEqual({ name: "F", title: "fix <ci>", status: "failed", why: "tests red" });
  expect(a.agents.map((x) => x.name)).toEqual(["F", "D1", "D2", "D3", "D4"]);
  expect(a.agents.length).toBe(Cockpit.AWAY_LIST);
  expect(a.more).toBe(1);
});

test("away: routines run since, questions and notes counted only (never their text), the inbox's changes", () => {
  const v = View.view_new();
  const at = NOW - 3 * 3600e3;
  const routine = (id: number, last: number | null) => ({ id, name: "r<" + id + ">", task: "t", when: { $: "review" as const }, tier: "worker" as const, on: true, last, made: 0 });
  v.routines = [routine(1, NOW - 3600e3), routine(2, at - 60e3), routine(3, null)];
  const q = (id: number, date: number, fyi?: true) => ({ id, text: "secret question " + id, at: 0, date: new Date(date).toISOString(), ...(fyi ? { fyi } : {}) });
  v.questions = [q(1, at - 60e3), q(2, NOW - 60e3), q(3, NOW - 120e3), q(4, NOW - 60e3, true)];
  const a = Cockpit.away(v, { at, crew: {} }, NOW, 4)!;
  expect(a.routines).toEqual(["r<1>"]);
  expect(a.questions).toBe(2);
  expect(a.notes).toBe(1);
  expect(a.inbox).toBe(4);
  expect(JSON.stringify(a)).not.toContain("secret question");
  v.routines = [];
  v.questions = [q(1, at - 60e3)];
  expect(Cockpit.away(v, { at, crew: {} }, NOW, 0)).toBeNull(); // nothing new since
  expect(Cockpit.away(v, { at, crew: {} }, NOW, 2)?.inbox).toBe(2); // the inbox alone is something
});

test("the terminal's home: greeting, who needs you, the stats, the cards working then done, how to archive", () => {
  const v = View.view_new();
  expect(Cockpit.home_text(v, new Date(NOW))).toMatch(/no agent needs you · 0 working\n[\s\S]*No agents yet: tell Legion what to do, or \/agent <task>\.$/);
  v.crew = [agent("A", "working", { title: "review o/r#5 for AO-10852", repos: ["r"], spent: 2.437 }), agent("B", "done", { title: "fix the login" }), agent("D", "working", { parent: "A" })];
  const text = Cockpit.home_text(v, new Date(NOW));
  expect(text).toContain("Agents 3 (2 working · 1 done) · Reviews for you – · Your PRs – · Merged this week – · Agent spend –");
  expect(text).toContain("Working (1):\n● A · review o/r#5 for AO-10852 · r · AO-10852 · #5 · ≈$2.44 · 2m · 1 under it");
  expect(text).toContain("Done (1), /archive all takes them:\n✓ B · fix the login · 2m");
});

test("the terminal's away note: how long, the agents (a failed one's why), the routines, the counts, never question text", () => {
  const a: Cockpit.Away = { span: "5h", agents: [{ name: "F", title: "fix ci", status: "failed", why: "tests red" }, { name: "D", title: "task D", status: "done", why: "" }], more: 2, done: 3, failed: 1, routines: ["nightly"], questions: 2, notes: 1, inbox: 0 };
  expect(Cockpit.away_text(a)).toBe("While you were away (5h · 3 done · 1 failed):\n✗ F · fix ci · tests red\n✓ D · task D\n+2 more: /crew\nRoutines ran: nightly\n2 new questions · 1 new note: /questions");
});

test("the terminal's inbox: sections with numbered rows (a filter keeps the numbers), what changed, how to act; none read: how", () => {
  const v = View.view_new();
  expect(Cockpit.inbox_text(v, "", NOW, 0)).toMatch(/^No device has read the inbox yet: .*\/refresh/);
  v.inbox = inbox({ reviews: [pr({ number: 5, title: "Add login" })], mine: [pr({ number: 7, title: "Fix deploy", state: "failing" })], errors: ["gh: rate limited", "acli: signed out"] });
  const text = Cockpit.inbox_text(v, "", NOW, 2);
  expect(text.split("\n")[0]).toBe("Inbox · updated 2026-11-12 12:00 · 2 changed since you looked");
  expect(text).toContain("gh: rate limited");
  expect(text).not.toContain("acli: signed out\n");
  expect(text).toMatch(/Alerts \(1\):\n {2}1\. o\/r#7 Failing: Fix deploy · .+ · 1h/);
  expect(text).toMatch(/Reviews \(1\) · 1 for you · 0 team · 0 bots:\n {2}2\. o\/r#5 Add login/);
  expect(text).toMatch(/Your PRs \(1\):\n {2}3\. o\/r#7 Fix deploy/);
  expect(text).toMatch(/\/review <n…>, \/fix <n…> \(add claude: as Claude Code workers\), \/refresh; \/inbox <words> filters\.$/);
  const only = Cockpit.inbox_text(v, "login", NOW, 0);
  expect(only).toContain("  2. o/r#5 Add login");
  expect(only).not.toContain("Fix deploy");
});

test("/review and /fix: the rows' numbers, each a PR it fits; claude: as Claude Code workers", () => {
  const v = View.view_new();
  v.inbox = inbox({ reviews: [pr({ number: 5 })], mine: [pr({ number: 7, state: "failing" }), pr({ number: 8 })] });
  const url = (n: number) => "https://github.com/o/r/pull/" + n;
  expect(Cockpit.review_cmd(v, "review", "2", NOW)).toEqual({ $: "Review", prs: [url(5)], how: "review" });
  expect(Cockpit.review_cmd(v, "fix", "1 3 claude", NOW)).toEqual({ $: "Review", prs: [url(7)], how: "fix", claude: true });
  expect(Cockpit.review_cmd(v, "fix", "4", NOW)).toBe("Nothing to fix in 4: /fix takes your PRs failing, in conflict or with changes asked (/inbox numbers them).");
  expect(Cockpit.review_cmd(v, "review", "3", NOW)).toBe("Nothing to review in 3: /review takes review requests (/inbox numbers them).");
  expect(Cockpit.review_cmd(v, "review", "", NOW)).toBe("Which? /review <n…>, as /inbox numbers them.");
});

test("the terminal's digest: merged by author (their themes once summarized), then open; none: how", () => {
  const v = View.view_new();
  expect(Cockpit.digest_text(v)).toMatch(/^No digest yet: /);
  const p = (n: number, author: string) => ({ repo: "o/r", number: n, title: "PR " + n, url: "u" + n, author, at: "" });
  v.inbox = inbox({ digest: { repos: ["o/r"], merged: [p(1, "ann"), p(2, "bo")], open: [p(3, "ann")] } });
  v.themes = { bo: ["faster builds"] };
  expect(Cockpit.digest_text(v)).toBe("o/r: last 7 days · 2 merged · 1 open\nMerged:\n  ann: PR 1 #1\n  bo: faster builds\nIn progress:\n  ann: PR 3 #3\n/themes summarizes by theme (one call to the compactor's model); /refresh reads it anew.");
});

test("the terminal's transcripts: numbered, newest as listed, summarized ones marked; /transcript n: its summary, else asked", () => {
  const v = View.view_new();
  expect(Cockpit.transcripts_text(v)).toBe("Google: run legion google-login on your device");
  v.inbox = inbox({ google: { events: [], docs: [{ id: "d1", title: "Standup", at: "2026-11-12T09:00:00Z", url: "https://docs.google.com/x" }] } });
  expect(Cockpit.transcripts_text(v)).toBe("Transcripts, last 14 days:\n  1. 2026-11-12 09:00 · Standup\n/transcript <n> summarizes one (its text goes to the compactor's model, once).");
  expect(Cockpit.transcript_cmd(v, "1")).toEqual({ $: "Transcript", id: "d1" });
  expect(Cockpit.transcript_cmd(v, "2")).toBe("No transcript 2: /transcripts lists them.");
  v.summaries.set("d1", { title: "Standup", text: "- shipped", at: 0 });
  expect(Cockpit.transcripts_text(v)).toContain("  1. 2026-11-12 09:00 · Standup · summarized");
  expect(Cockpit.transcript_cmd(v, "1")).toBe("Standup:\n- shipped\nFull transcript: https://docs.google.com/x");
});

test("the terminal's timesheet: drafts by day, newest first; /timesheet submit sends the open ones, drop <n>, weekly adds the routine", () => {
  const v = View.view_new();
  const d = (n: number, date: string, state: View.Draft["state"]): View.Draft => ({ n, project_id: 1, task_id: 2, project: "P", task: "Dev", date, hours: 1.5, notes: "work " + n, why: "PR #" + n, by: "W", state });
  expect(Cockpit.timesheet_text(v)).toMatch(/^No drafts yet\./);
  v.drafts = [d(1, "2026-11-10", "sent"), d(2, "2026-11-11", "draft"), d(3, "2026-11-11", "failed")];
  v.drafts[0].harvest = 77;
  v.drafts[2].error = "403";
  expect(Cockpit.timesheet_text(v)).toBe("Timesheet drafts (nothing is sent until you submit):\n2026-11-11 · 3 h\n  2. 1.5 h · P · Dev · work 2 · PR #2 · by W\n  3. 1.5 h · P · Dev · work 3 · PR #3 · by W · failed: 403\n2026-11-10 · 1.5 h\n  1. 1.5 h · P · Dev · work 1 · PR #1 · by W · Harvest #77\n/timesheet submit sends the 2 open to Harvest; drop <n>; weekly drafts every Friday.");
  expect(Cockpit.timesheet_cmd(v, "submit")).toEqual({ $: "Timesheet", op: "submit", ns: [2, 3] });
  expect(Cockpit.timesheet_cmd(v, "drop 2")).toEqual({ $: "Timesheet", op: "drop", ns: [2] });
  expect(Cockpit.timesheet_cmd(v, "drop 1")).toBe("Draft 1 is sent: only open drafts drop.");
  expect(Cockpit.timesheet_cmd(v, "weekly")).toEqual({ $: "Routine", op: "add", routine: Cockpit.TIMESHEET_ROUTINE });
  v.routines = [{ id: 1, name: Cockpit.TIMESHEET_ROUTINE.name, task: "", when: { $: "review" }, tier: "worker", on: true, last: null, made: 0 }];
  expect(Cockpit.timesheet_cmd(v, "weekly")).toBe("The weekly drafting routine is on already: /routines.");
});

test("the terminal's lane: an agent's timeline, a mark a line with its time", () => {
  const marks: View.Mark[] = [{ k: 0, at: 0, kind: "told", label: "fix it", t: NOW }, { k: null, at: 1, kind: "stall", label: "quiet 5m", t: NOW + 300e3 }];
  expect(Cockpit.lane_text("W", marks)).toBe(`W's timeline:\n  ${new Date(NOW).toTimeString().slice(0, 5)} told · fix it\n  ${new Date(NOW + 300e3).toTimeString().slice(0, 5)} stall · quiet 5m`);
  expect(Cockpit.lane_text("W", [])).toBe("Nothing on W's timeline yet.");
});

test("/archive: a done agent named, or all done ones; one at work refused", () => {
  const v = View.view_new();
  v.crew = [agent("A", "working"), agent("B", "done"), agent("C", "failed")];
  expect(Cockpit.archive_cmd(v, "all", NOW)).toEqual({ $: "Archive", names: ["B", "C"] });
  expect(Cockpit.archive_cmd(v, "", NOW)).toEqual({ $: "Archive", names: ["B", "C"] });
  expect(Cockpit.archive_cmd(v, "B", NOW)).toEqual({ $: "Archive", names: ["B"] });
  expect(Cockpit.archive_cmd(v, "A", NOW)).toBe("A is at work: /stop A first, or wait till it is done.");
  expect(Cockpit.archive_cmd(v, "Z", NOW)).toBe("No agent Z on home: /home lists them.");
  v.crew = [agent("A", "working")];
  expect(Cockpit.archive_cmd(v, "all", NOW)).toBe("Nothing done to archive.");
});

// the picked rows' acts (the web's picked panel, the terminal deck's r
// and f): review requests reviewed, PRs failing, in conflict or with
// changes asked fixed, each by its PR's own URL (an Alerts row's key is
// "alert:<url>": never sent as a PR), once each
test("the picks' acts: Review the review requests, Fix the PRs to fix, by their URLs", () => {
  const u = (n: number) => "https://github.com/o/r/pull/" + n;
  const s = Cockpit.inbox_sections(inbox({ reviews: [pr({ number: 5 }), pr({ number: 6 })], mine: [pr({ number: 7, state: "failing" }), pr({ number: 8 })] }), [], "", NOW);
  const all = Cockpit.picks_acts(s, new Set([u(5), "alert:" + u(7), u(7), u(8)]), false);
  expect(all.review).toEqual({ $: "Review", prs: [u(5)], how: "review" });
  expect(all.fix).toEqual({ $: "Review", prs: [u(7)], how: "fix" });
  expect(all.picked.map((r) => r.pr!.url)).toEqual([u(5), u(7), u(8)]);
  expect(Cockpit.picks_acts(s, new Set([u(8)]), false)).toMatchObject({ review: null, fix: null });
  expect(Cockpit.picks_acts(s, new Set([u(6)]), true).review).toEqual({ $: "Review", prs: [u(6)], how: "review", claude: true });
});

// the Todo page's chord and palette item; /todos (the terminal): each todo
// numbered, who and when; done <n> and drop <n> as its Done and Drop
test("todos: g o, the palette's Todo; /todos lists them; done and drop n are the page's buttons", () => {
  expect(Cockpit.CHORDS.o).toBe("todo");
  const v = View.view_new();
  expect(Cockpit.palette(v, "todo")[0]).toMatchObject({ label: "Todo", hint: "page · g o", go: { href: "#todo" } });
  expect(Cockpit.todo_text(v)).toContain("Nothing to do");
  v.assigned = [{ n: 1, text: "Approve PR #352", by: "main", date: "2026-11-12T11:00:00Z" }, { n: 4, text: "Send Dan the draft", by: "Wkr", date: "2026-11-12T11:30:00Z" }];
  const text = Cockpit.todo_text(v);
  expect(text).toMatch(/1\. Approve PR #352 · by Legion · 2026-11-12/);
  expect(text).toMatch(/4\. Send Dan the draft · by Wkr/);
  expect(text).toContain("/todos done <n>");
  expect(Cockpit.todo_cmd(v, "done 4")).toEqual({ $: "Assignment", n: 4, done: true });
  expect(Cockpit.todo_cmd(v, "drop 1")).toEqual({ $: "Assignment", n: 1, done: false });
  expect(Cockpit.todo_cmd(v, "done 9")).toMatch(/No todo 9/);
  expect(Cockpit.todo_cmd(v, "finish 1")).toMatch(/done <n>/);
});
