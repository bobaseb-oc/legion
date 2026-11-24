// Screen's input, fed byte streams as a terminal sends them: any read may
// end anywhere (a reader held up lets the terminal's writes split at any
// byte), and no text typed or pasted may slow a key down. Then the lines
// Paint lays out: a link is never cut, a frame never passes its width.

import { expect, test } from "bun:test";
import * as Paint from "./Paint.ts";
import * as Screen from "./Screen.ts";
import * as View from "./View.ts";

// a screen fed by hand: a kitty terminal (it answered the flags asked),
// keys pressed logged
function screen(): { scr: Screen.Screen; keys: string[] } {
  const keys: string[] = [];
  const ed  = { text: "", pos: 0, hist: [], at: 0, draft: "", moved: false, w: 80, tall: 1 };
  const scr = { tty: true, kitty: false, ed, rest: "", up: 0, rows: 0, on: (k: string) => k !== "" && keys.push(k) };
  Screen.screen_feed(scr, "\x1b[?1u");
  return { scr, keys };
}

// stream fed in two reads, cut at each place: what was typed, keys pressed
function splits(stream: string, check: (text: string, keys: string[]) => void): void {
  for (let k = 0; k <= stream.length; k++) {
    const { scr, keys } = screen();
    Screen.screen_feed(scr, stream.slice(0, k));
    Screen.screen_feed(scr, stream.slice(k));
    check(scr.ed.text, keys);
  }
}

const BOX = "  ▀▀▀▀▀▀▀▀\r  ╭─ 1x · /close #12345 ───╮\r  │ Done, it works. │\r  │                 │\r  ╰─────────────────╯\r";

test("a paste never sends, whatever its reads", () => {
  splits("\x1b[200~" + BOX + "\x1b[201~", (text, keys) => {
    expect(keys).toEqual([]);
    expect(text).toBe(BOX.replace(/\r/g, "\n"));
  });
});

test("a paste Term.ts takes (a dropped file's path) is not typed; any other is", () => {
  const { scr } = screen();
  const took: string[] = [];
  (scr as Screen.Screen).pasted = (s) => (s.startsWith("/") ? (took.push(s), true) : false);
  Screen.screen_feed(scr, "\x1b[200~/tmp/a.png\x1b[201~");
  expect(took).toEqual(["/tmp/a.png"]);
  expect(scr.ed.text).toBe("");
  Screen.screen_feed(scr, "\x1b[200~hello\x1b[201~");
  expect(scr.ed.text).toBe("hello");
});

test("a key Term.ts takes first (the / menu's Up, Down, Tab) does not edit; any other edits as ever", () => {
  const { scr, keys } = screen();
  const took: string[] = [];
  (scr as Screen.Screen).keys = (k) => (k === "Up" || k === "Tab" ? (took.push(k), true) : false);
  scr.ed.hist = ["before"];
  scr.ed.at = 1;
  Screen.screen_feed(scr, "/in\x1b[A\t");
  expect(took).toEqual(["Up", "Tab"]);
  expect(scr.ed.text).toBe("/in");
  expect(keys).toEqual([]);
  Screen.screen_feed(scr, "\x1b[D");
  expect(scr.ed.pos).toBe(2);
});

test("the mouse (SGR, the deck's): a left press a click at its column and row, the wheel up and down; a release nothing; none of it typed", () => {
  splits("\x1b[<0;12;3M\x1b[<0;12;3m\x1b[<64;5;5M\x1b[<65;5;5M\x1b[<2;1;1M", (text, keys) => {
    expect(text).toBe("");
    expect(keys).toEqual(["Click:12:3", "WheelUp", "WheelDown"]);
  });
});

test("kitty's keys never leak into the text, whatever their reads", () => {
  splits("hello!?\x1b[118;1:3u\x1b[27u\x1b[13;2u", (text, keys) => {
    expect(text).toBe("hello!?\n");
    expect(keys).toEqual(["V", "Esc"]);
  });
});

