// Rough summaries while the budget is spent
// =========================================
// `bun test rough.test.ts`. The gateway's daily budget (per team member,
// every model) spent, a summary can't be had from any model: its node is
// built rough instead, with no call (its source's first sentence, marked
// "(rough)", kept as rough in view.json), so the tree goes on and the
// chat's view never waits; the gateway isn't asked again till a probe
// (one call, past Memory.PROBE or the next UTC day) gets through. Once it
// works, the rough nodes are summarized anew, oldest first, one at a time,
// in the background; a restart still knows which. Other failures make no
// rough line: an outage still delays a summary, a refusal still clips it.
// Through the real Memory, AskAI and Agent loop against a fake gateway;
// timers run 1000 times fast.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/legion-rough-");

process.env.LEGION_DIR = DIR;

const config = await import("./Config.ts");
config.KEYS.anthropic = "test";

const { Memory, PROBE } = await import("./Memory.ts");
const { MASTER } = await import("./Tools.ts");

const SHARE = { vendor: "claude-api" as const, model: "claude-opus-5-5", effort: "medium", speed: "slow", system: MASTER, searches: 1, server: "" };

const BUDGET = "Budget has been exceeded! Current cost: 800.6046641950002, Max budget: 800.0";

// messages too long to be their own summary, each opening with a sentence
const COUNT = 16;
const MSGS  = Array.from({ length: COUNT }, (_, k) => ({ kind: "legion" as const, text: "Point " + k + " is made here.\n  Then   " + "word ".repeat(200) }));
const NODES = 2 * COUNT - 1;

const real = { setTimeout, fetch, error: console.error };

// the gateway: its budget spent, down (503), or answering; the tasks asked
let gateway: "spent" | "down" | "up" = "spent";
const asked: string[] = [];

