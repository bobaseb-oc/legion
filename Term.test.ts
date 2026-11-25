// Term test
// =========
// `bun test Term.test.ts`. RED ZONE (security review U1, DRAFT awaiting
// the user's sign-off): `legion device` and `legion login` reach their
// server only over its unix socket (<UNII_DIR>/server.sock, in a 0700
// dir), never over TCP: a process that took the port first (one relaying
// the real server, the old proof's hole) gets no Bearer and no new
// session's key, the real server's socket does.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

// what each request's method, path and authorization was, and the body
type Seen = string[];

// a squatter on a TCP port: it answers everything, as a relay would
function squatter(seen: Seen) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req, s) {
      seen.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")) + " " + (await req.text()));
      return s.upgrade(req) ? undefined : Response.json({ ok: true, code: "c" });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
}

// the real server's socket in dir: it signs in at once
function real(dir: string, seen: Seen) {
  return Bun.serve({
    unix: dir + "/server.sock",
    async fetch(req, s) {
      seen.push(req.method + " " + new URL(req.url).pathname + " " + String(req.headers.get("authorization")) + " " + req.headers.get("host"));
      if (new URL(req.url).pathname === "/api/hello") {
        return Response.json({ bills: false, github: false });
      }
      return s.upgrade(req) ? undefined : Response.json({ ok: true, code: "c" });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
}

// the server's dir (UNII_DIR), 0700, and a home with this port's token
function dirs(port: number, token: boolean) {
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-keys-");
  fs.chmodSync(dir, 0o700);
  const home = fs.mkdtempSync(os.tmpdir() + "/legion-term-");
  fs.mkdirSync(home + "/127.0.0.1:" + port, { recursive: true });
  if (token) {
    fs.writeFileSync(home + "/127.0.0.1:" + port + "/token", "sekrit", { mode: 0o600 });
  }
  return { dir, home };
}

// `legion <args> http://127.0.0.1:<port>`: its output after ms, or once
// it ends (through the Keychain stub: STUB)
async function legion(args: string[], port: number, dir: string, home: string, ms: number, stdin = ""): Promise<string> {
  return (await stubbed(args, port, dir, home, ms, stdin, {}, false)).out;
}

// RED ZONE (K1, K2, T1, DRAFT awaiting the user's sign-off): the terminal
// key. The Keychain is a stub in every run here, never the real one: the
// items legion-key keeps (keychain.json in the test's home), read by a
// fake legion-key in <UNII_DIR>/bin (HELPER: it asks no Touch ID;
// FAKE_REFUSE in keychain.json's dir refuses as if not given), and the
// items made the old way, by `security` (keychain-old.json: Auth.security
// replaced before Term.ts loads). Every call of either is logged
const STUB = `
const fs = await import("node:fs");
const { Auth } = await import(${JSON.stringify(import.meta.dir + "/Auth.ts")});
const file = process.env.FAKE_OLD;
const items = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const save = (x) => fs.writeFileSync(file, JSON.stringify(x));
const fake = async (args, input) => {
  fs.appendFileSync(process.env.FAKE_KEYCHAIN + ".log", JSON.stringify({ via: "security", args, input: input ?? null }) + "\\n");
  const all = items();
  if (process.env.FAKE_REFUSE === "1") return { code: 51, out: "" };
  if (args[0] === "find-generic-password") return args[2] in all ? { code: 0, out: all[args[2]] + "\\n" } : { code: 44, out: "" };
  if (args[0] === "delete-generic-password") { const had = args[2] in all; delete all[args[2]]; save(all); return { code: had ? 0 : 44, out: "" }; }
  const add = /^add-generic-password -s (\\S+) -a oauth -T "" -w (\\S+)\\n$/.exec(input ?? "");
  if (args[0] === "-i" && add !== null) { all[add[1]] = add[2]; save(all); return { code: 0, out: "" }; }
  return { code: 1, out: "" };
};
Auth.security = fake;
if (Auth.security !== fake) throw new Error("no stub: the real Keychain would be used");
await import(${JSON.stringify(import.meta.dir + "/Term.ts")});
`;

// the fake legion-key: get (44 none, 45 an old item, 1 refused), set
// (from stdin; the old item gone), delete; it logs its arguments, its
// stdin and its whole environment
function helper(keychain: string): string {
  return `#!${process.execPath}
const fs = require("node:fs");
const file = ${JSON.stringify(keychain)}, oldf = ${JSON.stringify(keychain.replace(/\.json$/, "-old.json"))};
const read = (f) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
const [verb, service, account] = process.argv.slice(2);
const input = verb === "set" ? fs.readFileSync(0, "utf8") : null;
fs.appendFileSync(file + ".log", JSON.stringify({ via: "helper", args: [verb, service, account], input, env: process.env }) + "\\n");
const all = read(file), old = read(oldf);
if (fs.existsSync(file + ".refuse") || account !== "oauth") process.exit(1);
if (verb === "get") {
  if (service in all) { process.stdout.write(all[service] + "\\n"); process.exit(0); }
  process.exit(service in old ? 45 : 44);
}
if (verb === "set") { delete old[service]; all[service] = input.replace(/\\n$/, ""); }
const had = service in all || service in old;
if (verb === "delete") { delete all[service]; delete old[service]; }
fs.writeFileSync(file, JSON.stringify(all)); fs.writeFileSync(oldf, JSON.stringify(old));
process.exit(verb === "delete" && !had ? 44 : 0);
`;
}

// `legion <args>` through the Keychain stub, its stdin `stdin` (left
// open: open), its output after ms or once it ends; the stub's items
// (legion-key's, and the old ones) and the calls it got. NO_HELPER: no
// legion-key in <UNII_DIR>/bin (local/legion could not build it)
async function stubbed(args: string[], port: number, dir: string, home: string, ms: number, stdin: string, env: Record<string, string> = {}, open = true) {
  const stub = home + "/stub.ts";
  fs.writeFileSync(stub, STUB);
  const keychain = home + "/keychain.json";
  fs.rmSync(dir + "/bin", { recursive: true, force: true });
  if (env.NO_HELPER !== "1") {
    fs.mkdirSync(dir + "/bin", { mode: 0o700 });
    fs.writeFileSync(dir + "/bin/legion-key", helper(keychain), { mode: 0o700 });
  }
  fs.rmSync(keychain + ".refuse", { force: true });
  if (env.FAKE_REFUSE === "1") {
    fs.writeFileSync(keychain + ".refuse", "");
  }
  const { UNII_URL, ...rest } = process.env;
  const all = { ...rest, UNII_HOME: home, UNII_DIR: dir, UNII_WORK: home + "/work", UNII_SPACES: home, UNII_NO_TELEMETRY: "1", FAKE_KEYCHAIN: keychain, FAKE_OLD: home + "/keychain-old.json", ...env };
  const proc = Bun.spawn([process.execPath, stub, ...args, "http://127.0.0.1:" + port], { env: all, stdin: open ? "pipe" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  if (open) {
    (proc.stdin as Bun.FileSink).write(stdin);
  }
  await Promise.race([proc.exited, Bun.sleep(ms)]);
  proc.kill();
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const items = fs.existsSync(keychain) ? JSON.parse(fs.readFileSync(keychain, "utf8")) : {};
  const calls = fs.existsSync(keychain + ".log") ? fs.readFileSync(keychain + ".log", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const oldf = home + "/keychain-old.json";
  const old = fs.existsSync(oldf) ? JSON.parse(fs.readFileSync(oldf, "utf8")) : {};
  return { out, items, old, calls };
}

test("legion device: with no server socket, the TCP port's squatter gets nothing; it says so and waits", async () => {
  const squat: Seen = [];
  const srv = squatter(squat);
  try {
    const { dir, home } = dirs(srv.port, true);
    const out = await legion(["device"], srv.port, dir, home, 2500);
    expect(squat).toEqual([]);
    expect(out).toContain("no server socket");
  } finally {
    srv.stop(true);
  }
});

test("legion device: the real server's socket gets its session, the TCP port's squatter nothing (no relay)", async () => {
  const squat: Seen = [];
  const sq = squatter(squat);
  const seen: Seen = [];
  const { dir, home } = dirs(sq.port, true);
  const srv = real(dir, seen);
  try {
    await legion(["device"], sq.port, dir, home, 2500);
    expect(seen).toContain("GET /api/me Bearer sekrit 127.0.0.1:" + sq.port);
    expect(seen.some((s) => s.startsWith("GET /ws Bearer sekrit"))).toBe(true);
    expect(squat).toEqual([]);
  } finally {
    srv.stop(true);
    sq.stop(true);
  }
});

test("legion login: the new session's key goes to the real server's socket only, never the TCP port", async () => {
  const squat: Seen = [];
  const sq = squatter(squat);
  const { dir, home } = dirs(sq.port, false);
  // no socket: it refuses, sending nothing
  expect(await legion(["login"], sq.port, dir, home, 3000, "me@x.com\n")).toContain("no server");
  expect(squat).toEqual([]);
  const seen: Seen = [];
  const srv = real(dir, seen);
  try {
    expect(await legion(["login"], sq.port, dir, home, 3000, "me@x.com\n")).toContain("Signed in.");
    expect(seen.some((s) => s.startsWith("POST /api/login"))).toBe(true);
    expect(seen.some((s) => s.startsWith("GET /api/wait Bearer "))).toBe(true);
    expect(squat).toEqual([]);
  } finally {
    srv.stop(true);
    sq.stop(true);
  }
});

// the real server's socket that keeps what each request carried: its
// method, path and query, its Bearer, its body; me: /api/me's status
function keeper(dir: string, seen: Seen, me = (_auth: string) => 200) {
  return Bun.serve({
    unix: dir + "/server.sock",
    async fetch(req, s) {
      const u = new URL(req.url);
      const auth = String(req.headers.get("authorization"));
      seen.push(req.method + " " + u.pathname + u.search + " " + auth + " " + (await req.text()));
      if (u.pathname === "/api/hello") {
        return Response.json({ bills: false, github: false });
      }
      if (u.pathname === "/api/me") {
        return Response.json({ id: "1", name: "me" }, { status: me(auth) });
      }
      return s.upgrade(req) ? undefined : Response.json({ ok: true, code: "c" });
    },
    websocket: { open: (ws) => ws.send(JSON.stringify({ $: "view", parts: [], turn: 0 })), message: () => {} },
  });
}

// /api/login's body, as the server got it
function login_body(seen: Seen): { key: string; term: string } {
  return JSON.parse(seen.find((s) => s.startsWith("POST /api/login "))!.replace(/^POST \/api\/login \S+ /, ""));
}

test("legion login makes two keys, one code: the device key in its file, the terminal key in the Keychain only (by stdin)", async () => {
  const port = 39511;
  const { dir, home } = dirs(port, false);
  const seen: Seen = [];
  const srv = keeper(dir, seen);
  try {
    const { out, items, calls } = await stubbed(["login"], port, dir, home, 3000, "me@x.com\n");
    expect(out).toContain("Signed in.");
    expect(out).toContain("Approving from the terminal is on");
    const body = login_body(seen);
    expect(body.key).toMatch(/^[\w-]{43}$/);
    expect(body.term).toMatch(/^[\w-]{43}$/);
    expect(body.term).not.toBe(body.key);
    expect(fs.readFileSync(home + "/127.0.0.1:" + port + "/token", "utf8")).toBe(body.key);
    expect(items).toEqual({ ["legion-terminal-127.0.0.1:" + port]: body.term });
    // kept by legion-key, from its stdin (T1); never by `security`, never
    // an argument nor in its environment, nor in any file of the terminal's
    expect(calls.filter((c) => c.via === "helper" && c.args[0] === "set")).toEqual([expect.objectContaining({ args: ["set", "legion-terminal-127.0.0.1:" + port, "oauth"], input: body.term + "\n" })]);
    expect(calls.filter((c) => c.via === "security")).toEqual([]);
    for (const c of calls) {
      expect(c.args.join(" ")).not.toContain(body.term);
      expect(JSON.stringify(c.env ?? {})).not.toContain(body.term);
      expect(Object.keys(c.env ?? {}).filter((k) => !["HOME", "__CF_USER_TEXT_ENCODING"].includes(k))).toEqual([]);
    }
    for (const f of fs.readdirSync(home, { recursive: true }) as string[]) {
      const p = home + "/" + f;
      if (fs.statSync(p).isFile() && !p.startsWith(home + "/keychain.json")) {
        expect([f, fs.readFileSync(p, "utf8").includes(body.term)]).toEqual([f, false]);
      }
    }
  } finally {
    srv.stop(true);
  }
});

test("legion login: a Keychain that won't keep the terminal key signs that key out; the device key still signs in", async () => {
  const port = 39512;
  const { dir, home } = dirs(port, false);
  const seen: Seen = [];
  const srv = keeper(dir, seen);
  try {
    const { out, items } = await stubbed(["login"], port, dir, home, 3000, "me@x.com\n", { FAKE_REFUSE: "1" });
    expect(out).toContain("Signed in.");
    expect(out).toContain("stays off");
    const body = login_body(seen);
    expect(items).toEqual({});
    expect(seen.some((s) => s.startsWith("POST /api/logout Bearer " + body.term + " "))).toBe(true);
    expect(fs.readFileSync(home + "/127.0.0.1:" + port + "/token", "utf8")).toBe(body.key);
  } finally {
    srv.stop(true);
  }
});

test("the terminal reads its key once as it starts and connects on it; none, refused or signed out: the device key's, and one line says legion login", async () => {
  const port = 39513;
  const { dir, home } = dirs(port, true);
  const item = "legion-terminal-127.0.0.1:" + port;
  const sockets = (seen: Seen) => seen.filter((s) => s.startsWith("GET /ws?"));
  const finds = (calls: any[]) => calls.filter((c) => c.via === "helper" && c.args[0] === "get" && c.args[1] === item);
  const run = async (kept: Record<string, string>, env: Record<string, string> = {}, me?: (auth: string) => number) => {
    fs.writeFileSync(home + "/keychain.json", JSON.stringify(kept));
    fs.writeFileSync(home + "/keychain-old.json", "{}");
    fs.rmSync(home + "/keychain.json.log", { force: true });
    const seen: Seen = [];
    const srv = keeper(dir, seen, me);
    try {
      const got = await stubbed([], port, dir, home, 2500, "", env);
      return { ...got, ws: sockets(seen), seen };
    } finally {
      srv.stop(true);
    }
  };
  const held = await run({ [item]: "termkey" });
  expect(held.ws.length).toBeGreaterThan(0);
  expect(held.ws.every((s) => / Bearer termkey $/.test(s) && /&device=/.test(s))).toBe(true);
  expect(finds(held.calls)).toHaveLength(1);
  expect(held.out).not.toContain("legion login once");
  for (const off of [await run({}), await run({ [item]: "termkey" }, { FAKE_REFUSE: "1" }), await run({ [item]: "deadkey" }, {}, (auth) => (auth === "Bearer deadkey" ? 401 : 200))]) {
    expect(off.ws.length).toBeGreaterThan(0);
    expect(off.ws.every((s) => / Bearer sekrit $/.test(s) && /&device=/.test(s))).toBe(true);
    expect(finds(off.calls)).toHaveLength(1);
    expect(off.out).toContain("legion login once");
  }
}, 20000);

// RED ZONE (T1, DRAFT awaiting the user's sign-off): with no legion-key
// (swiftc missing) the terminal runs keyless, and never falls back to
// `security` (whose "Always Allow" would let agents read the key); an
// item kept the old way (by `security`: legion-key says 45) is read once
// from there and kept by legion-key from then on
test("the terminal key without legion-key: keyless, no read by security; an old item moves to legion-key once", async () => {
  const port = 39517;
  const { dir, home } = dirs(port, true);
  const item = "legion-terminal-127.0.0.1:" + port;
  const run = async (kept: Record<string, string>, old: Record<string, string>, env: Record<string, string> = {}) => {
    fs.writeFileSync(home + "/keychain.json", JSON.stringify(kept));
    fs.writeFileSync(home + "/keychain-old.json", JSON.stringify(old));
    fs.rmSync(home + "/keychain.json.log", { force: true });
    const seen: Seen = [];
    const srv = keeper(dir, seen);
    try {
      const got = await stubbed([], port, dir, home, 2500, "", env);
      return { ...got, ws: seen.filter((s) => s.startsWith("GET /ws?")) };
    } finally {
      srv.stop(true);
    }
  };
  const none = await run({ [item]: "termkey" }, { [item]: "oldkey" }, { NO_HELPER: "1" });
  expect(none.ws.length).toBeGreaterThan(0);
  expect(none.ws.every((s) => / Bearer sekrit $/.test(s))).toBe(true);
  expect(none.calls.filter((c) => JSON.stringify(c).includes("legion-terminal"))).toEqual([]);
  expect(none.out).toContain("legion login once");
  const moved = await run({}, { [item]: "oldkey" });
  expect(moved.ws.length).toBeGreaterThan(0);
  expect(moved.ws.every((s) => / Bearer oldkey $/.test(s))).toBe(true);
  expect(moved.items).toEqual({ [item]: "oldkey" });
  expect(moved.old).toEqual({});
  expect(moved.calls.filter((c) => c.via === "security" && c.args[0] === "find-generic-password" && c.args[2] === item)).toHaveLength(1);
  const after = await run(moved.items, moved.old);
  expect(after.ws.every((s) => / Bearer oldkey $/.test(s))).toBe(true);
  expect(after.calls.filter((c) => c.via === "security" && JSON.stringify(c).includes("legion-terminal"))).toEqual([]);
}, 20000);

test("/logout signs out both keys' sessions and deletes the terminal key's Keychain item and the device key's file", async () => {
  const port = 39515;
  const { dir, home } = dirs(port, true);
  const item = "legion-terminal-127.0.0.1:" + port;
  fs.writeFileSync(home + "/keychain.json", JSON.stringify({ [item]: "termkey", other: "kept" }));
  const seen: Seen = [];
  const srv = keeper(dir, seen);
  try {
    const { items } = await stubbed([], port, dir, home, 3000, "/logout\n");
    const outs = seen.filter((s) => s.startsWith("POST /api/logout "));
    expect(outs.some((s) => s.startsWith("POST /api/logout Bearer termkey "))).toBe(true);
    expect(outs.some((s) => s.startsWith("POST /api/logout Bearer sekrit "))).toBe(true);
    expect(items).toEqual({ other: "kept" });
    expect(fs.existsSync(home + "/127.0.0.1:" + port + "/token")).toBe(false);
  } finally {
    srv.stop(true);
  }
});

// RED ZONE (security review 4 F3, signed off by the user 2026-11-25):
// `legion web`'s one-use link signs a browser in as the user, so it is in
// no process's arguments (any process of the user's reads those: ps): it
// is printed to the terminal only, never handed to `open` (a fake one on
// PATH logs any call)
test("legion web prints its one-use link and puts it in no command's arguments", async () => {
  const port = 39517;
  const { dir, home } = dirs(port, true);
  fs.writeFileSync(home + "/keychain.json", JSON.stringify({ ["legion-terminal-127.0.0.1:" + port]: "termkey" }));
  const link = "http://127.0.0.1:" + port + "/auth?t=ONEUSELINK";
  const bin = home + "/fakebin";
  fs.mkdirSync(bin);
  fs.writeFileSync(bin + "/open", "#!/bin/sh\necho \"$@\" >> " + JSON.stringify(home + "/open.log") + "\n", { mode: 0o755 });
  fs.writeFileSync(bin + "/xdg-open", "#!/bin/sh\necho \"$@\" >> " + JSON.stringify(home + "/open.log") + "\n", { mode: 0o755 });
  const seen: Seen = [];
  const srv = Bun.serve({
    unix: dir + "/server.sock",
    fetch(req) {
      const p = new URL(req.url).pathname;
      seen.push(req.method + " " + p + " " + String(req.headers.get("authorization")));
      if (p === "/api/hello") {
        return Response.json({ bills: false, github: false });
      }
      return p === "/api/web-link" ? Response.json({ url: link }) : Response.json({ ok: true });
    },
  });
  try {
    const { out } = await stubbed(["web"], port, dir, home, 5000, "", { PATH: bin + ":" + process.env.PATH });
    expect(seen.some((s) => s === "POST /api/web-link Bearer termkey")).toBe(true);
    expect(out).toContain(link);
    expect(fs.existsSync(home + "/open.log") ? fs.readFileSync(home + "/open.log", "utf8") : "").not.toContain("ONEUSELINK");
  } finally {
    srv.stop(true);
  }
});

test("legion device never reads the Keychain: it runs on the device key", async () => {
  const port = 39514;
  const { dir, home } = dirs(port, true);
  fs.writeFileSync(home + "/keychain.json", JSON.stringify({ ["legion-terminal-127.0.0.1:" + port]: "termkey" }));
  const seen: Seen = [];
  const srv = keeper(dir, seen);
  try {
    const { calls } = await stubbed(["device"], port, dir, home, 2500, "");
    expect(calls.filter((c) => c.args.join(" ").includes("legion-terminal"))).toEqual([]);
    expect(seen.some((s) => s.startsWith("GET /ws?") && / Bearer sekrit $/.test(s))).toBe(true);
    expect(seen.some((s) => s.includes("termkey"))).toBe(false);
  } finally {
    srv.stop(true);
  }
});

// RED ZONE (S1b, DRAFT awaiting the user's sign-off): against a real
// local Legion (Server.ts, no mail key), the first `legion login` makes
// the sign-in secret, keeps it in the Keychain (by stdin) and registers
// it (the server keeps its hash); each later one reads it (one prompt)
// and sends it with the confirm. With none in the Keychain it signs in
// nowhere and says how to start over. The secret is in no argument and
// no file of the terminal's; the server prints no link
test("legion login on a local Legion: the sign-in secret registered once, then read from the Keychain; none: refused", async () => {
  const port = 39516;
  const { dir, home } = dirs(port, false);
  const { RESEND_API_KEY, ...env } = process.env;
  const srv = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], { env: { ...env, UNII_DIR: dir, UNII_SITE: "http://127.0.0.1:" + port, UNII_WORK: dir + "/work", UNII_ANOTHER: "1" }, stdout: "pipe", stderr: "pipe" });
  const item = "legion-signin-127.0.0.1:" + port;
  const token = home + "/127.0.0.1:" + port + "/token";
  try {
    for (let k = 0; k < 100 && !fs.existsSync(dir + "/server.sock"); k++) {
      await Bun.sleep(50);
    }
    const first = await stubbed(["login"], port, dir, home, 10000, "me@x.com\n");
    expect(first.out).toContain("Signed in.");
    const secret = first.items[item];
    expect(secret).toMatch(/^[\w-]{43}$/);
    expect(fs.readFileSync(dir + "/signin-hash", "utf8").trim()).toBe(new Bun.CryptoHasher("sha256").update(secret).digest("hex"));
    for (const c of first.calls) {
      expect(c.args.join(" ")).not.toContain(secret);
    }
    for (const f of fs.readdirSync(home, { recursive: true }) as string[]) {
      const p = home + "/" + f;
      if (fs.statSync(p).isFile() && !p.startsWith(home + "/keychain.json")) {
        expect([f, fs.readFileSync(p, "utf8").includes(secret)]).toEqual([f, false]);
      }
    }
    // again: the secret read once, kept as it was
    fs.rmSync(home + "/keychain.json.log", { force: true });
    const again = await stubbed(["login"], port, dir, home, 10000, "me@x.com\n");
    expect(again.out).toContain("Signed in.");
    expect(again.items[item]).toBe(secret);
    expect(again.calls.filter((c) => c.via === "helper" && c.args[0] === "get" && c.args[1] === item)).toHaveLength(1);
    expect([...first.calls, ...again.calls].filter((c) => c.via === "security" && JSON.stringify(c).includes("signin"))).toEqual([]);
    // none in the Keychain: no sign-in, how to start over said
    const { [item]: _, ...rest } = again.items;
    fs.writeFileSync(home + "/keychain.json", JSON.stringify(rest));
    fs.rmSync(token, { force: true });
    const none = await stubbed(["login"], port, dir, home, 10000, "me@x.com\n");
    expect(none.out).not.toContain("Signed in.");
    expect(none.out).toContain("signin-hash");
    expect(fs.existsSync(token)).toBe(false);
    // RED ZONE (T1): no legion-key, the secret kept: refused, and why
    // (never read by `security` instead)
    fs.writeFileSync(home + "/keychain.json", JSON.stringify(again.items));
    fs.rmSync(home + "/keychain.json.log", { force: true });
    const keyless = await stubbed(["login"], port, dir, home, 10000, "me@x.com\n", { NO_HELPER: "1" });
    expect(keyless.out).not.toContain("Signed in.");
    expect(keyless.out).toContain("xcode-select --install");
    expect(keyless.calls).toEqual([]);
    expect(fs.existsSync(token)).toBe(false);
  } finally {
    srv.kill();
    await srv.exited;
  }
  const printed = (await new Response(srv.stdout).text()) + (await new Response(srv.stderr).text());
  expect(printed).not.toContain("/auth?t=");
}, 45000);
