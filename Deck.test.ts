// Deck test
// =========
// `bun test Deck.test.ts`. The terminal's full-screen deck (Deck.ts): the
// web's pages on the alternate screen, the web's nav on top, its g-chords
// between them; a key -> the deck next, a deck -> its lines.

import { expect, test } from "bun:test";
import * as Cockpit from "./Cockpit.ts";
import * as Deck from "./Deck.ts";
import type * as Inbox from "./Inbox.ts";
import * as Paint from "./Paint.ts";
import * as View from "./View.ts";

const text = (l: Paint.Line) => l.map((r) => r.x).join("");
const crew = (name: string, parent: string, status: View.Status): View.Crew => ({ name, parent, tier: parent === "main" ? "manager" : "worker", model: "sonnet-5.5", status, since: 0 });
const W = 100;
const H = 20;

function team(): View.View {
  const v = View.view_new();
  View.view_hear(v, { $: "state", ...v, mode: "auto", crew: [crew("Mgr", "main", "working"), crew("Ask", "main", "asking")], questions: [{ id: 1, text: "Ship it?", at: 0, date: "" }] });
  return v;
}

const key = (v: View.View, d: Deck.Deck, ...keys: string[]): Deck.Out => {
  let out: Deck.Out = { deck: d, acts: [], sends: [], done: false };
  for (const k of keys) {
    out = Deck.deck_key(v, out.deck, k, W, H, 0);
  }
  return out;
};

test("the web's g-chords are shared: Cockpit.CHORDS", () => {
  expect(Cockpit.CHORDS).toMatchObject({ h: "home", i: "inbox", m: "chat", c: "crew", r: "routines", d: "digest", t: "transcripts", f: "files", s: "timesheet", p: "memory" });
});

test("g and a letter go to that page; g m (the chat), Esc or q leave; any other key after g drops it", () => {
  const v = team();
  const home = Deck.deck_new("home");
  expect(key(v, home, "g", "i").deck.page).toBe("inbox");
  expect(key(v, home, "g", "c").deck.page).toBe("crew");
  expect(key(v, home, "g", "q").deck.page).toBe("questions");
  expect(key(v, home, "g", "p").deck.page).toBe("memory");
  expect(key(v, home, "g", "f").deck.page).toBe("file");
  expect(key(v, home, "g", "d").deck.page).toBe("digest");
  expect(key(v, home, "g", "m").done).toBe(true);
  expect(key(v, home, "Esc").done).toBe(true);
  expect(key(v, home, "q").done).toBe(true);
  const odd = key(v, home, "g", "z");
  expect(odd.deck.page).toBe("home");
  expect(odd.deck.g).toBe(false);
  expect(odd.done).toBe(false);
  // a new page starts at its top, nothing selected
  const moved = key(v, { ...home, top: 5, sel: "x" }, "g", "i").deck;
  expect(moved).toMatchObject({ top: 0, sel: null });
});

test("the head is the web's nav: the pages, their counts, the crew's pill, the mode; the page shown bold, its chord letter underlined", () => {
  const v = team();
  const lines = Deck.deck_lines(v, Deck.deck_new("inbox"), W, H, 0);
  const head = text(lines[0]);
  expect(head).toContain("Home");
  expect(head).toContain("Inbox");
  expect(head).toContain("Chat ?1");
  expect(head).toContain("Crew 1 working, 2 need you");
  expect(head).toContain("auto mode");
  expect(lines[0].find((r) => r.x.startsWith("I") || r.x.startsWith("nbox"))!.s.b).toBe(true);
  expect(lines[0].find((r) => r.x.startsWith("H") || r.x.startsWith("ome"))!.s.b).toBe(false);
  expect(lines[0].some((r) => r.x === "i" && r.s.u)).toBe(true);
  expect(lines.length).toBeLessThanOrEqual(H);
  for (const l of Deck.deck_lines(v, Deck.deck_new("home"), 30, H, 0)) {
    expect(Paint.text_width(text(l))).toBeLessThanOrEqual(30);
  }
});

test("the crew page is /crew full's: its keys move the selection, Enter leaves on that agent", () => {
  const v = team();
  const d = Deck.deck_new("crew");
  expect(key(v, d, "Down").deck.sel).toBe("Mgr");
  const enter = key(v, d, "Down", "Enter");
  expect(enter).toMatchObject({ done: true, focus: "Mgr" });
  expect(Deck.deck_lines(v, d, W, H, 0).map(text).join("\n")).toContain("Mgr");
});

