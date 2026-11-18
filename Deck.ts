// Deck
// ====
// The terminal's full-screen pages, as the web's deck: Term.ts draws them
// on the alternate screen and gives them every key (Screen grab), the
// chat's scrollback kept as it was. On top, the web's nav: each page by
// its chord letter, its count, the crew's pill, the mode. g and a letter
// go between pages (Cockpit.CHORDS, as the web's; q: the questions);
// Esc, q or g m go back to the chat. A page's body: the crew's
// (View.view_full, Paint.crew_full), or a text as its command prints it,
// scrolled. A key -> the deck next; a deck -> its lines; both pure.

import * as Cockpit from "./Cockpit.ts";
import * as Paint from "./Paint.ts";
import * as Theme from "./Theme.ts";
import * as View from "./View.ts";

// Types
// =====

export const PAGES = ["home", "inbox", "todo", "crew", "questions", "memory", "file", "routines", "digest", "transcripts", "timesheet"] as const;
export type Page = (typeof PAGES)[number];

// the deck: the page shown, what is selected on it (an agent's name, a
// row's "section key"), its first line in sight, whether g began a chord;
// the agent whose undo waits for y, a line said under the nav till the
// next key (why a key did nothing, what y does); home's away card. The
// inbox's, as the web's: its filter (being typed), the rows picked (their
// keys, in the order picked), the sections folded, the row whose details
// show, whether picks go to Claude Code workers, the rows changed since
// the terminal last showed it
export type Deck = {
  page: Page; sel: string | null; top: number; g: boolean; ask: string | null; say: string | null; away?: Cockpit.Away;
  filter: string; typing: boolean; picks: string[]; shut: Cockpit.SectionId[]; detail: string | null; claude: boolean; changed?: number;
  hit?: number | null; // the file's line found last (its search is the filter)
};

// a key's outcome: the deck next, the acts it asks (Term.ts runs them),
// what it sent (the crew's keys send as they act: View.view_full),
// whether the deck closes (focus: the agent whose page to show), a link
// to open in the browser, text to type in the box or a command to run
// (once the deck closes)
export type Out = { deck: Deck; acts: View.Act[]; sends: View.Client[]; done: boolean; focus?: string; open?: string; type?: string; run?: string };

// Constants
// =========

// the chords: the web's (its files: the file shown), and the questions
const CHORDS: Record<string, Page | "chat"> = {
  ...Object.fromEntries(Object.entries(Cockpit.CHORDS).map(([k, to]) => [k, to === "files" ? "file" : to])),
  q: "questions",
};

// the nav: each page's letter and label, in the web's order
const NAV: [letter: string, label: string, page: Page | "chat"][] = [
  ["h", "Home", "home"], ["i", "Inbox", "inbox"], ["o", "Todo", "todo"], ["m", "Chat", "chat"], ["c", "Crew", "crew"],
  ["q", "Questions", "questions"], ["p", "Memory", "memory"], ["f", "File", "file"],
  ["r", "Routines", "routines"], ["d", "Digest", "digest"], ["t", "Transcripts", "transcripts"], ["s", "Timesheet", "timesheet"],
];

const BOLD = { ...Paint.INK, b: true };
const KEY  = { ...Paint.DIM, u: true };
const SAY  = { ...Paint.INK, b: true, c: Theme.ANSI.you };
const HEAD = { ...Paint.DIM, b: true };

// Keys
// ====

export function deck_new(page: Page, filter = ""): Deck {
  return { page, sel: null, top: 0, g: false, ask: null, say: null, filter, typing: false, picks: [], shut: [], detail: null, claude: false };
}

// a key on the deck, w by h: y to an undo asked, a chord, leaving, or the
// page's key; what was said goes at the next key
export function deck_key(v: View.View, was: Deck, key: string, w: number, h: number, now: number): Out {
  const out = (deck: Deck, more: Partial<Out> = {}): Out => ({ deck, acts: [], sends: [], done: false, ...more });
  const d = { ...was, ask: null, say: null };
  if (was.ask !== null) {
    const undo = View.view_crew_op(v, "undo", was.ask + " yes");
    return key === "y" && typeof undo !== "string" ? out(d, { acts: [undo] }) : out(d);
  }
  const room = Math.max(1, h - 1);
  if (d.typing) {
    const typed = deck_type(d, key);
    return out(d.page === "file" && key === "Enter" ? file_find(typed, deck_body(v, typed, w, now).lines, room, 0) : typed);
  }
  if (d.g) {
    const to = deck_chord(key);
    if (to === "chat") {
      return out({ ...d, g: false }, { done: true });
    }
    return out(to === null ? { ...d, g: false } : deck_new(to));
  }
  if (key === "g") {
    return out({ ...d, g: true });
  }
  const mouse = deck_mouse(v, was, d, key, w, room, now);
  if (mouse !== null) {
    return mouse;
  }
  if (d.page === "crew") {
    return deck_crew_key(v, d, key, now);
  }
  const own = PAGE_KEYS[d.page]?.(v, d, key, now);
  if (own !== undefined && own !== null) {
    return own;
  }
  if (key === "Esc" || key === "q") {
    return out(d, { done: true });
  }
  const body = deck_body(v, d, w, now);
  if (d.page === "file") {
    const file = deck_file_key(v, d, key, body.lines, room);
    if (file !== null) {
      return file;
    }
  }
  const step = MOVES[key];
  if (body.items.length > 0 && step !== undefined) {
    const at = body.items.findIndex((it) => it.key === d.sel);
    const to = body.items[at < 0 ? 0 : Math.min(body.items.length - 1, Math.max(0, at + step))];
    return out({ ...d, sel: to.key, top: deck_sight(to.at, d.top, room) });
  }
  return out({ ...d, top: deck_scroll(body.lines.length, room, d.top, key) });
}

