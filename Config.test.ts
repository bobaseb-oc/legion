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

// RED ZONE (security review R6, DRAFT awaiting the user's sign-off): the
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