test("crew keys as the web's buttons: u asks, y undoes (any other key keeps); o hands off; A archives a done one; at work, each says why not", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, crew: [...v.crew, crew("Old", "main", "done")] });
  const on = (name: string) => ({ ...Deck.deck_new("crew"), sel: name });
  const asked = key(v, on("Old"), "u");
  expect(asked.acts).toEqual([]);
  expect(asked.deck.ask).toBe("Old");
  expect(asked.deck.say).toContain(View.undo_ask("Old"));
  expect(Deck.deck_lines(v, asked.deck, W, H, 0).map(text).join("\n")).toContain("Undo Old's last turn");
  expect(key(v, on("Old"), "u", "y").acts).toEqual([{ $: "Undo", name: "Old" }]);
  const kept = key(v, on("Old"), "u", "n");
  expect(kept.acts).toEqual([]);
  expect(kept.deck).toMatchObject({ ask: null, say: null, sel: "Old" });
  const busy = key(v, on("Mgr"), "u");
  expect(busy.deck.ask).toBeNull();
  expect(busy.deck.say).toContain("is at work");
  expect(key(v, on("Mgr"), "o").acts).toEqual([{ $: "Handoff", name: "Mgr" }]);
  expect(key(v, on("Old"), "A").acts).toEqual([{ $: "Archive", names: ["Old"] }]);
  expect(key(v, on("Mgr"), "A").deck.say).toContain("is at work");
  // the next key drops what was said
  expect(key(v, on("Mgr"), "A", "Down").deck.say).toBeNull();
  expect(Deck.deck_lines(v, on("Mgr"), W, H, 0).map(text).join(" ")).toContain("u undo · o handoff · A archive");
});

test("home, as the web's: greeting, stats, working then done cards to pick; Enter shows that agent, A archives it (none picked: all done)", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, crew: [...v.crew, { ...crew("Old", "main", "done"), title: "Fix AO-12 login" }] });
  const home = Deck.deck_new("home");
  const body = (d: Deck.Deck) => Deck.deck_lines(v, d, W, H, 0).map(text);
  const shown = body(home).join("\n");
  expect(shown).toMatch(/Good (morning|afternoon|evening)\. 2 need you · 1 working/);
  expect(shown).toContain("Agents 3");
  expect(shown).toMatch(/Working \(2\)[\s\S]*Mgr[\s\S]*Done \(1\)[\s\S]*Fix AO-12 login · AO-12/);
  expect(key(v, home, "j").deck.sel).toBe("Mgr");
  expect(key(v, home, "j", "j", "j").deck.sel).toBe("Old");
  expect(key(v, home, "j", "j", "j", "j").deck.sel).toBe("Old");
  expect(key(v, home, "j", "j", "j", "k").deck.sel).toBe("Ask");
  const picked = key(v, home, "j", "j", "j").deck;
  expect(body(picked).find((l) => l.startsWith("▸ "))).toContain("Old");
  expect(key(v, picked, "Enter")).toMatchObject({ done: true, focus: "Old" });
  expect(key(v, picked, "A").acts).toEqual([{ $: "Archive", names: ["Old"] }]);
  expect(key(v, home, "A").acts).toEqual([{ $: "Archive", names: ["Old"] }]);
  expect(key(v, { ...home, sel: "Mgr" }, "A").deck.say).toContain("is at work");
  // back after a while away: its card on top
  const away: Cockpit.Away = { span: "3h", agents: [{ name: "Old", title: "Fix AO-12 login", status: "done", why: "" }], more: 0, done: 1, failed: 0, routines: [], questions: 1, notes: 0, inbox: 0 };
  expect(body({ ...home, away }).slice(0, 4).join("\n")).toContain("While you were away (3h · 1 done)");
});

test("a picked item stays in sight: the page scrolls to it", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, crew: Array.from({ length: 30 }, (_, k) => crew("A" + k, "main", "working")) });
  const far = key(v, Deck.deck_new("home"), ...Array(29).fill("j")).deck;
  expect(far.sel).toBe("A28");
  expect(Deck.deck_lines(v, far, W, H, 0).map(text).some((l) => l.startsWith("▸ ") && l.includes("A28"))).toBe(true);
});