test("a character a terminal sends as a sequence, Shift or none held, is typed, whatever its reads", () => {
  // kitty's (code, its shifted alternate; repeat), modifyOtherKeys'; a
  // release, Ctrl and Shift+Enter stay keys
  splits("a\x1b[115;2uE\x1b[99:67;2:2u\x1b[32;2u\x1b[27;2;69~\x1b[100;1u!\x1b[47:63;2u\x1b[115;1:3u\x1b[115;5u\x1b[13;2u", (text, keys) => {
    expect(text).toBe("aSEC Ed!?\n");
    expect(keys).toEqual(["S", "Ctrl+S"]);
  });
});

test("kitty's alternate keys are asked, so Shift+/ comes as ? (the shifted key's own code; upper case is only right for letters)", () => {
  expect(Screen.MODES_ON).toContain("\x1b[>5u");
});

test("a pipe's last line, without a newline, waits in the input for the end", () => {
  const sent: string[] = [];
  const ed  = { text: "", pos: 0, hist: [], at: 0, draft: "", moved: false, w: 80, tall: 1 };
  const scr = { tty: false, kitty: false, ed, rest: "", up: 0, rows: 0, on: (k: string) => k === "Enter" && sent.push(Screen.ed_take(ed)) };
  Screen.screen_feed(scr, "one\ntw");
  Screen.screen_feed(scr, "o");
  expect(sent).toEqual(["one"]);
  expect(ed.text).toBe("two");
});

test("Alt and a character outside the BMP is one key, none of it typed", () => {
  const keys: string[] = [];
  const scr  = { tty: true, kitty: false, ed: { text: "", pos: 0, hist: [], at: 0, draft: "", moved: false, w: 80, tall: 1 }, rest: "", up: 0, rows: 0, on: (k: string) => k !== "" && keys.push(k) };
  Screen.screen_feed(scr, "\x1b😀a\x1bx");
  expect(keys).toEqual(["Alt+😀", "Alt+X"]);
  expect(scr.ed.text).toBe("a");
});

test("a pasted box in the history keeps each key fast", () => {
  const big = ("  ╭─ 1x · /close #12346 " + "─".repeat(240) + "╮\n  │ │ hi?" + " ".repeat(230) + "│ │\n  " + "▀".repeat(240) + "\n").repeat(100);
  const { scr } = screen();
  scr.ed.hist = ["hi", big];
  scr.ed.at   = 2;
  const t0 = performance.now();
  for (const key of ["Up", "Up", "Up", "Ctrl+Left", "Alt+Backspace", "Up", "Left", "Down", "Down"]) {
    Screen.ed_key(scr.ed, key);
    Screen.screen_input(scr, 120, 40, "", false);
  }
  expect(performance.now() - t0).toBeLessThan(500);
});

// shell mode (as Claude Code's !): a ! typed first turns the input's mark
// into a ! in the shell's color, the text after it in that color too, the
// hint saying so; a Backspace over the ! leaves it
test("a ! typed first shows the input in shell mode; Backspace over it leaves", () => {
  const { scr } = screen();
  const shown = () => {
    const { lines, at } = Screen.screen_input(scr, 80, 5, "hint", false);
    return { runs: lines[0]!.map((r) => [r.x, r.s === Paint.SHELL]), col: at.col };
  };
  Screen.screen_feed(scr, "!");
  expect(shown()).toEqual({ runs: [["! ", true], [View.SHELL_HINT, false]], col: 2 });
  Screen.screen_feed(scr, "ls");
  expect(shown()).toEqual({ runs: [["! ", true], ["ls", true]], col: 4 });
  Screen.ed_key(scr.ed, "Backspace");
  Screen.ed_key(scr.ed, "Backspace");
  expect(shown()).toEqual({ runs: [["! ", true], [View.SHELL_HINT, false]], col: 2 });
  Screen.ed_key(scr.ed, "Backspace");
  expect(shown()).toEqual({ runs: [["> ", false], ["hint", false]], col: 2 });
  expect(scr.ed.text).toBe("");
});

