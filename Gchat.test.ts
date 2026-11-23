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
import { gchat_act, gchat_chunks, gchat_items, gchat_new, gchat_on, gchat_post, gchat_replies, type Item } from "./Gchat.ts";
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
  expect(e1).toEqual({ error: "GChat: HTTP 400.", status: 400, retry: null, done: null, next: 0 });
  expect(e2).toEqual({ error: "GChat: not reachable.", status: null, retry: null, done: null, next: 0 });
  // Google's reason said too (a bad token is clear at once), one line,
  // capped, and never the URL's key or token even if it echoes them
  const why = (msg: string) => (async () => Response.json({ error: { code: 400, message: msg } }, { status: 400 })) as any;
  expect(await gchat_post(URL_, "k", "hi", why("Missing or malformed token in the request."))).toMatchObject({ error: "GChat: HTTP 400: Missing or malformed token in the request.", status: 400 });
  const u = new URL(URL_);
  const echo = await gchat_post(URL_, "k", "hi", why("bad " + URL_ + "\nkey " + u.searchParams.get("key") + " " + "x".repeat(500)));
  expect("error" in echo && echo.error.length <= 240).toBe(true);
  expect(JSON.stringify(echo)).not.toContain(u.searchParams.get("key")!);
  expect(JSON.stringify(echo)).not.toContain(u.searchParams.get("token")!);
  expect(JSON.stringify(echo)).not.toContain("\n");
});

// Google allows about one post a second a space: chunks are spaced GAP
// apart (the wait injected: no real sleep); a 429 says how long to wait
// (Retry-After, seconds); a post cut short by a later chunk's failure says
// its first message and the next chunk, so the rest goes in the same thread
test("a post spaces its chunks, says a 429's Retry-After, and goes on from the chunk that failed", async () => {
  const text = "x".repeat(9000);
  const n = gchat_chunks(text).length;
  expect(n).toBe(3);
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };
  const sent: string[] = [];
  let status = [200, 200, 200];
  const f = (async (u: string, init: any) => {
    sent.push(new URL(u).searchParams.get("threadKey") + " " + JSON.parse(init.body).text.slice(0, 5));
    const s = status.shift() ?? 200;
    return s === 200 ? Response.json({ createTime: "2026-11-23T10:00:00Z", thread: { name: SPACE + "/threads/T1" } })
      : new Response("no", { status: s, headers: s === 429 ? { "retry-after": "30" } : {} });
  }) as any;
  const first = { thread: SPACE + "/threads/T1", at: Date.parse("2026-11-23T10:00:00Z") };
  expect(await gchat_post(URL_, "k", text, f, { wait })).toEqual(first);
  expect(waits).toEqual([1100, 1100]);
  sent.length = 0;
  status = [429];
  expect(await gchat_post(URL_, "k", "hi", f, { wait })).toEqual({ error: "GChat: HTTP 429.", status: 429, retry: 30_000, done: null, next: 0 });
  sent.length = 0;
  status = [200, 500];
  const cut = await gchat_post(URL_, "k", text, f, { wait });
  expect(cut).toEqual({ error: "GChat: HTTP 500.", status: 500, retry: null, done: first, next: 1 });
  sent.length = 0;
  status = [];
  expect(await gchat_post(URL_, "k", text, f, { wait, from: 1, done: first })).toEqual(first);
  expect(sent).toEqual(["k [2/3]", "k [3/3]"]);
});

// security review L5: Google may echo the key or token percent-encoded,
// or the URL as the server was given it (no threadKey): cut too
test("a refused post's reason never has the key or token, encoded or not, nor the URL given", async () => {
  const hook = "https://chat.googleapis.com/v1/" + SPACE + "/messages?key=FAKE%2bKEY&token=FAKE-tok%3D%3D";
  const why = (msg: string) => (async () => Response.json({ error: { code: 400, message: msg } }, { status: 400 })) as any;
  const echo = await gchat_post(hook, "k", "hi", why("given " + hook + " token FAKE-tok%3D%3D key FAKE%2BKEY or FAKE-tok== FAKE+KEY"));
  const text = JSON.stringify(echo);
  for (const leak of ["FAKE-tok%3D%3D", "FAKE-tok==", "FAKE%2BKEY", "FAKE%2bKEY", "FAKE+KEY", "FAKE"]) {
    expect([leak, text.includes(leak)]).toEqual([leak, false]);
  }
  expect(text).toContain("<redacted>");
});

