// Launcher test
// =============
// `bun test Launcher.test.ts`. RED ZONE (security review M2): local/legion
// (local/legion, the same file) starts the terminal and `legion
// device` with none of the gateway's or vendors' secrets in their
// environment, so no job they run inherits one. A fake bun on PATH tells
// the names it was given (never a value).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

const SECRETS = ["LITELLM_API_KEY", "LITELLM_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "RESEND_API_KEY", "APNS_KEY", "GCHAT_WEBHOOK_URL"];

test("local/legion and legion are one file", () => {
  expect(fs.readFileSync(import.meta.dir + "/local/legion", "utf8")).toBe(fs.readFileSync(import.meta.dir + "/local/legion", "utf8"));
});

test("the terminal is started with no secret in its environment", () => {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  fs.writeFileSync(bin + "/bun", "#!/bin/sh\nenv | cut -d= -f1\n");
  fs.chmodSync(bin + "/bun", 0o755);
  const env: Record<string, string> = { PATH: bin + ":/usr/bin:/bin", HOME: os.homedir(), LEGION_DIR: fs.mkdtempSync(os.tmpdir() + "/legion-dir-"), LITELLM_API_BASE: "http://gw.example" };
  for (const k of SECRETS) {
    env[k] = "fake";
  }
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "version"], { env });
  const names = out.stdout.toString().split("\n");
  expect(names).toContain("LEGION_IMPORT_DIRS");
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
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "start"], { env: { PATH: bin + ":/usr/bin:/bin", HOME: os.homedir(), LEGION_DIR: dir } });
  expect(out.exitCode).toBe(0);
  expect(fs.readFileSync(said, "utf8")).toContain("--unix-socket " + dir + "/server.sock");
});

// `legion server --install`: a launchd agent (at login, kept alive) runs
// the server with no terminal open, so routines run (Server.ts Chat.free);
// its plist holds paths and settings only, never a key: the server reads
// the gateway's key at its start from the helper named (LEGION_KEY_HELPER,
// e.g. Claude Code's apiKeyHelper). launchctl and plutil are fakes here,
// so nothing is installed. The fake bun tells the names of its
// environment; started on Server.ts, also its arguments and the length
// of what it reads on fd 3 (the gateway's key: never its value)
const BUN = `#!/bin/sh
env | cut -d= -f1
case "$1" in
  */Server.ts) echo "ARGS=$*"; n=$( { cat <&3; } 2>/dev/null | wc -c | tr -d ' '); echo "KEYLEN=$n" ;;
esac
`;
function fakes(): { bin: string; home: string; dir: string; said: string; helper: string } {
  const bin = fs.mkdtempSync(os.tmpdir() + "/legion-bin-");
  const said = bin + "/launchctl.args";
  fs.writeFileSync(bin + "/launchctl", "#!/bin/sh\necho \"$@\" >>" + JSON.stringify(said) + "\n");
  fs.writeFileSync(bin + "/plutil", "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(bin + "/bun", BUN);
  const helper = bin + "/key-helper";
  fs.writeFileSync(helper, "#!/bin/sh\necho fake-key-from-helper\n");
  for (const f of ["launchctl", "plutil", "bun", "key-helper"]) {
    fs.chmodSync(bin + "/" + f, 0o755);
  }
  return { bin, home: fs.mkdtempSync(os.tmpdir() + "/legion-home-"), dir: fs.mkdtempSync(os.tmpdir() + "/legion-dir-"), said, helper };
}

test("legion server --install writes a launchd agent with paths only, no secret, and loads it", () => {
  const f = fakes();
  const env = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, LEGION_DIR: f.dir, LITELLM_API_BASE: "https://gw.example", LITELLM_API_KEY: "sk-secret-value", LEGION_KEY_HELPER: f.helper };
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server", "--install"], { env });
  expect(out.exitCode).toBe(0);
  const plist = fs.readFileSync(f.home + "/Library/LaunchAgents/com.oncorps.legion.server.plist", "utf8");
  expect(plist).toContain("<key>Label</key><string>com.oncorps.legion.server</string>");
  expect(plist).toContain("<string>" + import.meta.dir + "/local/legion</string><string>server-run</string>");
  expect(plist).toContain("<key>LEGION_KEY_HELPER</key><string>" + f.helper + "</string>");
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
    const env: Record<string, string> = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, LEGION_DIR: f.dir, LITELLM_API_BASE: "https://gw.example" };
    if (helper !== undefined) {
      env.LEGION_KEY_HELPER = helper;
    }
    const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server", "--install"], { env });
    expect(out.exitCode).not.toBe(0);
    expect(out.stderr.toString()).toContain("LEGION_KEY_HELPER");
    expect(fs.existsSync(f.home + "/Library/LaunchAgents/com.oncorps.legion.server.plist")).toBe(false);
  }
});

