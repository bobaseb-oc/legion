// Deck test
// =========
// `bun test Deck.test.ts`. The terminal's full-screen deck (Deck.ts): the
// web's pages on the alternate screen, the web's nav on top, its g-chords
// between them; a key -> the deck next, a deck -> its lines.

import { expect, test } from "bun:test";
import * as Cockpit from "./Cockpit.ts";
import * as Deck from "./Deck.ts";
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
