// Memory test
// ===========
// `bun test Memory.test.ts`. A chat's view.json read back (Memory.load):
// RED ZONE (R7, DRAFT awaiting the user's sign-off): what it says of who
// decides (the mode, routines on or off, super auto's tallies, timers) is
// checked as it loads, each entry not well formed dropped, so a file
// written by hand (or by an agent) can't start work or decide for the user.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Memory } from "./Memory.ts";

const DAY = { $: "daily", at: "09:30" };
const good = { id: 1, name: "Morning", task: "Triage", when: DAY, tier: "worker", on: true, last: null, made: 1 };
const timer = { id: 1, who: "main", at: 5, note: "poll the job", made: 1 };

function loaded(saved: object) {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  fs.writeFileSync(dir + "/view.json", JSON.stringify({ parts: [], ...saved }));
  return Memory.load(dir, () => ({}) as any);
}

test("view.json's mode, routines, timers and tallies: entries not well formed dropped as it loads", () => {
  const mem = loaded({
    mode: "yolo",
    routines: [
      good,
      { ...good, id: 2, by: "main", why: "standup", on: false, seen: ["a#1"] },
      { ...good, id: 3, when: { $: "hourly" } },
      { ...good, id: 4, on: "yes" },
      { ...good, id: "5" },
      { ...good, id: 6, last: "never" },
      { ...good, id: 7, made: null },
      { ...good, id: 8, seen: [1] },
      { ...good, id: 9, by: 7 },
      { ...good, id: 10, task: "" },
      null,
      "routine",
    ],
    timers: [
      timer,
      { ...timer, id: 2, at: "soon" },
      { ...timer, id: 3, who: "" },
      { ...timer, id: 4, note: "" },
      { ...timer, id: 5, note: "x".repeat(600) },
      { ...timer, id: 6.5 },
      { ...timer, id: 7, made: Infinity },
      42,
    ],
    tallies: {
      push: { n: 30, took: 29, auto: [{ id: 3, undone: false }] },
      scope: { n: 25, took: 25, est: true },
      bogus: { n: 30, took: 30 },
      merge: { n: -1, took: 0 },
      retry: { n: 30, took: 31 },
      other: { n: 1.5, took: 0 },
      access: { n: 30, took: "30" },
      redzone: { n: 30, took: 30, auto: [{ id: "x", undone: false }] },
      money: { n: 30, took: 30, est: "yes" },
    },
  });
  expect(mem.mode).toBe("super");
  expect(mem.routines.map((r) => r.id)).toEqual([1, 2]);
  expect(mem.routines[1]).toMatchObject({ by: "main", why: "standup", on: false, seen: ["a#1"] });
  expect(mem.timers.map((t) => t.id)).toEqual([1]);
  expect(Object.keys(mem.tallies).sort()).toEqual(["push", "scope"]);
  expect(mem.tallies.push).toEqual({ n: 30, took: 29, auto: [{ id: 3, undone: false }] });
});

test("view.json's lists, not lists, load as none", () => {
  const mem = loaded({ routines: { 0: good }, timers: "x", tallies: [] });
  expect(mem.routines).toEqual([]);
  expect(mem.timers).toEqual([]);
});
