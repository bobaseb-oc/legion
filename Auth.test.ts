// Auth test
// =========
// `bun test Auth.test.ts`. Signing in to an MCP server with OAuth (red
// zone: tasks/atlassian-oauth.md, invariants I1-I9): a fake authorization
// server and protected MCP resource on 127.0.0.1 (http allowed only by the
// test option), tokens in a store in memory. The real Keychain is used
// only with LEGION_TEST_KEYCHAIN=1, on a throwaway service.

import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import { Auth, type Store } from "./Auth.ts";
import { Mcp } from "./Mcp.ts";

const ACCESS = ["at-first-0123456789abcdef", "at-second-0123456789abcdef"];
const REFRESH = ["rt-first-0123456789abcdef", "rt-second-0123456789abcdef"];

// a store in memory, and what it holds
function memory(): Store & { all: Map<string, string> } {
  const all = new Map<string, string>();
  return {
    all,
    get    : async (name) => all.get(name) ?? null,
    set    : async (name, value) => void all.set(name, value),
    delete : async (name) => all.delete(name),
  };
}

// the fake: its options, what it was sent, its base URL
type Opts = { issuer?: string; s256?: boolean; resource?: string; refreshFails?: boolean; slowRefresh?: number; https?: boolean; noRefresh?: boolean };
function fake(opts: Opts = {}) {
  const seen = { register: [] as any[], token: [] as URLSearchParams[], mcpAuth: [] as (string | null)[], challenge: "" };
  let refreshes = 0;
  let live = ACCESS[0];
  const srv = Bun.serve({
    hostname : "127.0.0.1",
    port     : 0,
    async fetch(req) {
      const url = new URL(req.url);
      const base = url.origin;
      const ep = (p: string) => (opts.https ? base.replace("http:", "https:") : base) + p;
      switch (url.pathname) {
        case "/mcp": {
          const auth = req.headers.get("authorization");
          seen.mcpAuth.push(auth);
          if (auth !== "Bearer " + live) {
            return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="' + base + '/.well-known/oauth-protected-resource/mcp"' } });
          }
          const m = await req.json() as any;
          if (m.id === undefined) {
            return new Response(null, { status: 202 });
          }
          const result = m.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: {} } : m.method === "tools/list" ? { tools: [{ name: "getJiraIssue", inputSchema: { type: "object" } }] } : { content: [{ type: "text", text: "ok" }] };
          return Response.json({ jsonrpc: "2.0", id: m.id, result });
        }
        case "/.well-known/oauth-protected-resource/mcp": {
          return Response.json({ resource: opts.resource ?? base + "/mcp", authorization_servers: [base + "/as"] });
        }
        case "/.well-known/oauth-authorization-server/as": {
          return Response.json({
            issuer                           : opts.issuer ?? base + "/as",
            authorization_endpoint           : ep("/authorize"),
            token_endpoint                   : ep("/token"),
            registration_endpoint            : ep("/register"),
            code_challenge_methods_supported : opts.s256 === false ? ["plain"] : ["S256"],
          });
        }
        case "/register": {
          seen.register.push(await req.json());
          return Response.json({ client_id: "cid-1" }, { status: 201 });
        }
        case "/token": {
          const f = new URLSearchParams(await req.text());
          seen.token.push(f);
          if (f.get("resource") !== base + "/mcp" || f.get("client_id") !== "cid-1") {
            return Response.json({ error: "invalid_request" }, { status: 400 });
          }
          if (f.get("grant_type") === "authorization_code") {
            const ok = f.get("code") === "the-code" && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === seen.challenge;
            return ok ? Response.json({ access_token: ACCESS[0], token_type: "Bearer", expires_in: 3600, ...(opts.noRefresh ? {} : { refresh_token: REFRESH[0] }) }) : Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          if (f.get("grant_type") === "refresh_token") {
            refreshes++;
            await Bun.sleep(opts.slowRefresh ?? 0);
            if (opts.refreshFails || f.get("refresh_token") !== REFRESH[0]) {
              return Response.json({ error: "invalid_grant", error_description: "bad " + f.get("refresh_token") }, { status: 400 });
            }
            live = ACCESS[1];
            return Response.json({ access_token: ACCESS[1], token_type: "bearer", expires_in: 3600, refresh_token: REFRESH[1] });
          }
          return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
        }
      }
      return new Response("no", { status: 404 });
    },
  });
  const base = "http://127.0.0.1:" + srv.port;
  return { base, resource: base + "/mcp", seen, refreshes: () => refreshes, stop: () => srv.stop(true) };
}