// the keys that move the pick on a page with items
const MOVES: Record<string, number> = { j: 1, Down: 1, k: -1, Up: -1 };

// the lines a turn of the wheel scrolls
const WHEEL = 3;

// the mouse's keys (Screen's): the wheel scrolls (on the crew, moves its
// pick), a click goes where it lands (deck_click); null: not the mouse's
function deck_mouse(v: View.View, was: Deck, d: Deck, key: string, w: number, room: number, now: number): Out | null {
  if (key === "WheelUp" || key === "WheelDown") {
    const by = key === "WheelUp" ? -WHEEL : WHEEL;
    return d.page === "crew" ? deck_crew_key(v, d, by < 0 ? "Up" : "Down", now)
      : { deck: { ...d, top: Math.min(Math.max(0, deck_body(v, d, w, now).lines.length - room), Math.max(0, d.top + by)) }, acts: [], sends: [], done: false };
  }
  const click = /^Click:(\d+):(\d+)$/.exec(key);
  return click === null ? null : deck_click(v, was, d, Number(click[1]) - 1, Number(click[2]) - 1, w, now);
}

// a click at column x, row y (0: the first) of the deck as it was drawn
// (was: its line said above the body): on the nav, that page (the chat:
// back); on an item, it picked, or, picked already, as Enter on it
function deck_click(v: View.View, was: Deck, d: Deck, x: number, y: number, w: number, now: number): Out {
  const out = (deck: Deck, more: Partial<Out> = {}): Out => ({ deck, acts: [], sends: [], done: false, ...more });
  if (y === 0) {
    const to = nav_hit(v, d.page, w, x);
    return to === null ? out(d) : to === "chat" ? out(d, { done: true }) : out(to === d.page ? d : deck_new(to));
  }
  if (d.page === "crew") {
    return out(d);
  }
  const said = was.say === null ? 0 : Paint.runs_wrap([Paint.Run(was.say)], w, false).length;
  const line = d.top + y - 1 - said;
  const it = deck_body(v, d, w, now).items.find((i) => line >= i.at && line < i.at + i.n);
  if (it === undefined) {
    return out(d);
  }
  if (it.key !== d.sel) {
    return out({ ...d, sel: it.key });
  }
  return PAGE_KEYS[d.page]?.(v, d, "Enter", now) ?? out(d);
}

// a page's own keys, before Esc, q and the moves (null: not its key)
type Keys = (v: View.View, d: Deck, key: string, now: number) => Out | null;
const PAGE_KEYS: Partial<Record<Page, Keys>> = { home: deck_home_key, inbox: deck_inbox_key, questions: deck_questions_key, memory: deck_memory_key, todo: deck_todo_key };

// a key while a filter is typed: text goes in it, Backspace takes the last
// character, Enter or Esc end it (a key's name, as Screen names keys, is
// not text)
function deck_type(d: Deck, key: string): Deck {
  if (key === "Enter" || key === "Esc") {
    return { ...d, typing: false };
  }
  if (key === "Backspace") {
    return { ...d, filter: [...d.filter].slice(0, -1).join("") };
  }
  const named = [...key].length > 1 && /^(Ctrl\+|Alt\+|Shift\+|Click:|Wheel|[A-Z][a-z]+$|\d+~$)/.test(key);
  return named ? d : { ...d, filter: d.filter + (key === "Space" ? " " : key) };
}

// the result of a key that sends an act or says why not
function act_or_say(d: Deck, r: View.Act | string | null, more: Partial<Deck> = {}): Out {
  return typeof r === "string" || r === null ? { deck: { ...d, say: r }, acts: [], sends: [], done: false } : { deck: { ...d, ...more }, acts: [r], sends: [], done: false };
}

// home's keys: Enter shows the agent picked, A archives it (none: all
// done ones, as /archive)
function deck_home_key(v: View.View, d: Deck, key: string, now: number): Out | null {
  if (key === "Enter" && d.sel !== null) {
    return { deck: d, acts: [], sends: [], done: true, focus: d.sel };
  }
  if (key === "A") {
    return act_or_say(d, Cockpit.archive_cmd(v, d.sel ?? "", now));
  }
  return null;
}

// the inbox's sections as the deck shows them (its filter)
function inbox_of(v: View.View, d: Deck, now: number): Cockpit.Section[] {
  return Cockpit.inbox_sections(v.inbox, v.crew, d.filter, now);
}

// the row picked (sel: "section key"), with its section
function inbox_row(v: View.View, d: Deck, now: number): { s: Cockpit.SectionId; r: Cockpit.Row } | null {
  for (const s of inbox_of(v, d, now)) {
    const r = s.rows.find((x) => s.id + " " + x.key === d.sel);
    if (r !== undefined) {
      return { s: s.id, r };
    }
  }
  return null;
}

