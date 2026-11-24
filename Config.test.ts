// Config test
// ===========
// `bun test Config.test.ts`. Security review I: the Claude API's origin
// (anthropic_url, from LITELLM_API_BASE) is https, or http on this
// computer only (a local gateway); any other refuses to start. Each runs
// in its own process, as Config reads the environment once, at import.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const DIR = fs.mkdtempSync(os.tmpdir() + "/unii-config-");
const CODE = 'import { ANTHROPIC_URL } from "./Config.ts"; console.log(ANTHROPIC_URL)';

// Config imported with anthropic_url set: its exit code and output
function start(url: string): { code: number; text: string } {
  const out = Bun.spawnSync([process.execPath, "-e", CODE], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: DIR, UNII_ANTHROPIC_URL: url } });
  return { code: out.exitCode, text: (out.stdout.toString() + out.stderr.toString()).trim() };
}

test("anthropic_url: https, or http on 127.0.0.1, localhost or [::1]", () => {
  for (const url of ["https://litellm.example.com", "http://127.0.0.1:4000", "http://localhost:4000", "http://[::1]:4000"]) {
    expect(start(url)).toEqual({ code: 0, text: url });
  }
});

test("anthropic_url: plain http elsewhere, or no URL, refuses to start", () => {
  for (const url of ["http://litellm.example.com", "http://127.0.0.1.evil.example", "http://10.0.0.5:4000", "ftp://x.example", "not a url"]) {
    const out = start(url);
    expect(out.code).not.toBe(0);
    expect(out.text).toContain("config: anthropic_url");
  }
});

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off):
// X-Forwarded-For is trusted (Cloud.ip) only with UNII_PROXY=1; off by default
test("proxy: on only with UNII_PROXY=1", () => {
  const proxy = (value: string | null) => {
    const env: Record<string, string | undefined> = { ...process.env, UNII_DIR: DIR, UNII_PROXY: value ?? undefined };
    const out = Bun.spawnSync([process.execPath, "-e", 'import { PROXY } from "./Config.ts"; console.log(PROXY)'], { cwd: import.meta.dir, env });
    return out.stdout.toString().trim();
  };
  expect(proxy(null)).toBe("false");
  expect(proxy("0")).toBe("false");
  expect(proxy("true")).toBe("false");
  expect(proxy("1")).toBe("true");
});

// RED ZONE (security review U3, DRAFT awaiting the user's sign-off):
// mcp_reads, the MCP tools auto mode lets by unreviewed (Modes.reviews),
// by whole name; one that is no mcp__<server>__<tool> refuses to start
test("mcp_reads: exact mcp__server__tool names, comma-separated; others refuse to start", () => {
  const reads = (value: string | null) => {
    const env: Record<string, string | undefined> = { ...process.env, UNII_DIR: DIR, UNII_MCP_READS: value ?? undefined };
    const out = Bun.spawnSync([process.execPath, "-e", 'import { MCP_READS } from "./Config.ts"; console.log(JSON.stringify(MCP_READS))'], { cwd: import.meta.dir, env });
    return { code: out.exitCode, text: (out.stdout.toString() + out.stderr.toString()).trim() };
  };
  expect(reads(null)).toEqual({ code: 0, text: "[]" });
  expect(reads("mcp__x__list_pages, mcp__chrome-devtools__take_snapshot")).toEqual({ code: 0, text: '["mcp__x__list_pages","mcp__chrome-devtools__take_snapshot"]' });
  for (const bad of ["mcp__x__*", "list_pages", "mcp__x__", "mcp__x__a b", "my_mcp__x__y"]) {
    const out = reads(bad);
    expect([bad, out.code]).not.toEqual([bad, 0]);
    expect(out.text).toContain("config: mcp_reads");
  }
});

// RED ZONE (security review R6, signed off by the user 2026-11-19): the
// GChat webhook's URL read by the server itself from the login Keychain
// (UNII_GCHAT_KEYCHAIN=1, the launcher's), never from its environment
// (any process of this user reads that: ps -E), and not put back in a
// worker's. The Keychain is a stub here (Auth.security replaced before
// Config loads): the user's own item is never read
const HOOK = "https://chat.googleapis.com/v1/spaces/TESTSPACE/messages?key=FAKEKEY&token=FAKETOKEN-not-real";
const KEYCHAIN = `
import { Auth } from "./Auth.ts";
const calls: string[][] = [];
const fake = async (args: string[]) => (calls.push(args), process.env.STUB === "none" ? { code: 44, out: "" } : { code: 0, out: ${JSON.stringify(HOOK)} + "\\n" });
Auth.security = fake as any;
if (Auth.security !== fake) throw new Error("no stub: the real Keychain would be read");
const c = await import("./Config.ts");
console.log(JSON.stringify({ hook: c.KEYS.gchat === ${JSON.stringify(HOOK)}, other: c.KEYS.gchat === "https://dev.example/hook", empty: c.KEYS.gchat === "", calls, env: "GCHAT_WEBHOOK_URL" in process.env, worker: "GCHAT_WEBHOOK_URL" in c.config_env() }));
`;