const NOW = Date.parse("2026-11-12T12:00:00Z");
const url = (n: number) => "https://github.com/o/r/pull/" + n;
function pr(over: Partial<Inbox.Pr> = {}): Inbox.Pr {
  return {
    repo: "o/r", number: 1, title: "A change", url: url(over.number ?? 1), author: "ann", bot: false, updated: new Date(NOW - 3600e3).toISOString(),
    add: 1, del: 0, files: 1, branch: "b", state: "ready", failing: [], body: "", you: true, ...over,
  };
}
function inboxed(): View.View {
  const v = team();
  const inbox: Inbox.Inbox = { at: NOW, login: "me", merged: 0, today: 0, tickets: [], clean: [], notes: [], errors: [],
    reviews: [pr({ number: 5, title: "Add cache", body: "Why it\nmatters" }), pr({ number: 6, title: "Bump deps" })], mine: [pr({ number: 7, title: "Fix race", state: "failing", failing: ["ci / test"] })] };
  View.view_hear(v, { $: "inbox", inbox });
  return v;
}
const ikey = (v: View.View, d: Deck.Deck, ...keys: string[]): Deck.Out => {
  let out: Deck.Out = { deck: d, acts: [], sends: [], done: false };
  for (const k of keys) {
    out = Deck.deck_key(v, out.deck, k, W, H, NOW);
  }
  return out;
};
const shown = (v: View.View, d: Deck.Deck) => Deck.deck_lines(v, d, W, 40, NOW).map(text);

test("the inbox, as the web's keys: j/k over the rows, space folds a section, Tab its details, Enter opens", () => {
  const v = inboxed();
  const d = Deck.deck_new("inbox");
  const first = ikey(v, d, "j").deck;
  expect(shown(v, first).find((l) => l.startsWith("▸ "))).toContain("Failing: Fix race");
  const cache = ikey(v, d, "j", "j").deck;
  expect(shown(v, cache).find((l) => l.startsWith("▸ "))).toContain("Add cache");
  expect(shown(v, cache).join("\n")).toMatch(/▾ Reviews \(2\)/);
  const folded = ikey(v, cache, " ").deck;
  expect(shown(v, folded).join("\n")).toMatch(/▸ Reviews \(2\)/);
  expect(shown(v, folded).join("\n")).not.toContain("Add cache");
  expect(ikey(v, folded, " ").deck.shut).toEqual([]);
  const detail = shown(v, ikey(v, cache, "Tab").deck).join("\n");
  expect(detail).toContain("+1 −0 · 1 files · b · ann");
  expect(detail).toContain("Why it");
  expect(shown(v, ikey(v, cache, "Tab", "Tab").deck).join("\n")).not.toContain("Why it");
  expect(ikey(v, cache, "Enter").open).toBe(url(5));
});

test("the inbox's picks: v picks PRs, r reviews / f fixes the picks (or the row on), c as Claude Code workers, Esc drops them first", () => {
  const v = inboxed();
  const d = Deck.deck_new("inbox");
  const two = ikey(v, d, "j", "j", "v", "j", "v").deck;
  expect(two.picks).toEqual([url(5), url(6)]);
  expect(shown(v, two).join("\n")).toContain("2 picked · r review 2");
  const sent = ikey(v, two, "r");
  expect(sent.acts).toEqual([{ $: "Review", prs: [url(5), url(6)], how: "review" }]);
  expect(sent.deck.picks).toEqual([]);
  // the alert's row: fixed by the PR's own URL
  expect(ikey(v, d, "j", "v", "f").acts).toEqual([{ $: "Review", prs: [url(7)], how: "fix" }]);
  // no picks: the row the cursor is on
  expect(ikey(v, d, "j", "j", "r").acts).toEqual([{ $: "Review", prs: [url(5)], how: "review" }]);
  expect(ikey(v, d, "j", "j", "f").deck.say).toContain("Nothing to fix");
  expect(ikey(v, d, "j", "j", "c", "r").acts).toEqual([{ $: "Review", prs: [url(5)], how: "review", claude: true }]);
  const dropped = ikey(v, two, "Esc");
  expect(dropped).toMatchObject({ done: false, deck: { picks: [] } });
  expect(ikey(v, dropped.deck, "Esc").done).toBe(true);
  expect(ikey(v, d, "R").acts).toEqual([{ $: "Fetch" }]);
});