// the inbox's keys, the web's (main.ts page_keys): space folds the row's
// section, Tab shows its details, Enter opens it, v picks it (a PR), r and
// f review or fix the picks (none: the row), c as Claude Code workers, /
// types the filter, R reads the inbox anew, Esc drops the picks first
function deck_inbox_key(v: View.View, d: Deck, key: string, now: number): Out | null {
  const at = inbox_row(v, d, now);
  const go = (deck: Deck, open?: string): Out => ({ deck, acts: [], sends: [], done: false, ...(open === undefined ? {} : { open }) });
  const flip = <T>(xs: T[], x: T): T[] => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  switch (key) {
    case " ": case "Space":
      return at === null ? act_or_say(d, "Pick a row first: ↑↓.") : go({ ...d, shut: flip(d.shut, at.s) });
    case "Tab":
      return go({ ...d, detail: d.detail === d.sel ? null : d.sel });
    case "Enter":
      return at === null || at.r.url === "" ? act_or_say(d, "Nothing to open there.") : go({ ...d, say: "Opened in the browser: " + at.r.url }, at.r.url);
    case "v":
      return at?.r.pr === undefined ? act_or_say(d, "Only PRs can be picked.") : go({ ...d, picks: flip(d.picks, at.r.key) });
    case "r": case "f": {
      const picks = d.picks.length > 0 ? d.picks : at === null ? [] : [at.r.key];
      const acts = Cockpit.picks_acts(inbox_of(v, d, now), new Set(picks), d.claude);
      const act = key === "r" ? acts.review : acts.fix;
      return act !== null ? act_or_say(d, act, { picks: [] })
        : act_or_say(d, key === "r" ? "Nothing to review there: r takes review requests." : "Nothing to fix there: f takes your PRs failing, in conflict or with changes asked.");
    }
    case "c":
      return go({ ...d, claude: !d.claude, say: "Picks go to " + (d.claude ? "Legion agents." : "Claude Code workers, under a manager.") });
    case "/":
      return go({ ...d, typing: true });
    case "R":
      return act_or_say(d, { $: "Fetch" }, { say: "Reading the inbox anew…" });
    case "Esc":
      return d.picks.length === 0 ? null : go({ ...d, picks: [] });
  }
  return null;
}

// the questions' keys (the web's pane): 1-9 sends that offered answer,
// Enter leaves with /answer typed in the box, x dismisses (a note too),
// as /answer and /drop
function deck_questions_key(v: View.View, d: Deck, key: string, now: number): Out | null {
  const q = d.sel === null ? undefined : [...View.view_questions(v), ...View.view_notes(v)].find((x) => String(x.id) === d.sel);
  const done = { deck: d, acts: [], sends: [], done: true };
  // super auto's decision picked: u undoes it, Enter types /reverse (what
  // to do instead), x dismisses it
  const decided = d.sel?.startsWith("d") ? View.view_decided(v, now).find((x) => "d" + x.id === d.sel) : undefined;
  if (decided !== undefined && (/^[1-9]$/.test(key) || ["Enter", "x", "u"].includes(key))) {
    return key === "Enter" ? { ...done, type: "/reverse " + decided.id + " " }
      : key === "u" || key === "x" ? act_or_say(d, { $: "Decision", n: decided.id, undo: key === "u" })
      : act_or_say(d, "A decision: u undoes it, Enter says what instead, x dismisses it.");
  }
  if (!/^[1-9]$/.test(key) && key !== "Enter" && key !== "x") {
    return null;
  }
  if (q === undefined) {
    return act_or_say(d, "Pick a question first: ↑↓.");
  }
  if (key === "x") {
    return act_or_say(d, View.view_drop(v, String(q.id)));
  }
  if (q.fyi) {
    return act_or_say(d, "A note awaits no answer: x dismisses it.");
  }
  if (key === "Enter") {
    return { ...done, type: "/answer " + q.id + " " };
  }
  const offered = q.options?.[Number(key) - 1];
  return offered === undefined ? act_or_say(d, (q.options === undefined ? "This one has no offered answers" : "No answer " + key) + ": Enter types yours.")
    : act_or_say(d, View.view_answer(v, q.id + " " + key));
}

// the Todo page's keys (the web's buttons): d ticks the one picked Done
// (its agent hears it), x drops it, as /todos done and drop
function deck_todo_key(v: View.View, d: Deck, key: string, _now: number): Out | null {
  if (key !== "d" && key !== "x") {
    return null;
  }
  return act_or_say(d, d.sel === null ? "Pick a todo first: ↑↓." : Cockpit.todo_cmd(v, (key === "d" ? "done " : "drop ") + d.sel));
}

// memory's keys (the web's page): Enter shows the message picked in the
// chat (Seek), p pins it or unpins it, / leaves with /recall typed
function deck_memory_key(_v: View.View, d: Deck, key: string, _now: number): Out | null {
  const i = d.sel === null ? null : Number(d.sel.slice(1));
  if (key === "/") {
    return { deck: d, acts: [], sends: [], done: true, type: "/recall " };
  }
  if (key !== "Enter" && key !== "p") {
    return null;
  }
  if (i === null) {
    return act_or_say(d, "Pick a message first: ↑↓.");
  }
  return key === "Enter" ? { deck: d, acts: [{ $: "Seek", id: i }], sends: [], done: true } : act_or_say(d, { $: "Pin", i });
}

