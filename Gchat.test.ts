// Gchat test
// ==========
// `bun test Gchat.test.ts`. The GChat bridge (Gchat.ts, Server.ts
// Chat.bridge): each open item posted once through the webhook (never
// again after a restart), its text in chunks; a reply in its thread acted
// on once, as a view's act, only if it is the signed-in user's, in the
// space, in an open item's thread, newer than the item (RED ZONE). Off
// unless both the space and the key are set; the key never shown.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { gchat_act, gchat_chunks, gchat_new, gchat_on, gchat_post, gchat_replies, type Item } from "./Gchat.ts";
import type { Message } from "./Google.ts";

const SPACE = "spaces/TESTSPACE";
const URL_ = "https://chat.googleapis.com/v1/" + SPACE + "/messages?key=FAKEKEY&token=FAKETOKEN-not-real";

test("on only with a space and a webhook of that space on Chat's API", () => {
  expect(gchat_on(SPACE, URL_)).toBe(true);
  expect(gchat_on("", URL_)).toBe(false);
  expect(gchat_on(SPACE, "")).toBe(false);
  expect(gchat_on("spaces/OTHER", URL_)).toBe(false);
  expect(gchat_on(SPACE, URL_.replace("https:", "http:"))).toBe(false);
  expect(gchat_on(SPACE, URL_.replace("chat.googleapis.com", "evil.example"))).toBe(false);
  expect(gchat_on(SPACE, URL_.replace("&token=FAKETOKEN-not-real", ""))).toBe(false);
});

test("text in chunks of at most 4000, labelled when more than one", () => {
  const long = ("para ".repeat(300) + "\n\n").repeat(10);
  const chunks = gchat_chunks(long);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  expect(chunks[0]).toStartWith("[1/" + chunks.length + "]\n");
  expect(gchat_chunks("x".repeat(9000)).every((c) => c.length <= 4000)).toBe(true);
  expect(gchat_chunks("short")).toEqual(["short"]);
});