function answer(text: string, stop: string): Response {
  const events = [
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 100 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\n\n").join(""));
}

let refuse = -1;

async function vendor(_url: string, init: any): Promise<Response> {
  const content = JSON.parse(init.body).messages[0].content;
  const task: string = content[content.length - 1].text.split("\n")[0];
  asked.push(task);
  if (gateway === "spent") {
    return Response.json({ error: { message: BUDGET, type: "budget_exceeded", param: null, code: "429" } }, { status: 429 });
  }
  if (gateway === "down") {
    return Response.json({ error: { message: "Bedrock is unable to process your request." } }, { status: 503 });
  }
  return task.includes("compress message " + refuse + " ") ? answer("", "refusal") : answer("line for " + task, "end_turn");
}

function sleep(ms: number): Promise<void> {
  return new Promise((ok) => real.setTimeout(ok, ms));
}

function nodes(mem: any): Array<[{ l: number; i: number }, string | null]> {
  const out: Array<[{ l: number; i: number }, string | null]> = [];
  for (let l = 0; 2 ** l <= COUNT; l++) {
    for (let i = 0; i < COUNT / 2 ** l; i++) {
      out.push([{ l, i }, Memory.node(mem, { l, i })]);
    }
  }
  return out;
}

async function until(done: () => boolean): Promise<void> {
  for (let t = 0; t < 200 && !done(); t++) {
    await sleep(20);
  }
}

async function fast(go: () => Promise<void>): Promise<void> {
  globalThis.setTimeout = ((go: () => void, ms = 0) => real.setTimeout(go, ms / 1000)) as any;
  globalThis.fetch = vendor as any;
  console.error = () => {};
  asked.length = 0;
  try {
    await go();
  } finally {
    Object.assign(globalThis, { setTimeout: real.setTimeout, fetch: real.fetch });
    console.error = real.error;
  }
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

test("the budget spent: every node rough, with no call past the first; the view says so; kept", () => fast(async () => {
  gateway = "spent";
  const mem = Memory.load(DIR + "/spent", () => SHARE);
  Memory.push(mem, MSGS);
  await until(() => nodes(mem).every(([, text]) => text !== null));
  const calls = asked.length;
  expect(calls).toBeLessThanOrEqual(COUNT); // the leaves asked at once, before the first failed; no parent asked
  for (const [{ l, i }, text] of nodes(mem)) {
    expect(text!.startsWith("(rough) ")).toBe(true);
    expect(bytes(text!)).toBeLessThanOrEqual(512);
    if (l === 0) {
      expect(text).toBe("(rough) legion: Point " + i + " is made here.");
    }
  }
  // a merge whose halves fit is them, as ever (rough over rough halves);
  // one that doesn't, its halves' first parts
  expect(Memory.node(mem, { l: 1, i: 0 })).toBe("(rough) legion: Point 0 is made here.\n(rough) legion: Point 1 is made here.");
  const long = "(rough) legion: Point 0 is made here. " + "x".repeat(600) + "\nlegion: The other half. " + "y".repeat(600);
  expect(Memory.roughly(3, long)).toBe("(rough) legion: Point 0 is made here. / legion: The other half.");
  expect(bytes(Memory.roughly(3, "z".repeat(900) + "\n" + "w".repeat(900)))).toBeLessThanOrEqual(512);
  expect(mem.rough.size).toBe(NODES);
  expect(mem.trouble).toContain("spending limit");
  expect(Memory.view(mem).map((b) => b.text).join("")).toContain("|(rough) legion: Point");
  // no call more as the chat goes on, till a probe
  Memory.push(mem, [MSGS[0], MSGS[1]]);
  await until(() => Memory.node(mem, { l: 1, i: COUNT / 2 }) !== null);
  await sleep(100);
  expect(asked.length).toBe(calls);
  expect(Memory.node(mem, { l: 1, i: COUNT / 2 })!.startsWith("(rough) ")).toBe(true);
  // the next try waits till a probe, at most to the next UTC day
  const now = Date.now();
  const day = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  expect(mem.rest.until).toBeGreaterThan(now);
  expect(mem.rest.until).toBeLessThanOrEqual(Math.min(now + PROBE, day));
  // a probe due, the budget still spent: one call, the rest rough
  mem.rest.until = 0;
  Memory.push(mem, [MSGS[2], MSGS[3]]);
  await until(() => Memory.node(mem, { l: 1, i: COUNT / 2 + 1 }) !== null);
  await sleep(100);
  expect(asked.length).toBe(calls + 1);
  expect(mem.rest.until).toBeGreaterThan(Date.now());
  const saved = Memory.saved(DIR + "/spent")!;
  expect(saved.rough!.length).toBe(mem.rough.size);
  // the next probe gets through: the rest ends, the rough nodes are redone
  gateway = "up";
  mem.rest.until = 0;
  Memory.push(mem, [MSGS[4], MSGS[5]]);
  await until(() => mem.rough.size === 0);
  expect(mem.rest.until).toBe(null);
  expect(mem.rough.size).toBe(0);
  expect(mem.trouble).toBe(null);
  Memory.stop(mem);
}));

test("the gateway back: rough nodes summarized anew, oldest first, in the background; a restart remembers them", () => fast(async () => {
  gateway = "spent";
  const first = Memory.load(DIR + "/back", () => SHARE);
  Memory.push(first, MSGS);
  await until(() => first.rough.size === NODES);
  Memory.stop(first);
  // restarted: the rough nodes known from view.json
  const mem = Memory.load(DIR + "/back", () => SHARE);
  expect(mem.rough.size).toBe(NODES);
  expect(Memory.node(mem, { l: 0, i: 3 })!.startsWith("(rough) ")).toBe(true);
  gateway = "up";
  asked.length = 0;
  Memory.pump(mem); // as the chat opens: the first redo probes
  await until(() => mem.rough.size === 0);
  expect(mem.rough.size).toBe(0);
  for (const [, text] of nodes(mem)) {
    expect(text).toMatch(/^line for Compaction:/);
  }
  expect(asked[0]).toContain("compress message 0 ");
  const leaves = asked.map((t) => /compress message (\d+) /.exec(t)?.[1]).filter((x) => x !== undefined).map(Number);
  expect(leaves).toEqual(Array.from({ length: COUNT }, (_, k) => k)); // oldest first
  expect(new Set(asked).size).toBe(asked.length); // each once (a merge whose halves fit asks none)
  expect(mem.trouble).toBe(null);
  expect(mem.rest.until).toBe(null);
  expect(Memory.saved(DIR + "/back")!.rough).toEqual([]);
  Memory.stop(mem);
}));

test("other failures make no rough line: an outage delays a summary, a refusal clips it", () => fast(async () => {
  gateway = "down";
  refuse = 2;
  const mem = Memory.load(DIR + "/down", () => SHARE);
  Memory.push(mem, MSGS.slice(0, 4));
  await sleep(200);
  expect(asked.length).toBeGreaterThan(4); // asked again, as before
  expect(nodes(mem).filter(([{ i, l }, text]) => l === 0 && i < 4 && text !== null)).toEqual([]);
  expect(mem.rough.size).toBe(0);
  expect(mem.rest.until).toBe(null);
  gateway = "up";
  await until(() => Memory.node(mem, { l: 2, i: 0 }) !== null);
  expect(Memory.node(mem, { l: 0, i: 2 })).toBe(Memory.cut(Memory.flat(Memory.source(mem, 0, 2)!)));
  expect(Memory.node(mem, { l: 0, i: 1 })).toMatch(/^line for Compaction:/);
  expect(mem.rough.size).toBe(0);
  refuse = -1;
  Memory.stop(mem);
}));

// a build that fails at once (a bug, no I/O: an EISDIR) waits RETRY
// before its node is asked again: freed at once, it was asked again in
// the same tick, a loop that held the event loop (no timer, no signal)
test("a build that fails at once waits before its node is asked again; it is still asked again", () => fast(async () => {
  const ask = Memory.ask;
  const mem = Memory.load(DIR + "/throws", () => SHARE);
  let asks = 0;
  Memory.ask = (() => {
    if (++asks === 1000) {
      Memory.stop(mem); // the loop stopped, so the test fails, not hangs
    }
    throw new Error("EISDIR: illegal operation on a directory, read");
  }) as typeof Memory.ask;
  try {
    Memory.push(mem, MSGS.slice(0, 2));
    await sleep(20); // 20 s on these timers: RETRY (5 s) passes about 4 times
    expect(asks).toBeLessThanOrEqual(2 * 6);
    expect(asks).toBeGreaterThan(2); // asked again
    expect(mem.rough.size).toBe(0);
  } finally {
    Memory.ask = ask;
    Memory.stop(mem);
  }
}));

// a node cut (its side held) waits for no RETRY: asked again as soon as
// its side goes on. Real timers: RETRY here is 5 s
test("a node cut by a held side is asked again at once when the side goes on", async () => {
  const ask = Memory.ask;
  const mem = Memory.load(DIR + "/held", () => SHARE);
  let asks = 0;
  Memory.ask = (() => {
    asks++;
    mem.hold[0] = "held"; // cut while it asks
    throw new Error("cut");
  }) as typeof Memory.ask;
  console.error = () => {};
  try {
    Memory.push(mem, MSGS.slice(0, 2));
    await sleep(20);
    const before = asks;
    expect(before).toBeGreaterThan(0);
    mem.hold[0] = null;
    Memory.pump(mem);
    await sleep(50);
    expect(asks).toBeGreaterThan(before);
  } finally {
    Memory.ask = ask;
    console.error = real.error;
    Memory.stop(mem);
  }
});
