// Timer test
// ==========
// `bun test Timer.test.ts`. Agents wait and set timers, and propose
// routines (user's ask 2026-11-18). wait: a pause within one call, cut by
// a stop. timer: a note that wakes whoever set it (Unii: a turn; an agent:
// a message), kept with the chat (view.json) and keeping it open. routine:
// Unii proposes one, added off (RED ZONE: who may start unattended work);
// only the user's own Turn on, from a view, starts it.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const SERVER = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
// a view open, so the chat stays till the free check at the end
const view = { send: () => {}, data: { user: { id: "u1", name: "a@b.c" }, who: "view", tab: "", wire: null, host: null, computer: false, work: "", home: null, device: null, seen: new Set(), watch: new Set() } };
chat.socks.add(view);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(ask);
  call.send = () => {};
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 300 && !f(); k++) await Bun.sleep(10);
  return f();
};
await until(() => chat.posts === 0);
const go = new AbortController().signal;
const call = (who, name, args, id, signal = go) => Tools.call(chat.tools, who, name, args, signal, id);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
const names = (who) => Tools.list(chat.tools, who).map((s) => s.name);

// wait
const w0 = await call("main", "wait", { seconds: 0 }, "w0");
const w9 = await call("main", "wait", { seconds: 601 }, "w9");
let t = Date.now();
const w1 = await call("main", "wait", { seconds: 1 }, "w1");
const waited = Date.now() - t;
const cut = new AbortController();
setTimeout(() => cut.abort(), 50);
t = Date.now();
const w2 = await call("main", "wait", { seconds: 600 }, "w2", cut.signal);
const cutms = Date.now() - t;

// timers: set, refused, closed; a chat with one stays open
const worker = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "a task");
const tools = { main: names("main"), sub: names(worker) };
const m1 = await call("main", "timer", { minutes: 5, note: "check CI" }, "t1");
const s1 = await call(worker, "timer", { minutes: 1, note: "poll the job" }, "t2");
const bad = await call("main", "timer", { minutes: 0, note: "x" }, "t3");
const notyours = await call("main", "timer", { close: 2 }, "t4");
for (let k = 0; k < 6; k++) await call(worker, "timer", { minutes: 60, note: "n" + k }, "e" + k);
const each = chat.mem.timers.filter((x) => x.who === worker).length;
const closed = await call(worker, "timer", { close: chat.mem.timers.filter((x) => x.who === worker).at(-1).id }, "t5");
const open = chat.mem.timers.map((x) => ({ id: x.id, who: x.who, note: x.note }));
const state = Chat.state(chat).timers.length;
const saved = Memory.load(chat.mem.dir, () => null).timers.length;

// they fire: Unii's as a turn, the worker's as a message to it
const before = asks.length;
for (const x of chat.mem.timers) if (x.id <= 2) x.at = 0;
Chat.ticked(chat, Date.now());
await until(() => asks.length > before);
const turned = asks.length - before;
const work = msgs().filter((m) => m.kind === "work" && m.text.startsWith("[Timer")).map((m) => m.text);
const told = (Memory.agent(chat.tools.mem, worker) ?? []).filter((e) => e.text.startsWith("[Timer")).map((e) => e.text);
const left = chat.mem.timers.map((x) => x.id);

// a stopped agent's timers go
Tools.stop(chat.tools, worker);
const afterstop = chat.mem.timers.filter((x) => x.who === worker).length;

// routines: Unii proposes, added off; only a view's Turn on starts it
const sub = await call(worker, "routine", { name: "R", task: "t", when: { $: "daily", at: "09:00" }, why: "w" }, "r0");
const p1 = await call("main", "routine", { name: "Standup", task: "Summarize my PRs", when: { $: "daily", at: "09:00" }, why: "you asked for it daily" }, "r1");
const review = await call("main", "routine", { name: "Rev", task: "t", when: { $: "review" }, why: "w" }, "r2");
const proposed = chat.mem.routines.map((r) => ({ name: r.name, on: r.on, by: r.by, why: r.why }));
const noted = chat.mem.questions.filter((q) => q.fyi && q.text.includes("Standup") && q.text.includes("Turn it on")).length;
const ran = Chat.ticked(chat, Date.now() + 2 * 86400e3);
const n = chat.mem.routines[0].id;
const bydevice = await Chat.act(chat, "a1", { $: "routine", op: "toggle", n, on: true }, "mac");
const adddevice = await Chat.act(chat, "a2", { $: "routine", op: "add", routine: { name: "X", task: "t", when: { $: "every", hours: 1 } } }, "mac");
const offstill = chat.mem.routines[0].on;
const byview = await Chat.act(chat, "a3", { $: "routine", op: "toggle", n, on: true }, "");
const onnow = chat.mem.routines[0].on;
for (let k = 0; k < 4; k++) await call("main", "routine", { name: "P" + k, task: "t", when: { $: "every", hours: 2 }, why: "w" }, "p" + k);
const pending = chat.mem.routines.filter((r) => r.by !== undefined && !r.on).length;

