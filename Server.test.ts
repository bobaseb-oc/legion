// Server test
// ===========
// `bun test Server.test.ts`. `./Server.ts <port>` alone serves the site
// (its prices only if it bills); with workers set, it is their
// supervisor, which only routes (a proxy in front sends each request to
// the worker it names).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// `./Server.ts <port>` on a fresh dir, with `env`: its answer to `path`,
// read whole, once it answers
async function server_get(port: number, env: Record<string, string>, path: string): Promise<Response> {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  const site = "http://127.0.0.1:" + port;
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, UNII_ANOTHER: "1", ...env },
    stdout : "ignore",
    stderr : "inherit",
  });
  try {
    for (let k = 0; k < 100; k++) {
      const res = await fetch(site + path).catch(() => null);
      if (res !== null) {
        return new Response(await res.text(), res);
      }
      await Bun.sleep(50);
    }
    throw new Error("no answer on " + site);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

test("Server.ts alone serves the page", async () => {
  const res = await server_get(9461, {}, "/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>");
});

test("with workers, Server.ts routes to them", async () => {
  const res = await server_get(9471, { UNII_WORKERS: "2" }, "/");
  expect(res.headers.get("x-unii-worker")).toMatch(/^127\.0\.0\.1:947[23]$/);
  expect(await res.text()).toBe("");
});

// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
// devices' socket, <dir>/server.sock. `./Server.ts <port>` on dir as it
// is: whether it ended (its code, what it said) or answers on the socket
async function server_sock(port: number, dir: string): Promise<{ code: number | null; err: string; answers: boolean }> {
  const site = "http://127.0.0.1:" + port;
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, UNII_ANOTHER: "1" },
    stdout : "ignore",
    stderr : "pipe",
  });
  let answers = false;
  for (let k = 0; k < 100 && proc.exitCode === null && !answers; k++) {
    const res = await fetch(site + "/api/hello", { unix: dir + "/server.sock" } as RequestInit).catch(() => null);
    answers = res?.ok === true && "hello" in (await res.json().catch(() => ({})));
    await Bun.sleep(50);
  }
  proc.kill();
  const code = await proc.exited;
  return { code: answers ? null : code, err: await new Response(proc.stderr).text(), answers };
}

test("the server takes a stale socket of this user (nothing answers), its dir made 0700", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-sock-");
  const sock = dir + "/server.sock";
  // a socket a killed process left
  const left = Bun.spawn([process.execPath, "-e", `Bun.listen({ unix: ${JSON.stringify(sock)}, socket: { data() {} } }); setInterval(() => {}, 1000)`]);
  for (let k = 0; k < 100 && !fs.existsSync(sock); k++) await Bun.sleep(20);
  left.kill("SIGKILL");
  await left.exited;
  expect(fs.lstatSync(sock).isSocket()).toBe(true);
  fs.chmodSync(dir, 0o755);
  const out = await server_sock(9491, dir);
  expect(out.answers).toBe(true);
  expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
}, 15_000);

test("the server refuses a server.sock that is not a socket, or one something answers on", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-sock-");
  const sock = dir + "/server.sock";
  fs.writeFileSync(sock, "not a socket");
  const file = await server_sock(9492, dir);
  expect(file.answers).toBe(false);
  expect(file.code).not.toBe(0);
  expect(file.err).toContain("server.sock");
  expect(fs.readFileSync(sock, "utf8")).toBe("not a socket");
  fs.rmSync(sock);
  fs.symlinkSync(dir + "/elsewhere", sock);
  const link = await server_sock(9493, dir);
  expect(link.answers).toBe(false);
  expect(fs.lstatSync(sock).isSymbolicLink()).toBe(true);
  fs.rmSync(sock);
  const live = Bun.serve({ unix: sock, fetch: () => new Response("another") });
  try {
    const held = await server_sock(9494, dir);
    expect(held.answers).toBe(false);
    expect(held.err).toContain("server.sock");
    expect(await (await fetch("http://x/", { unix: sock } as RequestInit)).text()).toBe("another");
  } finally {
    live.stop(true);
  }
}, 30_000);

// a server says whether it bills (Billing.ts): this one doesn't, so it
// serves no prices or terms
test("a free server bills nothing: it says so, and shows no prices or terms", async () => {
  expect(await (await server_get(9481, {}, "/api/hello")).json()).toMatchObject({ bills: false, github: false });
  expect((await server_get(9482, {}, "/pricing")).status).toBe(404);
  expect((await server_get(9483, {}, "/terms.html")).status).toBe(404);
});

// one server at a time for this user (HOME's ~/.unii/lock), whatever its
// UNII_DIR: a second ends, naming the one that runs, unless UNII_ANOTHER=1.
// Deleting the first's dir (as a test run's cleanup does) frees nothing
test("one server per user: a second on another dir ends naming the first; UNII_ANOTHER=1 runs one beside it", async () => {
  const home = fs.mkdtempSync(os.tmpdir() + "/unii-home-");
  const first = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  const site = "http://127.0.0.1:9501";
  const holder = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", "9501"], {
    env    : { ...process.env, HOME: home, UNII_DIR: first, UNII_SITE: site, UNII_ANOTHER: "" },
    stdout : "ignore",
    stderr : "inherit",
  });
  try {
    for (let k = 0; k < 100 && (await fetch(site + "/api/hello").catch(() => null)) === null; k++) {
      await Bun.sleep(50);
    }
    fs.rmSync(first, { recursive: true, force: true });
    const second = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", "9502"], {
      env    : { ...process.env, HOME: home, UNII_DIR: fs.mkdtempSync(os.tmpdir() + "/unii-server-"), UNII_SITE: "http://127.0.0.1:9502", UNII_ANOTHER: "" },
      stdout : "ignore",
      stderr : "pipe",
    });
    expect(await second.exited).not.toBe(0);
    const said = await new Response(second.stderr).text();
    expect(said).toContain("pid " + holder.pid);
    expect(said).toContain("port 9501");
    expect(said).toContain("UNII_ANOTHER=1");
    expect((await fetch("http://127.0.0.1:9502/api/hello").catch(() => null))).toBeNull();
    const beside = await server_get(9503, { HOME: home }, "/api/hello");
    expect(beside.status).toBe(200);
  } finally {
    holder.kill();
    await holder.exited;
  }
}, 30_000);

// only a lock nothing listens on is taken: anything else there (not a
// socket) is left, and the server ends
test("a lock that is not a socket is left alone: the server ends", async () => {
  const home = fs.mkdtempSync(os.tmpdir() + "/unii-home-");
  fs.mkdirSync(home + "/.unii");
  fs.writeFileSync(home + "/.unii/lock", "not a socket");
  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", "9504"], {
    env    : { ...process.env, HOME: home, UNII_DIR: fs.mkdtempSync(os.tmpdir() + "/unii-server-"), UNII_SITE: "http://127.0.0.1:9504", UNII_ANOTHER: "" },
    stdout : "ignore",
    stderr : "pipe",
  });
  expect(await proc.exited).not.toBe(0);
  expect(await new Response(proc.stderr).text()).toContain("UNII_ANOTHER=1");
  expect(fs.readFileSync(home + "/.unii/lock", "utf8")).toBe("not a socket");
}, 30_000);

// L6: two starts at once on a stale lock (a holder killed -9 left its
// socket, which refuses): one takes it, the other finds it held. Without
// a lock around taking a stale one, both see it stale, both remove what
// is there and listen: the second removes the first's live socket. Its
// take of the lock (Main.taking), left too, is removed: its pid is gone
const RACE = `
const { Main } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const won = [];
Main.lock(1).then(() => won.push(1));
Main.lock(2).then(() => won.push(2));
await Bun.sleep(2500);
console.log(JSON.stringify({ won: won.length }));
process.exit(0);
`;