// the file's keys, as a pager's: / finds (typed; Enter goes to the first
// line found), n and N the next and the one before (round), G its end, e
// edits it (/edit); the rest scroll
function deck_file_key(v: View.View, d: Deck, key: string, lines: Paint.Line[], room: number): Out | null {
  const go = (deck: Deck, more: Partial<Out> = {}): Out => ({ deck, acts: [], sends: [], done: false, ...more });
  switch (key) {
    case "/": return go({ ...d, typing: true, filter: "", hit: null });
    case "n": return go(file_find(d, lines, room, 1));
    case "N": return go(file_find(d, lines, room, -1));
    case "G": return go({ ...d, top: deck_scroll(lines.length, room, d.top, "End") });
    case "e": return v.looked?.kind === "file" && v.looked.path !== undefined ? go(d, { done: true, run: "/edit " + v.looked.path }) : act_or_say(d, "No file shown to edit.");
  }
  return null;
}

// the deck at the file shown, w by h, the line asked (path:line) in sight
export function deck_file(v: View.View, w: number, h: number, now: number): Deck {
  const d = deck_new("file");
  const lines = deck_body(v, d, w, now).lines;
  const mark = v.line === null ? -1 : lines.findIndex((l) => l.map((r) => r.x).join("").includes(v.line + "→ "));
  return mark < 0 ? d : { ...d, top: Math.min(Math.max(0, lines.length - (h - 1)), Math.max(0, mark - FIND)) };
}

// a line holding the words: the first (by: 0), the one after the line
// found last (1) or before it (-1), round; shown FIND lines below the top;
// which of how many
const FIND = 2;
function file_find(d: Deck, lines: Paint.Line[], room: number, by: number): Deck {
  const q = d.filter.trim().toLowerCase();
  if (q === "") {
    return { ...d, say: "Find what? / and the words." };
  }
  const hits = lines.flatMap((l, k) => (l.map((r) => r.x).join("").toLowerCase().includes(q) ? [k] : []));
  if (hits.length === 0) {
    return { ...d, hit: null, say: "No line has “" + d.filter.trim() + "”." };
  }
  const last = d.hit ?? -1;
  const next = by === 0 ? 0 : by > 0 ? hits.findIndex((k) => k > last) : hits.findLastIndex((k) => k < last);
  const at = next >= 0 ? next : by > 0 ? 0 : hits.length - 1;
  const top = Math.min(Math.max(0, lines.length - room), Math.max(0, hits[at] - FIND));
  return { ...d, top, hit: hits[at], say: "“" + d.filter.trim() + "”: " + (at + 1) + " of " + hits.length };
}

// the first line in sight that keeps line at in sight, room lines shown
function deck_sight(at: number, top: number, room: number): number {
  return at < top ? at : at >= top + room ? at - room + 1 : top;
}

// the crew's keys: the web's Undo, Claude Code and Archive buttons, by
// the rules of /undo, /handoff and /archive (u asks first, y undoes);
// any other, /crew full's (View.view_full)
function deck_crew_key(v: View.View, d: Deck, key: string, now: number): Out {
  const out = (deck: Deck, r?: View.Act | string): Out => ({ deck: typeof r === "string" ? { ...deck, say: r } : deck, acts: r === undefined || typeof r === "string" ? [] : [r], sends: [], done: false });
  const name = d.sel ?? "";
  if ((key === "u" || key === "o" || key === "A") && name === "") {
    return out(d, "Pick an agent first: ↑↓.");
  }
  if (key === "u") {
    const undo = View.view_crew_op(v, "undo", name + " yes");
    return typeof undo === "string" ? out(d, undo) : out({ ...d, ask: name, say: View.undo_ask(name) + " y: undo · any other key: keep" });
  }
  if (key === "o") {
    return out(d, View.view_crew_op(v, "handoff", name));
  }
  if (key === "A") {
    return out(d, Cockpit.archive_cmd(v, name, now));
  }
  const full = View.view_full(v, d.sel, key);
  return { deck: { ...d, sel: full.sel }, acts: [], sends: full.acts, done: full.done, focus: full.focus };
}

// the first line in sight after a scrolling key, room lines shown of n
function deck_scroll(n: number, room: number, top: number, key: string): number {
  const step: Record<string, number> = { j: 1, Down: 1, k: -1, Up: -1, " ": room - 1, Space: room - 1, PageDown: room - 1, PageUp: 1 - room, b: 1 - room, Home: -Infinity, End: Infinity };
  return Math.min(Math.max(0, n - room), Math.max(0, top + (step[key] ?? 0)));
}

// Lines
// =====

// the deck in w columns, h rows at most: the nav, what was said, the
// page's body in sight
export function deck_lines(v: View.View, d: Deck, w: number, h: number, now: number): Paint.Line[] {
  const said = d.say === null ? [] : Paint.runs_wrap([Paint.Run(d.say, SAY)], w, false);
  const head = [deck_nav(v, d.page, w), ...said];
  const room = Math.max(1, h - head.length);
  if (d.page === "crew") {
    return [...head, ...Paint.crew_full(v, w, room, d.sel, now)].slice(0, h);
  }
  const body = deck_body(v, d, w, now).lines;
  const top = Math.min(d.top, Math.max(0, body.length - room));
  return [...head, ...body.slice(top, top + room)].slice(0, h);
}

// a page's body: its lines, and the items to pick on it (a key, its first
// line, how many it takes), in order
type Body = { lines: Paint.Line[]; items: { key: string; at: number; n: number }[] };

// a part of a body: a line of text in an ink, or an item to pick (key)
// (runs: its text in several inks)
type Part = { text: string; ink?: Ink; key?: string; runs?: Paint.Line };
type Ink = Paint.Run["s"];