test("the inbox's filter: / types it (keys are text till Enter or Esc), rows kept only if they hold it", () => {
  const v = inboxed();
  const typed = ikey(v, Deck.deck_new("inbox"), "/", "c", "a", "c", "h", "q", "Backspace", "e", "Enter").deck;
  expect(typed).toMatchObject({ filter: "cache", typing: false });
  const lines = shown(v, typed).join("\n");
  expect(lines).toContain("Add cache");
  expect(lines).not.toContain("Bump deps");
  expect(ikey(v, Deck.deck_new("inbox"), "/", "g", "i").deck).toMatchObject({ page: "inbox", filter: "gi", typing: true });
});

test("questions, as the web's pane: pick one, a number sends that offered answer, Enter types /answer in the box, x dismisses; notes under", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, questions: [...v.questions!, { id: 2, text: "Which db?\nWe need one", options: ["pg", "sqlite"], at: 0, date: "" }, { id: 3, text: "Deployed", at: 0, date: "", fyi: true }] });
  const d = Deck.deck_new("questions");
  const lines = Deck.deck_lines(v, d, W, H, 0).map(text).join("\n");
  expect(lines).toMatch(/Ship it\?[\s\S]*Which db\?[\s\S]*We need one[\s\S]*1\) pg · 2\) sqlite[\s\S]*Notes \(1\)[\s\S]*Deployed/);
  expect(key(v, d, "j", "j", "j").deck.sel).toBe("3");
  expect(key(v, d, "j", "j", "2").acts).toEqual([{ $: "Answer", q: 2, text: "sqlite" }]);
  expect(key(v, d, "j", "1").deck.say).toContain("no offered answers");
  expect(key(v, d, "j", "Enter")).toMatchObject({ done: true, type: "/answer 1 " });
  expect(key(v, d, "j", "j", "j", "x").acts).toEqual([{ $: "Drop", q: 3 }]);
  expect(key(v, d, "x").deck.say).toContain("Pick");
});

test("questions: super auto's decisions under them, with the kinds' progress; u undoes, Enter types /reverse, x dismisses", () => {
  const v = team();
  const date = new Date().toISOString();
  View.view_hear(v, { $: "state", ...v, mode: "super", decided: [{ id: 9, kind: "push", question: "Push AO-1?", answer: "Push it", date }], tallies: { push: { n: 20, took: 20 } } });
  const d = Deck.deck_new("questions");
  const lines = Deck.deck_lines(v, d, W, H, 0).map(text).join("\n");
  expect(lines).toMatch(/Ship it\?[\s\S]*Decided for you \(super auto\)[\s\S]*push 20\/20 ✓ unlocked[\s\S]*9\. Push AO-1\? → Push it/);
  expect(key(v, d, "j", "j").deck.sel).toBe("d9");
  expect(key(v, d, "j", "j", "u").acts).toEqual([{ $: "Decision", n: 9, undo: true }]);
  expect(key(v, d, "j", "j", "x").acts).toEqual([{ $: "Decision", n: 9, undo: false }]);
  expect(key(v, d, "j", "j", "Enter")).toMatchObject({ done: true, type: "/reverse 9 " });
  expect(key(v, d, "j", "j", "1").deck.say).toContain("u undoes");
  expect(View.view_reverse_cmd(v, "9 hold it", Date.now())).toEqual({ $: "Decision", n: 9, undo: true, text: "hold it" });
  expect(View.view_reverse_cmd(v, "4", Date.now())).toContain("No decision 4");
  expect(View.view_drop(v, "9")).toEqual({ $: "Decision", n: 9, undo: false });
  expect(View.view_questions_note(v)).toContain("Decided for you (super auto):\n9. Push AO-1? → Push it");
});

test("memory, as the web's page: pins and the last recall's hits to pick; Enter seeks it in the chat, p pins or unpins, / types /recall", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, pins: [{ i: 12, kind: "user", date: "2026-11-12T10:00:00Z", text: "keep this", size: 100 }] });
  View.view_act(v, { $: "Search", q: "cache" });
  View.view_hear(v, { $: "recalled", q: "cache", hits: [{ i: 40, kind: "unii", date: "2026-11-12T11:00:00Z", text: "the cache is warm" }], more: false });
  const d = Deck.deck_new("memory");
  expect(Deck.deck_lines(v, d, W, H, 0).map(text).join("\n")).toMatch(/Pinned, 1 of[\s\S]*#12 ·[\s\S]*keep this[\s\S]*“cache”[\s\S]*#40 ·[\s\S]*the cache is warm/);
  expect(key(v, d, "j", "j").deck.sel).toBe("h40");
  expect(key(v, d, "j", "j", "Enter")).toMatchObject({ done: true, acts: [{ $: "Seek", id: 40 }] });
  expect(key(v, d, "j", "p").acts).toEqual([{ $: "Pin", i: 12 }]);
  expect(key(v, d, "j", "j", "p").acts).toEqual([{ $: "Pin", i: 40 }]);
  expect(key(v, d, "/")).toMatchObject({ done: true, type: "/recall " });
});

