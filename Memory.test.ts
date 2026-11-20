// Memory test
// ===========
// `bun test Memory.test.ts`. A chat's view.json read back (Memory.load):
// RED ZONE (R7, signed off by the user 2026-11-19): what it says of who
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
  // a view.json without a mode fails closed (R5: Modes.read falls back to auto)
  expect(mem.mode).toBe("auto");
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

// Tracks (PLP-2895): the user's pins per track, kept in view.json and
// load-guarded like `assigned` (RED ZONE DRAFT)
const track = { pins: [{ n: 1, text: "Write the migration", status: "pending", at: 5 }, { n: 3, text: "Ship it", status: "doing", at: 6, since: 6 }], next: 3, dropped: ["old item"] };

test("AC11a: saved pins round-trip through Memory.load", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  const mem = Memory.load(dir, () => ({}) as any);
  (mem as any).tracks = { Alpha: track };
  Memory.save(mem);
  Memory.stop(mem);
  const again = Memory.load(dir, () => ({}) as any);
  expect((again as any).tracks).toEqual({ Alpha: track });
  Memory.stop(again);
});

test("AC11b: a corrupt tracks value (\"x\", [1]) loads as {}", () => {
  expect((loaded({ tracks: "x" }) as any).tracks).toEqual({});
  expect((loaded({ tracks: [1] }) as any).tracks).toEqual({});
});

// Tracks (PLP-2895, RED ZONE DRAFT): a view.json written by hand (or by an
// agent) can't widen what the user pinned: caps, pin numbers, statuses and
// fields are checked as it loads
const pin = (n: number, over: object = {}) => ({ n, text: "pin " + n, status: "pending", at: 1, ...over });

test("AC11b (pinned): more than 10 saved pins on a track load cut to the first 10", () => {
  const pins = Array.from({ length: 12 }, (_, k) => pin(k + 1));
  const mem = loaded({ tracks: { Many: { pins, next: 12, dropped: [] } } }) as any;
  expect(mem.tracks.Many.pins.map((p: any) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(mem.tracks.Many.next).toBe(12);
});

// review (2026-11-20, RED ZONE DRAFT): a track's "dropped by you" marks
// load capped like the agent's own list (Tools' TODOS 20, TODO_TEXT 120)
test("AC11b (review): a saved track with 500 dropped entries loads with the last 20", () => {
  const dropped = Array.from({ length: 500 }, (_, k) => "item " + k);
  const mem = loaded({ tracks: { D: { pins: [], next: 0, dropped } } }) as any;
  expect(mem.tracks.D.dropped).toEqual(dropped.slice(-20));
});

test("AC11b (review): saved dropped entries not strings are dropped, a long one cut to 120 characters", () => {
  const mem = loaded({ tracks: { D: { pins: [], next: 0, dropped: [1, null, { text: "x" }, ["y"], "ok", "z".repeat(300)] } } }) as any;
  expect(mem.tracks.D.dropped).toEqual(["ok", "z".repeat(120)]);
});

test("AC11b (pinned): a saved pin over 500 characters is dropped; a 500-character one kept", () => {
  const mem = loaded({ tracks: { Long: { pins: [pin(1, { text: "x".repeat(501) }), pin(2, { text: "y".repeat(500) })], next: 2, dropped: [] } } }) as any;
  expect(mem.tracks.Long.pins.map((p: any) => [p.n, p.text.length])).toEqual([[2, 500]]);
});

test("AC11b (pinned): a saved pin numbered above the track's next is dropped, so a later add can't reuse its number", () => {
  const mem = loaded({ tracks: { Above: { pins: [pin(1), pin(3), pin(5)], next: 3, dropped: [] } } }) as any;
  expect(mem.tracks.Above.pins.map((p: any) => p.n)).toEqual([1, 3]);
  expect(mem.tracks.Above.next).toBe(3);
});

test("AC11b (pinned): a saved __proto__ track is no track and leaves the tracks object's prototype alone", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  // written as raw JSON: an object literal's __proto__ would set the prototype, not a key
  fs.writeFileSync(dir + "/view.json", '{"parts":[],"tracks":{"__proto__":{"pins":[{"n":1,"text":"evil","status":"pending","at":1}],"next":1,"dropped":[]},"Ok":{"pins":[],"next":0,"dropped":[]}}}');
  const mem = Memory.load(dir, () => ({}) as any) as any;
  expect(Object.keys(mem.tracks)).toEqual(["Ok"]);
  expect(Object.hasOwn(mem.tracks, "__proto__")).toBe(false);
  expect(mem.tracks.pins).toBeUndefined();
  expect(mem.tracks.next).toBeUndefined();
  expect(({} as any).pins).toBeUndefined();
  Memory.stop(mem);
});

test("AC11b (pinned): a saved track that is an array, or whose next is not a non-negative integer, is dropped", () => {
  const ok = { pins: [], next: 0, dropped: [] };
  const mem = loaded({ tracks: { Ok: ok, Arr: [pin(1)], Neg: { ...ok, next: -1 }, Frac: { ...ok, next: 1.5 }, Str: { ...ok, next: "3" }, None: { pins: [], dropped: [] } } }) as any;
  expect(Object.keys(mem.tracks)).toEqual(["Ok"]);
  expect(mem.tracks.Ok).toEqual(ok);
});

test("AC11b (pinned): a saved pin with an unknown status is dropped; known statuses kept", () => {
  const mem = loaded({ tracks: { S: { pins: [pin(1, { status: "bogus" }), pin(2, { status: "done" }), pin(3, { status: "doing" }), pin(4)], next: 4, dropped: [] } } }) as any;
  expect(mem.tracks.S.pins.map((p: any) => [p.n, p.status])).toEqual([[2, "done"], [3, "doing"], [4, "pending"]]);
});

test("AC11b (pinned): a saved pin's unknown fields (by, evil) are not kept; its own fields are", () => {
  const mem = loaded({ tracks: { X: { pins: [pin(1, { evil: "x", by: "agent", since: 4, reminded: true, from: "orig" })], next: 1, dropped: [] } } }) as any;
  expect(mem.tracks.X.pins).toEqual([{ n: 1, text: "pin 1", status: "pending", at: 1, since: 4, reminded: true, from: "orig" }]);
});
