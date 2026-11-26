// Todo test
// =========
// `bun test Todo.test.ts`. What agents need the user to do (Tools.assign,
// Chat.assignment): any agent files an action only the user can take; it
// waits on the Todo page till the user ticks it Done or Drops it, a view's
// act only (RED ZONE: a device's socket is within an agent's reach). Done
// tells the filer once (Legion: a message quoting it, and a turn); Drop is
// a note, no turn. An agent withdraws only its own.

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
const asks = [];
AskAI.ask = (ask, on) => {
  const [call] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(ask);
  call.send = () => {};
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const go = new AbortController().signal;
const call = (who, args, id) => Tools.call(chat.tools, who, "assign", args, go, id);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
const filed = await call("main", { text: "  Approve  PR #352\\n on GitHub  " }, "t1");
const sub = await call("Wkr", { text: "Run ! gcloud auth login" }, "t2");
const empty = await call("main", { text: "  " }, "t3");
const long = await call("main", { text: "x".repeat(5000) }, "t4");
const longest = chat.mem.assigned.at(-1).text.length;
const notyours = await call("Wkr", { close: 1 }, "t5");
const closed = await call("main", { close: 3 }, "t6");
const listed = Chat.state(chat).assigned.map((a) => ({ n: a.n, by: a.by, text: a.text }));
const device = await Chat.act(chat, "a1", { $: "assignment", n: 1, done: true }, "mac");
const unknown = await Chat.act(chat, "a2", { $: "assignment", n: 99, done: true }, "");
const shape = await Chat.act(chat, "a3", { $: "assignment", n: "1", done: true }, "");
const done = await Chat.act(chat, "a4", { $: "assignment", n: 1, done: true }, "");
await until(() => asks.length === 1);
const again = await Chat.act(chat, "a5", { $: "assignment", n: 1, done: true }, "");
const dropped = await Chat.act(chat, "a6", { $: "assignment", n: 2, done: false }, "");
await Bun.sleep(100);
const said = msgs().filter((m) => m.kind === "user" && m.text.includes("todo")).map((m) => m.text);
const notes = msgs().filter((m) => m.kind === "note").map((m) => m.text);
const left = [...Chat.state(chat).assigned];
for (let k = 0; k < 40; k++) await call("main", { text: "a" + k }, "c" + k);
const capped = await call("main", { text: "one more" }, "cx");
const saved = Memory.load(chat.mem.dir, () => null).assigned.length;
const tools = { main: Tools.list(chat.tools, "main").map((s) => s.name).includes("assign"), sub: Tools.list(chat.tools, "Wkr").map((s) => s.name).includes("assign") };
console.log(JSON.stringify({ filed, sub, empty, long, longest, notyours, closed, listed, device: device.error ?? null, unknown, shape: shape.error ?? null, done, asks: asks.length, again, dropped, said, notes, left, capped, open: chat.mem.assigned.length, saved, tools }));
process.exit(0);
`;

test("the server: any agent assigns; Done or Drop from a view only; Done tells the filer once and starts a turn, Drop a note; close only your own; capped, kept", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-server-");
  fs.writeFileSync(dir + "/todo.ts", SERVER);
  const proc = Bun.spawn([process.execPath, dir + "/todo.ts"], { env: { ...process.env, LEGION_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.filed).toMatchObject({ fail: false, text: expect.stringContaining("todo 1") });
  expect(out.sub).toMatchObject({ fail: false });
  expect(out.empty.fail).toBe(true);
  expect(out.long.fail).toBe(false);
  expect(out.longest).toBe(2000);
  expect(out.notyours).toMatchObject({ fail: true, text: expect.stringContaining("only your own") });
  expect(out.closed).toMatchObject({ fail: false });
  expect(out.listed).toEqual([{ n: 1, by: "main", text: "Approve PR #352 on GitHub" }, { n: 2, by: "Wkr", text: "Run ! gcloud auth login" }]);
  expect(out.device).toMatch(/view|web|terminal/);
  expect(out.unknown).toEqual({ error: "No todo 99." });
  expect(out.shape).toMatch(/^No todo/);
  expect(out.done).toEqual({});
  expect(out.asks).toBe(1);
  expect(out.again).toEqual({ error: "No todo 1." });
  expect(out.dropped).toEqual({});
  expect(out.said).toEqual(["Done: your todo 1 (Approve PR #352 on GitHub)."]);
  expect(out.notes).toContain("The user dropped Wkr's todo 2 (Run ! gcloud auth login).");
  expect(out.left).toEqual([]);
  expect(out.capped).toMatchObject({ fail: true, text: expect.stringContaining("30 todos are open") });
  expect(out.open).toBe(30);
  expect(out.saved).toBe(30);
  expect(out.tools).toEqual({ main: true, sub: true });
});
