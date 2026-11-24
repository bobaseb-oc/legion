// Hooks test
// ==========
// `bun test Hooks.test.ts`. Claude Code's PreToolUse/PostToolUse hooks
// gating the device tools: what each hook is told, what refuses a call,
// which failures refuse it (a managed hook's) and which only warn.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Hooks, type Source } from "./Hooks.ts";
import { Machine } from "./Machine.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/legion-hooks-");
const live = () => new AbortController().signal;

// a hook script: its body (sh), made executable; a settings file with these
// PreToolUse (and PostToolUse) groups
function script(name: string, body: string): string {
  const file = DIR + "/" + name;
  fs.writeFileSync(file, "#!/bin/sh\n" + body + "\n");
  fs.chmodSync(file, 0o755);
  return file;
}
function settings(name: string, pre: object[], post: object[] = [], more: object = {}): string {
  const file = DIR + "/" + name + ".json";
  fs.writeFileSync(file, JSON.stringify({ hooks: { PreToolUse: pre, PostToolUse: post }, ...more }));
  return file;
}
const group = (matcher: string, command: string, timeout?: number) => ({ matcher, hooks: [{ type: "command", command, timeout }] });

test("Legion's tools are told to hooks under Claude Code's names and input shapes", () => {
  const cwd = "/r";
  expect(Hooks.calls({ name: "shell", input: { command: "ls" }, cwd: "x" }, cwd)).toEqual([{ tool: "Bash", input: { command: "ls" } }]);
  expect(Hooks.calls({ name: "read", input: { path: "a.ts", offset: 2, limit: 5 }, cwd: "x" }, cwd)).toEqual([{ tool: "Read", input: { file_path: "/r/a.ts", offset: 2, limit: 5 } }]);
  expect(Hooks.calls({ name: "write", input: { path: "/abs/b", content: "hi" }, cwd: "x" }, cwd)).toEqual([{ tool: "Write", input: { file_path: "/abs/b", content: "hi" } }]);
  expect(Hooks.calls({ name: "edit", input: { edits: [{ path: "a", old: "1", new: "2" }, { path: "b", old: "3", new: "4", all: true }] }, cwd: "x" }, cwd)).toEqual([
    { tool: "Edit", input: { file_path: "/r/a", old_string: "1", new_string: "2", replace_all: false } },
    { tool: "Edit", input: { file_path: "/r/b", old_string: "3", new_string: "4", replace_all: true } },
  ]);
  expect(Hooks.calls({ name: "glob", input: { pattern: "**/*.ts", path: "src" }, cwd: "x" }, cwd)).toEqual([{ tool: "Glob", input: { pattern: "**/*.ts", path: "/r/src" } }]);
  expect(Hooks.calls({ name: "grep", input: { pattern: "a+", mode: "content", ignore_case: true, glob: "*.ts", context: 2 }, cwd: "x" }, cwd)).toEqual([{ tool: "Grep", input: { pattern: "a+", path: "/r", output_mode: "content", glob: "*.ts", "-i": true, "-C": 2 } }]);
  // computer and claude (Claude Code itself, with its own hooks) are not told
  expect(Hooks.calls({ name: "computer", input: { action: "screenshot" }, cwd: "x" }, cwd)).toEqual([]);
  expect(Hooks.calls({ name: "claude", input: { task: "t" }, cwd: "x" }, cwd)).toEqual([]);
});

