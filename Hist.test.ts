// Hist test
// =========
// `bun run test Hist.test.ts`. The chat history search (Hist.ts), as
// Ctrl+R opens it in the terminal and on the web: what matches, in which
// order, marked how, deduplicated and capped; the age shown.

import { expect, test } from "bun:test";
import * as Hist from "./Hist.ts";
import * as View from "./View.ts";

const said = (...texts: string[]): Hist.Said[] => texts.map((text, k) => ({ text, at: k * 1000 }));

test("the list is newest first, each text once at its newest time, blanks left out, capped", () => {
  const list = Hist.hist_list([...said("a", "b", "a", "  ", "c")]);
  expect(list.map((s) => s.text)).toEqual(["c", "a", "b"]);
  expect(list.find((s) => s.text === "a")?.at).toBe(2000);
  const many = Array.from({ length: Hist.HIST + 50 }, (_, k) => ({ text: "m" + k, at: k }));
  const capped = Hist.hist_list(many);
  expect(capped.length).toBe(Hist.HIST);
  expect(capped[0].text).toBe("m" + (Hist.HIST + 49));
});

test("a match holds every query character in order, case-insensitive; marks are their indexes", () => {
  const cases: [string, string, number[] | null][] = [
    ["git", "git status", [0, 1, 2]],
    ["GS", "git status", [0, 4]],
    ["stat", "git status", [4, 5, 6, 7]],
    ["tsg", "git status", null],
    ["", "anything", []],
    ["sts", "git status", [4, 5, 9]],
  ];
  for (const [q, text, marks] of cases) {
    expect(Hist.hist_marks(q, text)).toEqual(marks);
  }
});

test("a substring match ranks above an out-of-order one, each group newest first", () => {
  const list = Hist.hist_list(said("git status", "go test", "grep st", "gst alias", "git stash"));
  const fuzzy = Hist.hist_find(list, "gts");
  expect(fuzzy.map((f) => f.text)).toEqual(["git stash", "gst alias", "go test", "git status"]);
  // "s x t" is newer but only matches out of order: the older substring wins
  const mixed = Hist.hist_find(Hist.hist_list(said("make st", "an st", "s x t")), "st");
  expect(mixed.map((f) => f.text)).toEqual(["an st", "make st", "s x t"]);
  expect(mixed[0].marks).toEqual([3, 4]);
  expect(Hist.hist_find(list, "").map((f) => f.text)).toEqual(list.map((s) => s.text));
  expect(Hist.hist_find(list, "zzz")).toEqual([]);
});

test("the selection moves older and newer and stays in the list", () => {
  expect(Hist.hist_move(0, 3, 1)).toBe(1);
  expect(Hist.hist_move(2, 3, 1)).toBe(2);
  expect(Hist.hist_move(0, 3, -1)).toBe(0);
  expect(Hist.hist_move(5, 3, -1)).toBe(2);
  expect(Hist.hist_move(0, 0, 1)).toBe(0);
});

test("the age is short (45s, 3m, 2h, 4d), and none when unknown", () => {
  const now = 10 * 86400e3;
  expect(Hist.hist_ago(now - 45e3, now)).toBe("45s");
  expect(Hist.hist_ago(now - 3 * 60e3, now)).toBe("3m");
  expect(Hist.hist_ago(now - 2 * 3600e3, now)).toBe("2h");
  expect(Hist.hist_ago(now - 4 * 86400e3, now)).toBe("4d");
  expect(Hist.hist_ago(null, now)).toBe("");
});

test("the view's history: the user's messages by id, with their dates, then what was typed here", () => {
  const v = View.view_new();
  v.whole.set(3, { kind: "user", text: "third", date: "2026-11-24T10:00:00.000Z" });
  v.whole.set(1, { kind: "user", text: "first" });
  v.whole.set(2, { kind: "unii", text: "not mine" });
  const typed = [{ text: "!ls", at: 5 }];
  expect(Hist.hist_said(v, typed)).toEqual([{ text: "first", at: null }, { text: "third", at: Date.parse("2026-11-24T10:00:00.000Z") }, { text: "!ls", at: 5 }]);
});