test("legion server-run (the agent's) takes the gateway's key from its helper, and fails with none", () => {
  const f = fakes();
  const env = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, LEGION_DIR: f.dir, LITELLM_API_BASE: "https://gw.example", LEGION_KEY_HELPER: f.helper, GCHAT_WEBHOOK_URL: "fake" };
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server-run"], { env });
  expect(out.exitCode).toBe(0);
  const names = out.stdout.toString().split("\n");
  expect(names).toContain("LEGION_ANTHROPIC_URL");
  // RED ZONE (security review 3 G1, DRAFT awaiting the user's sign-off):
  // the key reaches the server on fd 3, never in its environment or
  // arguments (and not in those of the launcher's other bun runs)
  expect(names).toContain("KEYLEN=" + "fake-key-from-helper".length);
  expect(names).toContain("LEGION_ANTHROPIC_KEY_FD");
  expect(names).not.toContain("ANTHROPIC_API_KEY");
  expect(names).not.toContain("LITELLM_API_KEY");
  expect(out.stdout.toString()).not.toContain("fake-key-from-helper");
  // the launcher's own bun runs before it (skills, MCP: their output on
  // stderr) don't get it either: it is not exported
  const before = out.stderr.toString().split("\n");
  expect(before).toContain("LEGION_KEY_HELPER");
  expect(["LITELLM_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => before.includes(k))).toEqual([]);
  // RED ZONE (security review R6, signed off by the user 2026-11-19):
  // the GChat webhook's URL never in the server's environment (any
  // process of this user reads it: ps -E); the server reads the Keychain
  expect(names).not.toContain("GCHAT_WEBHOOK_URL");
  expect(names).toContain("LEGION_GCHAT_KEYCHAIN");
  const none = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "server-run"], { env: { ...env, LEGION_KEY_HELPER: "" } });
  expect(none.exitCode).not.toBe(0);
  expect(none.stdout.toString()).not.toContain("ANTHROPIC_API_KEY");
});

// RED ZONE (security review 3 G1, DRAFT awaiting the user's sign-off): the
// server started from a shell (`legion serve`; `legion` and `legion start`
// run the same server_exec) gets the gateway's key on fd 3, with neither
// ANTHROPIC_API_KEY nor LITELLM_API_KEY in its environment, which any
// process of this user reads (ps -wwE); with no key it doesn't start
test("legion serve hands the server the gateway's key on fd 3, none in its environment", () => {
  const f = fakes();
  const key = "sk-fake-gateway-key-0123";
  const env = { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, LEGION_DIR: f.dir, LITELLM_API_BASE: "https://gw.example", LITELLM_API_KEY: key, ANTHROPIC_API_KEY: "sk-stray", LITELLM_KEY: "sk-stray", ANTHROPIC_AUTH_TOKEN: "sk-stray" };
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "serve"], { env });
  expect(out.exitCode).toBe(0);
  const text = out.stdout.toString();
  const names = text.split("\n");
  expect(names).toContain("KEYLEN=" + key.length);
  expect(names).toContain("LEGION_ANTHROPIC_KEY_FD");
  expect(SECRETS.filter((k) => names.includes(k))).toEqual([]);
  expect(text).not.toContain(key);
  expect(text).not.toContain("sk-stray");
  const none = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "serve"], { env: { ...env, LITELLM_API_KEY: "" } });
  expect(none.exitCode).not.toBe(0);
  expect(none.stdout.toString()).not.toContain("ARGS=");
});

