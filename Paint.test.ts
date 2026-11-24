// Paint test
// ==========
// `bun test Paint.test.ts`. The terminal's crew panel (Paint.crew_lines):
// Legion on top, each agent under its starter, the page shown marked,
// a failed one red, no line past the width, rows past the most counted.

import { expect, test } from "bun:test";
import * as Paint from "./Paint.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

const text = (l: Paint.Line) => l.map((r) => r.x).join("");
const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });

test("the crew panel: Legion, its agents under their starters, the page shown bold, a failed one red", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, busy: true, pick: { vendor: "claude-api", model: "opus-5.5", effort: "high", speed: "slow" }, crew: [crew("Mgr", "main", "waiting"), crew("Wkr", "Mgr", "failed")] });
  View.view_act(v, { $: "Goto", name: "Mgr" });
  const lines = Paint.crew_lines(v, 60, 120000, 8);
  expect(lines.map(text)).toEqual([
    expect.stringMatching(/^ {2}◆ Legion · orchestrator · opus-5\.5 · working/),
    expect.stringMatching(/^▸   ◐ Mgr · manager · sonnet-5\.5/),
    expect.stringMatching(/^ {6}✗ Wkr · worker · sonnet-5\.5/),
  ]);
  expect(lines[1].find((r) => r.x.includes("Mgr"))!.s.b).toBe(true);
  expect(lines[2].find((r) => r.x.includes("Wkr"))!.s.b).toBe(false);
  expect(lines[2].some((r) => r.s.c === "1")).toBe(true);
  for (const l of Paint.crew_lines(v, 20, 0, 8)) {
    expect(Paint.text_width(text(l))).toBeLessThanOrEqual(20);
  }
});

test("past the most rows, the rest are counted", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: Array.from({ length: 6 }, (_, k) => crew("A" + "bcdefg"[k], "main", "working")) });
  const lines = Paint.crew_lines(v, 60, 0, 4);
  expect(lines).toHaveLength(4);
  expect(text(lines[3])).toContain("+4 more");
});

// /crew full: a head (what's going on, the keys), who needs you, then the
// tree, the selection marked, each row's activity line; no line past the
// width, none past the height (the selection kept in sight)
test("the full-screen Crew: head, needs, tree with its selection, within the screen", async () => {
  const { demo_crew, demo_pulses } = await import("./Demo.ts");
  const v = View.view_new();
  const all = demo_crew(1e12);
  View.view_hear(v, { $: "state", ...v, crew: all });
  demo_pulses(all).forEach((p) => View.view_hear(v, p));
  View.view_act(v, { $: "Expand", name: "Mgr1" });
  const lines = Paint.crew_full(v, 70, 24, "W1-0", 1e12).map(text);
  expect(lines.length).toBeLessThanOrEqual(24);
  expect(lines.slice(0, 2).join(" ")).toContain("u undo · o handoff · A archive");
  expect(lines.some((l) => l.includes("Claude1 asks to start"))).toBe(true);
  expect(lines.filter((l) => l.startsWith("▸ "))).toHaveLength(1);
  expect(lines.find((l) => l.startsWith("▸ "))).toContain("W1-0");
  expect(lines.some((l) => l.includes("Mgr0") && l.includes("working,"))).toBe(true);
  for (const l of lines) {
    expect(l.length).toBeLessThanOrEqual(70);
  }
  // a short screen still shows the selection
  const short = Paint.crew_full(v, 70, 8, "Mgr7", 1e12).map(text);
  expect(short.length).toBeLessThanOrEqual(8);
  expect(short.some((l) => l.startsWith("▸ ") && l.includes("Mgr7"))).toBe(true);
});

test("/crew full shows the title, the name and the repos", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("FireAnt", "main", "working"), title: "Fix login tests", repos: ["auth-api"] }] });
  const lines = Paint.crew_full(v, 90, 20, "FireAnt", 0).map(text);
  expect(lines.find((l) => l.startsWith("▸ "))).toContain("Fix login tests (FireAnt) [auth-api]");
});

test("/crew full shows how far an agent's checklist is, and the step it is on", () => {
  const v = View.view_new();
  const todo: View.Todo[] = [{ text: "Read", status: "done" }, { text: "Fix the race", status: "doing" }, { text: "Run", status: "pending" }];
  View.view_hear(v, { $: "state", ...v, crew: [{ ...crew("FireAnt", "main", "working"), todo }, crew("PlainOwl", "main", "working")] });
  const lines = Paint.crew_full(v, 120, 20, "FireAnt", 0).map(text);
  expect(lines.find((l) => l.includes("FireAnt"))).toContain("1/3: Fix the race");
  expect(lines.find((l) => l.includes("PlainOwl"))).not.toContain("/");
});

