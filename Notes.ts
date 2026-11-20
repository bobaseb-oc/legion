// Notes
// =====
// Unii's notes: what it keeps across runs, one file per
// note under <dir>/notes, in Claude Code's MEMORY.md style. Only Unii
// writes them (Tools.notes); the user sees, edits and drops each (the
// Memory page: Chat.noted). Untrusted text: a name from NAME only, text
// redacted (redact.ts) and capped, files 0600 in a 0700 dir, a symlinked
// dir or note refused, at most NOTES notes. The index reaches Unii fenced
// (Tools.notes_block), cut to NOTE_INDEX bytes. notes/MEMORY.md is an
// export copy, rewritten after each change and never read back.

import * as fs from "node:fs";
import { redact } from "./local/prime/redact.ts";

// a note: its name (the file's, less .md), its index line, its text,
// when last written (ms)
export type Note = { name: string; line: string; text: string; at: number };

export const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

// the index's most bytes, a note text's, the most notes; an index line's
// most chars
export const NOTE_INDEX = 2048, NOTE_TEXT = 4096, NOTES = 32;
const LINE = 150;

const EXPORT = "MEMORY.md";

export function notes_dir(dir: string): string {
  return dir + "/notes";
}

// the dir, made if missing; a string: why it can't be used (a symlink, or
// not a dir: a planted link would redirect writes)
function dir_ready(dir: string): string | null {
  const at = notes_dir(dir);
  const st = fs.lstatSync(at, { throwIfNoEntry: false });
  if (st === undefined) {
    fs.mkdirSync(at, { mode: 0o700 });
    return null;
  }
  if (!st.isDirectory()) {
    return "The notes dir is not a plain dir: refused.";
  }
  fs.chmodSync(at, 0o700);
  return null;
}

// "memory" too: on a case-insensitive disk (macOS) its file is EXPORT
function name_bad(name: string): string | null {
  if (name === EXPORT.slice(0, -3).toLowerCase()) {
    return "No note named memory: the notes' index has that file. Pick another name.";
  }
  return NAME.test(name) ? null : "No note name " + JSON.stringify(name.slice(0, 60)) + ": lower case letters, digits and -, at most 48.";
}

const line_of = (line: string): string => line.replace(/[\r\n]+/g, " ").trim().slice(0, LINE);

const body_of = (name: string, line: string, text: string): string =>
  "---\nname: " + name + "\ndescription: " + JSON.stringify(line) + "\nmetadata:\n  type: note\n---\n\n" + text + "\n";

// a note file's line and text; null: not the format
function parse(body: string): { line: string; text: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(body);
  if (m === null) {
    return null;
  }
  const desc = /^description: (.*)$/m.exec(m[1]!)?.[1] ?? "";
  let line = desc;
  if (desc.startsWith('"')) {
    try {
      line = String(JSON.parse(desc));
    } catch {
      line = desc.slice(1, desc.endsWith('"') ? -1 : undefined);
    }
  }
  return { line: line_of(line), text: m[2]!.replace(/\n$/, "") };
}

// a plain file only (a symlinked note is not read through)
function load(dir: string, name: string): Note | null {
  const file = notes_dir(dir) + "/" + name + ".md";
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (st === undefined || !st.isFile()) {
    return null;
  }
  const got = parse(fs.readFileSync(file, "utf8"));
  return got === null ? null : { name, ...got, at: st.mtimeMs };
}

// every note with a valid name, newest first (a hand-planted one too: the
// user sees what Unii reads)
export function notes_list(dir: string): Note[] {
  const st = fs.lstatSync(notes_dir(dir), { throwIfNoEntry: false });
  if (st === undefined || !st.isDirectory()) {
    return [];
  }
  return fs.readdirSync(notes_dir(dir))
    .filter((f) => f.endsWith(".md") && NAME.test(f.slice(0, -3)))
    .map((f) => load(dir, f.slice(0, -3)))
    .filter((n): n is Note => n !== null)
    .sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

const index_line = (n: Note): string => "- [" + n.name + "](" + n.name + ".md) — " + n.line + "\n";
const more_line = (n: number): string => "… " + n + " more note" + (n === 1 ? "" : "s") + " (read lists them all)\n";

// the index Unii sees, at most NOTE_INDEX bytes: past it, the rest said
// in a last line
export function notes_index(dir: string): string {
  const notes = notes_list(dir);
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  let out = "";
  for (let k = 0; k < notes.length; k++) {
    const next = out + index_line(notes[k]!);
    const left = notes.length - k - 1;
    if (bytes(next) + (left === 0 ? 0 : bytes(more_line(left))) > NOTE_INDEX) {
      return out + more_line(notes.length - k);
    }
    out = next;
  }
  return out;
}

export function notes_read(dir: string, name: string): Note | string {
  const bad = name_bad(name);
  if (bad !== null) {
    return bad;
  }
  const st = fs.lstatSync(notes_dir(dir), { throwIfNoEntry: false });
  const note = st?.isDirectory() ? load(dir, name) : null;
  return note ?? "No note " + name + ".";
}

// to <file>.new (0600, never through a link: wx), then renamed over it
function put(file: string, body: string): void {
  const tmp = file + ".new";
  fs.rmSync(tmp, { force: true });
  fs.writeFileSync(tmp, body, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function export_write(dir: string): void {
  put(notes_dir(dir) + "/" + EXPORT, notes_list(dir).map(index_line).join(""));
}

// line null: the note's old line kept (an edit of its text alone)
export function notes_write(dir: string, name: string, line: string | null, text: string): Note | string {
  const bad = name_bad(name);
  if (bad !== null) {
    return bad;
  }
  if (Buffer.byteLength(text, "utf8") > NOTE_TEXT) {
    return "A note's text is at most " + NOTE_TEXT + " bytes: split it, or keep less.";
  }
  const why = dir_ready(dir);
  if (why !== null) {
    return why;
  }
  const file = notes_dir(dir) + "/" + name + ".md";
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (st !== undefined && !st.isFile()) {
    return "Note " + name + " is not a plain file: refused.";
  }
  if (st === undefined && notes_list(dir).length >= NOTES) {
    return "At most " + NOTES + " notes: drop or merge one first.";
  }
  const given = line ?? (st === undefined ? null : load(dir, name)?.line) ?? "";
  const kept = { line: line_of(redact(given, []).text), text: redact(text, []).text };
  put(file, body_of(name, kept.line, kept.text));
  export_write(dir);
  return { name, ...kept, at: fs.statSync(file).mtimeMs };
}

export function notes_drop(dir: string, name: string): true | string {
  const bad = name_bad(name);
  if (bad !== null) {
    return bad;
  }
  const st = fs.lstatSync(notes_dir(dir), { throwIfNoEntry: false });
  if (st === undefined || !st.isDirectory() || load(dir, name) === null) {
    return "No note " + name + ".";
  }
  fs.unlinkSync(notes_dir(dir) + "/" + name + ".md");
  export_write(dir);
  return true;
}
