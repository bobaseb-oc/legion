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

export const PAGES = ["home", "inbox", "crew", "questions", "memory", "file", "routines", "digest", "transcripts", "timesheet"] as const;
export type Page = (typeof PAGES)[number];

// the deck: the page shown, what is selected on it (an agent's name, a
// row's key), its first line in sight, whether g began a chord, the
// inbox's filter; the agent whose undo waits for y, a line said under
// the nav till the next key (why a key did nothing, what y does)
export type Deck = { page: Page; sel: string | null; top: number; g: boolean; filter: string; ask: string | null; say: string | null };

// a key's outcome: the deck next, the acts it asks (Term.ts runs them),
// what it sent (the crew's keys send as they act: View.view_full),
// whether the deck closes (focus: the agent whose page to show)
export type Out = { deck: Deck; acts: View.Act[]; sends: View.Client[]; done: boolean; focus?: string };

// Constants
// =========

// the chords: the web's (its files: the file shown), and the questions
const CHORDS: Record<string, Page | "chat"> = {
  ...Object.fromEntries(Object.entries(Cockpit.CHORDS).map(([k, to]) => [k, to === "files" ? "file" : to])),
  q: "questions",
};

// the nav: each page's letter and label, in the web's order
const NAV: [letter: string, label: string, page: Page | "chat"][] = [
  ["h", "Home", "home"], ["i", "Inbox", "inbox"], ["m", "Chat", "chat"], ["c", "Crew", "crew"],
  ["q", "Questions", "questions"], ["p", "Memory", "memory"], ["f", "File", "file"],
  ["r", "Routines", "routines"], ["d", "Digest", "digest"], ["t", "Transcripts", "transcripts"], ["s", "Timesheet", "timesheet"],
];

const BOLD = { ...Paint.INK, b: true };
const KEY  = { ...Paint.DIM, u: true };
const SAY  = { ...Paint.INK, b: true, c: Theme.ANSI.you };

// Keys
// ====

export function deck_new(page: Page, filter = ""): Deck {
  return { page, sel: null, top: 0, g: false, filter, ask: null, say: null };
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
  if (d.g) {
    const to = Object.hasOwn(CHORDS, key) ? CHORDS[key] : undefined;
    if (to === "chat") {
      return out({ ...d, g: false }, { done: true });
    }
    return out(to === undefined ? { ...d, g: false } : deck_new(to, d.filter));
  }
  if (key === "g") {
    return out({ ...d, g: true });
  }
  if (d.page === "crew") {
    return deck_crew_key(v, d, key, now);
  }
  if (key === "Esc" || key === "q") {
    return out(d, { done: true });
  }
  return out({ ...d, top: deck_scroll(deck_body(v, d, w, now).length, h - 1, d.top, key) });
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
  const body = deck_body(v, d, w, now);
  const top = Math.min(d.top, Math.max(0, body.length - room));
  return [...head, ...body.slice(top, top + room)].slice(0, h);
}

// a text page's lines: what its command prints (the file, as /look
// prints it: its code colored)
function deck_body(v: View.View, d: Deck, w: number, now: number): Paint.Line[] {
  const text = deck_text(v, d, now);
  return Paint.rows_lines(d.page === "file" && v.looked !== null ? View.entry_rows(null, "note", text) : View.note_rows(text), w);
}

function deck_text(v: View.View, d: Deck, now: number): string {
  switch (d.page) {
    case "home": return Cockpit.home_text(v, new Date(now));
    case "inbox": return Cockpit.inbox_text(v, d.filter, now, 0);
    case "questions": return View.view_questions_note(v);
    case "memory": return [View.view_pins_note(v), ...(v.recall === null ? [] : [View.view_recall_note(v)])].join("\n\n");
    case "file": return (v.looked === null ? null : View.looked_md(v, v.looked)) ?? "No file shown yet: /look <path>, then g f.";
    case "routines": return View.view_routines_note(v);
    case "digest": return Cockpit.digest_text(v);
    case "transcripts": return Cockpit.transcripts_text(v);
    case "timesheet": return Cockpit.timesheet_text(v);
    case "crew": return "";
  }
}

// the nav, as the web's: each page's letter (underlined), its label (the
// one shown bold) and count; then the mode. Pages that do not fit in w
// are left out, the one shown kept
export function deck_nav(v: View.View, page: Page, w: number): Paint.Line {
  const asked = View.view_questions(v).length;
  const notes = View.view_notes(v).length;
  const count: Partial<Record<Page | "chat", string>> = {
    inbox: String(Cockpit.inbox_badge(v.inbox) || ""),
    chat: [asked === 0 ? "" : "?" + asked, notes === 0 ? "" : "i" + notes].filter((x) => x !== "").join(" "),
    crew: View.view_pill(v),
    memory: String((v.pins ?? []).length || ""),
  };
  const item = ([letter, label, to]: (typeof NAV)[number]): Paint.Line => {
    const n = count[to] ?? "";
    return [Paint.Run(letter, KEY), Paint.Run(" "), Paint.Run(label + (n === "" ? "" : " " + n), to === page ? BOLD : Paint.INK)];
  };
  const mode = v.mode === undefined ? [] : [Paint.Run("· " + v.mode + " mode", Paint.DIM)];
  const width = (l: Paint.Line) => Paint.text_width(l.map((r) => r.x).join(""));
  const shown: Paint.Line[] = [];
  let used = width(mode);
  for (const nav of NAV) {
    const l = item(nav);
    const need = width(l) + 2;
    const keep = nav[2] === page;
    if (used + need <= w || keep) {
      shown.push(l);
      used += need;
    }
  }
  const line = [...shown.flatMap((l, k) => (k === 0 ? l : [Paint.Run("  "), ...l])), ...(used <= w && mode.length > 0 ? [Paint.Run("  "), ...mode] : [])];
  return line_cut(line, w);
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