function keychain(env: Record<string, string | undefined>): { out: any; err: string } {
  const all = { ...process.env, UNII_DIR: DIR, UNII_GCHAT_KEYCHAIN: undefined, UNII_GCHAT_SPACE: undefined, GCHAT_WEBHOOK_URL: undefined, ...env };
  const out = Bun.spawnSync([process.execPath, "-e", KEYCHAIN], { cwd: import.meta.dir, env: all });
  const text = out.stdout.toString().trim();
  return { out: text === "" ? null : JSON.parse(text), err: out.stderr.toString() };
}

test("gchat webhook: read from the Keychain by the server, never kept in its environment or a worker's", () => {
  const read = [["find-generic-password", "-s", "GCHAT_WEBHOOK_URL", "-w"]];
  const on = { UNII_GCHAT_KEYCHAIN: "1", UNII_GCHAT_SPACE: "spaces/TESTSPACE" };
  expect(keychain(on).out).toEqual({ hook: true, other: false, empty: false, calls: read, env: false, worker: false });
  // Keychain first: a URL left in the environment is not used, and removed
  expect(keychain({ ...on, GCHAT_WEBHOOK_URL: "https://dev.example/hook" }).out).toEqual({ hook: true, other: false, empty: false, calls: read, env: false, worker: false });
  // none kept: the bridge off, said, without a key
  const none = keychain({ ...on, STUB: "none" });
  expect(none.out).toEqual({ hook: false, other: false, empty: true, calls: read, env: false, worker: false });
  expect(none.err).toContain("GChat webhook");
  // no space: the Keychain not asked
  expect(keychain({ UNII_GCHAT_KEYCHAIN: "1" }).out.calls).toEqual([]);
  // off (tests, a server run by hand): the environment's, never the Keychain
  const off = keychain({ UNII_GCHAT_SPACE: "spaces/TESTSPACE", GCHAT_WEBHOOK_URL: "https://dev.example/hook" });
  expect(off.out).toEqual({ hook: false, other: true, empty: false, calls: [], env: false, worker: true });
});

// RED ZONE (security review 3 G1, DRAFT awaiting the user's sign-off):
// with UNII_ANTHROPIC_KEY_FD=3 (the launcher's server_exec) the gateway's
// key is read once, at the start, from fd 3 (a pipe), then the fd closed;
// never from the environment (any process of this user reads that: ps
// -wwE), nor put in a worker's (so no workers then: refused). Without it
// (tests, a server run by hand) ANTHROPIC_API_KEY is read as before. The
// key's length is told, never its value
const FD = `
import * as fs from "node:fs";
const c = await import("./Config.ts");
const env = c.config_env();
let open = true;
try { fs.fstatSync(3); } catch { open = false; }
console.log(JSON.stringify({ len: c.KEYS.anthropic.length, env: "ANTHROPIC_API_KEY" in process.env, told: "UNII_ANTHROPIC_KEY_FD" in process.env, worker: "ANTHROPIC_API_KEY" in env, worker_told: "UNII_ANTHROPIC_KEY_FD" in env, open }));
`;

// Config imported with `key` piped to its fd 3 (null: fd 3 not open)
function piped(key: string | null, env: Record<string, string | undefined>): { code: number; out: any; text: string } {
  const all = { ...process.env, UNII_DIR: DIR, ANTHROPIC_API_KEY: undefined, UNII_ANTHROPIC_KEY_FD: undefined, UNII_WORKERS: undefined, PIPED: key ?? "", ...env };
  const run = key === null ? 'exec "$0" -e "$1" 3<&-' : 'printf "%s" "$PIPED" | exec "$0" -e "$1" 3<&0 </dev/null';
  const out = Bun.spawnSync(["/bin/sh", "-c", run, process.execPath, FD], { cwd: import.meta.dir, env: all });
  const stdout = out.stdout.toString().trim();
  return { code: out.exitCode, out: stdout === "" ? null : JSON.parse(stdout), text: stdout + out.stderr.toString() };
}