test("the file page: the whole file, numbered; / finds in it, n and N go between the lines found, G its end, e edits it", () => {
  const v = team();
  expect(Deck.deck_lines(v, Deck.deck_new("file"), W, H, 0).map(text).join("\n")).toContain("No file shown yet");
  const body = Array.from({ length: 100 }, (_, k) => (k === 69 || k === 89 ? "needle " : "line ") + (k + 1)).join("\n");
  View.view_hear(v, { $: "looked", id: "x", kind: "file", path: "/r/a.ts", text: body, hash: "h" });
  const d = Deck.deck_new("file");
  const sight = (x: Deck.Deck) => Deck.deck_lines(v, x, W, H, 0).map(text).join("\n");
  expect(sight(d)).toMatch(/`?\/r\/a\.ts`?:/);
  expect(sight(d)).toMatch(/ 1  line 1\b/);
  expect(sight(key(v, d, "G").deck)).toContain("line 100");
  expect(sight(key(v, d, "End").deck)).toContain("line 100");
  const found = key(v, d, "/", "n", "e", "e", "d", "l", "e", "Enter").deck;
  expect(found).toMatchObject({ typing: false, filter: "needle" });
  expect(sight(found)).toContain("70  needle 70");
  expect(found.say).toBe("“needle”: 1 of 2");
  const next = key(v, found, "n").deck;
  expect(sight(next)).toContain("90  needle 90");
  expect(next.say).toBe("“needle”: 2 of 2");
  expect(key(v, next, "n").deck.say).toBe("“needle”: 1 of 2");
  expect(key(v, found, "N").deck.say).toBe("“needle”: 2 of 2");
  expect(key(v, d, "/", "z", "z", "Enter").deck.say).toBe("No line has “zz”.");
  expect(key(v, d, "e")).toMatchObject({ done: true, run: "/edit /r/a.ts" });
  // /look path:70: the page opens with line 70 in sight
  View.view_act(v, { $: "Look", what: { kind: "file", path: "/r/a.ts", line: 70 } });
  View.view_hear(v, { $: "looked", id: "y", kind: "file", path: "/r/a.ts", text: body, hash: "h" });
  expect(sight(Deck.deck_file(v, W, H, 0))).toContain("70→ needle 70");
  expect(Deck.deck_file(v, W, H, 0).page).toBe("file");
});

test("from the chat, Ctrl+G and a letter: the chord's page", () => {
  expect(Deck.deck_chord("i")).toBe("inbox");
  expect(Deck.deck_chord("q")).toBe("questions");
  expect(Deck.deck_chord("f")).toBe("file");
  expect(Deck.deck_chord("m")).toBe("chat");
  expect(Deck.deck_chord("x")).toBe("tracks");
  expect(Deck.deck_chord("z")).toBeNull();
  expect(Deck.deck_chord("constructor")).toBeNull();
});

test("the footer's nav: the pages and their counts, the chat bold, the web's bottom bar, how to go; within the width", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, crew: [...v.crew, crew("Old", "main", "done")] });
  const line = Deck.foot_line(v, 160);
  const all = text(line);
  expect(all).toContain("Chat ?1");
  expect(all).toContain("2 need you · 1 working · 0 ready · 1 done");
  expect(all).toContain("Ctrl+G");
  expect(line.find((r) => r.x.startsWith("Chat"))!.s.b).toBe(true);
  expect(line.find((r) => r.x.startsWith("Home"))!.s.b).toBe(false);
  for (const w of [20, 40, 80]) {
    expect(Paint.text_width(text(Deck.foot_line(v, w)))).toBeLessThanOrEqual(w);
  }
});

test("a wide terminal: home's column beside the crew panel, in its rows; narrow: the crew panel alone", () => {
  const v = team();
  const narrow = Deck.crew_foot(v, 100, 0, 8, true).map(text);
  expect(narrow).toEqual(Paint.crew_lines(v, 100, 0, 8).map(text));
  const wide = Deck.crew_foot(v, 140, 0, 8, true);
  expect(wide).toHaveLength(Paint.crew_lines(v, 100, 0, 8).length);
  const all = wide.map(text).join("\n");
  expect(all).toContain("│");
  expect(all).toContain("2 need you · 1 working");
  expect(all).toContain("Ask asks to start");
  for (const l of wide) {
    expect(Paint.text_width(text(l))).toBeLessThanOrEqual(140);
  }
  // no crew panel: the tabs line, the column's first line beside it
  const tabs = Deck.crew_foot(v, 140, 0, 8, false);
  expect(tabs).toHaveLength(1);
  expect(text(tabs[0])).toContain("2 need you · 1 working");
});

