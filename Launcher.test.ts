// Launcher test
// =============
// `bun test Launcher.test.ts`. RED ZONE (security review M2): local/legion
// (local/unii-local.sh, the same file) starts the terminal and `legion
// device` with none of the gateway's or vendors' secrets in their
// environment, so no job they run inherits one. A fake bun on PATH tells
// the names it was given (never a value).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const SECRETS = ["LITELLM_API_KEY", "LITELLM_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "RESEND_API_KEY", "APNS_KEY", "GCHAT_WEBHOOK_URL"];

test("local/legion and unii-local.sh are one file", () => {
  expect(fs.readFileSync(import.meta.dir + "/local/legion", "utf8")).toBe(fs.readFileSync(import.meta.dir + "/local/unii-local.sh", "utf8"));
});

test("the terminal is started with no secret in its environment", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  fs.writeFileSync(bin + "/bun", "#!/bin/sh\nenv | cut -d= -f1\n");
  fs.chmodSync(bin + "/bun", 0o755);
  const env: Record<string, string> = { PATH: bin + ":/usr/bin:/bin", HOME: os.homedir(), UNII_DIR: fs.mkdtempSync(os.tmpdir() + "/legion-dir-"), LITELLM_API_BASE: "http://gw.example" };
  for (const k of SECRETS) {
    env[k] = "fake";
  }
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "version"], { env });
  const names = out.stdout.toString().split("\n");
  expect(names).toContain("UNII_IMPORT_DIRS");
  expect(SECRETS.filter((k) => names.includes(k))).toEqual([]);
});

// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
// launcher asks whether the server is up over its unix socket, so a
// process squatting the TCP port is not taken for it
test("the launcher sees the server up over its socket, not the TCP port", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  const said = bin + "/curl.args";
  fs.writeFileSync(bin + "/curl", "#!/bin/sh\necho \"$@\" >>" + JSON.stringify(said) + "\n");
  fs.chmodSync(bin + "/curl", 0o755);
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-dir-");
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "start"], { env: { PATH: bin + ":/usr/bin:/bin", HOME: os.homedir(), UNII_DIR: dir } });
  expect(out.exitCode).toBe(0);
  expect(fs.readFileSync(said, "utf8")).toContain("--unix-socket " + dir + "/server.sock");
});

// `legion server --install`: a launchd agent (at login, kept alive) runs
// the server with no terminal open, so routines run (Server.ts Chat.free);
// its plist holds paths and settings only, never a key: the server reads
// the gateway's key at its start from the helper named (UNII_KEY_HELPER,
// e.g. Claude Code's apiKeyHelper). launchctl and plutil are fakes here,
// so nothing is installed
function fakes(): { bin: string; home: string; dir: string; said: string; helper: string } {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  const said = bin + "/launchctl.args";
  fs.writeFileSync(bin + "/launchctl", "#!/bin/sh\necho \"$@\" >>" + JSON.stringify(said) + "\n");
  fs.writeFileSync(bin + "/plutil", "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(bin + "/bun", "#!/bin/sh\nenv | cut -d= -f1\n");
  const helper = bin + "/key-helper";
  fs.writeFileSync(helper, "#!/bin/sh\necho fake-key-from-helper\n");
  for (const f of ["launchctl", "plutil", "bun", "key-helper"]) {
    fs.chmodSync(bin + "/" + f, 0o755);
  }
  return { bin, home: fs.mkdtempSync(os.tmpdir() + "/legion-home-"), dir: fs.mkdtempSync(os.tmpdir() + "/legion-dir-"), said, helper };
}

test("legion server --install writes a launchd agent with paths only, no secret, and loads it", () => {
  const f = fakes();
  const env = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, UNII_DIR: f.dir, LITELLM_API_BASE: "https://gw.example", LITELLM_API_KEY: "sk-secret-value", UNII_KEY_HELPER: f.helper };
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server", "--install"], { env });
  expect(out.exitCode).toBe(0);
  const plist = fs.readFileSync(f.home + "/Library/LaunchAgents/com.oncorps.legion.server.plist", "utf8");
  expect(plist).toContain("<key>Label</key><string>com.oncorps.legion.server</string>");
  expect(plist).toContain("<string>" + import.meta.dir + "/local/unii-local.sh</string><string>server-run</string>");
  expect(plist).toContain("<key>UNII_KEY_HELPER</key><string>" + f.helper + "</string>");
  expect(plist).toContain("<key>LITELLM_API_BASE</key><string>https://gw.example</string>");
  expect(plist).toContain("<key>KeepAlive</key><true/>");
  expect(plist).toContain("<string>" + f.dir + "/server.log</string>");
  expect(plist).not.toContain("sk-secret-value");
  expect(plist).not.toContain("fake-key-from-helper");
  expect(SECRETS.filter((k) => plist.includes(k))).toEqual([]);
  expect(fs.readFileSync(f.said, "utf8")).toContain("bootstrap gui/");
  // the device's agent is another label, left alone
  expect(fs.existsSync(f.home + "/Library/LaunchAgents/com.oncorps.legion.device.plist")).toBe(false);
});

test("legion server --install refuses with no key helper, or one not an executable absolute path", () => {
  for (const helper of [undefined, "relative/helper", "/nonexistent/helper"]) {
    const f = fakes();
    const env: Record<string, string> = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, UNII_DIR: f.dir, LITELLM_API_BASE: "https://gw.example" };
    if (helper !== undefined) {
      env.UNII_KEY_HELPER = helper;
    }
    const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server", "--install"], { env });
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr.toString()).toContain("UNII_KEY_HELPER");
    expect(fs.existsSync(f.home + "/Library/LaunchAgents/com.oncorps.legion.server.plist")).toBe(false);
  }
});

test("legion server-run (the agent's) takes the gateway's key from its helper, and fails with none", () => {
  const f = fakes();
  const env = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, UNII_DIR: f.dir, LITELLM_API_BASE: "https://gw.example", UNII_KEY_HELPER: f.helper, GCHAT_WEBHOOK_URL: "fake" };
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server-run"], { env });
  expect(out.exitCode).toBe(0);
  const names = out.stdout.toString().split("\n");
  expect(names).toContain("ANTHROPIC_API_KEY");
  expect(names).toContain("UNII_ANTHROPIC_URL");
  // RED ZONE (security review R6, signed off by the user 2026-11-19):
  // the GChat webhook's URL never in the server's environment (any
  // process of this user reads it: ps -E); the server reads the Keychain
  expect(names).not.toContain("GCHAT_WEBHOOK_URL");
  expect(names).toContain("UNII_GCHAT_KEYCHAIN");
  const none = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server-run"], { env: { ...env, UNII_KEY_HELPER: "" } });
  expect(none.exitCode).not.toBe(0);
  expect(none.stdout.toString()).not.toContain("ANTHROPIC_API_KEY");
});