test("the status line counts the open questions", () => {
  const s = { up: true, dir: "repo", branch: null, model: "m", working: 0, spend: { spend: null, stale: false } };
  expect(Paint.status_text({ ...s, questions: 2 })).toBe("repo · m · 2 questions (/questions)");
  expect(Paint.status_text({ ...s, questions: 1 })).toBe("repo · m · 1 question (/questions)");
  expect(Paint.status_text({ ...s, questions: 0 })).toBe("repo · m");
});

test("the status line shows the mode and what waits", () => {
  const s = { up: true, dir: "repo", branch: null, model: "m", working: 0, spend: { spend: null, stale: false }, mode: "plan" as const, waiting: 2 };
  expect(Paint.status_text(s)).toBe("repo · m · plan mode · 2 waiting for you");
});

test("a code block in a known language is colored as the web's: keywords, strings, numbers; comments dim; others plain", () => {
  const runs = Paint.rows_lines(View.entry_rows(null, "note", '```ts\nconst a = "s"; // c\nreturn 42;\n```'), 60).flat();
  const ink = (x: string) => runs.find((r) => r.x === x)!.s;
  expect(ink("const").c).toBe(Theme.HL.k);
  expect(ink('"s"').c).toBe(Theme.HL.s);
  expect(ink("42").c).toBe(Theme.HL.n);
  expect(ink("// c").d).toBe(true);
  const plain = Paint.rows_lines(View.entry_rows(null, "note", "```\nconst a = 1;\n```"), 60).flat();
  expect(plain.some((r) => r.s.c === Theme.HL.k)).toBe(false);
});

test("a file the terminal looked at prints as a note's code block, each line whole", () => {
  const rows = View.entry_rows(null, "note", "`/w/a.ts`:\n```ts\n1  const x = 1;\n2  // done\n```");
  const lines = Paint.rows_lines(rows, 60).map(text);
  expect(lines.some((l) => l.includes("/w/a.ts"))).toBe(true);
  expect(lines.some((l) => l.includes("1  const x = 1;"))).toBe(true);
  expect(lines.some((l) => l.includes("2  // done"))).toBe(true);
});

// a toast (Term.ts, as the web's #toast): one line over the input, in the
// color of what is for the user, cut to the width
test("a toast is one line, the user's color, cut to the width", () => {
  const l = Paint.toast_line("Reading the inbox anew; /inbox in a moment.", 20);
  expect(Paint.text_width(text(l))).toBeLessThanOrEqual(20);
  expect(text(l)).toMatch(/^Reading the inbox a.*…$/);
  expect(l[0].s.c).toBe(Theme.ANSI.you);
  expect(text(Paint.toast_line("Saved", 40))).toBe("Saved");
});

// an agent at work spins in the crew panel (the web's pulse), a frame
// per SPIN ms; the others keep their marks
test("a working agent's mark spins; the others keep theirs", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Mgr", "main", "working"), crew("Old", "main", "done")] });
  const at = (now: number) => Paint.crew_lines(v, 60, now, 8).map(text);
  const a = at(0);
  const b = at(Paint.SPIN_MS);
  expect(Paint.SPIN).toContain(a[1].trim()[0]);
  expect(Paint.SPIN).toContain(b[1].trim()[0]);
  expect(a[1]).not.toBe(b[1]);
  expect(a[2]).toBe(b[2]);
  expect(a[2]).toContain("✓ Old");
});