// security review L4: an agent's text may hold a secret; a post is
// scrubbed with the repo's secret shapes (local/prime/redact.ts)
test("the items posted are scrubbed of secret-shaped strings", () => {
  const gh = "ghp_" + "A1b2C3d4".repeat(5);
  const ant = "sk-ant-" + "x".repeat(30);
  const items = gchat_items({
    questions: [{ id: 1, text: "use " + gh + "?", options: ["yes " + ant, "no"], at: 0, date: "" }, { id: 2, text: "note " + gh, at: 0, date: "", fyi: true }],
    assigned: [{ n: 3, text: "rotate " + gh, by: "Unii", date: "" }],
    decided: [{ id: 4, kind: "other", question: "push " + gh + "?", answer: ant, date: new Date().toISOString() }],
  }, Date.now());
  expect(items.map((x) => x.key)).toEqual(["q1", "n2", "t3", "d4"]);
  for (const x of items) {
    expect([x.key, x.text.includes(gh) || x.text.includes(ant)]).toEqual([x.key, false]);
    expect(x.text).toContain("[REDACTED:");
  }
  expect(items[0]!.text).toContain("Question 1: use [REDACTED:github]?");
  // the options themselves kept: an answer by number is the option's text
  expect(items[0]!.options).toEqual(["yes " + ant, "no"]);
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

// RED ZONE (DRAFT awaiting the user's sign-off): the bridge sends Chat.act
// as a view (device ""), so the acts it can make are only an answer, an
// assignment's or a decision's: never the user's !command (bang), whatever
// a reply says
test("a reply never becomes a !command or any act but an answer, assignment or decision", () => {
  const items: Item[] = [
    { key: "q1", kind: "question", n: 1, text: "", options: ["!rm -rf ~"] },
    { key: "n2", kind: "note", n: 2, text: "" },
    { key: "t3", kind: "todo", n: 3, text: "" },
    { key: "d4", kind: "decision", n: 4, text: "" },
  ];
  const texts = ["!ls", "! rm -rf ~", "1", "bang", "done !ls", "undo !ls", "keep", "drop", "{\"$\":\"bang\"}", ""];
  const made = items.flatMap((item) => texts.map((text) => gchat_act({ item, name: "m", text }))).filter((a) => a !== null);
  expect(made.length).toBeGreaterThan(0);
  expect(made.every((a) => ["answer", "assignment", "decision"].includes(a.$) && a.command === undefined)).toBe(true);
});

// L4: an open consent is an `approval` item, first, keyed "a" + id,
// carrying the record's fp; its text from the call, scrubbed (O5)
test("L4-AC8, O5: an approval item: first, its text the call redacted, its fp carried", () => {
  const ant = "sk-ant-" + "x".repeat(30);
  const items = gchat_items({
    questions: [{ id: 1, text: "Ship?", at: 0, date: "" }],
    assigned: [],
    decided: [],
    calls: [{ id: 7, who: "main", tool: "shell", what: "curl -H 'x-api-key: " + ant + "' https://api.example (on mac)", fp: "f7" }],
  } as any, Date.now());
  expect(items.map((x) => x.key)).toEqual(["a7", "q1"]);
  const a = items[0] as any;
  expect(a.kind).toBe("approval");
  expect(a.n).toBe(7);
  expect(a.fp).toBe("f7");
  expect(a.text).toContain("Approval 7");
  expect(a.text).toContain("main");
  expect(a.text).toContain("curl");
  expect(a.text).toContain("[REDACTED:anthropic]");
  expect(a.text).not.toContain(ant);
  expect(a.text).toContain("Reply yes or no");
});

// RED ZONE (O6): an approval's reply counts only as an exact yes or no,
// trimmed, case-insensitive; anything else is no act at all
test("O6: an approval reply: exact trimmed yes or no only", () => {
  const a = { key: "a7", kind: "approval", n: 7, text: "", fp: "f7" } as unknown as Item;
  const r = (text: string) => gchat_act({ item: a, name: "m", text });
  expect(r(" YES ")).toEqual({ $: "consent", n: 7, yes: true });
  expect(r("yes")).toEqual({ $: "consent", n: 7, yes: true });
  expect(r("No")).toEqual({ $: "consent", n: 7, yes: false });
  for (const text of ["yes please", "ok", "y", "yes.", "", "  ", "no way", "yesno", "!yes"]) {
    expect([text, r(text)]).toEqual([text, null]);
  }
});

// the server, in a process of its own: fetch stubbed (no network), the
// webhook's and Chat's answers scripted; STEP: "post" files the items and
// posts them, "reply" (a restart: same UNII_DIR) posts each open item
// again in a new thread and acts on the replies there only
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
  if (u.host === "openidconnect.googleapis.com" && u.pathname === "/v1/userinfo") {
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
Chat.gchat_wait = async () => {}; // posts GAP apart: no real wait here
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
  const threads = chat.bridging?.threads ?? [];
  out.keys = threads.map((p) => p.key);
  // this process's threads, for the restart to reply in (memory only: PLP-2922)
  fs.writeFileSync(process.env.UNII_DIR + "/old-threads.json", JSON.stringify(threads.map((p) => [p.key, p.thread])));
  out.lists = lists.length;
  const before = posts.length;
  chat.socks.delete(device);
  Chat.chats.set("u1", chat);
  Chat.free(chat);
  await Bun.sleep(100);
  out.freed = !Chat.chats.has("u1");
  out.bye = posts.slice(before).map((p) => ({ tk: p.tk, text: p.text }));
} else {
  Chat.gchat_token = async () => "tok";
  const old = new Map(JSON.parse(fs.readFileSync(process.env.UNII_DIR + "/old-threads.json", "utf8")));
  out.saved = old.size;
  const q = chat.mem.questions.find((x) => !x.fyi && x.text === "Ship it?");
  const n = chat.mem.questions.find((x) => x.fyi);
  const t = chat.mem.assigned[0];
  const d = chat.mem.decided[0];
  const at = Date.now() - 1000;
  // the threads of the last process answer nothing (RED ZONE, PLP-2922):
  // the restart posts each open item again in a new thread
  const o = (name, key, text) => ({ name: SPACE + "/messages/" + name, sender: { name: "users/111", type: "HUMAN" }, thread: { name: old.get(key) }, createTime: new Date(at).toISOString(), text });
  script = [o("o1", "q" + q.id, "2"), o("o2", "t" + t.n, "done"), o("o3", "d" + d.id, "undo hold it")];
  // the digest due, so the note, todo and decision (quiet: held) post too
  chat.mem.digested = 0;
  await pass();
  await Bun.sleep(100);
  out.posted = posts.length;
  out.fresh = posts.every((p) => ![...old.values()].includes(SPACE + "/threads/" + p.tk));
  out.old = msgs().filter((m) => m.kind === "user" && /^(Answer to|Reply to|Done:|The user reversed)/.test(m.text)).length;
  // this process's own post of an item (its thread key, Chat.bridge's)
  const thread = (key) => SPACE + "/threads/" + posts.find((p) => p.tk.startsWith("legion-" + key + "-"))?.tk;
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
  out.later = posts.length - out.posted;
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
  const proc = Bun.spawn([process.execPath, dir + "/gchat.ts"], { env: { ...process.env, UNII_GCHAT_SPACE: "", GCHAT_WEBHOOK_URL: "", UNII_GCHAT_KEYCHAIN: "", UNII_GCHAT_USER: "u1", UNII_DIR: dir, STEP: step, ...env }, stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: JSON.parse(o.trim().split("\n").at(-1) ?? "{}"), all: o + e };
}

test("the server: each item posted once a process, again in a new thread after a restart; replies in its own threads acted on once, as a view's acts; the key never shown", async () => {
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
  expect(b.out.saved).toBe(5);
  // RED ZONE (PLP-2922): the restart posts the 5 open items again, each in
  // a new thread; replies in the old threads answer nothing; then each
  // only once, posted no more
  expect(b.out.posted).toBe(5);
  expect(b.out.fresh).toBe(true);
  expect(b.out.old).toBe(0);
  expect(b.out.later).toBe(0);
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

// the bridge against Google's limits, in a process of its own (fetch
// stubbed, the wait recorded: no real sleep, the clock given to each pass).
// STEP 429: a 429 ends the pass and holds posting max(Retry-After, 15 s);
// posts in a pass are spaced. part: an item cut short by a later chunk
// sends only the rest, in the same thread. refused: a 4xx (not 429)
// skips that item for this process, logged once
const LIMITS = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const SPACE = ${JSON.stringify(SPACE)};
const posts = [];
const script = JSON.parse(process.env.SCRIPT);
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === "chat.googleapis.com" && init.method === "POST") {
    const tk = u.searchParams.get("threadKey");
    posts.push(tk.split("-").slice(0, 2).join("-") + " " + JSON.parse(init.body).text.slice(0, 5));
    const s = script.shift() ?? 200;
    return s === 200 ? Response.json({ createTime: new Date().toISOString(), thread: { name: SPACE + "/threads/" + tk } })
      : new Response("no", { status: s, headers: s === 429 ? { "retry-after": "30" } : {} });
  }
  return new Response("no", { status: 404 });
};
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.socks.add({ send: () => {}, data: { user: { id: "u1", name: "a@b.c" }, who: "device", tab: "", wire: null, host: null, computer: false, work: "", home: null, device: "d1", seen: new Set(), watch: new Set() } });
AskAI.ask = (ask, on) => { const [call] = AskAI.tie(on, ask.bill, () => {}, () => {}); call.send = () => {}; return call; };
Chat.gchat_token = null;
const waits = [];
Chat.gchat_wait = async (ms) => { waits.push(ms); };
const go = new AbortController().signal;
const ask = (q, id) => Tools.call(chat.tools, "main", "ask", { question: q, options: ["Hold", "Push it"] }, go, id);
const t0 = Date.now();
const pass = async (dt) => { Chat.chats.set("u1", chat); await Chat.bridge(chat, t0 + dt); return posts.length; };
const out = {};
if (process.env.STEP === "429") {
  await ask("One?", "t1"); await ask("Two?", "t2"); await ask("Three?", "t3");
  out.passes = [await pass(0), await pass(10_000), await pass(16_000), await pass(31_000)];
  out.waits = waits;
} else if (process.env.STEP === "part") {
  // an item longer than one message (a question's own text is capped
  // below that, so set in memory)
  await ask("Long?", "t1");
  chat.mem.questions.at(-1).text = "x".repeat(5000);
  out.passes = [await pass(0), await pass(20_000), await pass(40_000)];
  out.threads = chat.bridging.threads.length;
} else {
  await ask("One?", "t1"); await ask("Two?", "t2");
  out.passes = [await pass(0), await pass(20_000), await pass(40_000)];
  out.threads = chat.bridging.threads.length;
}
out.posts = posts;
console.log(JSON.stringify(out));
process.exit(0);
`;

async function limits(step: string, script: number[]): Promise<{ out: any; err: string }> {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-gchat-");
  fs.writeFileSync(dir + "/limits.ts", LIMITS);
  const env = { UNII_GCHAT_SPACE: SPACE, GCHAT_WEBHOOK_URL: URL_, UNII_GCHAT_KEYCHAIN: "", UNII_GCHAT_USER: "u1", UNII_DIR: dir, STEP: step, SCRIPT: JSON.stringify(script) };
  const proc = Bun.spawn([process.execPath, dir + "/limits.ts"], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { out: JSON.parse(o.trim().split("\n").at(-1) ?? "{}"), err: e };
}

test("the bridge: a 429 ends the pass and holds posting for max(Retry-After, 15 s); posts in a pass are spaced", async () => {
  const { out, err } = await limits("429", [200, 429]);
  // pass 1: One posted, Two refused (429), Three not tried; held at 10 s
  // and 16 s (Retry-After 30 s), then Two and Three
  expect(out.passes).toEqual([2, 2, 2, 4]);
  expect(out.posts.map((p: string) => p.split(" ")[0])).toEqual(["legion-q1", "legion-q2", "legion-q2", "legion-q3"]);
  expect(out.waits).toEqual([1100, 1100]);
  expect(err).toContain("HTTP 429");
  expect(err).not.toContain("FAKETOKEN");
}, 30_000);

test("the bridge: an item cut short by a later chunk sends only the rest, in the same thread", async () => {
  const { out } = await limits("part", [200, 500]);
  expect(out.posts).toEqual(["legion-q1 [1/2]", "legion-q1 [2/2]", "legion-q1 [2/2]"]);
  expect(out.passes).toEqual([2, 3, 3]);
  expect(out.threads).toBe(1);
}, 30_000);

test("the bridge: a 4xx other than 429 skips that item for this process, logged once", async () => {
  const { out, err } = await limits("refused", [400]);
  expect(out.passes).toEqual([2, 2, 2]);
  expect(out.posts.map((p: string) => p.split(" ")[0])).toEqual(["legion-q1", "legion-q2"]);
  expect(out.threads).toBe(1);
  expect(err.split("HTTP 400").length - 1).toBe(1);
  expect(err).not.toContain("FAKETOKEN");
}, 30_000);