test("words: Ctrl+W, Alt+B, Alt+F", () => {
  const { scr } = screen();
  const ed = scr.ed;
  Object.assign(ed, { text: "olá mundo 𝒜b  ", pos: 15 });
  Screen.ed_key(ed, "Ctrl+W");
  expect(ed.text).toBe("olá mundo ");
  Screen.ed_key(ed, "Alt+B");
  expect(ed.pos).toBe(4);
  Screen.ed_key(ed, "Alt+F");
  expect(ed.pos).toBe(9);
});

test("a link is never cut", () => {
  const url = "https://x.co/" + "x".repeat(99);
  expect(Paint.runs_wrap([Paint.Run("Pay: " + url)], 76, false).map((l) => l.map((r) => r.x).join(""))).toEqual(["Pay: ", url]);
});

test("a frame never passes its width, however long its title", () => {
  const diff = "--- a/" + "dir/".repeat(30) + "f.ts\n+++ b/" + "dir/".repeat(30) + "f.ts\n@@ -1,1 +1,1 @@\n-x\n+y";
  const rows = View.entry_rows(1, "echo", diff);
  expect(Paint.rows_lines(rows, 60).map((l) => Paint.text_width(l.map((r) => r.x).join("")))).toEqual([60, 60, 60, 60]);
});

// the terminal tells focus (CSI ?1004h asked): CSI I in, CSI O out, as
// keys, never typed
test("focus in and out come as keys, never as text", () => {
  expect(Screen.MODES_ON).toContain("\x1b[?1004h");
  splits("a\x1b[Ib\x1b[O", (text, keys) => {
    expect(text).toBe("ab");
    expect(keys).toEqual(["FocusIn", "FocusOut"]);
  });
});

// Ctrl+R: the history searched in the input (Hist.ts), as a shell's
test("Ctrl+R searches the history: typing filters, Up goes older, Enter puts it in the input unsent, Esc leaves the input as it was", () => {
  const { scr, keys } = screen();
  const ed = scr.ed;
  ed.hist = ["git status", "npm test", "git stash"];
  ed.ats  = [1, 2, 3];
  ed.at   = 3;
  Screen.ed_type(ed, "draft");
  expect(Screen.ed_key(ed, "Ctrl+R")).toBe(true);
  Screen.ed_type(ed, "gst");
  expect(ed.text).toBe("draft");
  const drawn = Screen.screen_input(scr, 80, 10, "", false).lines.map((l) => l.map((r) => r.x).join(""));
  expect(drawn.join("\n")).toContain("git stash");
  expect(drawn.join("\n")).toContain("git status");
  expect(drawn[drawn.length - 1]).toContain("gst");
  expect(Screen.ed_key(ed, "Up")).toBe(true);
  expect(Screen.ed_key(ed, "Enter")).toBe(true);
  expect(ed.text).toBe("git status");
  expect(ed.pos).toBe("git status".length);
  expect(keys).toEqual([]);
  Screen.ed_key(ed, "Ctrl+R");
  Screen.ed_type(ed, "npm");
  expect(Screen.ed_key(ed, "Esc")).toBe(true);
  expect(ed.text).toBe("git status");
  Screen.ed_key(ed, "Ctrl+R");
  Screen.ed_type(ed, "zzz");
  Screen.ed_key(ed, "Enter");
  expect(ed.text).toBe("git status");
});

test("Ctrl+R's marked characters show in bold; what was sent here is searchable with its time", () => {
  const { scr } = screen();
  const ed = scr.ed;
  Screen.ed_type(ed, "!ls -la");
  Screen.ed_take(ed);
  expect(ed.ats?.[0]).toBeGreaterThan(0);
  Screen.ed_key(ed, "Ctrl+R");
  Screen.ed_type(ed, "la");
  const rows = Screen.screen_input(scr, 80, 10, "", false).lines;
  const hit  = rows.find((l) => l.map((r) => r.x).join("").includes("!ls -la"))!;
  expect(hit.filter((r) => r.s.b === true).map((r) => r.x).join("")).toBe("la");
});