// the pages with items to pick: their parts
const PARTS: Partial<Record<Page, (v: View.View, d: Deck, now: number) => Part[]>> = {
  home: home_parts, inbox: inbox_parts, questions: (v, _d, now) => questions_parts(v, now), memory: (v) => memory_parts(v), todo: (v) => todo_parts(v),
};

// a page's body: its parts; the file as /look prints it (its code
// colored); a text page's text
function deck_body(v: View.View, d: Deck, w: number, now: number): Body {
  const parts = PARTS[d.page];
  if (parts !== undefined) {
    return parts_body(parts(v, d, now), w, d.sel);
  }
  const md = d.page === "file" && v.looked !== null ? View.looked_md(v, v.looked, Infinity) : null;
  if (md !== null) {
    return { lines: Paint.rows_lines(View.entry_rows(null, "note", md), w), items: [] };
  }
  return parts_body(deck_text(v, d.page).split("\n").map((t) => ({ text: t })), w, d.sel);
}

// parts as lines in w columns: an item marked "▸ " and bold when picked
function parts_body(parts: Part[], w: number, sel: string | null): Body {
  const lines: Paint.Line[] = [];
  const items: Body["items"] = [];
  for (const p of parts) {
    const runs = p.runs ?? [Paint.Run(p.text, p.ink ?? Paint.INK)];
    if (p.key === undefined) {
      lines.push(...(runs.every((r) => r.x === "") ? [[]] : Paint.runs_wrap(runs, w, false)));
      continue;
    }
    const here = p.key === sel;
    const wrapped = Paint.runs_wrap(here ? runs.map((r) => Paint.Run(r.x, { ...r.s, b: true })) : runs, w - 2, false);
    items.push({ key: p.key, at: lines.length, n: wrapped.length });
    wrapped.forEach((l, k) => lines.push([Paint.Run(k === 0 && here ? "▸ " : "  ", BOLD), ...l]));
  }
  return { lines, items };
}

// the questions, as the web's pane: each open one to pick (its number,
// its lines, the answers offered), then the notes, then super auto's
// decisions (the kinds' progress over them); the keys
function questions_parts(v: View.View, now: number): Part[] {
  const qs = View.view_questions(v);
  const notes = View.view_notes(v);
  const ds = View.view_decided(v, now);
  const tallies = View.view_tallies_text(v);
  const decided: Part[] = ds.length === 0 && (tallies === "" || v.mode !== "super") ? [] : [
    { text: "" }, { text: "Decided for you (super auto)", ink: HEAD }, ...(tallies === "" ? [] : [{ text: tallies, ink: Paint.DIM }]),
    ...ds.map((x): Part => ({ key: "d" + x.id, text: View.decided_text(x) })),
    ...(ds.length === 0 ? [] : [{ text: "a decision: u undo · Enter /reverse with what instead · x dismiss", ink: Paint.DIM }]),
  ];
  const item = (q: View.Question): Part[] => {
    const [first, ...more] = q.text.split("\n");
    const offered = q.options === undefined ? [] : [{ text: "    " + q.options.map((o, k) => k + 1 + ") " + o).join(" · "), ink: SAY }];
    return [{ key: String(q.id), text: q.id + ". " + first }, ...more.map((l): Part => ({ text: "    " + l })), ...offered];
  };
  return [
    { text: qs.length === 0 ? "No open questions." : "Your questions (" + qs.length + ")", ink: BOLD },
    ...qs.flatMap(item),
    ...(notes.length === 0 ? [] : [{ text: "" }, { text: "Notes (" + notes.length + ")", ink: HEAD }, ...notes.flatMap(item)]),
    ...decided,
    { text: "" },
    { text: "↑↓ pick · 1-9 that answer · Enter types /answer in the box · x dismiss · Esc chat", ink: Paint.DIM },
  ];
}

// the Todo page, as the web's: each todo to pick (Cockpit.todo_line); the keys
function todo_parts(v: View.View): Part[] {
  const all = v.assigned ?? [];
  return [
    { text: all.length === 0 ? Cockpit.TODO_NONE : "Your todos (" + all.length + ")", ink: BOLD },
    ...all.map((a): Part => ({ key: String(a.n), text: Cockpit.todo_line(a) })),
    { text: "" },
    { text: "↑↓ pick · d done (its agent hears it) · x drop · Esc chat", ink: Paint.DIM },
  ];
}

// memory, as the web's page: the pins, then the last recall's hits, each
// a message to pick (as /pins and /recall list them: View.hit_text)
function memory_parts(v: View.View): Part[] {
  const pins = v.pins ?? [];
  const hits = v.recall?.hits ?? [];
  const first = (note: string) => note.split("\n")[0];
  return [
    { text: first(View.view_pins_note(v)), ink: BOLD },
    ...pins.map((p): Part => ({ key: "p" + p.i, text: View.hit_text(p) })),
    ...(v.recall === null ? [] : [{ text: "" }, { text: first(View.view_recall_note(v)), ink: BOLD }, ...hits.map((h): Part => ({ key: "h" + h.i, text: View.hit_text(h) }))]),
    { text: "" },
    { text: "↑↓ pick · Enter shows it in the chat · p pin or unpin · / recall words · Esc chat", ink: Paint.DIM },
  ];
}

// a row's tag's ink by its tone, as the web's tags
const TONE: Record<Cockpit.Row["tone"], Ink> = { bad: { ...Paint.INK, c: Theme.ANSI.del }, warn: { ...Paint.INK, c: "3" }, ok: { ...Paint.INK, c: Theme.ANSI.add }, "": Paint.DIM };

