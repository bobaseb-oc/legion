// Super test
// ==========
// `bun test Super.test.ts`. Super auto (Modes.decides, Tools.question,
// Chat.decision; RED ZONE: who decides): in super mode a question of a
// kind the user has always answered with Legion's pick is answered with
// it, logged as a note and on the Questions page's Decided-for-you list;
// any other is asked as in auto. The user's answers count per kind; an
// answer not the pick is learned as a preference. Undo, a view's act only,
// sends the reversal once and counts as an override; 2 of a kind's last
// 10 undone relock it. Past answers in the log are imported once.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const SERVER = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const fs = await import("node:fs");
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
const ask = (args, id) => Tools.call(chat.tools, "main", "ask", args, go, id);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
// the user's messages Legion answers in a turn (one runs; the rest queue)
const said = () => msgs().filter((m) => m.kind === "user" && /^(Answer to|The user reversed)/.test(m.text)).map((m) => m.text);
const mode = chat.mem.mode;
const fresh = { ...chat.mem.tallies };
chat.mem.tallies = { push: { n: 20, took: 20, auto: [] }, merge: { n: 30, took: 30, auto: [] }, access: { n: 50, took: 50, auto: [] } };
const push = { question: "Push AO-1 to origin?", options: ["Hold", "Push it"], kind: "push", pick: 1 };
const decided = await ask(push, "t1");
const open1 = chat.mem.questions.length;
const merge = await ask({ question: "Merge PR #7?", options: ["Merge", "Hold"], kind: "merge", pick: 0, prod: true }, "t2");
const access = await ask({ question: "Grant the token?", options: ["Yes", "No"], kind: "access", pick: 0 }, "t3");
const nokind = await ask({ question: "Push AO-2?", options: ["Hold", "Push it"], pick: 1 }, "t4");
const retry = await ask({ question: "Retry the flaky build?", options: ["Retry", "Skip"], kind: "retry", pick: 0 }, "t5");
chat.mem.mode = "auto";
const auto = await ask(push, "t6");
chat.mem.mode = "super";
const filed = chat.mem.questions.map((q) => ({ id: q.id, kind: q.kind ?? null, pick: q.pick ?? null, prod: q.prod ?? null }));
const list = Chat.state(chat).decided.map((d) => ({ id: d.id, kind: d.kind, answer: d.answer, question: d.question }));
const notes = () => msgs().filter((m) => m.kind === "note").map((m) => m.text);
const noted = notes().filter((t) => t.startsWith("Decided for you"));
// the user's answers: the retry's pick taken, the auto push's not
const r = chat.mem.questions.find((q) => q.kind === "retry").id;
const p = chat.mem.questions.find((q) => q.kind === "push").id;
await Chat.act(chat, "a1", { $: "answer", q: r, text: "Retry" }, "");
await Chat.act(chat, "a2", { $: "answer", q: p, text: "Hold: wait for CI" }, "");
await until(() => said().length === 2);
const tallies = JSON.parse(JSON.stringify(chat.mem.tallies));
const likes = [...chat.mem.likes];
const told = Tools.likes(chat.tools)[0]?.text ?? "";
// undo: refused from a device, sent once from a view
const n = list[0].id;
const device = await Chat.act(chat, "u1", { $: "decision", n, undo: true, text: "no" }, "mac");
const unknown = await Chat.act(chat, "u2", { $: "decision", n: 999, undo: true }, "");
const undo = await Chat.act(chat, "u3", { $: "decision", n, undo: true, text: "hold it" }, "");
await until(() => said().length === 3);
const again = await Chat.act(chat, "u4", { $: "decision", n, undo: true, text: "hold it" }, "");
await Bun.sleep(50);
const reversed = msgs().filter((m) => m.kind === "user" && m.text.startsWith("The user reversed")).map((m) => m.text);
const after = { ...chat.mem.tallies.push, auto: chat.mem.tallies.push.auto.length };
// a second undo, with no text, of push's last 10: relocked
const second = await ask({ ...push, question: "Push AO-3?" }, "t7");
await Chat.act(chat, "u5", { $: "decision", n: chat.mem.decided.at(-1).id, undo: true }, "");
await until(() => said().length === 4);
const plain = msgs().filter((m) => m.kind === "user" && m.text.startsWith("The user reversed")).at(-1).text;
const relocked = chat.mem.tallies.push;
const third = await ask({ ...push, question: "Push AO-4?" }, "t8");
// dismiss: gone, no turn
chat.mem.tallies.push = { n: 20, took: 20, auto: [] };
await ask({ ...push, question: "Push AO-5?" }, "t9");
const dismissed = await Chat.act(chat, "u6", { $: "decision", n: chat.mem.decided.at(-1).id, undo: false }, "");
await Bun.sleep(50);
const turns = { said: said().length, asked: asks.length > 0 };
const left = chat.mem.decided.length;
// R5: the model's kind is not trusted: worded as money, it asks, even said "push" (unlocked)
chat.mem.tallies.push = { n: 20, took: 20, auto: [] };
const lied = await ask({ question: "Pay the vendor's $300 invoice?", options: ["Pay it", "Hold"], kind: "push", pick: 0 }, "t10");
// kept with the chat
const saved = Memory.load(chat.mem.dir, () => null);
const kept = { tallies: saved.tallies.retry, likes: saved.likes.length, decided: saved.decided.length };
// the import of past answers: once, when view.json has no tallies
Memory.push(chat.mem, [{ kind: "user", text: "Answer to your question 77 (Push the branch? A) push (my pick) B) wait):\\nA" }]);
const file = chat.mem.dir + "/view.json";
const json = JSON.parse(fs.readFileSync(file, "utf8"));
delete json.tallies;
fs.writeFileSync(file, JSON.stringify(json));
const imported = Memory.load(chat.mem.dir, () => null).tallies.push;
// R5: a saved mode unknown, or none, fails closed to auto; a new chat is super (mode above)
json.mode = "turbo";
fs.writeFileSync(file, JSON.stringify(json));
const unknownmode = Memory.load(chat.mem.dir, () => null).mode;
delete json.mode;
fs.writeFileSync(file, JSON.stringify(json));
const nomode = Memory.load(chat.mem.dir, () => null).mode;
json.mode = "full";
fs.writeFileSync(file, JSON.stringify(json));
const fullmode = Memory.load(chat.mem.dir, () => null).mode;
console.log(JSON.stringify({ lied, unknownmode, nomode, fullmode, mode, fresh, decided, open1, merge, access, nokind, retry, auto, filed, list, noted, tallies, likes, told, device: device.error ?? null, unknown: unknown.error ?? null, undo, again: again.error ?? null, reversed, after, second, plain, relocked, third, dismissed, turns, left, kept, imported }));
process.exit(0);
`;

test("the server: super answers an unlocked kind with its pick, asks the rest; answers count and teach; Undo from a view only, once; relock; import", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/super.ts", SERVER);
  const proc = Bun.spawn([process.execPath, dir + "/super.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.mode).toBe("super");
  expect(out.fresh).toEqual({});
  expect(out.decided).toEqual({ text: "Decided for you (super auto): Push it. Proceed.", fail: false });
  expect(out.open1).toBe(0);
  for (const filed of [out.merge, out.access, out.nokind, out.retry, out.auto]) {
    expect(filed).toMatchObject({ fail: false, text: expect.stringContaining("Filed as question") });
  }
  expect(out.filed.map((q: any) => [q.kind, q.pick, q.prod])).toEqual([["merge", 0, true], ["access", 0, null], [null, 1, null], ["retry", 0, null], ["push", 1, null]]);
  expect(out.list).toEqual([{ id: 1, kind: "push", answer: "Push it", question: "Push AO-1 to origin?" }]);
  expect(out.noted).toEqual(["Decided for you (super auto): Push it (decision 1: Push AO-1 to origin?). Undo it on the Questions page."]);
  expect(out.tallies.retry).toEqual({ n: 1, took: 1, auto: [] });
  expect(out.tallies.push).toMatchObject({ n: 21, took: 20 });
  expect(out.likes).toEqual(["On push: user chose 'Hold: wait for CI' over 'Push it' (Push AO-1 to origin?)"]);
  expect(out.told).toContain("On push: user chose 'Hold: wait for CI' over 'Push it'");
  expect(out.device).toMatch(/view|web|terminal/);
  expect(out.unknown).toMatch(/^No decision/);
  expect(out.undo).toEqual({});
  expect(out.again).toMatch(/^No decision/);
  expect(out.reversed).toEqual(["The user reversed decision 1 (Push AO-1 to origin?): hold it"]);
  expect(out.after).toMatchObject({ n: 22, took: 20, auto: 1 });
  expect(out.second.text).toStartWith("Decided for you");
  expect(out.plain).toBe("The user reversed decision " + 7 + " (Push AO-3?): do not do this, ask me");
  expect(out.relocked).toEqual({ n: 0, took: 0, auto: [] });
  expect(out.third.text).toContain("Filed as question");
  expect(out.dismissed).toEqual({});
  expect(out.turns).toEqual({ said: 4, asked: true });
  expect(out.left).toBe(0);
  expect(out.kept).toEqual({ tallies: { n: 1, took: 1, auto: [] }, likes: 2, decided: 0 });
  expect(out.imported).toEqual({ n: 1, took: 1, est: true, auto: [] });
  // R5: worded as money, asked though it says push; a saved mode unread fails closed
  expect(out.lied).toMatchObject({ fail: false, text: expect.stringContaining("Filed as question") });
  expect(out.unknownmode).toBe("auto");
  expect(out.nomode).toBe("auto");
  expect(out.fullmode).toBe("full");
});
