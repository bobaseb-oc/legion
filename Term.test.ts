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

// RED ZONE (K1, K2, DRAFT awaiting the user's sign-off): the terminal
// key. The Keychain is a stub in every run here (Auth.security replaced
// before Term.ts loads, its items a file in the test's home): never the
// real one
const STUB = `
const fs = await import("node:fs");
const { Auth } = await import(${JSON.stringify(import.meta.dir + "/Auth.ts")});
const file = process.env.FAKE_KEYCHAIN;
const items = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const save = (x) => fs.writeFileSync(file, JSON.stringify(x));
const fake = async (args, input) => {
  fs.appendFileSync(file + ".log", JSON.stringify({ args, input: input ?? null }) + "\\n");
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

// `legion <args>` through the Keychain stub, its stdin `stdin` (left
// open: open), its output after ms or once it ends; the stub's items and
// the calls it got
async function stubbed(args: string[], port: number, dir: string, home: string, ms: number, stdin: string, env: Record<string, string> = {}, open = true) {
  const stub = home + "/stub.ts";
  fs.writeFileSync(stub, STUB);
  const keychain = home + "/keychain.json";
  const { UNII_URL, ...rest } = process.env;
  const all = { ...rest, UNII_HOME: home, UNII_DIR: dir, UNII_WORK: home + "/work", UNII_SPACES: home, UNII_NO_TELEMETRY: "1", FAKE_KEYCHAIN: keychain, ...env };
  const proc = Bun.spawn([process.execPath, stub, ...args, "http://127.0.0.1:" + port], { env: all, stdin: open ? "pipe" : new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  if (open) {
    (proc.stdin as Bun.FileSink).write(stdin);
  }
  await Promise.race([proc.exited, Bun.sleep(ms)]);
  proc.kill();
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const items = fs.existsSync(keychain) ? JSON.parse(fs.readFileSync(keychain, "utf8")) : {};
  const calls = fs.existsSync(keychain + ".log") ? fs.readFileSync(keychain + ".log", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { out, items, calls };
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
    // never an argument, nor in any file of the terminal's
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.args.join(" ")).not.toContain(body.term);
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
  const finds = (calls: any[]) => calls.filter((c) => c.args[0] === "find-generic-password" && c.args[2] === item);
  const run = async (kept: Record<string, string>, env: Record<string, string> = {}, me?: (auth: string) => number) => {
    fs.writeFileSync(home + "/keychain.json", JSON.stringify(kept));
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