// the inbox, as the web's page: when read and what changed, what failed
// to be read, the filter; each section (▾ open, ▸ folded) with its rows
// to pick ([x]: a PR picked), the one shown's details under it, those
// older than 60 days counted; the picks and what r and f do with them
function inbox_parts(v: View.View, d: Deck, now: number): Part[] {
  const keys: Part = { text: "↑↓ move · Space fold · Tab details · Enter open · v pick · r review · f fix · c Claude Code · / filter · R refresh · Esc drops the picks, then back", ink: Paint.DIM };
  const inbox = v.inbox;
  if (inbox === null) {
    return [{ text: "No device has read the inbox yet: a terminal (legion) or legion device reads it with your gh, acli and git. R asks again." }, { text: "" }, keys];
  }
  const sections = inbox_of(v, d, now);
  const shown = sections.filter((s) => s.count > 0 || s.note !== undefined);
  const pad = (text: string, ink: Ink = Paint.DIM): Part => ({ text: "      " + text, ink });
  const detail = (r: Cockpit.Row): Part[] => {
    const p = r.pr;
    if (p === undefined) {
      return r.clean === undefined ? [] : [pad(r.clean.path)];
    }
    const body = p.body.trim() === "" ? [] : p.body.trim().split("\n").slice(0, 8).map((l) => pad(l));
    return [pad("+" + p.add + " −" + p.del + " · " + p.files + " files · " + p.branch + " · " + p.author), ...(p.failing.length === 0 ? [] : [pad(p.failing.join(" · "), TONE.bad)]), ...body];
  };
  const row = (s: Cockpit.Section, r: Cockpit.Row): Part[] => {
    const key = s.id + " " + r.key;
    const mark = r.pr === undefined ? "    " : d.picks.includes(r.key) ? "[x] " : "[ ] ";
    const runs = [Paint.Run(mark + r.sub + " ", Paint.DIM), Paint.Run(r.title), ...(r.tag === "" ? [] : [Paint.Run(" · " + r.tag, TONE[r.tone])]), ...(r.age === "" ? [] : [Paint.Run(" · " + r.age, Paint.DIM)])];
    return [{ key, text: "", runs }, ...(d.detail === key ? detail(r) : [])];
  };
  const section = (s: Cockpit.Section): Part[] => {
    const shut = d.shut.includes(s.id);
    const head: Part = { text: (shut ? "▸ " : "▾ ") + s.title + " (" + s.count + ")" + (s.sub === "" ? "" : " · " + s.sub), ink: HEAD };
    const old = s.rows.filter((r) => r.old).length;
    return shut ? [head] : [head, ...(s.note === undefined ? [] : [{ text: "  " + s.note, ink: Paint.DIM }]), ...s.rows.filter((r) => !r.old).flatMap((r) => row(s, r)),
      ...(old === 0 ? [] : [{ text: "  " + old + " older than 60 days", ink: Paint.DIM }]), { text: "" }];
  };
  const { picked, review, fix } = Cockpit.picks_acts(sections, new Set(d.picks), d.claude);
  const n = (a: View.Act | null) => (a?.$ === "Review" ? a.prs.length : 0);
  const filter = d.typing ? ["Filter: " + d.filter + "▏ (Enter: done)"] : d.filter === "" ? [] : ["Filter: “" + d.filter + "” (/ to change)"];
  return [
    { text: "Inbox · updated " + View.minute(new Date(inbox.at).toISOString()) + " · " + (d.changed ?? 0) + " changed since you looked", ink: BOLD },
    ...inbox.errors.filter((e) => !e.startsWith("acli")).map((e): Part => ({ text: e, ink: TONE.bad })),
    ...filter.map((text): Part => ({ text, ink: SAY })),
    { text: "" },
    ...shown.flatMap(section),
    ...(shown.length === 0 ? [{ text: d.filter.trim() === "" ? "Nothing in the inbox." : "No row holds “" + d.filter.trim() + "”." }, { text: "" }] : []),
    ...(picked.length === 0 ? [] : [{ text: picked.length + " picked · r review " + n(review) + " · f fix " + n(fix) + " · as " + (d.claude ? "Claude Code workers" : "Legion agents") + " (c) · Esc drops them", ink: SAY }]),
    keys,
  ];
}

// an agent's ink by its status, as the crew panel's
function status_ink(s: View.Status): Ink {
  return s === "asking" ? SAY : s === "failed" ? { ...Paint.INK, c: Theme.ANSI.del } : s === "done" || s === "stopped" ? Paint.DIM : Paint.INK;
}

