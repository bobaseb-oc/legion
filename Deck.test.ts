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
  const odd = key(v, home, "g", "x");
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
  expect(Deck.deck_chord("x")).toBeNull();
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
