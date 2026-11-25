// Hist
// ====
// The chat's history searched, as Ctrl+R does in a shell (atuin's way):
// what the user sent, newest first, each text once; a query matches a
// text holding its characters in order, case-insensitive, a text holding
// it whole ranking first. Pure: the terminal's input (Screen.ts) and the
// web's box (web/src/main.ts) both draw from it.

import type * as View from "./View.ts";

// a text sent and when (ms; null: not known)
export type Said = { text: string; at: number | null };

// a hit: its text, when, the indexes of the query's characters in it
export type Found = Said & { marks: number[] };

// the most kept, newest first
export const HIST = 1000;

// the history: oldest first in, newest first out, each text once (at its
// newest), blank ones left out, HIST at most
export function hist_list(said: Said[]): Said[] {
  const seen = new Set<string>();
  const out: Said[] = [];
  for (let k = said.length - 1; k >= 0 && out.length < HIST; k--) {
    const s = said[k];
    if (s.text.trim() !== "" && !seen.has(s.text)) {
      seen.add(s.text);
      out.push(s);
    }
  }
  return out;
}

// where q's characters are in text, in order, case-insensitive: the
// first place it is whole, else the first of each in turn; null: none
export function hist_marks(q: string, text: string): number[] | null {
  const a = q.toLowerCase();
  const b = text.toLowerCase();
  const whole = b.indexOf(a);
  if (whole >= 0) {
    return Array.from({ length: a.length }, (_, k) => whole + k);
  }
  const marks: number[] = [];
  let from = 0;
  for (const ch of a) {
    const at = b.indexOf(ch, from);
    if (at < 0) {
      return null;
    }
    marks.push(at);
    from = at + 1;
  }
  return marks;
}

// the list's hits for q: those holding q whole first, then the rest, each
// newest first (the list's order)
export function hist_find(list: Said[], q: string): Found[] {
  const lower = q.toLowerCase();
  const found = list.flatMap((s) => {
    const marks = hist_marks(q, s.text);
    return marks === null ? [] : [{ ...s, marks }];
  });
  const whole = (f: Found) => f.text.toLowerCase().includes(lower);
  return [...found.filter(whole), ...found.filter((f) => !whole(f))];
}

// the selection moved d (1: older, -1: newer) in n hits, kept in them
export function hist_move(sel: number, n: number, d: number): number {
  return Math.max(0, Math.min(n - 1, sel + d));
}

// how long ago, short: 45s, 3m, 2h, 4d ("": not known)
export function hist_ago(at: number | null, now: number): string {
  if (at === null) {
    return "";
  }
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d";
}

// a view's history: the user's messages it holds, by id, with their
// dates; then what was typed in this view (its !commands too). RED ZONE
// (security review 4 E1, DRAFT awaiting the user's sign-off): a held one
// starting with "!" is left out: the user's !commands are logged as notes
// (Chat.bang), so it came by a say, maybe a device key's (an agent's), and
// a "!" line runs as the user, ungated
export function hist_said(v: View.View, typed: Said[]): Said[] {
  const mine = [...v.whole].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => {
    if (e.kind !== "user" || e.text.trimStart().startsWith("!")) {
      return [];
    }
    const at = e.date === undefined ? NaN : Date.parse(e.date);
    return [{ text: e.text, at: Number.isFinite(at) ? at : null }];
  });
  return [...mine, ...typed];
}
