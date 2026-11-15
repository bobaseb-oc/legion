// Pins and search test
// ====================
// `bun test Pins.test.ts`. The user's pins (Memory.pin): a message whole
// before every turn's view, however old, its bytes off the view's budget,
// within PINS and PINNED, kept in view.json; set only by a view's act,
// never a device's, and no agent has a tool for it. Search (Memory.find):
// a case-insensitive substring of the chat's messages, newest first,
// FOUND at most, the log read in steps so the server goes on meanwhile.
// The vendor is a fake Anthropic answering each summary with a line.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-pins-");

process.env.UNII_DIR = DIR;

const config = await import("./Config.ts");
config.KEYS.anthropic = "test";

const { Memory } = await import("./Memory.ts");
const { MASTER } = await import("./Tools.ts");
const { FIND, FOUND, PINNED, PINS } = await import("./View.ts");

const SHARE = { vendor: "claude-api" as const, model: "claude-opus-5-5", effort: "medium", speed: "slow", system: MASTER, searches: 0, server: "" };

const real = { setTimeout, fetch };

function answer(text: string): Response {
  const events = [
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((ev) => "data: " + JSON.stringify(ev) + "\n\n").join(""));
}

async function faked(go: () => Promise<void>): Promise<void> {
  globalThis.fetch = (async () => answer("a short summary line")) as any;
  try {
    await go();
  } finally {
    globalThis.fetch = real.fetch;
  }
}

async function until(done: () => boolean): Promise<void> {
  for (let t = 0; t < 200 && !done(); t++) {
    await new Promise((ok) => real.setTimeout(ok, 10));
  }
  expect(done()).toBe(true);
}

const said = (blocks: Array<{ text: string }>) => blocks.map((b) => b.text).join("");

test("a pinned message is whole before every turn's view, however old; its bytes come off the view's budget; kept", () => faked(async () => {
  const mem = Memory.load(DIR + "/pin", () => SHARE);
  const long = "the decision: <b>use X</b>\n" + "because ".repeat(250);
  Memory.push(mem, [{ kind: "user", text: long }, { kind: "unii", text: "ok" }, { kind: "user", text: "later" }]);
  await until(() => Memory.built(mem, 0, 0));
  const high = mem.view.high;
  // its node is a summary; unpinned, the view never has it whole
  expect(said(Memory.view(mem))).toContain("a short summary line");
  expect(said(Memory.view(mem))).not.toContain(long);

  expect(Memory.pin(mem, 0, true)).toBeNull();
  const view = said(Memory.view(mem));
  expect(view).toContain("<pinned>\n0+1|user: " + long + "\n</pinned>\n");
  expect(view.indexOf("<pinned>")).toBeLessThan(view.indexOf("<chat>"));
  expect(view).toContain("a short summary line"); // the tree's line stays
  const size = Memory.bytes("0+1|user: " + long + "\n");
  expect(mem.view.high).toBe(high - size);
  expect(mem.pinned).toEqual([{ i: 0, kind: "user", date: Memory.message(mem, 0)!.date, text: long.slice(0, 200), size }]);
  // the compactions' view has none; nor a view ending before it
  expect(said(Memory.view(mem, mem.count, mem.seen.parts))).not.toContain("<pinned>");
  expect(said(Memory.view(mem, 0))).not.toContain("<pinned>");
  // pinned again: nothing changes
  expect(Memory.pin(mem, 0, true)).toBeNull();
  expect(mem.pins).toEqual([0]);
  Memory.stop(mem);

  const again = Memory.load(DIR + "/pin", () => SHARE);
  expect(again.pins).toEqual([0]);
  expect(again.view.high).toBe(high - size);
  expect(said(Memory.view(again))).toContain("<pinned>");
  expect(Memory.pin(again, 0, false)).toBeNull();
  expect(again.pins).toEqual([]);
  expect(again.view.high).toBe(high);
  expect(said(Memory.view(again))).not.toContain("<pinned>");
  Memory.stop(again);
}));