test("a post sets the thread key and fallback, and says a failure without the URL", async () => {
  const urls: string[] = [];
  const ok = (async (u: string) => (urls.push(u), Response.json({ createTime: "2026-11-18T10:00:00Z", thread: { name: SPACE + "/threads/T1" } }))) as any;
  expect(await gchat_post(URL_, "legion-q1-1", "hi", ok)).toEqual({ thread: SPACE + "/threads/T1", at: Date.parse("2026-11-18T10:00:00Z") });
  const p = new URL(urls[0]!).searchParams;
  expect(p.get("threadKey")).toBe("legion-q1-1");
  expect(p.get("messageReplyOption")).toBe("REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  const bad = (async () => new Response("no", { status: 400 })) as any;
  const down = (async (u: string) => { throw new Error("fetch failed: " + u); }) as any;
  const e1 = await gchat_post(URL_, "k", "hi", bad);
  const e2 = await gchat_post(URL_, "k", "hi", down);
  expect(e1).toEqual({ error: "GChat: HTTP 400." });
  expect(e2).toEqual({ error: "GChat: not reachable." });
});

// RED ZONE: who may answer
test("only the signed-in user's reply, in the space, in an open item's thread, newer than it, once", () => {
  const g = { ...gchat_new(), posted: [
    { key: "q1", tk: "a", thread: SPACE + "/threads/A", at: 1000 },
    { key: "q2", tk: "b", thread: SPACE + "/threads/B", at: 1000 },
  ] };
  const items: Item[] = [{ key: "q1", kind: "question", n: 1, text: "Q" }]; // q2 closed
  const me = "users/111";
  const m = (name: string, o: Partial<Message> = {}): Message => ({ name: SPACE + "/messages/" + name, sender: me, type: "HUMAN", thread: SPACE + "/threads/A", at: 2000, text: "yes", ...o });
  const said = [
    m("good"),
    m("other", { sender: "users/222" }),
    m("bot", { type: "BOT" }),
    m("hook", { sender: "users/999", type: "BOT" }),
    m("space", { name: "spaces/OTHER/messages/x", thread: "spaces/OTHER/threads/A" }),
    m("closed", { thread: SPACE + "/threads/B" }),
    m("older", { at: 500 }),
    m("same", { at: 1000 }),
    m("nothread", { thread: SPACE + "/threads/Z" }),
    m("good"),
  ];
  expect(gchat_replies(said, me, SPACE, g, items).map((r) => r.name)).toEqual([SPACE + "/messages/good"]);
  expect(gchat_replies(said, me, SPACE, { ...g, acted: [SPACE + "/messages/good"] }, items)).toEqual([]);
  expect(gchat_replies(said, null, SPACE, g, items)).toEqual([]);
  expect(gchat_replies(said, "users/abc", SPACE, g, items)).toEqual([]);
  // who is signed in unknown, and a message with no sender: none counts
  expect(gchat_replies([m("nobody", { sender: "" })], "", SPACE, g, items)).toEqual([]);
  expect(gchat_replies(said, me, "spaces/OTHER", g, items)).toEqual([]);
});

test("a reply as a view's act", () => {
  const q: Item = { key: "q3", kind: "question", n: 3, text: "", options: ["Hold", "Push it"] };
  const r = (item: Item, text: string) => gchat_act({ item, name: "m", text });
  expect(r(q, "2")).toEqual({ $: "answer", q: 3, text: "Push it" });
  expect(r(q, "wait for CI")).toEqual({ $: "answer", q: 3, text: "wait for CI" });
  expect(r({ key: "n4", kind: "note", n: 4, text: "" }, "thanks")).toEqual({ $: "answer", q: 4, text: "thanks" });
  const t: Item = { key: "t1", kind: "todo", n: 1, text: "" };
  expect(r(t, "Done.")).toEqual({ $: "assignment", n: 1, done: true });
  expect(r(t, "drop")).toEqual({ $: "assignment", n: 1, done: false });
  expect(r(t, "maybe")).toBe(null);
  const d: Item = { key: "d5", kind: "decision", n: 5, text: "" };
  expect(r(d, "undo: hold it")).toEqual({ $: "decision", n: 5, undo: true, text: "hold it" });
  expect(r(d, "undo")).toEqual({ $: "decision", n: 5, undo: true });
  expect(r(d, "keep")).toEqual({ $: "decision", n: 5, undo: false });
  expect(r(d, "thanks")).toBe(null);
});

// the server, in a process of its own: fetch stubbed (no network), the
// webhook's and Chat's answers scripted; STEP: "post" files the items and
// posts them, "reply" (a restart: same UNII_DIR) posts nothing new and
// acts on the replies
const SERVER = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const fs = await import("node:fs");
const SPACE = ${JSON.stringify(SPACE)};
const posts = [];
const lists = [];
let script = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === "chat.googleapis.com" && init.method === "POST") {
    const tk = u.searchParams.get("threadKey");
    posts.push({ path: u.pathname, tk, reply: u.searchParams.get("messageReplyOption"), text: JSON.parse(init.body).text });
    if (posts.length === 1 && process.env.STEP === "post") throw new Error("fetch failed: " + u.href);
    return Response.json({ name: SPACE + "/messages/w" + posts.length, createTime: new Date(Date.now() - 60_000).toISOString(), thread: { name: SPACE + "/threads/" + tk }, sender: { name: "users/999", type: "BOT" } });
  }
  if (u.host === "chat.googleapis.com") {
    lists.push(u.pathname);
    return Response.json({ messages: [...script].reverse() });
  }
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/tokeninfo") {
    return Response.json({ sub: "111" });
  }
  return new Response("no", { status: 404 });
};
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const asks = [];
// a device kept connected (as legion device is while the user is away),
// so the chat stays open until the test lets it go
const device = { send: () => {}, data: { user: { id: "u1", name: "a@b.c" }, who: "device", tab: "", wire: null, host: null, computer: false, work: "", home: null, device: "d1", seen: new Set(), watch: new Set() } };
chat.socks.add(device);
AskAI.ask = (ask, on) => {
  const [call] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(ask);
  call.send = () => {};
  return call;
};
const go = new AbortController().signal;
const tool = (who, name, args, id) => Tools.call(chat.tools, who, name, args, go, id);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
// a pass of the bridge's timer, on the chat kept open (no view is
// connected here, so Chat.free would let it go)
const pass = () => (Chat.chats.set("u1", chat), Chat.bridge(chat, Date.now()));
const out = { dflt: Chat.gchat_token !== null };
if (process.env.STEP === "post" || process.env.STEP === "off") {
  await tool("main", "ask", { question: "Ship it?", options: ["Hold", "Push it"] }, "t1");
  await tool("main", "notify", { text: "Build is green." }, "t2");
  await tool("main", "assign", { text: "Approve PR #9" }, "t3");
  chat.mem.tallies = { push: { n: 20, took: 20, auto: [] } };
  await tool("main", "ask", { question: "Push AO-1?", options: ["Hold", "Push it"], kind: "push", pick: 1 }, "t4");
  await tool("main", "ask", { question: "x".repeat(5000), options: [] }, "t5");
  Chat.gchat_token = async () => "tok";
  await pass();
  out.first = posts.length;
  await pass();
  out.posts = posts.map((p) => ({ path: p.path, tk: p.tk, reply: p.reply, len: p.text.length }));
  out.keys = chat.mem.gchat.posted.map((p) => p.key);
  out.lists = lists.length;
  const before = posts.length;
  chat.socks.delete(device);
  Chat.chats.set("u1", chat);
  Chat.free(chat);
  await Bun.sleep(100);
  out.freed = !Chat.chats.has("u1");
  out.bye = posts.slice(before).map((p) => ({ tk: p.tk, text: p.text }));
} else {
  const saved = Memory.load(chat.mem.dir, () => null).gchat;
  out.saved = saved.posted.map((p) => p.key);
  Chat.gchat_token = async () => "tok";
  const thread = (key) => chat.mem.gchat.posted.find((p) => p.key === key).thread;
  const q = chat.mem.questions.find((x) => !x.fyi && x.text === "Ship it?");
  const n = chat.mem.questions.find((x) => x.fyi);
  const t = chat.mem.assigned[0];
  const d = chat.mem.decided[0];
  const at = Date.now() - 1000;
  const m = (name, key, text, o = {}) => ({ name: SPACE + "/messages/" + name, sender: { name: "users/111", type: "HUMAN" }, thread: { name: thread(key) }, createTime: new Date(at).toISOString(), text, ...o });
  script = [
    m("r1", "q" + q.id, "2"),
    m("r2", "n" + n.id, "thanks, ship it"),
    m("r3", "t" + t.n, "done"),
    m("r4", "d" + d.id, "undo hold it"),
    m("x1", "q" + q.id, "Hold", { sender: { name: "users/222", type: "HUMAN" } }),
    m("x2", "q" + q.id, "Hold", { sender: { name: "users/111", type: "BOT" } }),
    m("x3", "q" + q.id, "Hold", { createTime: new Date(at - 3600_000).toISOString() }),
  ];
  await pass();
  await Bun.sleep(100);
  const said = () => msgs().filter((m) => m.kind === "user" && /^(Answer to|Reply to|Done:|The user reversed)/.test(m.text)).map((m) => m.text);
  out.said = said();
  out.posted = posts.length;
  await pass();
  await Bun.sleep(50);
  out.again = said().length;
  out.acted = chat.mem.gchat.acted.length;
  out.open = { questions: chat.mem.questions.length, todos: chat.mem.assigned.length, decided: chat.mem.decided.length };
  out.view = fs.readFileSync(chat.mem.dir + "/view.json", "utf8").includes("FAKETOKEN");
}
console.log(JSON.stringify(out));
process.exit(0);
`;

async function run(dir: string, step: string, env: Record<string, string>): Promise<{ out: any; all: string }> {
  fs.writeFileSync(dir + "/gchat.ts", SERVER);
  const proc = Bun.spawn([process.execPath, dir + "/gchat.ts"], { env: { ...process.env, UNII_GCHAT_SPACE: "", GCHAT_WEBHOOK_URL: "", UNII_DIR: dir, STEP: step, ...env }, stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: JSON.parse(o.trim().split("\n").at(-1) ?? "{}"), all: o + e };
}

test("the server: each item posted once, not again after a restart; replies acted on once, as a view's acts; the key never shown", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-gchat-");
  const env = { UNII_GCHAT_SPACE: SPACE, GCHAT_WEBHOOK_URL: URL_ };
  const a = await run(dir, "post", env);
  // the first post failed (not reachable), so tried again on the second pass
  expect(a.out.first).toBe(5);
  expect(a.out.posts.length).toBe(6);
  expect(a.out.posts.every((p: any) => p.path === "/v1/" + SPACE + "/messages" && p.reply === "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD" && p.tk.startsWith("legion-") && p.len <= 4000)).toBe(true);
  expect(new Set(a.out.keys)).toEqual(new Set(["q1", "n2", "t1", "d3", "q4"]));
  expect(a.all).not.toContain("FAKETOKEN");
  // on: the server reads the Google grant for the poll (RED ZONE U2, A)
  expect(a.out.dflt).toBe(true);
  // the chat let go (no view or device left): the space told, once, in a
  // thread of its own, so the user away knows replies aren't read
  expect(a.out.freed).toBe(true);
  expect(a.out.bye.length).toBe(1);
  expect(a.out.bye[0].text).toContain("stopped listening");
  expect(a.out.bye[0].tk.startsWith("legion-")).toBe(true);
  const b = await run(dir, "reply", env);
  expect(b.out.saved.length).toBe(5);
  expect(b.out.posted).toBe(0);
  expect(b.out.said).toEqual([
    "Answer to your question 1 (Ship it?):\nPush it",
    "Reply to your note 2 (Build is green.):\nthanks, ship it",
    "Done: your todo 1 (Approve PR #9).",
    "The user reversed decision 3 (Push AO-1?): hold it",
  ]);
  expect(b.out.again).toBe(4);
  expect(b.out.acted).toBe(4);
  expect(b.out.open).toEqual({ questions: 1, todos: 0, decided: 0 });
  expect(b.out.view).toBe(false);
  expect(b.all).not.toContain("FAKETOKEN");
}, 30_000);

test("the server: off when the space or the key is unset", async () => {
  const envs: Array<Record<string, string>> = [{ UNII_GCHAT_SPACE: SPACE }, { GCHAT_WEBHOOK_URL: URL_ }, {}];
  for (const env of envs) {
    const dir = fs.mkdtempSync(os.tmpdir() + "/unii-gchat-");
    const { out, all } = await run(dir, "off", env);
    expect(out.first).toBe(0);
    expect(out.lists).toBe(0);
    expect(out.dflt).toBe(false);
    expect(out.bye).toEqual([]);
    expect(all).not.toContain("FAKETOKEN");
  }
}, 30_000);