const CMDS: [string, string][] = [["/inbox [words]", "the inbox"], ["/answer <n> <text>", "answer a question"], ["/help", "this list"], ["", "keys only"]];

test("the / menu: commands by their start, then the palette's items (pages, agents, PRs) by its words; closed once an argument is typed", () => {
  const v = team();
  const items = Deck.menu_items(v, CMDS, "/in");
  expect(items[0]).toMatchObject({ label: "/inbox [words]", go: { run: "/inbox [words]" } });
  expect(items.some((it) => it.label === "Inbox" && "href" in it.go)).toBe(true);
  expect(Deck.menu_items(v, CMDS, "/").map((it) => it.label)).toEqual(["/inbox [words]", "/answer <n> <text>", "/help"]);
  expect(Deck.menu_items(v, CMDS, "/mgr").some((it) => it.label === "Mgr" && it.hint.startsWith("agent Mgr"))).toBe(true);
  expect(Deck.menu_items(v, CMDS, "/inbox foo")).toEqual([]);
  expect(Deck.menu_items(v, CMDS, "hello")).toEqual([]);
  expect(Deck.menu_items(v, CMDS, "/zzz")).toEqual([]);
});

test("a menu item's going: a command runs (one needing an argument is typed), a page opens full screen, an agent's tab, a link, an act", () => {
  expect(Deck.menu_go({ label: "/help", hint: "", go: { run: "/help" } })).toEqual({ run: "/help" });
  expect(Deck.menu_go({ label: "/inbox [words]", hint: "", go: { run: "/inbox [words]" } })).toEqual({ run: "/inbox" });
  expect(Deck.menu_go({ label: "/answer <n> <text>", hint: "", go: { run: "/answer <n> <text>" } })).toEqual({ type: "/answer " });
  expect(Deck.menu_go({ label: "Home", hint: "", go: { href: "#home" } })).toEqual({ page: "home" });
  expect(Deck.menu_go({ label: "Files", hint: "", go: { href: "#files" } })).toEqual({ page: "file" });
  expect(Deck.menu_go({ label: "Crew", hint: "", go: { href: "#crew" } })).toEqual({ page: "crew" });
  expect(Deck.menu_go({ label: "Chat", hint: "", go: { href: "#chat" } })).toEqual({ chat: true });
  expect(Deck.menu_go({ label: "Mgr", hint: "", go: { href: "#crew/Mgr" } })).toEqual({ goto: "Mgr" });
  expect(Deck.menu_go({ label: "PR", hint: "", go: { open: "https://x/1" } })).toEqual({ open: "https://x/1" });
  expect(Deck.menu_go({ label: "Plan", hint: "", go: { act: { $: "Mode", mode: "plan" } } })).toEqual({ act: { $: "Mode", mode: "plan" } });
  expect(Deck.menu_go({ label: "New agent…", hint: "", go: { cmd: "new-agent" } })).toEqual({ type: "/agent " });
  expect(Deck.menu_go({ label: "o/r", hint: "", go: { space: "o/r" } })).toEqual({ page: "inbox", filter: "o/r" });
});

test("the menu's pick: Down from none is the first, Up the last; round at the ends", () => {
  expect(Deck.menu_pick(-1, 5, "Down")).toBe(0);
  expect(Deck.menu_pick(-1, 5, "Up")).toBe(4);
  expect(Deck.menu_pick(4, 5, "Down")).toBe(0);
  expect(Deck.menu_pick(0, 5, "Up")).toBe(4);
  expect(Deck.menu_pick(2, 5, "Down")).toBe(3);
});

test("the menu's lines: at most MENU items around the one picked, it marked; the keys; within the width", () => {
  const items = Array.from({ length: 20 }, (_, k): Deck.MenuItem => ({ label: "/c" + k, hint: "does " + k, go: { run: "/c" + k } }));
  const lines = Deck.menu_lines(items, 15, 40).map(text);
  expect(lines.length).toBeLessThanOrEqual(Deck.MENU + 1);
  expect(lines.find((l) => l.startsWith("▸ "))).toContain("/c15");
  expect(lines.at(-1)).toContain("Tab");
  expect(Deck.menu_lines(items, -1, 40).map(text)[0]).toContain("/c0");
  for (const l of lines) {
    expect(Paint.text_width(l)).toBeLessThanOrEqual(40);
  }
});