test("two starts at once on a stale lock: one takes it, the other finds it held", async () => {
  const home = fs.mkdtempSync(os.tmpdir() + "/unii-home-");
  fs.mkdirSync(home + "/.unii");
  const lock = home + "/.unii/lock";
  const dead = Bun.spawn([process.execPath, "-e", "Bun.listen({ unix: " + JSON.stringify(lock) + ", socket: { data() {} } }); console.log('up'); setInterval(() => {}, 1e3);"], { stdout: "pipe" });
  for await (const _ of dead.stdout) break;
  dead.kill("SIGKILL");
  await dead.exited;
  expect(fs.lstatSync(lock).isSocket()).toBe(true);
  // and its take of the lock, left as it died
  fs.writeFileSync(lock + ".take", String(dead.pid));
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/race.ts", RACE);
  const proc = Bun.spawn([process.execPath, dir + "/race.ts"], { env: { ...process.env, HOME: home, UNII_DIR: dir, UNII_ANOTHER: "" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.won).toBe(1);
});

// a /model while the turn's call runs picks the next call's: the wait
// names the model the running one asked. Its own process, as config is
// read once a process (another test file's dir is not this one's)
const TURN = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
Chat.take(chat, Chat.push(chat, null, "user", "hi"));
await Bun.sleep(10);
const model = chat.pick.model;
const waited = Chat.waits(chat);
const to = { ...chat.pick, model: model === "opus-5.5" ? "haiku-5.5" : "opus-5.5" };
const acted = await Chat.act(chat, "pick", { $: "pick", to }, "");
console.log(JSON.stringify({ model, waited, acted, picked: chat.pick.model, to: to.model, after: Chat.waits(chat) }));
process.exit(0);
`;

test("a turn's wait names the model it runs on, not one picked since", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/turn.ts", TURN);
  const proc = Bun.spawn([process.execPath, dir + "/turn.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.model).toMatch(/\w/);
  expect(out.to).not.toBe(out.model);
  expect(out.waited).toBe(out.model);
  expect(out.acted).toEqual({});
  expect(out.picked).toBe(out.to);
  expect(out.after).toBe(out.model);
});

// an agent the person starts (/agent) reports into the chat and starts no
// turn; one the AI started takes a turn with its report. Its own process,
// as TURN's: every call is stubbed (summaries' too), an agent's ended by
// the test, found by its tools' address
const SPAWN = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.socks.add({ send: () => {}, data: { seen: new Set(), watch: new Set() } }); // a view open: an idle chat with none ends
const works = [];
const push = Chat.push;
Chat.push = (c, agent, kind, ...rest) => (agent === null && kind === "work" && works.push(rest[0]), push(c, agent, kind, ...rest));
const calls = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  calls.push({ server: String(ask.server ?? ""), sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const end = async (name, text) => {
  await until(() => calls.some((c) => c.server.includes(name)));
  calls.find((c) => c.server.includes(name)).sink.end({ ok: true, text, left: [] });
};
const acted = await Chat.act(chat, "s1", { $: "spawn", task: "count to 3" }, "");
const started = Chat.state(chat).agents;
await end(started[0], "1 2 3");
const reported = await until(() => works.length === 1);
await Bun.sleep(100);
const mine = { reported, busy: chat.busy, working: Chat.state(chat).agents.length };
const ai = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "count to 2");
await end(ai, "1 2");
const ais = { reported: await until(() => works.length === 2), busy: await until(() => chat.busy) };
console.log(JSON.stringify({ acted, started, mine, ais }));
process.exit(0);
`;

test("a person's agent reports without a turn; the AI's takes one", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/spawn.ts", SPAWN);
  const proc = Bun.spawn([process.execPath, dir + "/spawn.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.acted).toEqual({});
  expect(out.started).toHaveLength(1);
  expect(out.mine).toEqual({ reported: true, busy: false, working: 0 });
  expect(out.ais).toEqual({ reported: true, busy: true });
});

// a turn's call past ROLL tokens ends rolled (Agent.ts): the turn asks
// again from the chat's tree, the user's message word for word and what
// the turn did since raw, never ending on it. Its own process, as TURN's
const ROLL = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
chat.socks.add({ send: () => {}, data: { seen: new Set(), watch: new Set() } });
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push({ ask, sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const main = () => asks.filter((a) => String(a.ask.server ?? "").endsWith("/main"));
Chat.take(chat, Chat.push(chat, null, "user", "the user's own words"));
await until(() => main().length === 1);
Chat.push(chat, null, "tool", "shell(ls)");
Chat.push(chat, null, "echo", "a.txt b.txt");
main()[0].sink.end({ ok: true, text: "", left: [], roll: true });
const again = await until(() => main().length === 2);
const blocks = again ? main()[1].ask.blocks.map((b) => b.text).join("") : "";
const busy = chat.busy;
if (again) main()[1].sink.end({ ok: true, text: "done", left: [] });
await until(() => !chat.busy);
console.log(JSON.stringify({ again, busy, words: blocks.includes("the user's own words"), echo: /\\|echo: a\\.txt b\\.txt/.test(blocks), rolled: blocks.includes("rolled over") }));
process.exit(0);
`;

test("a turn past ROLL tokens rolls over: asked again from the tree, the user's words and its steps kept", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/roll.ts", ROLL);
  const proc = Bun.spawn([process.execPath, dir + "/roll.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ again: true, busy: true, words: true, echo: true, rolled: true });
});

// an agent's events go only to the views that asked for its page (the
// `agent` read); the chat's go to all. A tell and a dismiss from a view
// reach the agent. Its own process, as TURN's
const WATCH = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const got = { a: [], b: [] };
const sock = (k) => ({ send: (m) => got[k].push(JSON.parse(m)), data: { seen: new Set(), watch: new Set() } });
const [a, b] = [sock("a"), sock("b")];
chat.socks.add(a);
chat.socks.add(b);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push({ ask, sink, sent: [] });
  call.send = (say) => asks.at(-1).sent.push(say.text);
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const name = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "a task");
await until(() => asks.length === 1);
Chat.ask(chat, a, { $: "agent", name });
got.a.length = 0;
got.b.length = 0;
Chat.push(chat, chat.tools.agents.get(name), "unii", "agent words");
Chat.push(chat, null, "note", "chat words");
const seen = (k, text) => got[k].some((m) => m.$ === "entry" && m.text === text);
const told = await Chat.act(chat, "t1", { $: "tell", name, text: "one more thing" }, "");
const crewed = Chat.state(chat).crew.map((c) => c.name);
asks[0].sink.end({ ok: true, text: "done", left: [] });
await until(() => !chat.tools.agents.get(name).runs);
const dismissed = await Chat.act(chat, "d1", { $: "dismiss", name }, "");
console.log(JSON.stringify({
  a: [seen("a", "agent words"), seen("a", "chat words")],
  b: [seen("b", "agent words"), seen("b", "chat words")],
  told, sent: asks[0].sent, crewed: crewed.includes(name), dismissed, after: Chat.state(chat).crew.map((c) => c.name).includes(name),
}));
process.exit(0);
`;

// A person's !command: the user's own shell command (RED ZONE, DRAFT),
// from what speaks for the user only (a view or the terminal's own key: never a device's key, an act posted
// with no browser's session, an agent's tool call), run ungated as a
// user_shell job on the device named (else the only one open), told to
// the views as it starts; its command and output (capped) a note the AI
// reads, no turn; a timeout stops it
const BANG = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const { CAP } = await import(${JSON.stringify(import.meta.dir + "/Clip.ts")});
const { USER_SHELL } = await import(${JSON.stringify(import.meta.dir + "/Machine.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const told = [];
chat.socks.add({ send: (m) => { const x = JSON.parse(m); if (x.$ === "note") told.push(x.text); }, data: { seen: new Set(), watch: new Set() } });
// the compactor may call (a long note), never answered; a turn would
// leave the chat busy
AskAI.ask = (ask, on) => { const [call] = AskAI.tie(on, ask.bill, () => {}, () => {}); call.send = () => {}; return call; };
const notes = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i)).filter((m) => m.kind === "note").map((m) => m.text);
const until = async (f) => { for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10); return f(); };
const none = await Chat.act(chat, "b0", { $: "bang", command: "ls" }, "");
const jobs = { mac: [], pc: [] };
const link = (k) => ({ send: (x) => { if (x.$ === "job") jobs[k].push(x); }, live: () => true, computer: false, work: "~/w" });
Tools.attach(chat.tools, "t1", "mac", "u1", link("mac"));
const one = await Chat.act(chat, "b1", { $: "bang", command: "ls" }, "");
const first = jobs.mac.at(-1);
Tools.attach(chat.tools, "t2", "pc", "u1", link("pc"));
const empty = await Chat.act(chat, "b2", { $: "bang", command: "  " }, "");
const device = await Chat.act(chat, "b3", { $: "bang", command: "echo hi" }, "pc");
const posted = await Chat.act(chat, "b4", { $: "bang", command: "echo hi", device: "pc" }, "api");
const refused = jobs.pc.length;
const ran = await Chat.act(chat, "b5", { $: "bang", command: "echo hi", device: "pc" }, "");
const job = jobs.pc.at(-1);
Tools.done(chat.tools, "pc", job.id, { text: "hi\\n(exit 0 in 0.0 s)", fail: false });
await until(() => notes().length === 1);
const note = notes()[0];
await Chat.act(chat, "b6", { $: "bang", command: "yes", device: "pc" }, "");
Tools.done(chat.tools, "pc", jobs.pc.at(-1).id, { text: "y\\n".repeat(CAP), fail: false });
await until(() => notes().length === 2);
const capped = notes()[1].length <= CAP + 200 && notes()[1].includes("characters cut");
const before = jobs.pc.length;
const agent = await Tools.call(chat.tools, "main", USER_SHELL, { command: "echo x", device: "pc" }, new AbortController().signal, "x1");
const agented = jobs.pc.length - before;
Chat.bang_ms = 50;
await Chat.act(chat, "b7", { $: "bang", command: "sleep 99", device: "mac" }, "");
await until(() => notes().length === 3);
const late = notes()[2];
// K9: the web picks the device (!@name) and a folder (the Files page)
const several = await Chat.act(chat, "b8", { $: "bang", command: "ls" }, "");
const unknown = await Chat.act(chat, "b9", { $: "bang", command: "ls", device: "nas" }, "");
const picked = await Chat.act(chat, "b10", { $: "bang", command: "ls", device: "mac", dir: "/r/it's here" }, "");
const there = jobs.mac.at(-1);
const baddir = await Chat.act(chat, "b11", { $: "bang", command: "ls", device: "mac", dir: "x".repeat(2000) }, "");
// the terminal's own key (says): its socket speaks for the user, so its
// !command runs, on its own device
const tbefore = jobs.pc.length;
const termed = await Chat.act(chat, "b12", { $: "bang", command: "echo t" }, "pc", true);
const termjob = jobs.pc.length === tbefore + 1 ? jobs.pc.at(-1).job : null;
console.log(JSON.stringify({ none, one, first: first && first.job, empty, device, posted, refused, ran, job: job && job.job, note, capped, agent: agent.fail, agented, late, told: told.slice(0, 2), busy: chat.busy,
  several: several.error ?? null, unknown: unknown.error ?? null, picked, there: there && there.job.input.command, baddir: "error" in baddir, termed, termjob: termjob && termjob.input.command }));
process.exit(0);
`;

// B2: shell commands running like Claude Code's. A device's tails (its
// own jobs only) give each command's last lines, in the state and in
// "shells" messages; RED ZONE (DRAFT): sending one to the background or
// stopping it is the user's only (a view, or the terminal's own key),
// never a device key's socket or an act posted with neither; the user's
// Stop of all work ends every one, the background's too
const SHELL = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const heard = [];
chat.socks.add({ send: (m) => { const x = JSON.parse(m); if (x.$ === "shells") heard.push(x.shells); }, data: { seen: new Set(), watch: new Set() } });
AskAI.ask = (ask, on) => { const [call] = AskAI.tie(on, ask.bill, () => {}, () => {}); call.send = () => {}; return call; };
const until = async (f) => { for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10); return f(); };
const ids = { mac: [], pc: [] };
const link = (k) => ({ send: (x) => { if (x.$ === "jobs") ids[k] = x.ids; }, live: () => true, computer: false, work: "~/w" });
Tools.attach(chat.tools, "t1", "mac", "u1", link("mac"));
Tools.attach(chat.tools, "t2", "pc", "u1", link("pc"));
await Chat.act(chat, "b1", { $: "bang", command: "make", device: "mac" }, "");
const job = ids.mac[0];
await Chat.act(chat, "x1", { $: "tail", job, text: "compiling\\n" }, "mac");
await Chat.act(chat, "x2", { $: "tail", job, text: "<b>pc</b>\\n" }, "pc");
const lines = Chat.state(chat).shells[0].lines;
await until(() => heard.length > 0);
const told = heard.at(-1)[0].lines;
const yours = "Only you send a command to the background or stop it: from the web, or legion signed in with its own key (legion login). A device's key is within an agent's reach, so it can't speak for you.";
const device = await Chat.act(chat, "s1", { $: "shell", op: "stop", job }, "mac");
const posted = await Chat.act(chat, "s2", { $: "shell", op: "bg", job }, "api");
const kept = ids.mac.length;
const bg = await Chat.act(chat, "s3", { $: "shell", op: "bg", job }, "mac", true);
const n = Chat.state(chat).shells[0].n;
// an agent's call (Unii's), sent away from a view; then the user's Stop
// from a device key: the agents stop, not what runs in the background
const agent = Tools.job(chat.tools, "pc", { name: "shell", input: { command: "sleep 9" }, cwd: "main" }, new AbortController().signal, "a1");
const sent = await Chat.act(chat, "s4", { $: "shell", op: "bg", job: "a1" }, "");
const back = await agent;
await Chat.act(chat, "s5", { $: "stop" }, "mac");
const after = ids.mac.length + ids.pc.length;
await Chat.act(chat, "s6", { $: "stop" }, "");
const stopped = ids.mac.length + ids.pc.length;
const bad = await Chat.act(chat, "s7", { $: "shell", op: "rm" }, "");
console.log(JSON.stringify({ lines, told, device, posted: posted.error === yours, kept, bg, n, sent, back: back.text.includes("background command 2"), after, stopped, bad }));
process.exit(0);
`;

// A device's status (Device.device_status): its folder, branch and today's
// spend, kept as the latest and told every view in the state; only from a
// device, its fields checked
const STATUS = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const none = Chat.state(chat).status;
const web = await Chat.act(chat, "s0", { $: "status", dir: "x", branch: null, spend: null, stale: false }, "");
const ok = await Chat.act(chat, "s1", { $: "status", dir: "uniichat", branch: "main", spend: 0.25, stale: false, junk: 1 }, "mac");
const kept = Chat.state(chat).status;
const bad = await Chat.act(chat, "s2", { $: "status", dir: 5, branch: "main", spend: "lots", stale: false }, "mac");
const after = Chat.state(chat).status;
const weekly = await Chat.act(chat, "s3", { $: "status", dir: "uniichat", branch: "main", spend: 0.25, stale: false, week: 12.5 }, "mac");
const week = Chat.state(chat).status.week;
const badweek = await Chat.act(chat, "s4", { $: "status", dir: "uniichat", branch: "main", spend: 0.25, stale: false, week: "lots" }, "mac");
console.log(JSON.stringify({ none, web: "error" in web, ok, kept, bad: "error" in bad, after, weekly, week, badweek: "error" in badweek }));
process.exit(0);
`;

test("a device's status is kept and told in the state; only a device's, its fields checked", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/status.ts", STATUS);
  const proc = Bun.spawn([process.execPath, dir + "/status.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const mac = { device: "mac", dir: "uniichat", branch: "main", spend: 0.25, stale: false };
  expect(out).toEqual({ none: null, web: true, ok: {}, kept: mac, bad: true, after: mac, weekly: {}, week: 12.5, badweek: true });
});

// A device's inbox (Device.device_inbox): only a device's, checked
// (Inbox.inbox_check), kept and told every view; a view's "fetch" asks
// every socket (the devices) to read it anew; with no device up, it says so
const INBOX = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set() } });
const inbox = { at: 1, login: "me", reviews: [], mine: [], merged: 2, today: 0, tickets: null, clean: [], notes: [], errors: [] };
const web = await Chat.act(chat, "i0", { $: "inbox", inbox }, "");
const ok = await Chat.act(chat, "i1", { $: "inbox", inbox: { ...inbox, extra: 1 } }, "mac");
const bad = await Chat.act(chat, "i2", { $: "inbox", inbox: { ...inbox, merged: "many" } }, "mac");
const none = await Chat.act(chat, "i3", { $: "fetch" }, "");
chat.tools.devices.set("mac", { terms: new Set(["t1"]), jobs: new Map() });
const fetch = await Chat.act(chat, "i4", { $: "fetch" }, "");
console.log(JSON.stringify({ web: "error" in web, ok, bad: "error" in bad, none: none.error ?? null, fetch, kept: chat.inbox, sent: sent.filter((m) => m.$ === "inbox" || m.$ === "fetch") }));
process.exit(0);
`;

test("a device's inbox is checked, kept and told every view; a view's fetch asks the devices", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/inbox.ts", INBOX);
  const proc = Bun.spawn([process.execPath, dir + "/inbox.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const kept = { at: 1, login: "me", reviews: [], mine: [], merged: 2, today: 0, tickets: null, clean: [], notes: [], errors: [], digest: null, spaces: [], google: null };
  expect(out.none).toMatch(/legion device/);
  delete out.none;
  expect(out).toEqual({ web: true, ok: {}, bad: true, fetch: {}, kept, sent: [{ $: "inbox", inbox: kept }, { $: "fetch" }] });
});

// the files pane and git tab (K4): a view's look, checked, goes to the
// devices with its act's id; a device's answer (only a device's, once per
// id, shape checked) goes to the views; no device up: it says so
const LOOK = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set() } });
const none = await Chat.act(chat, "l0", { $: "look", what: { kind: "file", path: "a.ts" } }, "");
chat.tools.devices.set("mac", { terms: new Set(["t1"]), jobs: new Map() });
const bad = [
  await Chat.act(chat, "l1", { $: "look", what: { kind: "rm", path: "a" } }, ""),
  await Chat.act(chat, "l2", { $: "look", what: { kind: "file", path: "x".repeat(2000) } }, ""),
  await Chat.act(chat, "l3", { $: "look", what: { kind: "git", repo: "/r", op: "log", rev: 5 } }, ""),
].map((a) => "error" in a);
const ok = await Chat.act(chat, "l4", { $: "look", what: { kind: "git", repo: "/r", op: "log", extra: 1 } }, "");
const forged = await Chat.act(chat, "l5", { $: "looked", id: "l4", kind: "git", text: "fake" }, "");
const shown = await Chat.act(chat, "l6", { $: "looked", id: "l4", kind: "git", path: "/r", op: "log", text: "abc first" }, "mac");
const twice = await Chat.act(chat, "l7", { $: "looked", id: "l4", kind: "git", text: "again" }, "mac");
const unasked = await Chat.act(chat, "l8", { $: "looked", id: "zz", kind: "file", text: "x" }, "mac");
const before = sent.length;
// the explorer: a folder to every device as a look; a file opened in an
// editor by ONE device only (each would open a window); answers as looks'
const links = [];
chat.tools.devices.set("mac", { terms: new Map([["t1", { send: (m) => links.push(["t1", m]) }], ["t2", { send: (m) => links.push(["t2", m]) }]]), jobs: new Map() });
await Chat.act(chat, "l9", { $: "look", what: { kind: "dir", path: "/r", x: 1 } }, "");
await Chat.act(chat, "l10", { $: "look", what: { kind: "open", path: "/r/.env" } }, "");
const opened = await Chat.act(chat, "l11", { $: "looked", id: "l10", kind: "open", path: "/r/.env", text: "Opened .env in VS Code." }, "mac");
// two devices asked: one's refusal waits for the other's answer; both
// refusing: the last refusal is told (user's report 2026-11-13: an old
// terminal's refusal hid the device's file)
const mark = sent.length;
await Chat.act(chat, "l12", { $: "look", what: { kind: "file", path: "/r/a.ts" } }, "");
await Chat.act(chat, "l13", { $: "looked", id: "l12", kind: "file", error: "not under" }, "mac");
await Chat.act(chat, "l14", { $: "looked", id: "l12", kind: "file", path: "/r/a.ts", text: "a" }, "mac");
await Chat.act(chat, "l15", { $: "look", what: { kind: "file", path: "/r/b.ts" } }, "");
await Chat.act(chat, "l16", { $: "looked", id: "l15", kind: "file", error: "one" }, "mac");
await Chat.act(chat, "l17", { $: "looked", id: "l15", kind: "file", error: "two" }, "mac");
const either = sent.slice(mark).filter((m) => m.$ === "looked");
// find and search to every device; a save (RED ZONE) to one, and only a
// view's (a device's own ask refused), its text and base shape checked
const opens = links.splice(0);
const quick = sent.length;
await Chat.act(chat, "l18", { $: "look", what: { kind: "grep", path: "/r", q: "needle", x: 1 } }, "");
const saves = [
  await Chat.act(chat, "l19", { $: "look", what: { kind: "save", path: "/r/a.ts", text: "x", base: "a".repeat(64) } }, "mac"),
  await Chat.act(chat, "l20", { $: "look", what: { kind: "save", path: "/r/a.ts", text: "x", base: "short" } }, ""),
  await Chat.act(chat, "l21", { $: "look", what: { kind: "save", path: "/r/a.ts", text: 7, base: "a".repeat(64) } }, ""),
].map((a) => "error" in a);
const saved = await Chat.act(chat, "l22", { $: "look", what: { kind: "save", path: "/r/a.ts", text: "two", base: "a".repeat(64) } }, "");
const found = sent.slice(quick).filter((m) => m.$ === "look");
console.log(JSON.stringify({ none: none.error ?? null, bad, ok, forged: "error" in forged, shown, twice: "error" in twice, unasked: "error" in unasked, sent: sent.slice(0, before).filter((m) => m.$ === "look" || m.$ === "looked"), later: sent.slice(before, mark).filter((m) => m.$ === "look" || m.$ === "looked"), links, opens, opened, either, saves, saved, found }));
process.exit(0);
`;

test("a view's look goes to the devices; a device's answer, once, to the views", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/look.ts", LOOK);
  const proc = Bun.spawn([process.execPath, dir + "/look.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.none).toMatch(/legion device/);
  expect(out).toMatchObject({
    bad: [true, true, true], ok: {}, forged: true, shown: {}, twice: true, unasked: true,
    sent: [{ $: "look", id: "l4", what: { kind: "git", repo: "/r", op: "log" } }, { $: "looked", id: "l4", kind: "git", path: "/r", op: "log", text: "abc first" }],
  });
  expect(out.later).toEqual([{ $: "look", id: "l9", what: { kind: "dir", path: "/r" } }, { $: "looked", id: "l10", kind: "open", path: "/r/.env", text: "Opened .env in VS Code." }]);
  expect(out.opened).toEqual({});
  expect(out.opens).toEqual([["t1", { $: "look", id: "l10", what: { kind: "open", path: "/r/.env" } }]]);
  expect(out.saves).toEqual([true, true, true]);
  expect(out.saved).toEqual({});
  expect(out.found).toEqual([{ $: "look", id: "l18", what: { kind: "grep", path: "/r", q: "needle" } }]);
  expect(out.links).toEqual([["t1", { $: "look", id: "l22", what: { kind: "save", path: "/r/a.ts", text: "two", base: "a".repeat(64) } }]]);
  expect(out.either).toEqual([{ $: "looked", id: "l12", kind: "file", path: "/r/a.ts", text: "a" }, { $: "looked", id: "l15", kind: "file", error: "two" }]);
});

// the Crew view's Undo last turn and Open in Claude Code: the user's act
// goes to ONE terminal of the agent's device (each would undo again, or
// open a window); an agent at work isn't undone; a device's answer (only a
// device's, once) becomes a note in the chat
const CREW_OPS = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const links = [];
const agent = (name, more) => ({ name, parent: "main", role: { $: "sub", tier: "worker", effort: null, model: null }, call: null, live: [], calls: {}, stop: false, replies: ["done it"], user: false, ...more });
chat.tools.agents.set("Owl", agent("Owl", { device: "box", title: "Fix $(it)" }));
chat.tools.agents.set("Busy", agent("Busy", { device: "box", runs: true }));
chat.tools.agents.set("Far", agent("Far", { device: "gone" }));
const none = await Chat.act(chat, "c0", { $: "undo", name: "Nobody" }, "");
chat.tools.devices.set("mac", { terms: new Map([["m1", { send: (m) => links.push(["m1", m]) }]]), jobs: new Map() });
chat.tools.devices.set("box", { terms: new Map([["b1", { send: (m) => links.push(["b1", m]) }], ["b2", { send: (m) => links.push(["b2", m]) }]]), jobs: new Map() });
const busy = await Chat.act(chat, "c1", { $: "undo", name: "Busy" }, "");
const far = await Chat.act(chat, "c2", { $: "undo", name: "Far" }, "");
const undo = await Chat.act(chat, "c3", { $: "undo", name: "Owl" }, "");
const hand = await Chat.act(chat, "c4", { $: "handoff", name: "Owl" }, "");
const forged = await Chat.act(chat, "c5", { $: "did", id: "c3", text: "fake" }, "");
const did = await Chat.act(chat, "c6", { $: "did", id: "c3", text: "Undid Owl's last turn." }, "box");
const twice = await Chat.act(chat, "c7", { $: "did", id: "c3", text: "again" }, "box");
const by_device = await Chat.act(chat, "c8", { $: "undo", name: "Owl" }, "box");
const hand_by_device = await Chat.act(chat, "c9", { $: "handoff", name: "Owl" }, "box");
await new Promise((r) => setTimeout(r, 100));
const resent = await Chat.apply(chat, { $: "undo", id: "c3", name: "Owl" }, "");
console.log(JSON.stringify({ none: none.error ?? null, busy: busy.error ?? null, far: far.error ?? null, undo, hand, forged: "error" in forged, did, twice: "error" in twice, by_device: by_device.error ?? null, hand_by_device: hand_by_device.error ?? null, resent, links }));
process.exit(0);
`;

test("Undo and Open in Claude Code go to one terminal of the agent's device; its answer, once, is a note", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/crew.ts", CREW_OPS);
  const proc = Bun.spawn([process.execPath, dir + "/crew.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.none).toMatch(/No agent/);
  expect(out.busy).toMatch(/at work/);
  expect(out.far).toMatch(/gone/);
  expect(out).toMatchObject({ undo: {}, hand: {}, forged: true, did: {}, twice: true, resent: {} });
  // a device's socket is within an agent's reach: the user's acts only
  expect(out.by_device).toMatch(/web/);
  expect(out.hand_by_device).toMatch(/web/);
  // an undo resent (its answer lost) is recorded: not sent to the device again
  expect(out.links.map(([t, m]: any) => [t, m.$, m.id, m.agent])).toEqual([["b1", "undo", "c3", "Owl"], ["b1", "handoff", "c4", "Owl"]]);
  expect(out.links[1][1].brief).toContain("Title: Fix $(it)");
  const log = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(dir + "/" + f).isFile()).map((f) => fs.readFileSync(dir + "/" + f, "utf8")).join("\n");
  expect(log).toContain("Undid Owl's last turn.");
});

// the timesheet's Submit (K5, RED ZONE): the user's act sends the drafts
// asked (only those not sent nor sending) to ONE device's terminal, never
// to every socket (each would post them: billed twice); a device's answer
// (only a device's, for that submit, once) marks each sent or failed;
// drop removes an unsent draft only
const HARVEST = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const views = [], one = [], two = [];
chat.socks.add({ send: (s) => views.push(JSON.parse(s)), data: { watch: new Set(), seen: new Set() } });
const d = (n, state) => ({ n, project_id: 7, task_id: 70, project: "P", task: "T", date: "2026-11-12", hours: 1, notes: "x", why: "w", by: "main", state });
chat.mem.drafts = [d(1, "draft"), d(2, "draft"), d(3, "sent"), d(4, "failed")];
const none = await Chat.act(chat, "h0", { $: "timesheet", op: "submit", ns: [1] }, "");
chat.tools.devices.set("mac", { terms: new Map([["t1", { send: (m) => one.push(m) }], ["t2", { send: (m) => two.push(m) }]]), jobs: new Map() });
const bad = await Chat.act(chat, "h1", { $: "timesheet", op: "submit", ns: [3] }, "");
const ok = await Chat.act(chat, "h2", { $: "timesheet", op: "submit", ns: [1, 3, 4, 99] }, "");
const again = await Chat.act(chat, "h3", { $: "timesheet", op: "submit", ns: [1] }, "");
const states = chat.mem.drafts.map((x) => x.state);
const forged = await Chat.act(chat, "h4", { $: "harvested", id: "h2", results: [{ n: 1, id: 5 }] }, "");
const done = await Chat.act(chat, "h5", { $: "harvested", id: "h2", results: [{ n: 1, id: 555 }, { n: 4, error: "Harvest: HTTP 422." }, { n: 2, id: 9 }] }, "mac");
const twice = await Chat.act(chat, "h6", { $: "harvested", id: "h2", results: [{ n: 1, id: 6 }] }, "mac");
const dropped = await Chat.act(chat, "h7", { $: "timesheet", op: "drop", ns: [2, 1] }, "");
console.log(JSON.stringify({ none: none.error ?? null, bad: bad.error ?? null, ok, again: again.error ?? null, states, forged: "error" in forged, done, twice: "error" in twice, dropped,
  after: chat.mem.drafts.map((x) => [x.n, x.state, x.harvest ?? null, x.error ?? null]), one, two, toViews: views.some((m) => m.$ === "harvest"), shown: Chat.state(chat).drafts.length }));
process.exit(0);
`;

test("timesheet: Submit sends the user's drafts to one device; its answer marks them; drop removes unsent ones", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/harvest.ts", HARVEST);
  const proc = Bun.spawn([process.execPath, dir + "/harvest.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.none).toMatch(/legion device/);
  expect(out.bad).toMatch(/No draft/);
  expect(out.again).toMatch(/No draft/);
  const entry = { project_id: 7, task_id: 70, date: "2026-11-12", hours: 1, notes: "x" };
  expect(out).toMatchObject({
    ok: {}, states: ["sending", "draft", "sent", "sending"], forged: true, done: {}, twice: true, dropped: {},
    after: [[1, "sent", 555, null], [3, "sent", null, null], [4, "failed", null, "Harvest: HTTP 422."]],
    one: [{ $: "harvest", id: "h2", entries: [{ n: 1, ...entry }, { n: 4, ...entry }] }], two: [], toViews: false, shown: 3,
  });
});

// PRs of the inbox reviewed or fixed (the cockpit's Review / Fix): a native
// Legion worker each, labelled by its PR and repo, started by the user (its
// report takes no turn); with claude, a manager told to run a Claude Code
// worker; only PRs the inbox holds, at most Chat.REVIEWS at once
const REVIEW = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
const asked = [];
const start = Tools.start;
Tools.start = (...args) => { asked.push(args[3] + " | user: " + args[4]); return start(...args); };
const pr = (n, state) => ({ repo: "o/r", number: n, title: "T" + n, url: "https://github.com/o/r/pull/" + n, author: "ann", bot: false, updated: "", add: 1, del: 0, files: 1, branch: "b" + n, state, failing: state === "failing" ? ["ruff"] : [], body: "", you: true });
await Chat.act(chat, "i0", { $: "inbox", inbox: { at: 1, login: "me", reviews: [pr(5, "ready")], mine: [pr(6, "failing")], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [] } }, "mac");
const unknown = await Chat.act(chat, "r0", { $: "review", prs: ["https://github.com/o/r/pull/99"], how: "review", claude: false }, "");
const odd = await Chat.act(chat, "r1", { $: "review", prs: ["https://github.com/o/r/pull/5"], how: "merge", claude: false }, "");
const many = await Chat.act(chat, "r2", { $: "review", prs: Array.from({ length: 11 }, () => "https://github.com/o/r/pull/5"), how: "review", claude: false }, "");
const review = await Chat.act(chat, "r3", { $: "review", prs: ["https://github.com/o/r/pull/5"], how: "review", claude: false }, "");
const fix = await Chat.act(chat, "r4", { $: "review", prs: ["https://github.com/o/r/pull/6"], how: "fix", claude: true }, "");
const crew = Chat.state(chat).crew.map((c) => ({ tier: c.tier, parent: c.parent, title: c.title, repos: c.repos }));
console.log(JSON.stringify({ unknown: "error" in unknown, odd: "error" in odd, many: "error" in many, review, fix, crew, asked }));
process.exit(0);
`;

test("inbox PRs reviewed or fixed: a native worker each (a manager with a Claude Code worker if asked); only the inbox's", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/review.ts", REVIEW);
  const proc = Bun.spawn([process.execPath, dir + "/review.ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toMatchObject({ unknown: true, odd: true, many: true, review: {}, fix: {} });
  expect(out.crew).toEqual([
    { tier: "worker", parent: "main", title: "review o/r#5", repos: ["r"] },
    { tier: "manager", parent: "main", title: "fix o/r#6", repos: ["r"] },
  ]);
  expect(out.asked.length).toBe(2);
  expect(out.asked[0]).toContain("Review o/r#5 \"T5\" (https://github.com/o/r/pull/5)");
  expect(out.asked[0]).toContain("Post nothing to GitHub");
  expect(out.asked[0]).toContain("run its tests"); // the user started it, watching
  expect(out.asked[1]).toContain("failing checks: ruff");
  expect(out.asked[1]).toContain("spawn as: \"claude\"");
  expect(out.asked[1]).toContain("Don't push");
  expect(out.asked.every((t: string) => t.endsWith(" | user: true"))).toBe(true); // the user's: its report takes no turn
});

// Routines (Routines.ts): added, checked, at most Routines.MOST; run now,
// turned off, dropped; the tick starts those due once; a review routine
// starts a review for each new review request of the user's (the first
// inbox seen only seeds it); kept with the chat
const ROUTINE = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
const started = [];
const start = Tools.start;
Tools.start = (...args) => { started.push({ tier: args[2].tier, task: args[3], user: args[4], title: args[5]?.title, plan: args[6] === true }); return start(...args); };
const add = (r) => Chat.act(chat, "a" + Math.random(), { $: "routine", op: "add", routine: r }, "");
const ok = await add({ name: "Sweep", task: "clean the worktrees", when: { $: "every", hours: 1 }, tier: "worker" });
const bad = await add({ name: "", task: "x", when: { $: "every", hours: 1 } });
const listed = Chat.state(chat).routines.map((r) => ({ id: r.id, name: r.name, on: r.on }));
const run = await Chat.act(chat, "r1", { $: "routine", op: "run", n: 1 }, "");
const ran = started.length;
const early = Chat.ticked(chat, Date.now() + 30 * 60e3);
const due = Chat.ticked(chat, Date.now() + 61 * 60e3);
const again = Chat.ticked(chat, Date.now() + 62 * 60e3);
const off = await Chat.act(chat, "r2", { $: "routine", op: "toggle", n: 1, on: false }, "");
const offdue = Chat.ticked(chat, Date.now() + 9 * 3600e3);
const unknown = await Chat.act(chat, "r3", { $: "routine", op: "run", n: 9 }, "");
await add({ name: "Reviews", task: "", when: { $: "review" } });
const pr = (n, you) => ({ repo: "o/r", number: n, title: "T" + n, url: "https://github.com/o/r/pull/" + n, author: "ann", bot: false, updated: "", add: 1, del: 0, files: 1, branch: "b", state: "ready", failing: [], body: "", you });
const inbox = (reviews) => ({ at: 1, login: "me", reviews, mine: [], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [] });
const before = started.length;
await Chat.act(chat, "i1", { $: "inbox", inbox: inbox([pr(1, true)]) }, "mac");
const seeded = started.length - before;
await Chat.act(chat, "i2", { $: "inbox", inbox: inbox([pr(1, true), pr(2, true), pr(3, false)]) }, "mac");
const reviewed = started.slice(before);
const drop = await Chat.act(chat, "r4", { $: "routine", op: "drop", n: 1 }, "");
for (let k = 0; k < 19; k++) await add({ name: "R" + k, task: "t", when: { $: "every", hours: 5 } });
const full = await add({ name: "one too many", task: "t", when: { $: "every", hours: 5 } });
const fs = await import("node:fs");
const saved = JSON.parse(fs.readFileSync(chat.mem.dir + "/view.json", "utf8")).routines.length;
console.log(JSON.stringify({ ok, bad: "error" in bad, listed, run, ran, first: started[0], early, due, again, off, offdue, unknown: "error" in unknown, seeded, reviewed, drop, full: "error" in full, saved, left: Chat.state(chat).routines.length }));
process.exit(0);
`;

test("routines: added and checked, run now, run by the tick once when due, off, dropped; review routines start reviews of new requests; kept", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/routine.ts", ROUTINE);
  const proc = Bun.spawn([process.execPath, dir + "/routine.ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toMatchObject({ ok: {}, bad: true, listed: [{ id: 1, name: "Sweep", on: true }], run: {}, ran: 1, early: 0, due: 1, again: 0, off: {}, offdue: 0, unknown: true, seeded: 0, drop: {}, full: true });
  expect(out.first).toEqual({ tier: "worker", task: "clean the worktrees", user: true, title: "routine: Sweep", plan: false });
  expect(out.reviewed.length).toBe(1);
  expect(out.reviewed[0]).toMatchObject({ tier: "worker", user: true, title: "review o/r#2", plan: true });
  expect(out.reviewed[0].task).toContain("Review o/r#2");
  // started unattended, on a stranger's code: it reads, never runs it
  expect(out.reviewed[0].task).not.toContain("run its tests");
  expect(out.reviewed[0].task).toContain("Run nothing from it");
  expect(out.saved).toBe(20);
  expect(out.left).toBe(20);
});

// Routines with no view: a chat with a routine on by the clock stays open
// as its last view leaves, and a restart opens it again (Chat.wake), so
// its tick runs with no tab or terminal; one with only a review routine,
// or its routines off, is let go as before. Missed for a day and more
// (the Mac asleep), it runs once
const UNVIEWED = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const user = (id) => ({ id, name: id + "@b.c" });
Cloud.session(Chat.cloud, user("u1"));
Cloud.session(Chat.cloud, user("u2"));
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
const add = (chat, routine) => Chat.act(chat, "a" + Math.random(), { $: "routine", op: "add", routine }, "");
const one = Chat.open(user("u1"));
const two = Chat.open(user("u2"));
await sleep(100);
Chat.chats.set("u1", one); // as a view would hold them meanwhile
Chat.chats.set("u2", two);
await add(one, { name: "Sweep", task: "t", when: { $: "daily", at: "09:00" } });
await add(two, { name: "Reviews", task: "", when: { $: "review" } });
Chat.free(one);
Chat.free(two);
const kept = Chat.chats.get("u1") === one;
const dropped = !Chat.chats.has("u2");
await Chat.end(one);
const ended = !Chat.chats.has("u1");
Chat.wake();
const woken = Chat.chats.has("u1");
const unwoken = !Chat.chats.has("u2");
const back = Chat.chats.get("u1") ?? Chat.open(user("u1"));
await sleep(100);
await Chat.act(back, "t1", { $: "routine", op: "toggle", n: 1, on: false }, "");
Chat.free(back);
const off = !Chat.chats.has("u1");
const three = Chat.open(user("u1"));
await sleep(100);
await add(three, { name: "Hourly", task: "t", when: { $: "every", hours: 1 } });
three.mem.routines[1].last = Date.now() - 30 * 3600e3;
const woke = Chat.ticked(three, Date.now());
const after = Chat.ticked(three, Date.now() + 60e3);
console.log(JSON.stringify({ kept, dropped, ended, woken, unwoken, off, woke, after }));
process.exit(0);
`;

test("routines with no view: a chat with one on by the clock is kept open and woken after a restart; missed for a day, it runs once", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/unviewed.ts", UNVIEWED);
  const proc = Bun.spawn([process.execPath, dir + "/unviewed.ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ kept: true, dropped: true, ended: true, woken: true, unwoken: true, off: true, woke: 1, after: 0 });
});

// The digest's themes (the cockpit's Summarize by theme): one compactor
// call over the merged PRs, its JSON kept only for the digest's authors,
// lines capped and cut; asked again only when the digest changed; told
// every view; none to summarize, or a reply not JSON, refused
const THEMES = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set() } });
const asks = [];
let reply = JSON.stringify({ ann: ["Login fixes (#1, #2)", "x".repeat(900)], mallory: ["not in the digest"] });
AskAI.ask = (ask) => { asks.push(ask.blocks.map((b) => b.text).join("")); return { send() {}, stop() {}, done: Promise.resolve({ ok: true, text: "Here: " + reply, left: [] }) }; };
const none = await Chat.act(chat, "t0", { $: "themes" }, "");
const pr = (n) => ({ repo: "o/r", number: n, title: "T" + n, url: "https://github.com/o/r/pull/" + n, author: "ann", at: "" });
const inbox = (merged) => ({ at: 1, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [], digest: { repos: ["o/r"], merged, open: [] } });
await Chat.act(chat, "i1", { $: "inbox", inbox: inbox([pr(1), pr(2)]) }, "mac");
const ok = await Chat.act(chat, "t1", { $: "themes" }, "");
const cached = await Chat.act(chat, "t2", { $: "themes" }, "");
reply = "no json here";
await Chat.act(chat, "i2", { $: "inbox", inbox: inbox([pr(1), pr(2), pr(3)]) }, "mac");
const bad = await Chat.act(chat, "t3", { $: "themes" }, "");
console.log(JSON.stringify({ none: "error" in none, ok, cached, bad: "error" in bad, asks, themes: sent.filter((m) => m.$ === "themes").map((m) => m.themes.by) }));
process.exit(0);
`;

test("the digest's themes: one compactor call, its JSON checked, asked again only for a new digest", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/themes.ts", THEMES);
  const proc = Bun.spawn([process.execPath, dir + "/themes.ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toMatchObject({ none: true, ok: {}, cached: {}, bad: true });
  expect(out.asks.length).toBe(2);
  expect(out.asks[0]).toContain("ann: #1 T1 (o/r)");
  expect(out.themes.length).toBe(1);
  expect(Object.keys(out.themes[0])).toEqual(["ann"]);
  expect(out.themes[0].ann[0]).toBe("Login fixes (#1, #2)");
  expect(out.themes[0].ann[1].length).toBe(200);
});

// A meeting transcript summarized (RED ZONE draft, Google.ts): the user
// asks for a Doc the inbox lists; the devices are asked to read it; only
// an asked-for Doc's text is taken, from a device; the compactor
// summarizes it; the summary (not the text) kept and told; a device's
// failure said; asked again: the summary kept
const TRANSCRIPT = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set(), seen: new Set() } });
const asks = [];
const notes = [];
const note = Chat.note;
Chat.note = (c, t) => { notes.push(t); return note(c, t); };
AskAI.ask = (ask) => { asks.push(ask.blocks.map((b) => b.text).join("")); return { send() {}, stop() {}, done: Promise.resolve({ ok: true, text: "## Overview\\nThey decided.", left: [] }) }; };
const doc = { id: "doc_1234567890", title: "Standup - Transcript", at: "", url: "https://docs.google.com/document/d/doc_1234567890" };
const inbox = { at: 1, login: "me", reviews: [], mine: [], merged: 0, today: 0, tickets: null, clean: [], notes: [], errors: [], google: { events: [], docs: [doc] } };
await Chat.act(chat, "i", { $: "inbox", inbox }, "mac");
const unknown = await Chat.act(chat, "t0", { $: "transcript", id: "doc_other12345" }, "");
const unasked = await Chat.act(chat, "t1", { $: "transcript", id: doc.id, text: "words" }, "mac");
const ask = await Chat.act(chat, "t2", { $: "transcript", id: doc.id }, "");
const read = sent.filter((m) => m.$ === "read");
const viewtext = await Chat.act(chat, "t3", { $: "transcript", id: doc.id, text: "a view's words" }, "");
const reply = await Chat.act(chat, "t4", { $: "transcript", id: doc.id, text: "Ann: we ship Friday." }, "mac");
await Bun.sleep(20);
const summary = sent.filter((m) => m.$ === "summary");
const again = await Chat.act(chat, "t5", { $: "transcript", id: doc.id }, "");
const reads = sent.filter((m) => m.$ === "read").length;
const fs = await import("node:fs");
const saved = JSON.parse(fs.readFileSync(chat.mem.dir + "/view.json", "utf8")).summaries;
await Chat.act(chat, "i2", { $: "inbox", inbox: { ...inbox, google: { events: [], docs: [doc, { ...doc, id: "doc_0987654321" }] } } }, "mac");
await Chat.act(chat, "t6", { $: "transcript", id: "doc_0987654321" }, "");
const failed = await Chat.act(chat, "t7", { $: "transcript", id: "doc_0987654321", error: "Google: HTTP 403." }, "mac");
console.log(JSON.stringify({ unknown: "error" in unknown, unasked: "error" in unasked, ask, read, viewtext: "error" in viewtext, reply, summary, again, asks, saved, failed, reads, notes, stored: JSON.stringify(saved).includes("we ship Friday") }));
process.exit(0);
`;

test("a transcript summarized: only a listed Doc, read by a device when asked, summarized, the summary kept (not the text)", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/transcript.ts", TRANSCRIPT);
  const proc = Bun.spawn([process.execPath, dir + "/transcript.ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toMatchObject({ unknown: true, unasked: true, ask: {}, read: [{ $: "read", id: "doc_1234567890" }], viewtext: true, reply: {}, again: {}, stored: false });
  expect(out.asks.length).toBe(1);
  expect(out.asks[0]).toContain("Ann: we ship Friday.");
  expect(out.summary).toEqual([{ $: "summary", id: "doc_1234567890", summary: { title: "Standup - Transcript", text: "## Overview\nThey decided.", at: expect.any(Number) } }]);
  expect(out.saved.doc_1234567890.text).toBe("## Overview\nThey decided.");
  expect(out.failed).toEqual({});
  expect(out.reads).toBe(1); // summarized: asked again, not read again
  expect(out.notes.some((n: string) => n.includes("Google: HTTP 403."))).toBe(true);
});

// A call waiting for the user (auto's reviewer couldn't check it): in the
// state; the user's yes or no answers it; an unknown one is refused
const CONSENT = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const asked = Tools.ask_user(chat.tools, "Wkr", "shell", { device: "mac", command: "make deploy" }, new AbortController().signal);
const listed = Chat.state(chat).calls;
const unknown = await Chat.act(chat, "c0", { $: "consent", n: 9, yes: true }, "");
const yes = await Chat.act(chat, "c1", { $: "consent", n: listed[0].id, yes: true }, "");
console.log(JSON.stringify({ listed, unknown, yes, answered: await asked, after: Chat.state(chat).calls }));
process.exit(0);
`;

test("a call waiting for the user is in the state; their yes answers it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/consent.ts", CONSENT);
  const proc = Bun.spawn([process.execPath, dir + "/consent.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    listed: [{ id: 1, who: "Wkr", tool: "shell", what: "make deploy (on mac)" }], unknown: { error: "No call 9 waits for you." }, yes: {}, answered: true, after: [],
  });
});

// The modes: the user switches the mode (a note, no turn); a plan filed
// in plan mode is in the state; approved, the mode becomes the one picked
// and the orchestrator is told (a turn); rejected, it stays plan mode and
// the orchestrator gets the feedback (a turn); no plan: refused
const MODE = `
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
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push(sink);
  call.send = () => {};
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 200 && !f(); k++) await Bun.sleep(10);
  return f();
};
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
// the switch on a chat of its own (its note would hold this one's turns
// for summaries this test never builds)
const other = Chat.open({ id: "u2", name: "c@d.e" });
Chat.chats.set("u2", other);
const first = Chat.state(other).mode;
const bad = await Chat.act(other, "m0", { $: "mode", mode: "nope" }, "");
const none = await Chat.act(other, "p0", { $: "plan", yes: true }, "");
await Chat.act(other, "m1", { $: "mode", mode: "plan" }, "");
const last = Memory.message(other.mem, other.mem.count - 1);
const switched = [Chat.state(other).mode, asks.length, last.kind, last.text];
chat.mem.mode = "plan";
await Tools.call(chat.tools, "main", "plan", { plan: "1. fix it" }, new AbortController().signal, "t");
const shown = Chat.state(chat).plan?.text;
await Chat.act(chat, "p1", { $: "plan", yes: false, text: "test first" }, "");
await until(() => asks.length === 1);
const rejected = [Chat.state(chat).mode, Chat.state(chat).plan, msgs().filter((m) => m.kind === "user").at(-1).text];
asks[0].end({ ok: true, text: "ok", left: [] });
await until(() => !chat.busy);
await Tools.call(chat.tools, "main", "plan", { plan: "1. test\\n2. fix" }, new AbortController().signal, "t2");
await Chat.act(chat, "p2", { $: "plan", yes: true, mode: "full" }, "");
await until(() => asks.length === 2);
const approved = [Chat.state(chat).mode, Chat.state(chat).plan, msgs().filter((m) => m.kind === "user").at(-1).text];
asks.at(-1)?.end({ ok: true, text: "ok", left: [] });
await until(() => !chat.busy);
chat.mem.mode = "plan";
await Tools.call(chat.tools, "main", "plan", { plan: "1. ship" }, new AbortController().signal, "t3");
await Chat.act(chat, "p3", { $: "plan", yes: true }, "");
const plain = Chat.state(chat).mode;
console.log(JSON.stringify({ first, bad: "error" in bad, none, switched, shown, rejected, approved, plain }));
process.exit(0);
`;

test("the user switches the mode, and approves or rejects the orchestrator's plan", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/mode.ts", MODE);
  const proc = Bun.spawn([process.execPath, dir + "/mode.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    first: "super", bad: true, none: { error: "No plan is waiting for approval." },
    switched: ["plan", 0, "note", "The user switched to plan mode: agents only read, until you approve a plan."],
    shown: "1. fix it",
    rejected: ["plan", null, "The user didn't approve your plan: test first\nStill in plan mode: revise it and file it again with plan."],
    approved: ["full", null, "The user approved your plan; now in full mode: every call runs (hooks only). Go ahead with it."],
    plain: "super",
  });
});

// RED ZONE (R3, signed off by the user 2026-11-19): the user's say over
// what agents may do (the mode, the plan, a waiting call, a worker's
// start, a question's answer) is a view's act only: one from a device's
// socket (within an agent's reach) is refused, nothing changed
const VIEW_ONLY = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const go = new AbortController().signal;
chat.mem.mode = "plan";
await Tools.call(chat.tools, "main", "plan", { plan: "1. ship" }, go, "t1");
await Tools.call(chat.tools, "main", "ask", { question: "Ship on Friday?" }, go, "q1");
Tools.ask_user(chat.tools, "Wkr", "shell", { device: "mac", command: "make deploy" }, go);
const call = Chat.state(chat).calls[0].id;
const acts = [
  { $: "mode", mode: "full" },
  { $: "plan", yes: true, mode: "full" },
  { $: "consent", n: call, yes: true },
  { $: "approve", name: "Wkr", yes: true },
  { $: "answer", q: 1, text: "yes" },
];
const refused = [];
for (const [k, msg] of acts.entries()) {
  refused.push((await Chat.act(chat, "d" + k, msg, "mac")).error ?? null);
}
const s = Chat.state(chat);
console.log(JSON.stringify({ refused, mode: s.mode, plan: s.plan?.text ?? null, calls: s.calls.length, questions: s.questions.length }));
process.exit(0);
`;

test("the mode, the plan, a call's or a worker's yes, an answer: a view's acts only, refused from a device", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/views.ts", VIEW_ONLY);
  const proc = Bun.spawn([process.execPath, dir + "/views.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.refused).toHaveLength(5);
  for (const why of out.refused) {
    expect(why).toMatch(/in a view/);
  }
  expect(out).toMatchObject({ mode: "plan", plan: "1. ship", calls: 1, questions: 1 });
});

// RED ZONE (K1, DRAFT awaiting the user's sign-off): a socket on the
// terminal's terminal key (Keychain, every read asked; Cloud.speaks)
// speaks for the user: every act a device's socket is refused is done
// from it; the same device's socket on its device key stays refused
const TERMINAL_KEY = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
AskAI.ask = (ask, on) => {
  const [call] = AskAI.tie(on, ask.bill, () => {}, () => {});
  call.send = () => {};
  return call;
};
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const go = new AbortController().signal;
chat.mem.mode = "plan";
await Tools.call(chat.tools, "main", "plan", { plan: "1. ship" }, go, "t1");
await Tools.call(chat.tools, "main", "ask", { question: "Ship on Friday?" }, go, "q1");
await Tools.call(chat.tools, "main", "assign", { text: "Approve PR #9" }, go, "a1");
await Tools.call(chat.tools, "main", "timer", { minutes: 30, note: "check CI" }, go, "x1");
Tools.ask_user(chat.tools, "Wkr", "shell", { device: "mac", command: "make deploy" }, go);
const call = Chat.state(chat).calls[0].id;
const timer = chat.mem.timers.at(-1).id;
const todo = chat.mem.assigned.at(-1).n;
const acts = [
  { $: "plan", yes: true, mode: "full" },
  { $: "consent", n: call, yes: true },
  { $: "approve", name: "Wkr", yes: true },
  { $: "answer", q: 1, text: "yes" },
  { $: "mode", mode: "full" },
  { $: "routine", op: "add", routine: { name: "R", task: "t", when: { $: "every", hours: 1 } } },
  { $: "timer", n: timer },
  { $: "assignment", n: todo, done: false },
  { $: "pin", i: 0, on: true },
  { $: "decision", n: 1, undo: false },
  { $: "explain", q: "why?" },
  { $: "look", what: { kind: "save", path: "/r/a.txt", text: "x", base: "0".repeat(64) } },
  { $: "undo", name: "Nobody" },
];
const pairs = [];
for (const [k, msg] of acts.entries()) {
  const dev = (await Chat.act(chat, "d" + k, msg, "mac", false)).error ?? null;
  // (an act at work, as explain's call, is no refusal: refusals answer at once)
  const term = (await Promise.race([Chat.act(chat, "t" + k, msg, "mac", true), Bun.sleep(500).then(() => ({ error: "at work" }))])).error ?? null;
  pairs.push([msg.$, dev, term]);
}
const s = Chat.state(chat);
console.log(JSON.stringify({ pairs, mode: s.mode, plan: s.plan?.text ?? null, calls: s.calls.length, questions: s.questions.filter((q) => !q.fyi).length, timers: chat.mem.timers.length, routines: chat.mem.routines.length, todos: chat.mem.assigned.length }));
process.exit(0);
`;

test("a terminal-key socket speaks for the user: every act refused a device's is done from it; its device key's stays refused", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/term.ts", TERMINAL_KEY);
  const proc = Bun.spawn([process.execPath, dir + "/term.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.pairs).toHaveLength(13);
  for (const [act, dev, term] of out.pairs) {
    expect([act, dev]).toEqual([act, expect.stringMatching(/in a view|the web|Ask to see/)]);
    expect([act, term]).not.toEqual([act, dev]);
    expect([act, term ?? ""]).not.toEqual([act, expect.stringMatching(/in a view|the web|user's say/)]);
  }
  expect(out).toMatchObject({ mode: "full", plan: null, calls: 0, questions: 0, timers: 0, routines: 1, todos: 0 });
});

// The question backlog: the orchestrator's open questions in the state;
// an answer is the user's message quoting the question, and a turn; no
// text dismisses it (a note, no turn); an unknown one is refused
const ANSWER = `
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
await Tools.call(chat.tools, "main", "ask", { question: "Ship on Friday?" }, go, "q1");
await Tools.call(chat.tools, "main", "ask", { question: "Rename the repo?" }, go, "q2");
const listed = Chat.state(chat).questions.map((q) => q.id);
const unknown = await Chat.act(chat, "a0", { $: "answer", q: 9, text: "x" }, "");
const answered = await Chat.act(chat, "a1", { $: "answer", q: 1, text: " Yes, ship it " }, "");
await until(() => asks.length === 1);
const msgs = () => Array.from({ length: chat.mem.count }, (_, i) => Memory.message(chat.mem, i));
const said = msgs().filter((m) => m.kind === "user" && m.text.includes("question")).map((m) => m.text);
const dismissed = await Chat.act(chat, "a2", { $: "answer", q: 2 }, "");
await Tools.call(chat.tools, "main", "notify", { text: "Picked bank-recon." }, go, "n1");
await Chat.act(chat, "a3", { $: "answer", q: 3 }, "");
await Bun.sleep(100);
const notes = msgs().filter((m) => m.kind === "note").map((m) => m.text);
console.log(JSON.stringify({ listed, unknown, answered, said, dismissed, notes, asks: asks.length, left: Chat.state(chat).questions }));
process.exit(0);
`;

test("an answer from the question backlog is a message quoting it, and a turn; no text dismisses it (a note, silently)", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/answer.ts", ANSWER);
  const proc = Bun.spawn([process.execPath, dir + "/answer.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({
    listed: [1, 2], unknown: { error: "No open question 9." }, answered: {},
    said: ["Answer to your question 1 (Ship on Friday?):\nYes, ship it"], dismissed: {},
    notes: ["The user dismissed your question 2 (Rename the repo?)."], asks: 1, left: [],
  });
});

test("!command: the user's own, from a view only, run ungated on the device named; its output a note (capped), no turn", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/bang.ts", BANG);
  const proc = Bun.spawn([process.execPath, dir + "/bang.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const yours = "Only you run a !command: from the web, or legion signed in with its own key (legion login). A device's key is within an agent's reach, so it can't speak for you.";
  expect(out).toEqual({
    none: { error: "No device is open: run legion (or legion device) on one." }, one: {},
    first: { name: "user_shell", input: { command: "ls" }, cwd: "main" }, empty: { error: "No command." },
    device: { error: yours }, posted: { error: yours }, refused: 0, ran: {},
    job: { name: "user_shell", input: { command: "echo hi" }, cwd: "main" },
    note: "The user ran on pc:\n$ echo hi\nhi\n(exit 0 in 0.0 s)", capped: true, agent: true, agented: 0,
    late: "The user ran on mac:\n$ sleep 99\nerror: timed out after 0.05 s: stopped.",
    told: ["Running on mac: $ ls", "Running on pc: $ echo hi"], busy: false,
    several: "Several devices are open (mac, pc): name one, as !@mac <command>.",
    unknown: "No device nas is open: mac, pc.", picked: {}, there: "cd '/r/it'\\''s here' && ls", baddir: true,
    termed: {}, termjob: "echo t",
  });
});

test("shell commands: their last lines told the views; background and stop only the user's, a device key's refused; the user's Stop ends them all", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/shell.ts", SHELL);
  const proc = Bun.spawn([process.execPath, dir + "/shell.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const yours = "Only you send a command to the background or stop it: from the web, or legion signed in with its own key (legion login). A device's key is within an agent's reach, so it can't speak for you.";
  expect(out).toEqual({
    lines: ["compiling"], told: ["compiling"], device: { error: yours }, posted: true, kept: 1,
    bg: { text: "Sent to the background: 1." }, n: 1, sent: { text: "Sent to the background: 2." }, back: true,
    after: 2, stopped: 0, bad: { error: "No such op: bg or stop." },
  });
});

test("an agent's events go only to views on its page; a view's tell and dismiss reach it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/watch.ts", WATCH);
  const proc = Bun.spawn([process.execPath, dir + "/watch.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out).toEqual({ a: [true, true], b: [false, true], told: {}, sent: ["one more thing"], crewed: true, dismissed: {}, after: false });
});

// Every view hears an agent's pulse (Tools.pulse) as it streams, at most
// one an agent a PULSE (a burst of deltas: one); only views watching it
// hear the deltas. A view's watch replaces what it watches: agents known,
// at most WATCH of them
const PULSE = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Tools } = await import(${JSON.stringify(import.meta.dir + "/Tools.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const got = { a: [], b: [] };
const sock = (k) => ({ send: (m) => got[k].push(JSON.parse(m)), data: { seen: new Set(), watch: new Set() } });
const [a, b] = [sock("a"), sock("b")];
chat.socks.add(a);
chat.socks.add(b);
const asks = [];
AskAI.ask = (ask, on) => {
  const [call, sink] = AskAI.tie(on, ask.bill, () => {}, () => {});
  asks.push({ ask, sink });
  return call;
};
const until = async (f) => {
  for (let k = 0; k < 300 && !f(); k++) await Bun.sleep(10);
  return f();
};
const name = Tools.start(chat.tools, "main", { $: "sub", tier: "worker", effort: null, model: null }, "a task");
await until(() => asks.length === 1);
Chat.ask(chat, a, { $: "watch", names: [name, "Nobody", ...Array.from({ length: 40 }, (_, k) => name)] });
const watched = [...a.data.watch];
got.a.length = 0;
got.b.length = 0;
const agent = chat.tools.agents.get(name);
for (let k = 0; k < 20; k++) Chat.on(chat, agent, { $: "Delta", kind: "work", text: k === 19 ? "\\nlast words" : "x" });
const pulses = (k) => got[k].filter((m) => m.$ === "pulse");
await until(() => pulses("b").length > 0);
await Bun.sleep(1200);
const deltas = (k) => got[k].filter((m) => m.$ === "delta").length;
const seen = { watched, pa: pulses("a").length, pb: pulses("b").length, pulse: pulses("b")[0], da: deltas("a"), db: deltas("b") };
Chat.ask(chat, a, { $: "watch", names: [] });
got.a.length = 0;
Chat.on(chat, agent, { $: "Delta", kind: "work", text: "more" });
console.log(JSON.stringify({ ...seen, after: deltas("a") }));
process.exit(0);
`;

test("every view hears an agent's pulse, a burst as one; a view's watch replaces what it watches", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/pulse.ts", PULSE);
  const proc = Bun.spawn([process.execPath, dir + "/pulse.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  expect(out.watched).toHaveLength(1);
  expect(out.pa).toBe(1);
  expect(out.pb).toBe(1);
  expect(out.pulse).toMatchObject({ $: "pulse", status: "working", act: "last words", last: "" });
  expect(out.da).toBe(20);
  expect(out.db).toBe(0);
  expect(out.after).toBe(0);
});

// the wait while a turn waits on summaries is View's SUMMARIES ("summaries"),
// never shadowed (a constant of the same name once made it a number)
test("the summaries wait reads as View's SUMMARIES", async () => {
  const { SUMMARIES } = await import("./View.ts");
  const src = fs.readFileSync(import.meta.dir + "/Server.ts", "utf8");
  expect(SUMMARIES).toBe("summaries");
  expect(src.match(/\bconst SUMMARIES\b/g)).toBe(null);
});

// the gateway's report (Gateway.ts) to every chat's views: its budget,
// read at most every GATEWAY_READ, and only through a gateway; when a
// model last answered busy
const GATEWAY = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Agent } = await import(${JSON.stringify(import.meta.dir + "/Agent.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
const sent = [];
chat.socks.add({ send: (s) => sent.push(JSON.parse(s)), data: { watch: new Set() } });
const reads = [];
const read = async (base, key) => (reads.push(base + " " + (key === "k-test")), { spend: 1, max: 800, reset: null });
Agent.health.busy = 42;
await Chat.gateway(1e9, read);
await Chat.gateway(1e9 + 60e3, read);
await Chat.gateway(1e9 + 11 * 60e3, read);
console.log(JSON.stringify({ reads, sent: sent.filter((m) => m.$ === "gateway") }));
process.exit(0);
`;

test("the gateway's budget, read every 10 minutes through the gateway, and busy go to the views", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/gw.ts", GATEWAY);
  const run = async (env: Record<string, string>) => {
    const proc = Bun.spawn([process.execPath, dir + "/gw.ts"], { env: { ...process.env, UNII_DIR: dir, ...env }, stdout: "pipe", stderr: "inherit" });
    return JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  };
  const gw = await run({ UNII_ANTHROPIC_URL: "https://gw.test", ANTHROPIC_API_KEY: "k-test" });
  expect(gw.reads).toEqual(["https://gw.test true", "https://gw.test true"]);
  expect(gw.sent).toHaveLength(3);
  expect(gw.sent[0]).toEqual({ $: "gateway", budget: { spend: 1, max: 800, reset: null }, busy: 42 });
  const own = await run({ UNII_ANTHROPIC_URL: "https://api.anthropic.com", ANTHROPIC_API_KEY: "k-test" });
  expect(own.reads).toEqual([]);
  expect(own.sent[0]).toEqual({ $: "gateway", budget: null, busy: 42 });
});

// RED ZONE (R8, signed off by the user 2026-11-19): the GChat bridge
// posts a chat's questions to one space and acts on its replies, so it
// bridges one owner's chat only: the user config gchat_user names; none
// named, no chat's (fail closed), however many users the server has
const BRIDGED = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
Chat.gchat_token = null;
let posts = 0;
globalThis.fetch = async () => (posts++, Response.json({}));
const bridged = [];
for (const id of ["u1", "u2"]) {
  const chat = Chat.open({ id, name: id + "@b.c" });
  Chat.chats.set(id, chat);
  chat.mem.questions.push({ id: 1, text: "Ship?", at: Date.now(), date: "" });
  const opened = chat.bridging !== undefined;
  const before = posts;
  await Chat.bridge(chat, Date.now());
  bridged.push({ opened, posted: posts > before });
}
console.log(JSON.stringify({ bridged }));
process.exit(0);
`;

test("the GChat bridge opens on and posts from the chat of the user gchat_user names only; none named, none", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-server-");
  fs.writeFileSync(dir + "/bridged.ts", BRIDGED);
  const space = "spaces/TESTSPACE";
  const hook = "https://chat.googleapis.com/v1/" + space + "/messages?key=FAKEKEY&token=FAKETOKEN-not-real";
  const run = async (user: string | null) => {
    const env: Record<string, string | undefined> = { ...process.env, UNII_DIR: fs.mkdtempSync(dir + "/d-"), UNII_GCHAT_SPACE: space, GCHAT_WEBHOOK_URL: hook, UNII_GCHAT_USER: user ?? undefined };
    const proc = Bun.spawn([process.execPath, dir + "/bridged.ts"], { env, stdout: "pipe", stderr: "inherit" });
    return JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}").bridged;
  };
  const none = { opened: false, posted: false };
  expect(await run("u2")).toEqual([none, { opened: true, posted: true }]);
  expect(await run(null)).toEqual([none, none]);
  expect(await run("")).toEqual([none, none]);
});