// RED ZONE (T1, DRAFT awaiting the user's sign-off): before the terminal,
// `legion login` or `legion web` need it, the launcher builds legion-key
// (local/legion-key/main.swift: swiftc -O, then ad hoc signed with the
// hardened runtime) into <LEGION_DIR>/bin, 0700, only when its source
// changed (its sha256 kept beside it) or it is gone. No swiftc (or a
// failed build): no helper, said loudly with how to get one, and the
// terminal still starts (keyless: Term.ts fails closed). swiftc and
// codesign are fakes here, logging their arguments
function builders(swiftc_ok = true): { bin: string; dir: string; log: string; env: Record<string, string> } {
  const f = fakes();
  const log = f.bin + "/build.log";
  fs.writeFileSync(f.bin + "/swiftc", "#!/bin/sh\necho \"swiftc $*\" >>" + JSON.stringify(log) + "\n" + (swiftc_ok ? "while [ $# -gt 0 ]; do if [ \"$1\" = -o ]; then printf '#!/bin/sh\\n' >\"$2\"; fi; shift; done\n" : "echo 'xcrun: error: invalid active developer path' >&2; exit 1\n"));
  fs.writeFileSync(f.bin + "/codesign", "#!/bin/sh\necho \"codesign $*\" >>" + JSON.stringify(log) + "\n");
  fs.writeFileSync(f.bin + "/curl", "#!/bin/sh\nexit 0\n");
  for (const n of ["swiftc", "codesign", "curl"]) {
    fs.chmodSync(f.bin + "/" + n, 0o755);
  }
  return { bin: f.bin, dir: f.dir, log, env: { PATH: f.bin + ":/usr/bin:/bin", HOME: f.home, LEGION_DIR: f.dir } };
}
const builds = (log: string) => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter((l) => l.startsWith("swiftc ")) : []);

test("the launcher builds legion-key, signs it, 0700, before login, web and the terminal; again only when its source changed", () => {
  const b = builders();
  const key = b.dir + "/bin/legion-key";
  const src = import.meta.dir + "/local/legion-key/main.swift";
  const first = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "login"], { env: b.env });
  expect(first.exitCode).toBe(0);
  expect(first.stdout.toString().split("\n")).toContain("LEGION_IMPORT_DIRS");
  expect(builds(b.log)).toHaveLength(1);
  expect(builds(b.log)[0]).toContain("-O");
  expect(builds(b.log)[0]).toContain(src);
  const signed = fs.readFileSync(b.log, "utf8").split("\n").find((l) => l.startsWith("codesign "))!;
  expect(signed).toContain("-s - ");
  expect(signed).toContain("-o runtime");
  expect(signed).toContain("--force");
  expect(fs.statSync(key).mode & 0o777).toBe(0o700);
  expect(fs.statSync(b.dir + "/bin").mode & 0o777).toBe(0o700);
  expect(fs.readFileSync(key + ".sha256", "utf8").trim()).toBe(new Bun.CryptoHasher("sha256").update(fs.readFileSync(src)).digest("hex"));
  // the same source: not built again, by login, web or the terminal
  for (const args of [["login"], ["web"], []]) {
    expect(Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", ...args], { env: b.env }).exitCode).toBe(0);
  }
  expect(builds(b.log)).toHaveLength(1);
  // another source (its hash not the kept one), or the helper gone: built again
  fs.writeFileSync(key + ".sha256", "0".repeat(64) + "\n");
  Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "login"], { env: b.env });
  expect(builds(b.log)).toHaveLength(2);
  fs.rmSync(key);
  Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "web"], { env: b.env });
  expect(builds(b.log)).toHaveLength(3);
  // commands that read no key build nothing
  Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "version"], { env: b.env });
  expect(builds(b.log)).toHaveLength(3);
});

test("no swiftc: no legion-key, said loudly with xcode-select --install; the terminal still starts (keyless)", () => {
  const b = builders(false);
  const out = Bun.spawnSync(["/bin/bash", import.meta.dir + "/local/legion", "login"], { env: b.env });
  expect(out.exitCode).toBe(0);
  expect(out.stdout.toString().split("\n")).toContain("LEGION_IMPORT_DIRS");
  const err = out.stderr.toString();
  expect(err).toContain("xcode-select --install");
  expect(err).toContain("legion-key");
  expect(fs.existsSync(b.dir + "/bin/legion-key")).toBe(false);
  expect(fs.existsSync(b.dir + "/bin/legion-key.sha256")).toBe(false);
});