test("a hook gets Claude Code's stdin JSON, runs in the tool's dir, and allows on exit 0", async () => {
  const seen = DIR + "/seen.json";
  const hook = script("echo.sh", `cat > ${seen}; pwd >> ${seen}.cwd; echo "$CLAUDE_PROJECT_DIR" >> ${seen}.cwd`);
  const src: Source[] = [{ file: settings("echo", [group("Bash", hook)]), managed: true }];
  const gate = await Hooks.pre(src, "Bash", { command: "ls -la" }, DIR, "Ann", live());
  expect(gate).toEqual({ deny: null, warn: [] });
  const told = JSON.parse(fs.readFileSync(seen, "utf8"));
  expect(told).toMatchObject({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls -la" }, cwd: DIR, session_id: "Ann" });
  const [pwd, proj] = fs.readFileSync(seen + ".cwd", "utf8").trim().split("\n");
  expect(fs.realpathSync(pwd!)).toBe(fs.realpathSync(DIR));
  expect(proj).toBe(DIR);
});

test("exit 2 refuses with the hook's stderr; deny JSON refuses with its reason; ask refuses too", async () => {
  const two  = script("two.sh", `echo "no force pushes" >&2; exit 2`);
  const json = script("json.sh", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"blocked by guard"}}'`);
  const ask  = script("ask.sh", `echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"confirm?"}}'`);
  const s = (f: string): Source[] => [{ file: settings(f, [group("Bash", DIR + "/" + f + ".sh")]), managed: false }];
  expect((await Hooks.pre(s("two"), "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("no force pushes");
  expect((await Hooks.pre(s("json"), "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("blocked by guard");
  expect((await Hooks.pre(s("ask"), "Bash", { command: "x" }, DIR, "A", live())).deny).toContain("confirm?");
  void two; void json; void ask;
});

test("a systemMessage warns and allows; a matcher that misses runs nothing", async () => {
  const warn = script("warn.sh", `echo '{"systemMessage":"careful: rm"}'`);
  const boom = script("boom.sh", `exit 2`);
  const src: Source[] = [{ file: settings("warn", [group("Bash", warn), group("Edit|Write", boom)]), managed: true }];
  expect(await Hooks.pre(src, "Bash", { command: "rm x" }, DIR, "A", live())).toEqual({ deny: null, warn: ["careful: rm"] });
  expect((await Hooks.pre(src, "Write", { file_path: "/a", content: "" }, DIR, "A", live())).deny).not.toBeNull();
  expect((await Hooks.pre(src, "Read", { file_path: "/a" }, DIR, "A", live())).deny).toBeNull();
  // "*" and "" match every tool
  const all: Source[] = [{ file: settings("all", [group("*", boom), group("", boom)]), managed: false }];
  expect((await Hooks.pre(all, "Read", { file_path: "/a" }, DIR, "A", live())).deny).not.toBeNull();
});

test("a managed hook that can't run refuses (fail closed); a user hook that can't run only warns", async () => {
  const crash = script("crash.sh", `exit 7`);
  const slow  = script("slow.sh", `sleep 5`);
  const gone  = DIR + "/no-such-hook";
  for (const cmd of [crash, gone]) {
    const m = await Hooks.pre([{ file: settings("m", [group("Bash", cmd)]), managed: true }], "Bash", { command: "x" }, DIR, "A", live());
    expect(m.deny).toContain("managed hook");
    const u = await Hooks.pre([{ file: settings("u", [group("Bash", cmd)]), managed: false }], "Bash", { command: "x" }, DIR, "A", live());
    expect(u.deny).toBeNull();
    expect(u.warn.length).toBe(1);
  }
  const t0 = Date.now();
  const timed = await Hooks.pre([{ file: settings("t", [group("Bash", slow, 0.3)]), managed: true }], "Bash", { command: "x" }, DIR, "A", live());
  expect(timed.deny).toContain("timed out");
  expect(Date.now() - t0).toBeLessThan(3000);
});

test("a managed settings file that can't be read refuses; a missing one is no hooks", async () => {
  const bad = DIR + "/bad.json";
  fs.writeFileSync(bad, "{ not json");
  expect((await Hooks.pre([{ file: bad, managed: true }], "Bash", { command: "x" }, DIR, "A", live())).deny).toContain("managed");
  expect((await Hooks.pre([{ file: bad, managed: false }], "Bash", { command: "x" }, DIR, "A", live())).deny).toBeNull();
  expect(await Hooks.pre([{ file: DIR + "/none.json", managed: true }], "Bash", { command: "x" }, DIR, "A", live())).toEqual({ deny: null, warn: [] });
});

test("allowManagedHooksOnly drops user hooks; a user's disableAllHooks can't drop managed ones", async () => {
  const deny = script("deny.sh", `echo user >&2; exit 2`);
  const mdeny = script("mdeny.sh", `echo managed >&2; exit 2`);
  const only: Source[] = [
    { file: settings("only", [], [], { allowManagedHooksOnly: true }), managed: true },
    { file: settings("user1", [group("Bash", deny)]), managed: false },
  ];
  expect((await Hooks.pre(only, "Bash", { command: "x" }, DIR, "A", live())).deny).toBeNull();
  const off: Source[] = [
    { file: settings("man", [group("Bash", mdeny)]), managed: true },
    { file: settings("user2", [group("Bash", deny)], [], { disableAllHooks: true }), managed: false },
  ];
  expect((await Hooks.pre(off, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("managed");
});

// security review M3: an agent may write its project's settings (a shell
// can), so a project's disableAllHooks drops nothing: the user's hooks
// and the project's own still run; the user's still drops theirs
test("a project's disableAllHooks drops no hook; the project's settings are marked as its", async () => {
  const deny = script("pdeny.sh", `echo user >&2; exit 2`);
  const proj = script("pown.sh", `echo project >&2; exit 2`);
  const repo = fs.mkdtempSync(DIR + "/proj-");
  expect(Hooks.sources(repo).filter((s) => s.project === true).map((s) => s.file)).toEqual([repo + "/.claude/settings.json", repo + "/.claude/settings.local.json"]);
  expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed && s.plugin === undefined).map((s) => s.file)).toEqual([os.homedir() + "/.claude/settings.json"]);
  const src: Source[] = [
    { file: settings("puser", [group("Bash", deny)]), managed: false },
    { file: settings("pproj", [], [], { disableAllHooks: true }), managed: false, project: true },
  ];
  expect((await Hooks.pre(src, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("user");
  const own: Source[] = [{ file: settings("pproj2", [group("Bash", proj)], [], { disableAllHooks: true }), managed: false, project: true }];
  expect((await Hooks.pre(own, "Bash", { command: "x" }, DIR, "A", live())).deny).toBe("project");
});

test("PostToolUse hooks get the tool's response; exit 2 gives the model their stderr", async () => {
  const seen = DIR + "/post.json";
  const post = script("post.sh", `cat > ${seen}; echo "lint failed" >&2; exit 2`);
  const src: Source[] = [{ file: settings("post", [], [group("Write", post)]), managed: false }];
  const note = await Hooks.post(src, "Write", { file_path: "/a", content: "x" }, { text: "ok", fail: false }, DIR, "A", live());
  expect(note).toEqual(["lint failed"]);
  expect(JSON.parse(fs.readFileSync(seen, "utf8"))).toMatchObject({ hook_event_name: "PostToolUse", tool_name: "Write", tool_response: { text: "ok" } });
});

test("Machine.run refuses a denied shell before it runs, and runs an allowed one", async () => {
  const mark = DIR + "/ran";
  const guard = script("guard.sh", `grep -q force && { echo "force push blocked" >&2; exit 2; }; exit 0`);
  const src: Source[] = [{ file: settings("run", [group("Bash", guard)]), managed: true }];
  const no = await Machine.run({ name: "shell", input: { command: "touch " + mark + " # --force" }, cwd: "Ann" }, DIR, live(), undefined, undefined, src);
  expect(no).toEqual({ text: "Refused by a hook: force push blocked", fail: true });
  expect(fs.existsSync(mark)).toBe(false);
  const yes = await Machine.run({ name: "shell", input: { command: "touch " + mark }, cwd: "Ann" }, DIR, live(), undefined, undefined, src);
  expect(yes.fail).toBe(false);
  expect(fs.existsSync(mark)).toBe(true);
  // an edit is refused whole when one of its files is denied: no file changes
  fs.mkdirSync(DIR + "/Ann", { recursive: true });
  fs.writeFileSync(DIR + "/Ann/a", "1");
  const eg = script("eg.sh", `grep -q secret && exit 2; exit 0`);
  const es: Source[] = [{ file: settings("edit", [group("Edit", eg)]), managed: true }];
  const edit = await Machine.run({ name: "edit", input: { edits: [{ path: "a", old: "1", new: "2" }, { path: "secret", old: "x", new: "y" }] }, cwd: "Ann" }, DIR, live(), undefined, undefined, es);
  expect(edit.fail).toBe(true);
  expect(fs.readFileSync(DIR + "/Ann/a", "utf8")).toBe("1");
});

// the real OnCorps guard, where it is installed: a critical command refused
const GUARD = "/Library/Application Support/OnCorps/claude-guard/guard.py";
test.skipIf(!fs.existsSync(GUARD))("the installed OnCorps guard refuses a critical command through Legion", async () => {
  const src: Source[] = [{ file: settings("oncorps", [group("Bash", `'${GUARD}'`)]), managed: true }];
  const bad = await Hooks.pre(src, "Bash", { command: "rm -rf /" }, DIR, "A", live());
  expect(bad.deny).toContain("OnCorps guard");
  expect((await Hooks.pre(src, "Bash", { command: "ls" }, DIR, "A", live())).deny).toBeNull();
});

// RED ZONE (security review follow-up, DRAFT awaiting the user's
// sign-off): Claude Code reads the user's settings from $CLAUDE_CONFIG_DIR
// when it is set (else ~/.claude): so does Hooks.sources, and write and
// edit refuse all of it, by its path or real one, in any case
test("the user's settings come from $CLAUDE_CONFIG_DIR, and write and edit refuse it", async () => {
  const was = process.env.CLAUDE_CONFIG_DIR;
  const conf = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-conf-"));
  fs.symlinkSync(conf, DIR + "/conflink");
  const repo = fs.mkdtempSync(DIR + "/cproj-");
  try {
    process.env.CLAUDE_CONFIG_DIR = DIR + "/conflink";
    expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed && s.plugin === undefined).map((s) => s.file)).toEqual([DIR + "/conflink/settings.json"]);
    for (const p of [conf + "/settings.json", conf.toUpperCase() + "/hooks/x.sh", DIR + "/conflink/agents/x.md", os.homedir() + "/.claude/x.md"]) {
      expect([p, Machine.gating(p)]).toEqual([p, true]);
    }
    const run = await Machine.run({ name: "write", input: { path: conf + "/Settings.json", content: "{}" }, cwd: "C" }, DIR, live(), undefined, undefined, []);
    expect(run.fail).toBe(true);
    expect(fs.readdirSync(conf)).toEqual([]);
    expect(Machine.gating(repo + "/notes.md")).toBe(false);
    process.env.CLAUDE_CONFIG_DIR = "";
    expect(Hooks.sources(repo).filter((s) => s.project !== true && !s.managed && s.plugin === undefined).map((s) => s.file)).toEqual([os.homedir() + "/.claude/settings.json"]);
  } finally {
    was === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = was);
  }
});

// the one plugin whose hooks gate Legion: its name and its marketplace
const OCKEY = "oc-coding-assistant@oncorps-shared-skills";

// a Claude Code dir with plugins: each [name@market, enabled, scope], its
// hooks.json giving a PreToolUse Bash hook that runs `body`
function plugged(list: [string, boolean, string][], body = "exit 0", more: object = {}): string {
  const conf = fs.mkdtempSync(DIR + "/plug-");
  const enabled: Record<string, boolean> = {};
  const installed: Record<string, object[]> = {};
  for (const [key, on, scope] of list) {
    const root = conf + "/plugins/cache/" + key.replace("@", "/") + "/1.0";
    fs.mkdirSync(root + "/hooks", { recursive: true });
    fs.writeFileSync(root + "/hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [group("Bash", body)] } }));
    enabled[key] = on;
    installed[key] = [{ scope, installPath: root }];
  }
  fs.writeFileSync(conf + "/settings.json", JSON.stringify({ enabledPlugins: enabled, ...more }));
  fs.writeFileSync(conf + "/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: installed }));
  return conf;
}
async function within<T>(conf: string, f: () => Promise<T> | T): Promise<T> {
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = conf;
  try {
    return await f();
  } finally {
    was === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = was);
  }
}

test("only an enabled, user-installed oc-coding-assistant's hooks join the sources, with its root", async () => {
  const conf = plugged([[OCKEY, true, "user"], ["coding-assistant@home", true, "user"], ["claude-mem@m", true, "user"], ["other@m", true, "user"]]);
  const plugs = await within(conf, () => Hooks.sources(DIR).filter((s) => s.plugin !== undefined));
  const root = conf + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0";
  expect(plugs).toEqual([{ file: root + "/hooks/hooks.json", managed: false, plugin: root, key: OCKEY }]);
  // disabled, or installed only for a project: none
  for (const off of [plugged([[OCKEY, false, "user"]]), plugged([[OCKEY, true, "local"]])]) {
    expect(await within(off, () => Hooks.sources(DIR).filter((s) => s.plugin !== undefined))).toEqual([]);
  }
});

test("a plugin's hook runs with CLAUDE_PLUGIN_ROOT and refuses; the user's disableAllHooks drops it", async () => {
  const deny = `echo "{\\"hookSpecificOutput\\":{\\"permissionDecision\\":\\"deny\\",\\"permissionDecisionReason\\":\\"root=$CLAUDE_PLUGIN_ROOT\\"}}"`;
  const conf = plugged([[OCKEY, true, "user"]], deny);
  const gate = await within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(gate.deny).toBe("root=" + conf + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0");
  const off = plugged([[OCKEY, true, "user"]], deny, { disableAllHooks: true });
  expect((await within(off, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBeNull();
});

// security review L1a: the allowlist is the full key, so the same name
// from another marketplace is not trusted
test("an oc-coding-assistant from another marketplace gates nothing", async () => {
  const conf = plugged([["oc-coding-assistant@elsewhere", true, "user"]], "exit 2");
  expect(await within(conf, () => Hooks.sources(DIR).filter((s) => s.plugin !== undefined))).toEqual([]);
  expect((await within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBeNull();
});

// a plugged() dir whose allowlisted plugin is installed at `root` instead
function moved(root: string): string {
  const conf = plugged([[OCKEY, true, "user"]]);
  fs.writeFileSync(conf + "/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { [OCKEY]: [{ scope: "user", installPath: root }] } }));
  return conf;
}

// security review L1b: a plugin's root must really be under the Claude
// Code dir's plugins, by its path and by its real one: else the gate
// can't be known, and the call is refused
test("an allowlisted plugin installed outside the plugins dir, or linked out of it, refuses the call", async () => {
  const out = fs.mkdtempSync(DIR + "/outside-");
  fs.mkdirSync(out + "/hooks");
  fs.writeFileSync(out + "/hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [group("Bash", "exit 0")] } }));
  const far = moved(out);
  const gate = await within(far, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(gate.deny).toContain("not under");
  const link = moved("");
  fs.symlinkSync(out, link + "/plugins/cache/link");
  fs.writeFileSync(link + "/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { [OCKEY]: [{ scope: "user", installPath: link + "/plugins/cache/link" }] } }));
  expect((await within(link, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toContain("not under");
  // a dotted escape is caught too
  const dots = moved("");
  fs.writeFileSync(dots + "/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: { [OCKEY]: [{ scope: "user", installPath: dots + "/plugins/cache/../../../" + out.split("/").pop() }] } }));
  expect((await within(dots, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toContain("not under");
  // where it is under them, it runs
  expect((await within(plugged([[OCKEY, true, "user"]]), () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBeNull();
});

// security review L1c: an allowlisted plugin's hooks.json fails closed as
// managed settings do: missing or unparsable, the call is refused (unless
// the user's disableAllHooks drops the plugin's hooks anyway)
test("an allowlisted plugin whose hooks.json is missing or unparsable refuses the call", async () => {
  const conf = plugged([[OCKEY, true, "user"]]);
  const file = conf + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0/hooks/hooks.json";
  fs.writeFileSync(file, "{ not json");
  const bad = await within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(bad.deny).toContain("can't read the hooks of " + OCKEY);
  fs.rmSync(file);
  const gone = await within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(gone.deny).toContain("can't read the hooks of " + OCKEY);
  // through Machine.run, the shell never runs
  const mark = DIR + "/plugran";
  fs.mkdirSync(DIR + "/P", { recursive: true });
  const run = await within(conf, () => Machine.run({ name: "shell", input: { command: "touch " + mark }, cwd: "P" }, DIR, live()));
  expect(run.fail).toBe(true);
  expect(run.text).toContain("Refused by a hook: can't read the hooks of " + OCKEY);
  expect(fs.existsSync(mark)).toBe(false);
  // the user's disableAllHooks drops the plugin's hooks, so nothing to read
  const off = plugged([[OCKEY, true, "user"]], "exit 0", { disableAllHooks: true });
  fs.rmSync(off + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0/hooks/hooks.json");
  expect((await within(off, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBeNull();
});

// the real oc-coding-assistant, as installed and enabled for the user: its
// gate, found by Hooks.sources in the real Claude Code dir (so the
// allowlisted key is the installed one), refuses a PR from a Legion agent
// until pre-ship polish has run for the commit
const REAL = os.homedir() + "/.claude";
const OC = (() => {
  const json = (f: string): any => { try { return JSON.parse(fs.readFileSync(REAL + f, "utf8")); } catch { return {}; } };
  const on = json("/settings.json").enabledPlugins?.[OCKEY] === true;
  const entries: any[] = json("/plugins/installed_plugins.json").plugins?.[OCKEY] ?? [];
  return on ? entries.find((e) => e?.scope === "user")?.installPath as string | undefined : undefined;
})();
test.skipIf(OC === undefined || !fs.existsSync(OC + "/hooks/hooks.json"))("the installed oc-coding-assistant refuses an unpolished gh pr create through Legion, and allows a polished one", async () => {
  const repo = fs.mkdtempSync(DIR + "/ocrepo-");
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  git("init", "-q", "-b", "main");
  fs.writeFileSync(repo + "/a.py", "x = 1\n");
  git("add", "."); git("commit", "-qm", "base");
  git("switch", "-qc", "feat/x");
  fs.writeFileSync(repo + "/a.py", "x = 2\n");
  git("commit", "-qam", "change");
  const plugs = await within(REAL, () => Hooks.sources(repo).filter((s) => s.plugin !== undefined));
  expect(plugs.map((s) => s.plugin)).toEqual([OC]);
  const pr = () => within(REAL, () => Hooks.pre(plugs, "Bash", { command: "gh pr create --base main --fill" }, repo, "A", live()));
  expect((await pr()).deny).toContain("Pre-ship polish has not run");
  expect(Bun.spawnSync(["python3", OC + "/scripts/ca_telemetry.py", "mark-polished", "--cwd", repo]).exitCode).toBe(0);
  expect((await pr()).deny).toBeNull();
});

// security review 3: a plugin's hooks.json is not the user's settings, so
// its disableAllHooks can't drop the user's hooks (nor its own)
test("a plugin's disableAllHooks drops no hook", async () => {
  const user = script("plugoff.sh", `echo user >&2; exit 2`);
  const conf = plugged([[OCKEY, true, "user"]], "exit 0", { hooks: { PreToolUse: [group("Bash", user)] } });
  const file = conf + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0/hooks/hooks.json";
  fs.writeFileSync(file, JSON.stringify({ disableAllHooks: true, hooks: { PreToolUse: [group("Bash", "exit 0")] } }));
  expect((await within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBe("user");
});

// RED ZONE (security review 3 H1, DRAFT awaiting the user's sign-off): an
// allowlisted plugin's hook that can't run (crashed, an unexpected exit,
// missing, timed out) refuses the call, as a managed one: the PR gate fails
// closed. Its exit 0, exit 2 and deny mean what they always did
test("an allowlisted plugin's hook that crashes or times out refuses the call, through Hooks.pre and Machine.run", async () => {
  const hooked = (command: string, timeout?: number) => {
    const conf = plugged([[OCKEY, true, "user"]]);
    fs.writeFileSync(conf + "/plugins/cache/oc-coding-assistant/oncorps-shared-skills/1.0/hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [group("Bash", command, timeout)] } }));
    return conf;
  };
  const pre = (conf: string) => within(conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  for (const cmd of ["exit 7", "kill -9 $$", DIR + "/no-such-plugin-hook"]) {
    const gate = await pre(hooked(cmd));
    expect([cmd, gate.deny]).toEqual([cmd, expect.stringContaining("the hook of " + OCKEY)]);
  }
  const t0 = Date.now();
  const slow = hooked("sleep 5", 0.3);
  const timed = await pre(slow);
  expect(timed.deny).toContain("the hook of " + OCKEY);
  expect(timed.deny).toContain("timed out");
  expect(Date.now() - t0).toBeLessThan(3000);
  // through Machine.run, the shell never runs, crashed or timed out
  fs.mkdirSync(DIR + "/P", { recursive: true });
  for (const conf of [hooked("exit 7"), slow]) {
    const mark = DIR + "/plugcrash-ran";
    const run = await within(conf, () => Machine.run({ name: "shell", input: { command: "touch " + mark }, cwd: "P" }, DIR, live()));
    expect(run.fail).toBe(true);
    expect(run.text).toContain("Refused by a hook: the hook of " + OCKEY);
    expect(fs.existsSync(mark)).toBe(false);
  }
  // unchanged: exit 0 allows, exit 2 refuses with its stderr
  expect((await pre(hooked("exit 0"))).deny).toBeNull();
  expect((await pre(hooked("echo nope >&2; exit 2"))).deny).toBe("nope");
});

// PLP-2945 (RED ZONE, DRAFT awaiting the user's sign-off): with Legion's
// own oncorps-shared-skills checkout ($UNII_DIR/shared-skills), the gate's
// hooks.json comes from it, not from Claude Code's install; in it, the
// gated plugin missing, or its source out of the checkout, refuses the call
function checkout(source: string | null, body = "exit 0"): string {
  const unii = fs.mkdtempSync(DIR + "/unii-");
  const dir = unii + "/shared-skills";
  fs.mkdirSync(dir + "/.claude-plugin", { recursive: true });
  const plugins = source === null ? [] : [{ name: "oc-coding-assistant", source }];
  fs.writeFileSync(dir + "/.claude-plugin/marketplace.json", JSON.stringify({ name: "oncorps-shared-skills", plugins }));
  fs.mkdirSync(dir + "/skills/oc-coding-assistant/hooks", { recursive: true });
  fs.writeFileSync(dir + "/skills/oc-coding-assistant/hooks/hooks.json", JSON.stringify({ hooks: { PreToolUse: [group("Bash", body)] } }));
  return unii;
}
async function legion<T>(unii: string, conf: string, f: () => Promise<T> | T): Promise<T> {
  const was = process.env.UNII_DIR;
  process.env.UNII_DIR = unii;
  try {
    return await within(conf, f);
  } finally {
    was === undefined ? delete process.env.UNII_DIR : (process.env.UNII_DIR = was);
  }
}

test("with Legion's checkout, the gate is its oc-coding-assistant, not Claude Code's", async () => {
  const deny = `echo "{\\"hookSpecificOutput\\":{\\"permissionDecision\\":\\"deny\\",\\"permissionDecisionReason\\":\\"root=$CLAUDE_PLUGIN_ROOT\\"}}"`;
  const unii = checkout("./skills/oc-coding-assistant", deny);
  const root = unii + "/shared-skills/skills/oc-coding-assistant";
  const conf = plugged([[OCKEY, true, "user"]]);
  const plugs = await legion(unii, conf, () => Hooks.sources(DIR).filter((s) => s.plugin !== undefined));
  expect(plugs).toEqual([{ file: root + "/hooks/hooks.json", managed: false, plugin: root, key: OCKEY }]);
  const gate = await legion(unii, conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(gate.deny).toBe("root=" + root);
  // with no Claude Code install at all, the checkout still gates
  const bare = plugged([]);
  expect((await legion(unii, bare, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toBe("root=" + root);
});

test("in Legion's checkout, a missing gated plugin or one sourced outside it refuses the call", async () => {
  const conf = plugged([[OCKEY, true, "user"]]);
  const gone = await legion(checkout(null), conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(gone.deny).toContain("can't read the hooks of " + OCKEY);
  const out = checkout("../../");
  const far = await legion(out, conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()));
  expect(far.deny).toContain("not under");
  // its hooks.json unreadable
  const bad = checkout("./skills/oc-coding-assistant");
  fs.writeFileSync(bad + "/shared-skills/skills/oc-coding-assistant/hooks/hooks.json", "{ not json");
  expect((await legion(bad, conf, () => Hooks.pre(Hooks.sources(DIR), "Bash", { command: "ls" }, DIR, "A", live()))).deny).toContain("can't read the hooks of " + OCKEY);
});
