// Notes test
// ==========
// `bun run test Notes.test.ts`. The notes store (Notes.ts):
// one file per note under <dir>/notes, names from a slug allowlist,
// text redacted and capped, files 0600, a symlinked dir or note refused,
// at most NOTES notes, an index cut to NOTE_INDEX bytes with a line that
// says how many were left out. Hand-planted files with a valid name are
// listed (the user sees what Unii reads); MEMORY.md and bad names are not.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const Notes = await import("./Notes.ts");

// a user dir of its own, inside a base dir of its own, so a write that
// escapes notes/ (or the user dir) is seen
function fresh(): { base: string; dir: string } {
  const base = fs.mkdtempSync(os.tmpdir() + "/unii-notes-");
  const dir = base + "/u";
  fs.mkdirSync(dir);
  return { base, dir };
}

const listed = (path: string): string[] => (fs.existsSync(path) ? fs.readdirSync(path) : []);

// every file under `root`, as paths relative to it
function files(root: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!e.isDirectory()) {
      out.push((e.parentPath + "/" + e.name).slice(root.length + 1));
    }
  }
  return out.sort();
}

// a note file as the store writes it (Claude Code's MEMORY.md style)
const planted = (name: string, line: string, text: string): string =>
  "---\nname: " + name + "\ndescription: \"" + line + "\"\nmetadata:\n  type: note\n---\n\n" + text + "\n";

function plant(dir: string, file: string, body: string): void {
  fs.mkdirSync(Notes.notes_dir(dir), { recursive: true });
  fs.writeFileSync(Notes.notes_dir(dir) + "/" + file, body);
}

test("N2: a bad name is refused before any file call; nothing is written anywhere", () => {
  const bad = ["../x", "A", "-a", "a/b", ".hidden", "a".repeat(49), "", "a b"];
  for (const name of bad) {
    const { base, dir } = fresh();
    const out = Notes.notes_write(dir, name, "a line", "some text");
    expect({ name, out: typeof out }).toEqual({ name, out: "string" });
    expect({ name, notes: listed(Notes.notes_dir(dir)) }).toEqual({ name, notes: [] });
    expect({ name, files: files(base) }).toEqual({ name, files: [] });
  }
});

test("N2: the slug allowlist is the plan's NAME", () => {
  expect(Notes.NAME.source).toBe("^[a-z0-9][a-z0-9-]{0,47}$");
  // the longest valid name (48 chars) is written
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "a".repeat(48), "a line", "t")).toBe("object");
});

test("L2-AC3: an Anthropic key in a note's text is redacted on disk", () => {
  const { dir } = fresh();
  const key = "sk-ant-api03-" + "aBcDeFgHiJ".repeat(4);
  const out = Notes.notes_write(dir, "creds", "where the key is", "the key is " + key + " keep it");
  expect(typeof out).toBe("object");
  const disk = fs.readFileSync(Notes.notes_dir(dir) + "/creds.md", "utf8");
  expect(disk).toContain("[REDACTED:");
  expect(disk).not.toContain(key);
});

test("L2-AC6: a written note's file mode is 0600", () => {
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "plan", "the plan", "step one")).toBe("object");
  expect(fs.statSync(Notes.notes_dir(dir) + "/plan.md").mode & 0o777).toBe(0o600);
});

test("N3: the notes dir's mode is 0700", () => {
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "plan", "the plan", "step one")).toBe("object");
  expect(fs.statSync(Notes.notes_dir(dir)).mode & 0o777).toBe(0o700);
});

test("L2-AC7: notes/ replaced by a symlink to another dir: the write is refused, the target dir unchanged", () => {
  const { base, dir } = fresh();
  const other = base + "/other";
  fs.mkdirSync(other);
  fs.writeFileSync(other + "/keep.txt", "keep");
  fs.symlinkSync(other, Notes.notes_dir(dir));
  const out = Notes.notes_write(dir, "plan", "the plan", "step one");
  expect(typeof out).toBe("string");
  expect(fs.readdirSync(other)).toEqual(["keep.txt"]);
  expect(fs.readFileSync(other + "/keep.txt", "utf8")).toBe("keep");
});

test("N4: a note path that is a symlink is refused; the file it points to is unchanged", () => {
  const { base, dir } = fresh();
  const outside = base + "/outside.txt";
  fs.writeFileSync(outside, "untouched");
  fs.mkdirSync(Notes.notes_dir(dir), { recursive: true });
  fs.symlinkSync(outside, Notes.notes_dir(dir) + "/plan.md");
  const out = Notes.notes_write(dir, "plan", "the plan", "step one");
  expect(typeof out).toBe("string");
  expect(fs.readFileSync(outside, "utf8")).toBe("untouched");
});

test("L2-AC8: note text of NOTE_TEXT + 1 bytes is refused, not cut", () => {
  expect(Notes.NOTE_TEXT).toBe(4096);
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "big", "too big", "x".repeat(Notes.NOTE_TEXT + 1))).toBe("string");
  expect(fs.existsSync(Notes.notes_dir(dir) + "/big.md")).toBe(false);
  // counted in bytes, not chars: 2049 two-byte chars are 4098 bytes
  expect(typeof Notes.notes_write(dir, "wide", "too wide", "é".repeat(2049))).toBe("string");
  // at the cap it is kept
  expect(typeof Notes.notes_write(dir, "full", "at the cap", "x".repeat(Notes.NOTE_TEXT))).toBe("object");
});