// home, as the web's: the greeting and who needs you, the card of what
// happened while away, the stats, Legion's agents working then done (to
// pick), what is up next, the apps' lines, the keys
function home_parts(v: View.View, d: Deck, now: number): Part[] {
  const { working, done } = Cockpit.home_cards(v, now);
  const apps = Cockpit.home_apps(v);
  const next = Cockpit.up_next(v, now).slice(0, 5);
  const head = (text: string): Part => ({ text, ink: HEAD });
  const card = (c: Cockpit.Card): Part => ({ key: c.name, text: Cockpit.card_text(c), ink: status_ink(c.status) });
  const away = d.away === undefined ? [] : Cockpit.away_text(d.away).split("\n").map((text, k): Part => ({ text, ink: k === 0 ? SAY : Paint.INK }));
  return [
    { text: Cockpit.home_greeting(new Date(now)) + ". " + Cockpit.home_line(v), ink: BOLD },
    ...away,
    { text: Cockpit.stats_text(v), ink: Paint.DIM },
    ...(working.length === 0 ? [] : [{ text: "" }, head("Working (" + working.length + ")"), ...working.map(card)]),
    ...(done.length === 0 ? [] : [{ text: "" }, head("Done (" + done.length + ") · A archives the one picked; none picked: all"), ...done.map(card)]),
    ...(working.length + done.length === 0 ? [{ text: "" }, { text: "No agents yet: tell Legion what to do, or /agent <task>." }] : []),
    ...(next.length === 0 ? [] : [{ text: "" }, head("Up next"), ...next.map((e): Part => ({ text: e.day + " " + e.time + " · " + e.title + (e.people === 0 ? "" : " · " + e.people + " people") }))]),
    { text: "" },
    { text: "Inbox: " + apps.inbox + " · Questions: " + apps.questions + " · Routines: " + apps.routines, ink: Paint.DIM },
    { text: "↑↓ pick · Enter its page · A archive · g i inbox · g c crew · Esc chat", ink: Paint.DIM },
  ];
}

// a text page's text, as its command prints it (the crew draws its own)
function deck_text(v: View.View, page: Page): string {
  switch (page) {
    case "routines": return View.view_routines_note(v);
    case "digest": return Cockpit.digest_text(v);
    case "transcripts": return Cockpit.transcripts_text(v);
    case "timesheet": return Cockpit.timesheet_text(v);
    default: return page === "file" ? "No file shown yet: /look <path>, then g f." : "";
  }
}

// the nav, as the web's: each page's letter (underlined), its label (the
// one shown bold) and count (the crew's: its pill, unless the tail says
// it); then the tail (the deck's: the mode). Pages that do not fit in w
// are left out, the one shown kept; then the tail, if it fits
export function deck_nav(v: View.View, page: Page | "chat", w: number, tail?: Paint.Line): Paint.Line {
  return nav_layout(v, page, w, tail).line;
}

// the nav page at column x (0: the first) of the nav in w, else null
function nav_hit(v: View.View, page: Page | "chat", w: number, x: number): Page | "chat" | null {
  return nav_layout(v, page, w).spans.find((s) => x >= s.from && x < s.to)?.to_page ?? null;
}

// the nav's line, and the columns each page shown takes in it
function nav_layout(v: View.View, page: Page | "chat", w: number, tail?: Paint.Line): { line: Paint.Line; spans: { from: number; to: number; to_page: Page | "chat" }[] } {
  const asked = View.view_questions(v).length;
  const notes = View.view_notes(v).length;
  const count: Partial<Record<Page | "chat", string>> = {
    inbox: String(Cockpit.inbox_badge(v.inbox) || ""),
    chat: [asked === 0 ? "" : "?" + asked, notes === 0 ? "" : "i" + notes].filter((x) => x !== "").join(" "),
    crew: tail === undefined ? View.view_pill(v) : "",
    memory: String((v.pins ?? []).length || ""),
    todo: String((v.assigned ?? []).length || ""),
  };
  const item = ([letter, label, to]: (typeof NAV)[number]): Paint.Line => {
    const n = count[to] ?? "";
    return [Paint.Run(letter, KEY), Paint.Run(" "), Paint.Run(label + (n === "" ? "" : " " + n), to === page ? BOLD : Paint.INK)];
  };
  const mode = tail ?? (v.mode === undefined ? [] : [Paint.Run("· " + v.mode + " mode", Paint.DIM)]);
  const width = (l: Paint.Line) => Paint.text_width(l.map((r) => r.x).join(""));
  const shown: { l: Paint.Line; to: Page | "chat" }[] = [];
  let used = width(mode);
  for (const nav of NAV) {
    const l = item(nav);
    const need = width(l) + 2;
    const keep = nav[2] === page;
    if (used + need <= w || keep) {
      shown.push({ l, to: nav[2] });
      used += need;
    }
  }
  const spans: { from: number; to: number; to_page: Page | "chat" }[] = [];
  let col = 0;
  for (const { l, to } of shown) {
    spans.push({ from: col, to: col + width(l), to_page: to });
    col += width(l) + 2;
  }
  const line = [...shown.flatMap(({ l }, k) => (k === 0 ? l : [Paint.Run("  "), ...l])), ...(used <= w && mode.length > 0 ? [Paint.Run("  "), ...mode] : [])];
  return { line: line_cut(line, w), spans };
}

// the chat's footer line: the nav (the chat shown), the web's bottom bar
// (Cockpit.bar_text), how to go to a page from the chat
export function foot_line(v: View.View, w: number): Paint.Line {
  return deck_nav(v, "chat", w, [Paint.Run("· " + Cockpit.bar_text(v) + " · Ctrl+G + letter", Paint.DIM)]);
}

// the chat's crew panel (panel: else the tabs line), w wide; from WIDE
// columns, home's column beside it, as the web's side column, in its rows
// (the footer no taller)
export const WIDE = 120;
export function crew_foot(v: View.View, w: number, now: number, most: number, panel: boolean): Paint.Line[] {
  const rw = Math.min(48, Math.floor(w * 0.35));
  const lw = w < WIDE ? w : w - rw - 3;
  const left = panel ? Paint.crew_lines(v, lw, now, most) : [Paint.tabs_line(v, lw)];
  if (w < WIDE) {
    return left;
  }
  const right = side_lines(v, now).slice(0, left.length).map((l) => line_cut(l, rw));
  const width = (l: Paint.Line) => Paint.text_width(l.map((r) => r.x).join(""));
  return left.map((l, k) => [...l, Paint.Run(" ".repeat(Math.max(0, lw - width(l))) + " │ ", Paint.DIM), ...(right[k] ?? [])]);
}

