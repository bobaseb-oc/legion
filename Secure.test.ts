// Secure test
// ===========
// `bun test Secure.test.ts`: the security review's (SC) guards on the
// site's HTTP, against `./Server.ts <port>` on a fresh dir (no mail key: a
// local Legion), signed in as a browser is there (a terminal's sign-in by
// its code and the sign-in secret, then `legion web`'s link): the
// devices' unix socket, Origin and Host, the headers HTML goes with, what
// an error tells, the bodies read before sign-in; no sign-in link printed.

import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { WIRE } from "./View.ts";

const PORT = 9591;
const SITE = "http://127.0.0.1:" + PORT;
const DIR  = fs.mkdtempSync(os.tmpdir() + "/unii-secure-");
let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
let printed = "";
let cookie = "";

// the sign-in secret, as `legion login` reads it from the Keychain; its
// hash written to the server's dir as `legion login` writes it (S1b,
// security review 4 F1: no request registers one)
const SECRET = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");

// a terminal's sign-in on this local server: /api/login (its ticket and
// code come back, no link is printed), then the confirm with the code
// and `more` (the sign-in secret); the confirm's answer
async function signin(who: string, key: string, more: Record<string, string>, term?: string): Promise<Response> {
  const asked = await fetch(SITE + "/api/login", { method: "POST", body: JSON.stringify({ who, key, ...(term ? { term } : {}) }) });
  expect(asked.status).toBe(200);
  const { t, code } = await asked.json();
  const form = new URLSearchParams({ t, code, ...more }).toString();
  return fetch(SITE + "/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: SITE }, body: form, redirect: "manual" });
}

beforeAll(async () => {
  const { RESEND_API_KEY, ...env } = process.env;
  proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(PORT)], {
    env    : { ...env, UNII_DIR: DIR, UNII_SITE: SITE, UNII_WORK: DIR + "/work", UNII_ANOTHER: "1" },
    stdout : "pipe",
    stderr : "pipe",
  });
  for (const out of [proc.stdout, proc.stderr]) {
    (async () => {
      for await (const piece of out) {
        printed += new TextDecoder().decode(piece);
      }
    })();
  }
  for (let k = 0; k < 100 && (await fetch(SITE + "/api/hello").catch(() => null)) === null; k++) {
    await Bun.sleep(50);
  }
  // no request registers a secret (F1): register=1 is refused and writes
  // no hash; `legion login` writes it, then the secret signs in; `legion
  // web`'s link, a browser (minted with the terminal's own key: the
  // device key can't)
  const key = crypto.randomUUID();
  const termkey = crypto.randomUUID();
  expect((await signin("me@x.com", key, { secret: SECRET, register: "1" }, termkey)).status).toBe(403);
  expect(fs.existsSync(DIR + "/signin-hash")).toBe(false);
  fs.writeFileSync(DIR + "/signin-hash", new Bun.CryptoHasher("sha256").update(SECRET).digest("hex") + "\n", { flag: "wx", mode: 0o600 });
  expect((await signin("me@x.com", key, { secret: SECRET }, termkey)).status).toBe(200);
  expect((await fetch(SITE + "/api/web-link", { method: "POST", headers: { authorization: "Bearer " + key } })).status).toBe(403);
  const web = await fetch(SITE + "/api/web-link", { method: "POST", headers: { authorization: "Bearer " + termkey } });
  const res = await fetch((await web.json()).url, { redirect: "manual" });
  cookie = /^(unii=[^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  expect(cookie).not.toBe("");
});

afterAll(async () => {
  proc.kill();
  await proc.exited;
  fs.rmSync(DIR, { recursive: true, force: true });
});

// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
// server also listens on <dir>/server.sock, a socket of this user, 0600,
// in its 0700 dir, so only this user's processes reach it (devices and
// terminals go there only); its answers are the TCP port's, Host checks
// too. The old proof is gone: nothing answers /api/proof, no key is made
test("the server's unix socket: 0600 in a 0700 dir, this user's, the same handlers; no /api/proof", async () => {
  const sock = DIR + "/server.sock";
  const st = fs.lstatSync(sock);
  expect(st.isSocket()).toBe(true);
  expect(st.uid).toBe(process.getuid!());
  expect(st.mode & 0o777).toBe(0o600);
  expect(fs.statSync(DIR).mode & 0o777).toBe(0o700);
  const hello = await fetch(SITE + "/api/hello", { unix: sock } as RequestInit);
  expect(hello.status).toBe(200);
  expect(await hello.json()).toMatchObject({ bills: false });
  expect((await fetch("http://evil.example/api/hello", { unix: sock } as RequestInit)).status).toBe(403);
  expect((await fetch(SITE + "/api/logout", { method: "POST", headers: { origin: "http://evil.example" }, unix: sock } as RequestInit)).status).toBe(403);
  expect((await fetch(SITE + "/api/proof?n=" + "ab".repeat(32))).status).not.toBe(200);
  expect(fs.existsSync(DIR + "/server-key")).toBe(false);
});

// RED ZONE U1: alone, the server holds its port by itself (no
// SO_REUSEPORT), so no other process shares it to take some connections
test("alone, no other process can bind the server's port beside it", () => {
  expect(() => Bun.serve({ port: PORT, hostname: "127.0.0.1", reusePort: true, fetch: () => new Response("squat") })).toThrow();
});

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
// post or socket with an Origin must be the site's; any request's Host
// one the server is (DNS rebinding); none of these said passes
test("Origin: another's refuses posts and sockets; Host: only the site's", async () => {
  const post = (origin: string | null) => fetch(SITE + "/api/logout", { method: "POST", headers: origin === null ? {} : { origin } });
  expect((await post("http://evil.example")).status).toBe(403);
  expect((await post("null")).status).toBe(403);
  expect((await post(SITE)).status).toBe(204);
  expect((await post("http://localhost:" + PORT)).status).toBe(204);
  expect((await post(null)).status).toBe(204);
  const ws = (origin: string | null) => fetch(SITE + "/ws", { headers: { cookie, ...(origin === null ? {} : { origin }) } });
  expect((await ws("http://evil.example")).status).toBe(403);
  expect((await ws(null)).status).toBe(400); // past the guard: not an upgrade
  expect((await ws(SITE)).status).toBe(400);
  const host = (h: string) => fetch(SITE + "/api/hello", { headers: { host: h } });
  expect((await host("evil.example")).status).toBe(403);
  expect((await host("evil.example:" + PORT)).status).toBe(403);
  expect((await host("127.0.0.1:" + PORT)).status).toBe(200);
  expect((await host("localhost:" + PORT)).status).toBe(200);
});

test("HTML goes with a CSP; every answer with nosniff and no referrer; /tree runs no inline script", async () => {
  const page = await fetch(SITE + "/");
  const csp = page.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(page.headers.get("x-content-type-options")).toBe("nosniff");
  expect(page.headers.get("referrer-policy")).toBe("no-referrer");
  const hello = await fetch(SITE + "/api/hello");
  expect(hello.headers.get("x-content-type-options")).toBe("nosniff");
  expect(hello.headers.get("content-security-policy")).toBeNull();
  const signin = await fetch(SITE + "/auth?t=nothing", { redirect: "manual" });
  expect(signin.headers.get("x-content-type-options")).toBe("nosniff");
  const tree = await fetch(SITE + "/tree", { headers: { cookie } });
  expect(tree.status).toBe(200);
  expect(tree.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(await tree.text()).not.toContain("<script");
});

// RED ZONE (R1, signed off by the user 2026-11-19): a view is a
// browser's only: its session a cookie's, made by a browser's sign-in. A
// terminal's Bearer session (its token in ~/.unii, within an agent
// shell's reach) is never one: its socket names its device or is
// refused, sent as a cookie too; its /api/act is a device's
test("only a browser's session is a view: a terminal's token, as Bearer or cookie, never is", async () => {
  const key = crypto.randomUUID();
  expect((await signin("term@x.com", key, { secret: SECRET })).status).toBe(200);
  const opens = (q: string, headers: Record<string, string>) => new Promise<boolean>((ok) => {
    const ws = new WebSocket(SITE.replace(/^http/, "ws") + "/ws" + q, { headers } as any);
    ws.onopen = () => (ws.close(), ok(true));
    ws.onerror = () => ok(false);
  });
  const bearer = { authorization: "Bearer " + key };
  expect(await opens("", { cookie })).toBe(true);
  expect(await opens("?device=box", bearer)).toBe(true);
  expect(await opens("", bearer)).toBe(false);
  expect(await opens("?device=", bearer)).toBe(false);
  expect(await opens("", { cookie: "unii=" + key })).toBe(false);
  // a todo ticked: a view finds none ("No todo"), a device is refused
  const tick = (headers: Record<string, string>) => fetch(SITE + "/api/act?$=assignment&id=" + crypto.randomUUID() + "&n=1&done=true", { method: "POST", headers }).then((r) => r.json());
  expect((await tick({ cookie })).error).toMatch(/^No todo/);
  expect((await tick(bearer)).error).toMatch(/in a view/);
  expect((await tick({ cookie: "unii=" + key })).error).toMatch(/in a view/);
});

// RED ZONE (K1, DRAFT awaiting the user's sign-off): a terminal's sign-in
// approves two keys with its one code: the device key (a file) and the
// terminal key (the Keychain). A socket on the terminal key still names
// its device (it runs jobs) and speaks for the user: its /mode is done,
// its typed todo tick is a view's; the device key's are refused as ever.
// A terminal key not signed in opens nothing; logging one out leaves the other
test("the terminal key's socket speaks for the user; the device key's stays a device's", async () => {
  const key = crypto.randomUUID();
  const term = crypto.randomUUID();
  expect((await signin("keys@x.com", key, { secret: SECRET }, term)).status).toBe(200);
  // a socket: opened, or refused; an act sent on it, its ack
  const sock = (q: string, token: string) => new Promise<WebSocket | null>((ok) => {
    const ws = new WebSocket(SITE.replace(/^http/, "ws") + "/ws?wire=" + WIRE + q, { headers: { authorization: "Bearer " + token } } as any);
    ws.onopen = () => ok(ws);
    ws.onerror = () => ok(null);
  });
  const ack = (ws: WebSocket, msg: object) => new Promise<any>((ok) => {
    const id = crypto.randomUUID();
    ws.addEventListener("message", (ev) => {
      const got = JSON.parse(String(ev.data));
      if (got.$ === "ack" && got.id === id) {
        ok(got);
      }
    });
    ws.send(JSON.stringify({ id, ...msg }));
  });
  expect(await sock("&device=box", nobody())).toBeNull();
  expect(await sock("", term)).toBeNull();
  const dev = (await sock("&device=box", key))!;
  const mine = (await sock("&device=box2", term))!;
  expect(dev).not.toBeNull();
  expect(mine).not.toBeNull();
  expect((await ack(dev, { $: "mode", mode: "full" })).error).toMatch(/user's say/);
  expect((await ack(dev, { $: "routine", op: "add", routine: { name: "R", task: "t", when: { $: "every", hours: 1 } } })).error).toMatch(/in a view/);
  expect((await ack(mine, { $: "mode", mode: "full" })).error).toBeUndefined();
  expect((await ack(mine, { $: "routine", op: "add", routine: { name: "R", task: "t", when: { $: "every", hours: 1 } } })).error).toBeUndefined();
  expect((await ack(mine, { $: "timer", n: 999 })).error).toMatch(/^No timer/);
  dev.close();
  mine.close();
  // a post (/api/act) on the terminal key is the user's too
  const tick = (token: string) => fetch(SITE + "/api/act?$=assignment&id=" + crypto.randomUUID() + "&n=1&done=true", { method: "POST", headers: { authorization: "Bearer " + token } }).then((r) => r.json());
  expect((await tick(key)).error).toMatch(/in a view/);
  expect((await tick(term)).error).toMatch(/^No todo/);
  // signed out, the terminal key's session ends alone
  const me = (token: string) => fetch(SITE + "/api/me", { headers: { authorization: "Bearer " + token } }).then((r) => r.status);
  expect((await fetch(SITE + "/api/logout", { method: "POST", headers: { authorization: "Bearer " + term } })).status).toBe(204);
  expect(await me(term)).toBe(401);
  expect(await me(key)).toBe(200);
  expect(await sock("&device=box2", term)).toBeNull();
});

// a random token, signed in nowhere
function nobody(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

// RED ZONE (S1a, S1b, DRAFT awaiting the user's sign-off): an agent's
// self sign-in on a local Legion. It starts one with keys it made (so it
// knows the code) and finds no link in the server's output (stdout,
// stderr: the launcher's server.log); its confirm with no secret, a guess
// or a new registration is refused, its keys sign in nowhere, and the
// link is used up (the right secret no longer helps); a browser's
// sign-in there is refused
test("a local Legion refuses an agent's self sign-in without the sign-in secret, and prints no link", async () => {
  for (const more of [{}, { secret: nobody().replace(/-/g, "") }, { secret: nobody().replace(/-/g, ""), register: "1" }] as Record<string, string>[]) {
    const key = crypto.randomUUID();
    const term = crypto.randomUUID();
    const asked = await fetch(SITE + "/api/login", { method: "POST", body: JSON.stringify({ who: "me@x.com", key, term }) });
    const { t, code } = await asked.json();
    const post = (form: Record<string, string>) => fetch(SITE + "/auth", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t, code, ...form }).toString(), redirect: "manual" });
    expect((await post(more)).status).toBe(403);
    const me = (token: string) => fetch(SITE + "/api/me", { headers: { authorization: "Bearer " + token } }).then((r) => r.status);
    expect(await me(key)).toBe(401);
    expect(await me(term)).toBe(401);
    expect((await post({ secret: SECRET })).headers.get("location")).toContain("expired=1");
    expect(await me(key)).toBe(401);
    expect(printed).not.toContain(t);
  }
  const browser = await fetch(SITE + "/api/login", { method: "POST", body: JSON.stringify({ who: "me@x.com" }) });
  expect(browser.status).toBe(400);
  await Bun.sleep(100);
  expect(printed).not.toContain("/auth?t=");
  expect(printed).not.toContain("sign-in link");
});

// what's read before anyone is signed in is small: /api/delete's
test("/api/delete reads at most a small body", async () => {
  const big = JSON.stringify({ confirm: "x".repeat(64 * 1024) });
  expect((await fetch(SITE + "/api/delete", { method: "POST", body: big })).status).toBe(413);
  expect((await fetch(SITE + "/api/delete", { method: "POST", body: JSON.stringify({ confirm: "no" }) })).status).toBe(400);
});

// an error no one meant to show (a bug, a path, a library's words) is
// logged, and the client told only that something failed; one meant for
// the user (Chat.told) is told as it is
const FAIL = `
const { Chat, Main } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const { Memory } = await import(${JSON.stringify(import.meta.dir + "/Memory.ts")});
const config = await import(${JSON.stringify(import.meta.dir + "/Config.ts")});
const fs = await import("node:fs");
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const failed = Chat.fail(new Error("ENOENT: /Users/x/.unii/secret"));
const told = Chat.fail(Chat.told("An import has no kind x."));
Cloud.who = () => { throw new Error("SQLITE_CORRUPT at /Users/x/.unii/cloud.db"); };
const res = await Main.http(new Request("http://127.0.0.1/api/hello", { headers: { host: new URL(config.SITE).host } }), {});
const mem = Memory.load(config.DIR + "/m", () => ({}));
Memory.save(mem);
const saved = fs.statSync(config.DIR + "/m/view.json").mode & 0o777;
console.log(JSON.stringify({ failed, told, status: res.status, body: await res.text(), body_max: Main.BODY, buffer: Main.BUFFER, saved }));
process.exit(0);
`;

test("unexpected errors tell the client nothing of them; meant ones are told; limits are finite; the chat's state is 0600", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-secure-");
  fs.writeFileSync(dir + "/fail.ts", FAIL);
  const run = Bun.spawn([process.execPath, dir + "/fail.ts"], { env: { ...process.env, UNII_DIR: dir }, stdout: "pipe", stderr: "pipe" });
  const out = JSON.parse((await new Response(run.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  const logged = await new Response(run.stderr).text();
  expect(JSON.stringify(out.failed)).not.toContain("secret");
  expect(out.failed.error).toMatch(/went wrong/);
  expect(out.told).toEqual({ error: "An import has no kind x." });
  expect(out.status).toBe(500);
  expect(out.body).not.toContain("SQLITE");
  expect(out.body).not.toContain("/Users");
  expect(logged).toContain("SQLITE_CORRUPT");
  expect(logged).toContain("ENOENT");
  const { FRAME } = await import("./View.ts");
  expect(out.body_max).toBeLessThanOrEqual(2 ** 32);
  expect(out.buffer).toBeGreaterThanOrEqual(FRAME);
  expect(out.buffer).toBeLessThanOrEqual(4 * FRAME);
  // the chat's state (Memory.save) is this user's alone
  expect(out.saved).toBe(0o600);
});

// a body that says it's over Main.BODY is refused (413) before any of it
// is read, signed in or not
test("a body over Main.BODY is refused unread", async () => {
  const head = await new Promise<string>((done) => {
    let out = "";
    Bun.connect({ hostname: "127.0.0.1", port: PORT, socket: {
      open: (s) => void s.write("POST /api/act HTTP/1.1\r\nHost: 127.0.0.1:" + PORT + "\r\nContent-Length: " + (2 ** 32 + 1) + "\r\n\r\nx"),
      data: (s, d) => { out += d.toString(); if (out.includes("\r\n")) { s.end(); done(out); } },
      close: () => done(out),
    } });
    setTimeout(() => done(out), 2000);
  });
  expect(head.split("\r\n")[0]).toBe("HTTP/1.1 413 Request Entity Too Large");
});