// R2: text from outside (a PR's body, an event's title, an agent's words)
// reaches the terminal as text: no escape of its own (an OSC 52 clipboard
// write, a cursor move, a line wipe), only the SGR and link codes the
// painter itself writes; and the width it is wrapped at is the width drawn
const OWN = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b\x07]*\x1b\\/g;
test("a line's text can't carry its own escapes: Run and line_ansi clean it, widths as drawn", () => {
  const evil = "a\x1b]52;c;cHduZWQ=\x07b\x1b[H\x1b[2Kc\x9b2J";
  const made = Paint.line_ansi([Paint.Run(evil, { ...Paint.INK, b: true })]);
  expect(made.replace(OWN, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  expect(made).toContain("\x1b[0;1m");
  // a run made without the constructor: line_ansi still cleans it
  const raw = Paint.line_ansi([{ x: evil, s: Paint.INK }]);
  expect(raw.replace(OWN, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  // a link's target can't end its link early
  const link = Paint.line_ansi([{ x: "x", s: { ...Paint.INK, k: "https://e.x/\x1b\\\x1b]52;c;eA==\x07" } }]);
  expect(link.replace(OWN, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  // wrapped at the width it is drawn at
  for (const l of Paint.runs_wrap([Paint.Run(evil.repeat(4))], 12, true)) {
    expect(Paint.text_width(Paint.line_ansi(l).replace(OWN, ""))).toBeLessThanOrEqual(12);
  }
});

// /copy (the terminal): the painter's own OSC 52 to the terminal's
// clipboard, the text base64 (UTF-8), so no text, escapes and all, writes
// a sequence of its own
test("copy_osc: the text as OSC 52, base64, whatever it holds", () => {
  expect(Paint.copy_osc("gcloud auth login")).toBe("\x1b]52;c;" + Buffer.from("gcloud auth login").toString("base64") + "\x07");
  const odd = "olá \x1b]52;c;x\x07 \x1b[2J😀\n";
  const out = Paint.copy_osc(odd);
  // security review 4 (E4): cleaned first, its \n kept
  expect(out).toBe("\x1b]52;c;" + Buffer.from("olá ]52;c;x [2J😀\n").toString("base64") + "\x07");
  expect(/^\x1b\]52;c;[A-Za-z0-9+/=]*\x07$/.test(out)).toBe(true);
});

// B2, RED ZONE (DRAFT): the status block of shell commands running: the
// head in the shell's color, the last lines and the keys dim, each cut to
// the width; what a command prints (escapes: a screen clear, a title, a
// bell) never reaches the terminal as one: only the painter's own codes
test("the shell status block: head, last lines, keys; a command's escapes never written", () => {
  const v = View.view_new();
  expect(Paint.shell_lines(v, 40, 0)).toEqual([]);
  const evil = "\x1b[2J\x1b]0;pwned\x07done\x1b[31m";
  View.view_hear(v, { $: "shells", shells: [{ job: "b", n: null, who: "user", device: "mac", command: "make \x1b[2J", since: 0, lines: [evil, "y".repeat(80)] }] });
  const lines = Paint.shell_lines(v, 40, 3000);
  expect(lines.map(text)).toEqual(["$ make [2J · you on mac · 3s", "  [2J]0;pwneddone[31m", "  " + "y".repeat(37) + "…", "ctrl+b to run in background · esc to st…"]);
  expect(lines[0][0].s.c).toBe(Theme.ANSI.shell);
  expect(lines.slice(1).every((l) => l[0].s.d)).toBe(true);
  const ansi = lines.map(Paint.line_ansi).join("\n");
  expect(ansi).not.toContain("\x1b[2J");
  expect(ansi).not.toContain("\x1b]");
  expect(ansi).not.toContain("\x07");
  expect(ansi).not.toContain("\x1b[31m");
});

// Tracks (PLP-2895): the terminal's Tracks page (Deck), painted as the
// terminal draws it: an item's escapes cleaned, its text kept
test("AC25: the terminal's Tracks page draws an item's text with its escapes cleaned", async () => {
  const Deck = await import("./Deck.ts");
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, crew: [crew("Alpha", "main", "working")], tracks: [{ name: "Alpha", tier: "manager", editable: true, orphaned: false, queued: false,
    items: [{ text: "Fix \x1b[2Jit", status: "doing" }], pins: [{ n: 1, text: "Pin \x1b[2Jme", status: "pending", at: 0 }] }] } as any);
  const OWNS = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b\x07]*\x1b\\/g;
  const lines = Deck.deck_lines(v, Deck.deck_new("tracks" as any), 100, 40, 0);
  const all = lines.map((l) => Paint.line_ansi(Paint.runs_wrap(l, 100, true)[0] ?? [])).join("\r\n");
  expect(all).toContain("Fix [2Jit");
  expect(all).toContain("Pin [2Jme");
  expect(all.replace(OWNS, "").replace(/\r\n/g, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
});

// security review 4, E4: the terminal's /copy cleans what it puts on the
// clipboard (Md.copy_clean): no ESC, no bidi control reaches a paste
test("SR4 E4: copy_osc copies the cleaned text", () => {
  const out = Paint.copy_osc("ls\x1b[201~ \u202eevil\nok");
  expect(Buffer.from(out.slice(7, -1), "base64").toString("utf8")).toBe("ls[201~ evil\nok");
});