// the user at the browser: checks the authorize URL, then is sent back
// to the callback with `back`'s query (by default the code and the state)
function browser(f: ReturnType<typeof fake>, back?: (q: URLSearchParams) => string) {
  const asked: URL[] = [];
  const open = async (at: string) => {
    const u = new URL(at);
    asked.push(u);
    f.seen.challenge = u.searchParams.get("code_challenge") ?? "";
    const query = back ? back(u.searchParams) : "code=the-code&state=" + u.searchParams.get("state");
    await fetch(u.searchParams.get("redirect_uri") + "?" + query).catch(() => {});
  };
  return { asked, open };
}

const T = { insecure: true }; // test-only: http on 127.0.0.1

test("a sign-in: discovered from the 401, a public client registered, PKCE S256, state and resource sent; tokens stored (I3, I4, I7)", async () => {
  const f = fake();
  const store = memory();
  const b = browser(f);
  await Auth.login("web", f.resource, store, { ...T, open: b.open });
  f.stop();
  const q = b.asked[0].searchParams;
  expect(b.asked[0].origin + b.asked[0].pathname).toBe(f.base + "/authorize");
  expect([q.get("response_type"), q.get("client_id"), q.get("code_challenge_method"), q.get("resource")]).toEqual(["code", "cid-1", "S256", f.resource]);
  expect(q.get("state")!.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
  expect(q.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  expect(f.seen.register[0]).toMatchObject({ redirect_uris: [q.get("redirect_uri")], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  const code = f.seen.token[0];
  expect([code.get("grant_type"), code.get("redirect_uri"), code.get("resource")]).toEqual(["authorization_code", q.get("redirect_uri"), f.resource]);
  expect(code.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);
  const grant = JSON.parse(store.all.get("web")!);
  expect(grant).toMatchObject({ client_id: "cid-1", resource: f.resource, access_token: ACCESS[0], refresh_token: REFRESH[0], token_endpoint: f.base + "/token" });
  expect(grant.expires_at).toBeGreaterThan(Date.now() + 3500e3);
});

test("a callback with a wrong state, an error, or no code ends the sign-in, no token stored (I5)", async () => {
  for (const back of [(q: URLSearchParams) => "code=the-code&state=" + q.get("state")!.replace(/^./, (c) => (c === "A" ? "B" : "A")), () => "error=access_denied", (q: URLSearchParams) => "state=" + q.get("state")]) {
    const f = fake();
    const store = memory();
    const err = await Auth.login("web", f.resource, store, { ...T, open: browser(f, back).open }).then(() => null, (e) => e);
    f.stop();
    expect(err).toBeInstanceOf(Error);
    expect(store.all.size).toBe(0);
    expect(f.seen.token.length).toBe(0);
  }
});

test("a sign-in nobody completes ends at its time, and its callback port is closed (I6)", async () => {
  const f = fake();
  let redirect = "";
  const err = await Auth.login("web", f.resource, memory(), { ...T, wait: 300, open: async (at) => void (redirect = new URL(at).searchParams.get("redirect_uri")!) }).then(() => null, (e) => e);
  f.stop();
  expect(String(err?.message)).toContain("no sign-in in 0.3 s");
  expect(await fetch(redirect + "?code=x").then(() => "open", () => "closed")).toBe("closed");
});

test("metadata is refused when: http without the test option, issuer or resource not the one asked, no S256 (I2, I3, I4)", async () => {
  const cases: Array<[Opts, object, string]> = [
    [{}, {}, "https"],
    [{ issuer: "https://evil.example/as" }, T, "issuer"],
    [{ resource: "https://other.example/mcp" }, T, "resource"],
    [{ s256: false }, T, "S256"],
  ];
  for (const [opts, o, why] of cases) {
    const f = fake(opts);
    const b = browser(f);
    const err = await Auth.login("web", f.resource, memory(), { ...o, open: b.open }).then(() => null, (e) => e);
    f.stop();
    expect(String(err?.message)).toContain(why);
    expect(b.asked.length).toBe(0);
    expect(f.seen.register.length).toBe(0);
  }
});

test("token: kept until near expiry, then refreshed with the refresh token rotated; two requests at once refresh once (I9)", async () => {
  const f = fake({ slowRefresh: 100 });
  const store = memory();
  await Auth.login("web", f.resource, store, { ...T, open: browser(f).open });
  expect(await Auth.token("web", store, T)).toBe(ACCESS[0]);
  expect(f.refreshes()).toBe(0);
  const g = JSON.parse(store.all.get("web")!);
  await store.set("web", JSON.stringify({ ...g, expires_at: Date.now() + 60e3 })); // inside the 2-minute margin
  const both = await Promise.all([Auth.token("web", store, T), Auth.token("web", store, T)]);
  f.stop();
  expect(both).toEqual([ACCESS[1], ACCESS[1]]);
  expect(f.refreshes()).toBe(1);
  expect(f.seen.token.at(-1)!.get("resource")).toBe(f.resource);
  expect(JSON.parse(store.all.get("web")!)).toMatchObject({ access_token: ACCESS[1], refresh_token: REFRESH[1] });
});

test("token fails closed: none stored, refresh refused, expired with no refresh token; no token in any error (I1, I8)", async () => {
  expect(String(await Auth.token("web", memory(), T).catch((e) => e.message))).toBe("not signed in: legion mcp-login web");
  for (const opts of [{ refreshFails: true }, { noRefresh: true }]) {
    const f = fake(opts);
    const store = memory();
    await Auth.login("web", f.resource, store, { ...T, open: browser(f).open });
    const g = JSON.parse(store.all.get("web")!);
    await store.set("web", JSON.stringify({ ...g, expires_at: Date.now() - 1 }));
    const why = String(await Auth.token("web", store, T).then(() => "no error", (e) => e.message));
    f.stop();
    expect(why).toStartWith("sign in again: legion mcp-login web");
    for (const secret of [...ACCESS, ...REFRESH]) {
      expect(why).not.toContain(secret);
    }
  }
});

test("an oauth server gets its bearer token on every request; without one it is skipped, said once, nothing sent (I8)", async () => {
  const f = fake();
  const store = memory();
  const log: string[] = [];
  const server = { name: "web", url: f.resource, oauth: true };
  const none = await Mcp.list(Mcp.pool([server], { auth: (n) => Auth.token(n, store, T), log: (l) => log.push(l) }), new AbortController().signal);
  expect(none).toEqual([]);
  expect(log).toEqual(["mcp: web skipped: not signed in: legion mcp-login web"]);
  expect(f.seen.mcpAuth.length).toBe(0);
  await Auth.login("web", f.resource, store, { ...T, open: browser(f).open });
  const pool = Mcp.pool([server], { auth: (n) => Auth.token(n, store, T), log: (l) => log.push(l) });
  expect((await Mcp.list(pool, new AbortController().signal)).map((s) => s.name)).toEqual(["mcp__web__getJiraIssue"]);
  expect((await Mcp.call(pool, "mcp__web__getJiraIssue", {}, new AbortController().signal)).text).toBe("ok");
  f.stop();
  const after = f.seen.mcpAuth.slice(-4);
  expect(after.every((a) => a === "Bearer " + ACCESS[0])).toBe(true);
  for (const line of log) {
    for (const secret of [...ACCESS, ...REFRESH]) {
      expect(line).not.toContain(secret);
    }
  }
});

test("logout deletes the grant; the Keychain store round-trips (LEGION_TEST_KEYCHAIN=1 only, a throwaway service) (I1)", async () => {
  const store = memory();
  await store.set("web", "{}");
  expect(await Auth.logout("web", store)).toBe(true);
  expect(store.all.size).toBe(0);
  if (process.env.LEGION_TEST_KEYCHAIN === "1") {
    const kc = Auth.keychain("legion-test-" + crypto.randomUUID());
    await kc.set("web", "secret-value");
    expect(await kc.get("web")).toBe("secret-value");
    expect(await kc.delete("web")).toBe(true);
    expect(await kc.get("web")).toBe(null);
  }
});

// RED ZONE (T1, DRAFT awaiting the user's sign-off): a key behind
// legion-key (local/legion-key), the one program its Keychain item
// trusts, which asks for Touch ID or the password before every read.
// A fake helper (Run) here: no real Keychain, no Touch ID
function helper_fake() {
  const items = new Map<string, string>();
  const old = new Map<string, string>();
  const calls: { args: string[]; input?: string }[] = [];
  let code = 0;
  const run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    const [verb, service] = args;
    if (code !== 0) {
      return { code, out: "" };
    }
    if (verb === "get") {
      return items.has(service) ? { code: 0, out: items.get(service) + "\n" } : old.has(service) ? { code: 45, out: "" } : { code: 44, out: "" };
    }
    if (verb === "set") {
      old.delete(service);
      items.set(service, input!.replace(/\n$/, ""));
      return { code: 0, out: "" };
    }
    const had = items.delete(service) || old.delete(service);
    return { code: had ? 0 : 44, out: "" };
  };
  return { items, old, calls, run, code: (c: number) => (code = c) };
}

test("the present store: set, get, delete through legion-key, the value on its stdin only, never an argument", async () => {
  const h = helper_fake();
  const store = Auth.present("legion-terminal", h.run);
  await store.set("h:1", "tok-0123_abc.def");
  expect(h.calls.at(-1)).toEqual({ args: ["set", "legion-terminal-h:1", "oauth"], input: "tok-0123_abc.def\n" });
  expect(await store.get("h:1")).toBe("tok-0123_abc.def");
  expect(h.calls.at(-1)).toEqual({ args: ["get", "legion-terminal-h:1", "oauth"], input: undefined });
  expect(h.calls.every((c) => !c.args.join(" ").includes("tok-0123"))).toBe(true);
  expect(await store.delete("h:1")).toBe(true);
  expect(await store.get("h:1")).toBe(null);
  expect(await store.delete("h:1")).toBe(false);
  await expect(store.set("h:1", "not a token\n-w x")).rejects.toThrow("not a token");
  expect(h.items.size).toBe(0);
});

test("the present store fails closed: presence refused, no helper, or a broken one, and no value; never the old store", async () => {
  const h = helper_fake();
  h.items.set("legion-terminal-h", "tok");
  const asked: string[][] = [];
  const store = Auth.present("legion-terminal", h.run, { get: async (n) => (asked.push([n]), "tok"), set: async () => {}, delete: async () => true });
  for (const code of [1, 2, 127]) {
    h.code(code);
    await expect(store.get("h")).rejects.toThrow();
    await expect(store.set("h", "tok")).rejects.toThrow();
  }
  expect(asked).toEqual([]);
});

test("the present store moves an item made the old way (45: not legion-key's) once: read from the old store, kept by legion-key", async () => {
  const h = helper_fake();
  h.old.set("legion-signin-h", "oldsecret");
  const reads: string[] = [];
  const old = { get: async (n: string) => (reads.push(n), "oldsecret"), set: async () => {}, delete: async () => true };
  const store = Auth.present("legion-signin", h.run, old);
  expect(await store.get("h")).toBe("oldsecret");
  expect(reads).toEqual(["h"]);
  expect(h.items.get("legion-signin-h")).toBe("oldsecret");
  expect(h.old.has("legion-signin-h")).toBe(false);
  expect(await store.get("h")).toBe("oldsecret");
  expect(reads).toEqual(["h"]);
  // with no old store to read, an old item is refused
  const h2 = helper_fake();
  h2.old.set("legion-signin-h", "oldsecret");
  await expect(Auth.present("legion-signin", h2.run).get("h")).rejects.toThrow("legion login");
});

test("keybin runs legion-key only from a file of this user's, written by no one else; else none (127), nothing run", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-keybin-");
  const bin = dir + "/legion-key";
  expect((await Auth.keybin(bin)(["get", "legion-terminal-h", "oauth"])).code).toBe(127);
  fs.writeFileSync(bin, "#!/bin/sh\necho \"$1 $2 $3\"; cat\n", { mode: 0o700 });
  expect(await Auth.keybin(bin)(["set", "legion-terminal-h", "oauth"], "v\n")).toEqual({ code: 0, out: "set legion-terminal-h oauth\nv\n" });
  fs.chmodSync(bin, 0o722);
  expect((await Auth.keybin(bin)(["get", "legion-terminal-h", "oauth"])).code).toBe(127);
  fs.chmodSync(bin, 0o600);
  expect((await Auth.keybin(bin)(["get", "legion-terminal-h", "oauth"])).code).toBe(127);
});