test("the mouse in the deck: a click on the nav goes to that page (Chat: back), on an item picks it and again opens it; the wheel scrolls", () => {
  const v = team();
  const home = Deck.deck_new("home");
  const nav = text(Deck.deck_lines(v, home, W, H, 0)[0]);
  const col = (label: string) => nav.indexOf(label) + 1;
  expect(key(v, home, "Click:" + col("Inbox") + ":1").deck.page).toBe("inbox");
  expect(key(v, home, "Click:" + col("Questions") + ":1").deck.page).toBe("questions");
  expect(key(v, home, "Click:" + col("Chat") + ":1").done).toBe(true);
  const lines = Deck.deck_lines(v, home, W, H, 0).map(text);
  const row = lines.findIndex((l) => l.includes("Ask")) + 1;
  const picked = key(v, home, "Click:5:" + row);
  expect(picked.deck.sel).toBe("Ask");
  expect(key(v, picked.deck, "Click:5:" + row)).toMatchObject({ done: true, focus: "Ask" });
  View.view_hear(v, { $: "state", ...v, routines: Array.from({ length: 40 }, (_, k) => ({ id: k + 1, name: "r" + k, task: "t", when: { $: "daily", at: "09:00" }, tier: "worker", on: true, last: null, made: 0 })) });
  const r = Deck.deck_new("routines");
  expect(key(v, r, "WheelDown").deck.top).toBe(3);
  expect(key(v, r, "WheelDown", "WheelUp", "WheelUp").deck.top).toBe(0);
  // the crew: the wheel moves its pick
  expect(key(v, Deck.deck_new("crew"), "WheelDown").deck.sel).toBe("Mgr");
});

test("the Todo page, as the web's: each todo to pick, who and when; d ticks it done, x drops it; g o goes there, its count in the nav", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, assigned: [{ n: 1, text: "Approve PR #352", by: "main", date: "2026-11-12T11:00:00Z" }, { n: 4, text: "Send Dan the draft", by: "Wkr", date: "2026-11-12T11:30:00Z" }] });
  const d = Deck.deck_new("todo");
  const lines = Deck.deck_lines(v, d, W, H, 0).map(text);
  expect(lines[0]).toContain("o Todo 2");
  expect(lines.join("\n")).toMatch(/Approve PR #352 · by Legion[\s\S]*Send Dan the draft · by Wkr/);
  expect(key(v, d, "j", "j").deck.sel).toBe("4");
  expect(key(v, d, "j", "d").acts).toEqual([{ $: "Assignment", n: 1, done: true }]);
  expect(key(v, d, "j", "j", "x").acts).toEqual([{ $: "Assignment", n: 4, done: false }]);
  expect(key(v, d, "d").deck.say).toContain("Pick");
  expect(key(v, Deck.deck_new("home"), "g", "o").deck.page).toBe("todo");
  expect(Deck.deck_lines(View.view_new(), d, W, H, 0).map(text).join("\n")).toContain("Nothing to do");
});

test("a text page (the digest, transcripts, timesheet, routines) scrolls: j/k, Space and PageDown, Home and End, kept in its length", () => {
  const v = team();
  View.view_hear(v, { $: "state", ...v, routines: Array.from({ length: 40 }, (_, k) => ({ id: k + 1, name: "r" + k, task: "t", when: { $: "daily", at: "09:00" }, tier: "worker", on: true, last: null, made: 0 })) });
  const d = Deck.deck_new("routines");
  const body = (x: Deck.Deck) => Deck.deck_lines(v, x, W, H, 0).slice(1).map(text).join("\n");
  expect(body(d)).toContain("r0");
  expect(key(v, d, "j").deck.top).toBe(1);
  expect(key(v, d, "j", "k", "k").deck.top).toBe(0);
  expect(key(v, d, "PageDown").deck.top).toBe(H - 2);
  const end = key(v, d, "End").deck;
  expect(body(end)).toContain("r39");
  expect(key(v, end, "j").deck.top).toBe(end.top);
  expect(key(v, end, "Home").deck.top).toBe(0);
});