test("a pin past the caps, or of no message, is refused with why; nothing changes", () => faked(async () => {
  const mem = Memory.load(DIR + "/caps", () => SHARE);
  mem.hold[0] = "held";
  Memory.push(mem, Array.from({ length: PINS + 1 }, (_, k) => ({ kind: "user" as const, text: "message " + k })));
  Memory.push(mem, [{ kind: "user", text: "y".repeat(PINNED) }]);
  for (const i of [-1, 1.5, NaN, mem.count, 99]) {
    expect(Memory.pin(mem, i, true)).toMatch(/^No message/);
  }
  expect(Memory.pin(mem, PINS + 1, true)).toMatch(/KB/); // one too big alone
  for (let k = 0; k < PINS; k++) {
    expect(Memory.pin(mem, k, true)).toBeNull();
  }
  const high = mem.view.high;
  expect(Memory.pin(mem, PINS, true)).toMatch(new RegExp("At most " + PINS));
  expect(mem.pins.length).toBe(PINS);
  expect(mem.view.high).toBe(high);
  // the bytes cap counts what is pinned already
  expect(Memory.pin(mem, 0, false)).toBeNull();
  const big = Memory.load(DIR + "/big", () => SHARE);
  big.hold[0] = "held";
  Memory.push(big, [{ kind: "user", text: "z".repeat(PINNED / 2) }, { kind: "user", text: "w".repeat(PINNED / 2) }]);
  expect(Memory.pin(big, 0, true)).toBeNull();
  expect(Memory.pin(big, 1, true)).toMatch(/KB/);
  expect(big.pins).toEqual([0]);
  Memory.stop(big);
  Memory.stop(mem);
}));

test("view.json's pins are checked as they load: only messages of the chat, once each, PINS at most", () => {
  const mem = Memory.load(DIR + "/kept", () => SHARE);
  mem.hold[0] = "held";
  Memory.push(mem, [{ kind: "user", text: "a" }, { kind: "user", text: "b" }]);
  Memory.stop(mem);
  const file = DIR + "/kept/view.json";
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), pins: [1, 1, "0", -1, 7, 0.5, 0] }));
  const again = Memory.load(DIR + "/kept", () => SHARE);
  expect(again.pins).toEqual([0, 1]);
  Memory.stop(again);
});

test("search: a case-insensitive substring, newest first, FOUND at most; each its index, date, kind and a snippet", async () => {
  const mem = Memory.load(DIR + "/find", () => SHARE);
  mem.hold[0] = "held";
  Memory.push(mem, [{ kind: "user", text: "the Needle here" }, { kind: "unii", text: "nothing" }, { kind: "unii", text: "x".repeat(500) + "a NEEDLE deep in" + "y".repeat(500) }]);
  const found = await Memory.find(mem, "needle");
  expect(found.more).toBe(false);
  expect(found.hits.map((h) => [h.i, h.kind])).toEqual([[2, "unii"], [0, "user"]]);
  expect(found.hits[1]).toEqual({ i: 0, kind: "user", date: Memory.message(mem, 0)!.date, text: "the Needle here" });
  const deep = found.hits[0].text;
  expect(deep).toContain("a NEEDLE deep in");
  expect(deep.length).toBeLessThan(200);
  expect(deep.startsWith("…")).toBe(true);
  expect(deep.endsWith("…")).toBe(true);
  expect((await Memory.find(mem, "absent")).hits).toEqual([]);

  Memory.push(mem, Array.from({ length: FOUND + 10 }, (_, k) => ({ kind: "user" as const, text: "needle " + k })));
  const many = await Memory.find(mem, "NEEDLE");
  expect(many.more).toBe(true);
  expect(many.hits.length).toBe(FOUND);
  expect(many.hits[0].i).toBe(mem.count - 1);
  expect(FIND).toBe(200);
  Memory.stop(mem);
});