// with no view, a pending timer keeps a chat (a fresh one: nothing runs); none, it goes
const c2 = Chat.open({ id: "u2", name: "c@d.e" });
Chat.chats.set("u2", c2);
c2.socks.add(view);
await until(() => c2.posts === 0);
await Tools.call(c2.tools, "main", "timer", { minutes: 30, note: "later" }, go, "k1");
c2.socks.delete(view);
Chat.free(c2);
const kept = Chat.chats.get("u2") === c2;
c2.mem.timers = [];
Chat.free(c2);
const gone = Chat.chats.get("u2") !== c2;
console.log(JSON.stringify({ w0, w9, w1, waited, w2, cutms, tools, m1, s1, bad, notyours, each, closed, open, state, saved, turned, work, told, left, afterstop, sub, p1, review, proposed, noted, ran, bydevice: bydevice.error ?? null, adddevice: adddevice.error ?? null, offstill, byview, onnow, pending, kept, gone }));
process.exit(0);
`;

test("wait, timers and proposed routines, end to end on a server", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/timer.ts", SERVER);
  const proc = Bun.spawn([process.execPath, dir + "/timer.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  // wait: 1 to 600 s, cut by a stop
  expect(out.w0.fail).toBe(true);
  expect(out.w9.fail).toBe(true);
  expect(out.w1).toEqual({ text: "Waited 1 s.", fail: false });
  expect(out.waited).toBeGreaterThanOrEqual(950);
  expect(out.w2).toMatchObject({ fail: true, text: expect.stringContaining("Stopped") });
  expect(out.cutms).toBeLessThan(1000);
  // everyone gets wait and timer; only Unii, routine
  expect(out.tools.main).toEqual(expect.arrayContaining(["wait", "timer", "routine"]));
  expect(out.tools.sub).toEqual(expect.arrayContaining(["wait", "timer"]));
  expect(out.tools.sub).not.toContain("routine");
  // timers: set, refused, only one's own closed, capped per agent, kept
  expect(out.m1).toMatchObject({ fail: false, text: expect.stringMatching(/^Timer 1 set for \d\d:\d\d/) });
  expect(out.s1).toMatchObject({ fail: false, text: expect.stringContaining("Timer 2") });
  expect(out.bad.fail).toBe(true);
  expect(out.notyours).toMatchObject({ fail: true, text: expect.stringContaining("only your own") });
  expect(out.each).toBe(5);
  expect(out.closed.fail).toBe(false);
  expect(out.open.filter((x: any) => x.who !== "main").length).toBe(4);
  expect(out.open[0]).toEqual({ id: 1, who: "main", note: "check CI" });
  expect(out.state).toBe(5);
  expect(out.saved).toBe(5);
  // fired: Unii takes a turn on "[Timer 1] check CI"; the worker is told
  expect(out.turned).toBeGreaterThanOrEqual(1);
  expect(out.work).toEqual(["[Timer 1] check CI"]);
  expect(out.told).toEqual(["[Timer 2] poll the job"]);
  expect(out.left).not.toContain(1);
  expect(out.left).not.toContain(2);
  expect(out.afterstop).toBe(0);
  // proposals: Unii only, by the clock, added off with whose and why
  expect(out.sub).toMatchObject({ fail: true, text: expect.stringContaining("Only Unii") });
  expect(out.p1).toMatchObject({ fail: false, text: expect.stringContaining("only once the user turns it on") });
  expect(out.review.fail).toBe(true);
  expect(out.proposed).toEqual([{ name: "Standup", on: false, by: "main", why: "you asked for it daily" }]);
  expect(out.noted).toBe(1);
  expect(out.ran).toBe(0);
  // RED ZONE: a device's socket (an agent's shell can reach it) neither
  // turns one on nor adds one; the user's view does
  expect(out.bydevice).toMatch(/view/);
  expect(out.adddevice).toMatch(/view/);
  expect(out.offstill).toBe(false);
  expect(out.byview).toEqual({});
  expect(out.onnow).toBe(true);
  expect(out.pending).toBe(3);
  // a pending timer keeps a chat with no view open
  expect(out.kept).toBe(true);
  expect(out.gone).toBe(true);
}, 30_000);