test("gateway key: read from fd 3 when told (the launcher's), never from or into an environment", () => {
  const key = "sk-fake-fd-key-0123456789";
  const on = piped(key, { UNII_ANTHROPIC_KEY_FD: "3", ANTHROPIC_API_KEY: "sk-stray-env" });
  expect(on.code).toBe(0);
  expect(on.out).toEqual({ len: key.length, env: false, told: false, worker: false, worker_told: false, open: false });
  expect(on.text).not.toContain(key);
  // a trailing newline is not the key's
  expect(piped(key + "\n", { UNII_ANTHROPIC_KEY_FD: "3" }).out.len).toBe(key.length);
  // none on it, fd 3 not open, or no fd 3-9: no start, said without a key
  for (const [k, fd] of [["", "3"], [null, "3"], [key, "0"], [key, "1"], [key, "abc"], [key, ""]] as [string | null, string][]) {
    const out = piped(k, { UNII_ANTHROPIC_KEY_FD: fd });
    expect([fd, k === null, out.code === 0]).toEqual([fd, k === null, false]);
    expect(out.text).toContain("config: ");
    expect(out.text).not.toContain(key);
  }
  // workers would need it in their environment: refused
  const workers = piped(key, { UNII_ANTHROPIC_KEY_FD: "3", UNII_WORKERS: "2" });
  expect(workers.code).not.toBe(0);
  expect(workers.text).toContain("config: workers");
  expect(workers.text).not.toContain(key);
  // not told (tests, a server run by hand): the environment's, as before (fd 3, closed at the start, is then bun's own: not asked)
  const off = piped(null, { ANTHROPIC_API_KEY: "sk-env-key" });
  expect({ ...off.out, open: undefined }).toEqual({ len: "sk-env-key".length, env: false, told: false, worker: true, worker_told: false, open: undefined });
}, 30_000);

// the roles' models: a tier (claude-api:sonnet:…) or a versioned label,
// from the catalog (Models.ts); only the orchestrator defaults to opus; a
// Claude Code worker runs a full id, sonnet or haiku, never opus; a role
// naming no model of the catalog refuses to start
function roles(env: Record<string, string>, dir = DIR): { code: number; text: string } {
  const code = 'import * as c from "./Config.ts"; console.log(JSON.stringify({ pick: c.PICK.model, manager: c.MANAGER.model, worker: c.WORKER.model, observer: c.OBSERVER.model, claude: c.CLAUDE_WORKER }))';
  const out = Bun.spawnSync([process.execPath, "-e", code], { cwd: import.meta.dir, env: { ...process.env, UNII_DIR: dir, ...env } });
  return { code: out.exitCode, text: (out.stdout.toString() + out.stderr.toString()).trim() };
}

test("roles: only the orchestrator defaults to opus; a Claude Code worker to sonnet's full id", () => {
  const out = roles({});
  expect(out.code).toBe(0);
  expect(JSON.parse(out.text)).toEqual({ pick: "opus-5.5", manager: "sonnet-5.5", worker: "sonnet-5.5", observer: "haiku-5.5", claude: "claude-sonnet-5-5" });
});

test("roles: a tier and a versioned label name the same pick; claude_worker may be haiku", () => {
  const tier = roles({ UNII_MANAGER: "claude-api:haiku:high:slow", UNII_CLAUDE_WORKER: "haiku" });
  const label = roles({ UNII_MANAGER: "claude-api:haiku-5.5:high:slow", UNII_CLAUDE_WORKER: "haiku-5.5" });
  expect(tier.code).toBe(0);
  expect(JSON.parse(tier.text)).toEqual(JSON.parse(label.text));
  expect(JSON.parse(tier.text).claude).toBe("claude-haiku-5-5");
});

test("roles: claude_worker opus, or a role naming no model of the catalog, refuses to start", () => {
  for (const [key, value] of [["UNII_CLAUDE_WORKER", "opus"], ["UNII_CLAUDE_WORKER", "opus-5.5"], ["UNII_CLAUDE_WORKER", "gpt-9"], ["UNII_WORKER", "claude-api:gpt-9:medium:slow"]] as const) {
    const out = roles({ [key]: value });
    expect(out.code).not.toBe(0);
    expect(out.text).toContain("config: " + key.slice(5).toLowerCase());
  }
});

test("roles: config.json's catalog overrides an entry's id", () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-catalog-");
  fs.writeFileSync(dir + "/config.json", JSON.stringify({ catalog: { "claude-api": [{ label: "sonnet-5.5", id: "claude-sonnet-9-9" }] } }));
  const out = roles({}, dir);
  expect(out.code).toBe(0);
  expect(JSON.parse(out.text).claude).toBe("claude-sonnet-9-9");
});