test("N7: the 33rd note is refused", () => {
  expect(Notes.NOTES).toBe(32);
  const { dir } = fresh();
  for (let k = 0; k < Notes.NOTES; k++) {
    expect(typeof Notes.notes_write(dir, "n" + k, "note " + k, "t")).toBe("object");
  }
  expect(typeof Notes.notes_write(dir, "one-more", "note 33", "t")).toBe("string");
  expect(fs.existsSync(Notes.notes_dir(dir) + "/one-more.md")).toBe(false);
});

test("L2-AC9: 40 notes whose index lines pass 2048 bytes: the index is at most 2048 bytes and its last line names how many were left out", () => {
  expect(Notes.NOTE_INDEX).toBe(2048);
  const { dir } = fresh();
  // planted by hand: the store itself refuses past NOTES
  for (let k = 0; k < 40; k++) {
    plant(dir, "note-" + k + ".md", planted("note-" + k, "line " + k + " " + "w".repeat(100), "t"));
  }
  const index = Notes.notes_index(dir);
  expect(Buffer.byteLength(index, "utf8")).toBeLessThanOrEqual(2048);
  const lines = index.trimEnd().split("\n");
  const shown = lines.filter((l) => l.startsWith("- [")).length;
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(40);
  expect(lines.at(-1)).toMatch(new RegExp("\\b" + (40 - shown) + " more notes?\\b"));
});

test("L2-AC15: a hand-planted note with a valid name is listed; MEMORY.md and bad names are skipped", () => {
  const { dir } = fresh();
  plant(dir, "hand-made.md", planted("hand-made", "planted by the user", "body"));
  plant(dir, "MEMORY.md", "- [ghost](ghost.md) — not a note\n");
  plant(dir, "Bad_Name.md", planted("Bad_Name", "bad", "body"));
  plant(dir, ".hidden.md", planted(".hidden", "hidden", "body"));
  const notes = Notes.notes_list(dir);
  expect(notes.map((n) => n.name)).toEqual(["hand-made"]);
  expect(notes[0]!.line).toBe("planted by the user");
});

test("a note's round trip: write, read, drop; MEMORY.md follows the files", () => {
  const { dir } = fresh();
  const wrote = Notes.notes_write(dir, "plan", "the plan", "step one");
  expect(wrote).toMatchObject({ name: "plan", line: "the plan" });
  expect(fs.readFileSync(Notes.notes_dir(dir) + "/MEMORY.md", "utf8")).toContain("[plan](plan.md)");
  const read = Notes.notes_read(dir, "plan");
  expect(typeof read).toBe("object");
  expect((read as { text: string }).text.trim()).toBe("step one");
  expect(Notes.notes_list(dir).map((n) => n.name)).toEqual(["plan"]);
  expect(Notes.notes_drop(dir, "plan")).toBe(true);
  expect(typeof Notes.notes_read(dir, "plan")).toBe("string");
  expect(Notes.notes_list(dir)).toEqual([]);
  expect(fs.readFileSync(Notes.notes_dir(dir) + "/MEMORY.md", "utf8")).not.toContain("[plan](plan.md)");
});

test("a note named memory is refused: on a case-insensitive disk its file is the export MEMORY.md", () => {
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "plan", "the plan", "step one")).toBe("object");
  expect(typeof Notes.notes_write(dir, "memory", "how memory works", "keep this")).toBe("string");
  expect(Notes.notes_list(dir).map((n) => n.name)).toEqual(["plan"]);
  expect(listed(Notes.notes_dir(dir)).filter((f) => f.toLowerCase() === "memory.md")).toEqual(["MEMORY.md"]);
});

test("a planted note file past NOTE_FILE bytes is listed as too large, never read: not its text, not in the index", () => {
  const { dir } = fresh();
  plant(dir, "big.md", planted("big", "huge line", "x".repeat(Notes.NOTE_FILE)));
  plant(dir, "small.md", planted("small", "small line", "ok"));
  const big = Notes.notes_list(dir).find((n) => n.name === "big");
  expect(big?.text).toBe("");
  expect(big?.line).toContain("too large");
  expect(Notes.notes_index(dir)).not.toContain("[big](big.md)");
  expect(Notes.notes_index(dir)).toContain("[small](small.md)");
  expect(typeof Notes.notes_read(dir, "big")).toBe("string");
});

test("a note the store wrote at the NOTE_TEXT cap is under NOTE_FILE, so it is read whole", () => {
  const { dir } = fresh();
  expect(typeof Notes.notes_write(dir, "full", "l".repeat(150), "x".repeat(Notes.NOTE_TEXT))).not.toBe("string");
  expect((Notes.notes_read(dir, "full") as any).text.length).toBe(Notes.NOTE_TEXT);
});

test("notes_list reads at most LISTED files, newest first", () => {
  const { dir } = fresh();
  for (let k = 0; k < Notes.LISTED + 5; k++) {
    plant(dir, "n" + k + ".md", planted("n" + k, "line " + k, "t"));
  }
  const late = Date.now() / 1000 + 60;
  fs.utimesSync(Notes.notes_dir(dir) + "/n0.md", late, late);
  const list = Notes.notes_list(dir);
  expect(list.length).toBe(Notes.LISTED);
  expect(list[0]!.name).toBe("n0");
});

test("a note whose redacted text passes NOTE_TEXT is refused, not stored past NOTE_FILE", () => {
  const { dir } = fresh();
  // under the cap as given; each 8-char value becomes [REDACTED:assigned]
  const text = "pwd=12345678\n".repeat(315);
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(Notes.NOTE_TEXT);
  expect(typeof Notes.notes_write(dir, "logins", "the logins", text)).toBe("string");
  expect(fs.existsSync(Notes.notes_dir(dir) + "/logins.md")).toBe(false);
});
