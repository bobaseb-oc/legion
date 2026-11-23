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

// RED ZONE (R4, ADR 1; DRAFT awaiting the user's sign-off): the approvals
// waiting for the user or a boss (Pending.ts), kept in view.json; a record
// not well formed (here a forged one, its fp not its args' hash) dropped
test("P8, L1-AC8: view.json's pending records are checked as they load; a forged one is dropped", async () => {
  const Pending = await import("./Pending.ts");
  const args = { device: "mac", command: "make deploy" };
  const good = { id: 1, kind: "consent", who: "main", tool: "shell", args: Pending.canon(args), fp: Pending.fp("main", "shell", args), made: 1, until: 1 + Pending.CONSENT_MS, state: "open" };
  const forged = { ...good, id: 2, args: Pending.canon({ device: "mac", command: "make wipe" }) };
  const mem: any = loaded({ pending: [good, forged] });
  expect(mem.pending).toEqual([good]);
  const none: any = loaded({});
  expect(none.pending).toEqual([]);
  expect(none.pended).toBe(0);
});

test("L1-AC16: view.json's pended (the last approval id) survives a save and a load; not an integer, 0", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  fs.writeFileSync(dir + "/view.json", JSON.stringify({ parts: [] }));
  const mem: any = Memory.load(dir, () => ({}) as any);
  mem.pended = 7;
  Memory.save(mem);
  const back: any = Memory.load(dir, () => ({}) as any);
  expect(back.pended).toBe(7);
  expect((loaded({ pended: "7" }) as any).pended).toBe(0);
  expect((loaded({ pended: 1.5 }) as any).pended).toBe(0);
});

// RED ZONE (ADR 2; DRAFT awaiting the user's sign-off): the chat's inbox
// (Events.ts), kept in view.json; an event not well formed dropped as it
// loads, and an approval not from the user's own origins dropped (a file
// written by hand can't answer an approval)
const event = { id: 1, src: "view", key: "k1", kind: "work", to: "main", body: "b", at: 5, tries: 0, state: "new" };

test("L3 load guard: view.json's events not well formed are dropped as they load", () => {
  const mem: any = loaded({
    events: [
      event,
      { ...event, id: 2, key: "k2", src: "terminal", kind: "approval", ref: 4, body: "yes", state: "done" },
      { ...event, id: "3", key: "k3" },
      { ...event, id: 4, key: "k4", src: "evil" },
      { ...event, id: 5, key: "k5", kind: "shell" },
      { ...event, id: 6, key: "k6", state: "yes" },
      { ...event, id: 7, key: "k7", tries: -1 },
      { ...event, id: 8, key: "k8", tries: 1.5 },
      { ...event, id: 9, key: "k9", body: 7 },
      { ...event, id: 10, key: "a b" },
      { ...event, id: 11, key: "k11", at: "now" },
      { ...event, id: 12, key: "k12", to: 3 },
      null,
      "event",
    ],
  });
  expect(mem.events.map((e: any) => e.id)).toEqual([1, 2]);
  expect(mem.events[0]).toEqual(event);
  const none: any = loaded({});
  expect(none.events).toEqual([]);
  expect(none.evented).toBe(0);
  expect((loaded({ events: "x" }) as any).events).toEqual([]);
});

test("E2, L3 load guard: an approval event from a device in view.json is dropped; a gchat one kept", () => {
  const mem: any = loaded({
    events: [
      { ...event, id: 1, src: "device", kind: "approval", ref: 2, body: "yes" },
      { ...event, id: 2, key: "k2", src: "gchat", kind: "approval", ref: 2, body: "yes" },
    ],
  });
  expect(mem.events.map((e: any) => [e.id, e.src])).toEqual([[2, "gchat"]]);
});

test("L3: view.json's evented (the last event id) and events survive a save and a load; evented not an integer, 0", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  fs.writeFileSync(dir + "/view.json", JSON.stringify({ parts: [] }));
  const mem: any = Memory.load(dir, () => ({}) as any);
  mem.evented = 9;
  mem.events = [{ ...event, id: 9 }];
  Memory.save(mem);
  const back: any = Memory.load(dir, () => ({}) as any);
  expect(back.evented).toBe(9);
  expect(back.events).toEqual([{ ...event, id: 9 }]);
  expect((loaded({ evented: "9" }) as any).evented).toBe(0);
  expect((loaded({ evented: 1.5 }) as any).evented).toBe(0);
});

test("view.json's goaled (a goal's unmet checks in a row) survives a save and a load; not a non-negative integer, 0", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-memory-");
  fs.writeFileSync(dir + "/view.json", JSON.stringify({ parts: [] }));
  const mem: any = Memory.load(dir, () => ({}) as any);
  expect(mem.goaled).toBe(0);
  mem.goal = "tests pass";
  mem.goaled = 3;
  Memory.save(mem);
  const back: any = Memory.load(dir, () => ({}) as any);
  expect(back.goaled).toBe(3);
  for (const bad of ["3", 1.5, -1, null]) {
    expect((loaded({ goaled: bad }) as any).goaled).toBe(0);
  }
});