test("the Tracks page, as the web's: each track's card and the thread as text; / or ? leaves with /tracks typed; g x goes there", () => {
  const v = team();
  v.tracks = [{ name: "Owl", tier: "worker", editable: true, orphaned: false, queued: false, items: [], pins: [] }];
  View.view_hear(v, { $: "explain", explain: { cards: [{ track: "Owl", title: "Explain tab", what: "A page for managers", why: "To follow the work", status: "Half done", watch: "Cost" }], at: Date.now(), hash: "h", tried: null, qa: [], writing: false, asking: null } });
  const d = Deck.deck_new("tracks");
  const lines = Deck.deck_lines(v, d, W, H, 0).map(text);
  expect(lines[0]).toContain("x Tracks");
  expect(lines.join("\n")).toMatch(/Explain tab[\s\S]*What: A page for managers/);
  expect(key(v, d, "/")).toMatchObject({ done: true, type: "/tracks " });
  expect(key(v, d, "?")).toMatchObject({ done: true, type: "/tracks " });
  expect(key(v, Deck.deck_new("home"), "g", "x").deck.page).toBe("tracks");
});

// R2: what others write (a PR's body, a calendar event's title, an agent's
// routine why) painted as the terminal draws it (Paint.line_ansi over the
// deck's lines and the chat's footer): no escape but the painter's own
const OWN = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b\x07]*\x1b\\/g;
const EVIL = "\x1b]52;c;cHduZWQ=\x07\x1b[H\x1b[2K";
const drawn = (ls: Paint.Line[], w: number) => ls.map((l) => Paint.line_ansi(Paint.runs_wrap(l, w, true)[0] ?? [])).join("\r\n");
test("a PR body, an event title, a routine's why: drawn without their escapes", () => {
  const v = inboxed();
  const evil: Inbox.Inbox = { ...v.inbox!, reviews: [pr({ number: 5, title: "Add " + EVIL + "cache", body: "Why " + EVIL + "it\nmatters" + EVIL })],
    google: { events: [{ id: "e", title: "Sync " + EVIL + "up", start: new Date(NOW + 3600e3).toISOString(), end: new Date(NOW + 7200e3).toISOString(), meet: "", people: 2 }], docs: [] } };
  View.view_hear(v, { $: "inbox", inbox: evil });
  View.view_hear(v, { $: "state", ...v, crew: [...v.crew, crew("A", "main", "working"), crew("B", "main", "working"), crew("C", "main", "working")] });
  View.view_hear(v, { $: "state", ...v, routines: [{ id: 5, name: "Standup " + EVIL, task: "t" + EVIL, when: { $: "daily", at: "09:00" }, tier: "worker", on: false, last: null, made: 0, by: "main", why: "you " + EVIL + "asked" }] });
  const detail = ikey(v, Deck.deck_new("inbox"), "j", "j", "Tab").deck;
  const pages = [Deck.deck_lines(v, detail, W, 40, NOW), Deck.deck_lines(v, Deck.deck_new("routines"), W, 40, NOW), Deck.crew_foot(v, 140, NOW, 8, true), Deck.crew_foot(v, 140, NOW, 8, false)];
  const all = pages.map((ls) => drawn(ls, 140)).join("\r\n");
  expect(all).toContain("Why ]52;c;cHduZWQ=[H[2Kit");
  expect(all).toContain("Sync ]52;c;");
  expect(all).toContain("]52;c;cHduZWQ=[H[2Kasked");
  expect(all.replace(OWN, "").replace(/\r\n/g, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  // the menu: a label from a palette item (an agent's name, a PR's title)
  const menu = Deck.menu_lines([{ label: "PR " + EVIL, hint: "h" + EVIL, go: { run: "/x" } }], 0, W);
  expect(drawn(menu, W).replace(OWN, "").replace(/\r\n/g, "")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
});

// Notes: the terminal's Memory page lists Unii's notes,
// read-only (edited on the web)
test("L2-AC14: the terminal Memory page lists both notes' names", () => {
  const v = team();
  (v as any).notebook = [
    { name: "alpha-plan", line: "the alpha line", text: "alpha body", at: 0 },
    { name: "beta-notes", line: "the beta line", text: "beta body", at: 0 },
  ];
  const lines = Deck.deck_lines(v, Deck.deck_new("memory"), W, 60, 0).map(text).join("\n");
  expect(lines).toContain("Notes");
  expect(lines).toContain("alpha-plan");
  expect(lines).toContain("beta-notes");
});