test("search reads a long log in steps: the event loop runs meanwhile, and a search stopped ends early", async () => {
  const mem = Memory.load(DIR + "/long", () => SHARE);
  mem.hold[0] = "held";
  Memory.push(mem, Array.from({ length: 3000 }, (_, k) => ({ kind: "user" as const, text: "line " + k })));
  // what was queued as it began has run by the time it answers
  let ran = false;
  setImmediate(() => (ran = true));
  const [found, before] = await Memory.find(mem, "line 0").then((f) => [f, ran] as const);
  expect(found.hits.map((h) => h.i)).toEqual([0]);
  expect(before).toBe(true);
  let asked = 0;
  const cut = await Memory.find(mem, "line 0", () => ++asked < 10);
  expect(cut.hits).toEqual([]);
  Memory.stop(mem);
});

// the server's side: a pin is a view's act (a device's is refused: an
// agent's reach), checked; the state tells the pins; no agent has a pin
// tool; a search is a socket's read, checked, answered "recalled" to it
const SERVER = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.mem.hold[0] = "held";
const at = chat.mem.count; // after the chat's hello
Memory.push(chat.mem, [{ kind: "user", text: "pin <me>" }, { kind: "unii", text: "A Zebra <it>" }]);
const sent = [];
const sock = { send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set(), seen: new Set(), device: null } };
chat.socks.add(sock);
const ok = await Chat.act(chat, "p1", { $: "pin", i: at, on: true }, "");
const state = Chat.state(chat).pins;
const device = await Chat.act(chat, "p2", { $: "pin", i: at + 1, on: true }, "mac");
const bad = await Promise.all([
  Chat.act(chat, "p3", { $: "pin", i: String(at + 1), on: true }, ""),
  Chat.act(chat, "p4", { $: "pin", i: at + 99, on: true }, ""),
  Chat.act(chat, "p5", { $: "pin", i: at + 1, on: "yes" }, ""),
  Chat.act(chat, "p6", { $: "pin", i: at + 0.5, on: true }, ""),
]);
const off = await Chat.act(chat, "p7", { $: "pin", i: at, on: false }, "");
const tools = Tools.list(chat.tools, "main").map((s) => s.name);
const asks = [Chat.ask(chat, sock, { $: "search", q: "" }), Chat.ask(chat, sock, { $: "search", q: "x".repeat(201) }), Chat.ask(chat, sock, { $: "search", q: 5 })];
const asked = Chat.ask(chat, sock, { $: "search", q: " zebra " });
for (let k = 0; k < 50 && !sent.some((m) => m.$ === "recalled"); k++) await Bun.sleep(10);
console.log(JSON.stringify({ at, ok, state, device: device.error ?? null, bad: bad.map((a) => a.error ?? null), off, pins: chat.mem.pins, tools, asks: asks.map((a) => a.error ?? null), asked, found: sent.filter((m) => m.$ === "recalled") }));
process.exit(0);
`;

test("the server: a pin is a view's act, checked; the state tells it; no agent tool pins; search answers the socket", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/pins.ts", SERVER);
  const proc = Bun.spawn([process.execPath, dir + "/pins.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.ok).toEqual({});
  expect(out.state).toMatchObject([{ i: out.at, kind: "user", text: "pin <me>" }]);
  expect(out.device).toMatch(/web/);
  expect(out.bad.every((e: string | null) => typeof e === "string")).toBe(true);
  expect(out.bad[1]).toMatch(new RegExp("No message " + (out.at + 99)));
  expect([out.bad[0], out.bad[2], out.bad[3]].every((e: string) => e.startsWith("No pin"))).toBe(true); // the act's shape, checked before Memory's
  expect(out.off).toEqual({});
  expect(out.pins).toEqual([]);
  expect(out.tools.length).toBeGreaterThan(5);
  expect(out.tools.filter((n: string) => /pin/i.test(n))).toEqual([]);
  expect(out.asks.every((e: string | null) => typeof e === "string")).toBe(true);
  expect(out.asked).toEqual({});
  expect(out.found).toEqual([{ $: "recalled", q: "zebra", hits: [expect.objectContaining({ i: out.at + 1, kind: "unii", text: "A Zebra <it>" })], more: false }]);
});