// home's column: who needs you and who works, those asking or failed, the
// inbox, the questions and routines, what is up next
function side_lines(v: View.View, now: number): Paint.Line[] {
  const apps = Cockpit.home_apps(v);
  const next = Cockpit.up_next(v, now)[0];
  const need = View.view_needs(v).map((c): Paint.Line => [Paint.Run(Cockpit.MARK[c.status] + " " + c.name + (c.status === "asking" ? " asks to start" : " failed"), status_ink(c.status))]);
  const badge = Cockpit.inbox_badge(v.inbox);
  return [
    [Paint.Run("Home · ", HEAD), Paint.Run(Cockpit.home_line(v), BOLD)],
    ...need,
    [Paint.Run("Inbox: " + (badge === 0 ? "" : badge + " for you · ") + apps.inbox, Paint.DIM)],
    [Paint.Run("Questions: " + apps.questions + " · Routines: " + apps.routines, Paint.DIM)],
    ...(next === undefined ? [] : [[Paint.Run("Next: " + next.day + " " + next.time + " · " + next.title, Paint.DIM)]]),
  ];
}

// The / menu
// ----------
// The web's Ctrl+K palette in the chat's box: the input a / and a word,
// the commands starting with it, then the palette's items holding it
// (Cockpit.palette: pages, agents, PRs, spaces); an item's going, as
// Term.ts does it

export type MenuItem = { label: string; hint: string; go: Cockpit.Go | { run: string } };
export type Going = { run: string } | { type: string } | { page: Page; filter?: string } | { goto: string } | { open: string } | { act: View.Act } | { chat: true } | { say: string };

// the most items shown at once
export const MENU = 6;

// the items for the input (commands: their use and what they do)
export function menu_items(v: View.View, cmds: [use: string, text: string][], text: string): MenuItem[] {
  if (!/^\/\S*$/.test(text)) {
    return [];
  }
  const q = text.slice(1).toLowerCase();
  const own = cmds.filter(([use]) => use !== "" && use.slice(1).toLowerCase().startsWith(q)).map(([use, hint]): MenuItem => ({ label: use, hint, go: { run: use } }));
  const more = q === "" ? [] : Cockpit.palette(v, q).map((it): MenuItem => it);
  return [...own, ...more];
}

// what choosing an item does: a command runs (one that needs an
// argument, <...>, typed in the box), a page opens full screen, an agent's
// tab shows, a link opens, an act is sent
export function menu_go(it: MenuItem): Going {
  const go = it.go;
  if ("run" in go) {
    const word = go.run.split(" ")[0];
    return go.run.includes("<") ? { type: word + " " } : { run: word };
  }
  if ("href" in go) {
    const r = View.view_route(go.href);
    return r.mode === "chat" ? { chat: true } : r.mode === "crew" ? (r.name === null ? { page: "crew" } : { goto: r.name }) : { page: r.mode === "files" ? "file" : r.mode };
  }
  if ("open" in go) {
    return { open: go.open };
  }
  if ("act" in go) {
    return { act: go.act };
  }
  if ("space" in go) {
    return { page: "inbox", filter: go.space };
  }
  return go.cmd === "new-agent" ? { type: "/agent " } : { say: "No side columns to hide in the terminal: /crew hides the crew." };
}

// the item picked after Up or Down, of n (sel -1: none yet), round
export function menu_pick(sel: number, n: number, key: "Up" | "Down"): number {
  return sel < 0 ? (key === "Down" ? 0 : n - 1) : (sel + (key === "Down" ? 1 : n - 1)) % n;
}

// the menu's lines, w wide: MENU items at most, around the one picked
// (-1: none yet) and it marked; the keys
export function menu_lines(items: MenuItem[], sel: number, w: number): Paint.Line[] {
  const from = Math.min(Math.max(0, sel - MENU + 1), Math.max(0, items.length - MENU));
  const shown = items.slice(from, from + MENU).map((it, k): Paint.Line => {
    const here = from + k === sel;
    return line_cut([Paint.Run(here ? "▸ " : "  ", BOLD), Paint.Run(it.label, here ? BOLD : Paint.INK), Paint.Run("  " + it.hint, Paint.DIM)], w);
  });
  const more = items.length > MENU ? " · " + items.length + " in all" : "";
  return [...shown, line_cut([Paint.Run("↑↓ pick · Tab complete · Enter run · Esc close" + more, Paint.DIM)], w)];
}

// the page a chord's letter goes to (m: the chat), else null
export function deck_chord(key: string): Page | "chat" | null {
  return Object.hasOwn(CHORDS, key) ? CHORDS[key] : null;
}

// a line cut to w columns (its runs' inks kept)
function line_cut(l: Paint.Line, w: number): Paint.Line {
  const out: Paint.Line = [];
  let left = w;
  for (const r of l) {
    const n = Paint.text_width(r.x);
    if (n <= left) {
      out.push(r);
      left -= n;
    } else {
      out.push(Paint.Run(Paint.text_cut(r.x, left), r.s));
      break;
    }
  }
  return out;
}
