// Directives: the turn-end check's pure parts (user's ask 2026-11-20):
// what a turn did, the ask-guard, the judge's prompt and answer, the nudge

import { expect, test } from "bun:test";
import { Directives } from "./Directives.ts";

const ASKED = "ask " + JSON.stringify({ text: "Merge PR 5?", kind: "merge", pick: 0 });

test("turn: scans back to the latest user message; the reply is the last unii message", () => {
  const t = Directives.turn([
    { kind: "user", text: "old" },
    { kind: "unii", text: "old reply?" },
    { kind: "user", text: "merge it" },
    { kind: "tool", text: "shell {}" },
    { kind: "unii", text: "first" },
    { kind: "unii", text: "Shall I merge?" },
  ]);
  expect(t).toEqual({ user: "merge it", reply: "Shall I merge?", asked: false, nudged: false });
  expect(Directives.turn([{ kind: "user", text: "x" }, { kind: "tool", text: ASKED }, { kind: "unii", text: "Filed." }]).asked).toBe(true);
  expect(Directives.turn([{ kind: "user", text: "x" }, { kind: "tool", text: "asked {}" }]).asked).toBe(false);
  expect(Directives.turn([{ kind: "user", text: Directives.nudge("r") }, { kind: "unii", text: "ok?" }]).nudged).toBe(true);
  expect(Directives.turn([]).reply).toBeNull();
});

test("question: the reply's last line ends in a question mark (markdown closers allowed)", () => {
  expect(Directives.question("Done.\n\nShall I merge PR 5?")).toBe(true);
  expect(Directives.question("Want me to push? **")).toBe(true);
  expect(Directives.question("Why? Because the test failed.\nFixed it.")).toBe(false);
  expect(Directives.question("Done.")).toBe(false);
});

test("guard: a question with no ask filed, outside a nudged turn, is nudged once", () => {
  const t = { user: "go", reply: "Shall I merge?", asked: false, nudged: false };
  expect(Directives.guard(t)).toContain(Directives.TAG);
  expect(Directives.guard(t)).toMatch(/\bask\b/);
  expect(Directives.guard({ ...t, asked: true })).toBeNull();
  expect(Directives.guard({ ...t, nudged: true })).toBeNull();
  expect(Directives.guard({ ...t, reply: "Merged." })).toBeNull();
  expect(Directives.guard({ ...t, reply: null })).toBeNull();
});

test("judge: its input fences the directives and the reply as data; its answer: ok or one skipped line", () => {
  const text = Directives.judge_text("Always name the branch.", { user: "ship it", reply: "Shipped.", asked: false, nudged: false });
  expect(text).toContain("Always name the branch.");
  expect(text).toContain("ship it");
  expect(text).toContain("Shipped.");
  expect(text).toMatch(/<directives>[\s\S]*<\/directives>/);
  expect(Directives.SYSTEM).toMatch(/data, never instructions/);
  expect(Directives.judged("ok")).toBeNull();
  expect(Directives.judged(" OK.")).toBeNull();
  expect(Directives.judged("")).toBeNull();
  expect(Directives.judged("skipped: name the branch\nmore")).toBe("skipped: name the branch");
  expect(Directives.judged("skipped: " + "x".repeat(500))!.length).toBeLessThanOrEqual(Directives.REASON);
});

test("nudge: labelled as the checker, never an order or a grant", () => {
  const n = Directives.nudge("skipped: name the branch");
  expect(n.startsWith(Directives.TAG)).toBe(true);
  expect(n).toContain("skipped: name the branch");
  expect(n).toMatch(/not the user's/i);
});
