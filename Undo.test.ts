// Undo test
// =========
// `bun test Undo.test.ts`. An agent's turn snapshotted before its first
// change (Device.device_snap, by device_run), once a turn, never touching
// the user's index, HEAD or stash; undone by the user (Device.device_undo):
// what differs checked out, what was added deleted, ignored files and
// secrets untouched, the tree before kept (redo); refused when HEAD moved,
// outside the roots, at the home dir. Handing an agent to Claude Code
// (Device.device_handoff): a 0600 brief and a 0700 .command script that
// reads it, inert whatever the agent's title says.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Device from "./Device.ts";
import * as Undo from "./Undo.ts";

const git = (repo: string, ...a: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdout: "pipe", stderr: "pipe" });
const out = (repo: string, ...a: string[]) => git(repo, ...a).stdout.toString();

// a repo in a temp top, a.txt and b.txt committed, u.txt untracked, *.log
// ignored; rules whose spaces hold it, state in the top
function fixture() {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-undo-"));
  const repo = top + "/repo";
  fs.mkdirSync(repo);
  Bun.spawnSync(["git", "init", "-q", "-b", "trunk", repo]);
  fs.writeFileSync(repo + "/a.txt", "a\n");
  fs.writeFileSync(repo + "/b.txt", "b\n");
  fs.writeFileSync(repo + "/.gitignore", "*.log\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "first");
  fs.writeFileSync(repo + "/u.txt", "untracked\n");
  fs.writeFileSync(repo + "/ig.log", "ignored\n");
  fs.writeFileSync(repo + "/.env", "KEY=1\n");
  fs.writeFileSync(repo + "/staged.txt", "staged\n");
  git(repo, "add", "staged.txt");
  fs.mkdirSync(top + "/work");
  const rules = { work: top + "/work", computer: false, spaces: [repo], state: top + "/state" };
  return { top, repo, rules };
}

const job = (name: string, input: any, snap?: number) => ({ name, input, cwd: "Owl", ...(snap === undefined ? {} : { snap }) });
async function run(rules: any, j: any): Promise<any> {
  let got: any = null;
  await Device.device_run(new Map(), "j", j, rules, (m: any) => (got = m.out));
  return got;
}
const user = (repo: string) => ({ index: out(repo, "ls-files", "-s"), cached: out(repo, "diff", "--cached", "--name-only"), head: out(repo, "rev-parse", "HEAD"), stash: out(repo, "stash", "list") });

test("a turn is snapshotted once, before its first change, the user's index, HEAD and stash untouched; undo puts it back", async () => {
  const { repo, rules } = fixture();
  const before = user(repo);
  expect((await run(rules, job("write", { path: repo + "/a.txt", content: "changed\n" }, 100))).fail).toBe(false);
  expect(out(repo, "for-each-ref", "--format=%(refname)", "refs/legion/")).toBe("refs/legion/undo/Owl/100\n");
  expect(user(repo)).toEqual(before);
  // the same turn: no new snapshot (the first stays, the tree before it)
  await run(rules, job("edit", { edits: [{ path: repo + "/a.txt", old: "changed", new: "edited" }] }, 100));
  await run(rules, job("shell", { command: "cd " + repo + " && rm b.txt && mkdir -p d/e && echo n > d/e/new.txt && echo x > ig.log && echo KEY=2 > .env" }, 100));
  expect(out(repo, "for-each-ref", "--format=%(refname)", "refs/legion/")).toBe("refs/legion/undo/Owl/100\n");
  // the snapshot keeps the untracked file, never the ignored one or a secret
  const kept = out(repo, "ls-tree", "-r", "--name-only", "refs/legion/undo/Owl/100");
  expect(kept.split("\n")).toEqual(expect.arrayContaining(["a.txt", "b.txt", "u.txt", "staged.txt"]));
  expect(kept).not.toContain("ig.log");
  expect(kept).not.toContain(".env");
  // a read-only call takes none
  await run(rules, job("read", { path: repo + "/a.txt" }));
  const undone = await Device.device_undo(rules, "u1", "Owl") as any;
  expect(undone.error).toBeUndefined();
  expect(undone.text).toMatch(/2 files restored, 1 deleted/);
  expect(fs.readFileSync(repo + "/a.txt", "utf8")).toBe("a\n");
  expect(fs.readFileSync(repo + "/b.txt", "utf8")).toBe("b\n");
  expect(fs.existsSync(repo + "/d")).toBe(false);
  expect(fs.readFileSync(repo + "/u.txt", "utf8")).toBe("untracked\n");
  expect(fs.readFileSync(repo + "/ig.log", "utf8")).toBe("x\n");
  expect(fs.readFileSync(repo + "/.env", "utf8")).toBe("KEY=2\n");
  expect(user(repo)).toEqual(before);
  // the undo is undoable: the tree before it kept as a redo snapshot
  const redo = out(repo, "for-each-ref", "--format=%(refname)", "refs/legion/redo/Owl/").trim();
  expect(redo).toMatch(/^refs\/legion\/redo\/Owl\/\d+$/);
  expect(out(repo, "show", redo + ":a.txt")).toBe("edited\n");
  expect(out(repo, "for-each-ref", "refs/legion/undo/")).toBe("");
  expect((await Device.device_undo(rules, "u2", "Owl") as any).error).toMatch(/Nothing to undo/);
});

test("undo refuses when HEAD moved since the snapshot, changing nothing", async () => {
  const { repo, rules } = fixture();
  await run(rules, job("write", { path: repo + "/a.txt", content: "agent\n" }, 200));
  git(repo, "commit", "-q", "-am", "the agent's commit");
  fs.writeFileSync(repo + "/a.txt", "later\n");
  const r = await Device.device_undo(rules, "u", "Owl") as any;
  expect(r.error).toMatch(/HEAD moved/);
  expect(fs.readFileSync(repo + "/a.txt", "utf8")).toBe("later\n");
  expect(out(repo, "for-each-ref", "--format=%(refname)", "refs/legion/")).toBe("refs/legion/undo/Owl/200\n");
});

test("no snapshot outside the roots; undo refuses a repo outside them and the home dir", async () => {
  const { top, repo, rules } = fixture();
  const away = { ...rules, spaces: [] };
  await run(away, job("write", { path: repo + "/a.txt", content: "x\n" }, 300));
  expect(out(repo, "for-each-ref", "refs/legion/")).toBe("");
  // a snapshot planted outside the roots (as an agent's shell could)
  expect(Undo.undo_snap(Device.device_git, repo, Undo.undo_ref("undo", "Owl", 300))).not.toBeNull();
  Undo.undo_log(rules.state, "Owl", repo);
  fs.writeFileSync(repo + "/a.txt", "y\n");
  expect((await Device.device_undo(away, "u", "Owl") as any).error).toMatch(/not under/);
  expect(fs.readFileSync(repo + "/a.txt", "utf8")).toBe("y\n");
  // the home dir, even as a root
  const home = { ...rules, spaces: [os.homedir()], state: top + "/state2" };
  Undo.undo_log(home.state, "Owl", os.homedir());
  expect((await Device.device_undo(home, "u", "Owl") as any).error).toMatch(/home dir/);
  expect((await Device.device_undo(rules, "u", "../x") as any).error).toMatch(/Not an agent/);
});

test("undo never writes a secret's path, even from a planted snapshot", async () => {
  const { repo, rules } = fixture();
  // an agent's shell could plant a snapshot holding a .env of its own
  const head = out(repo, "rev-parse", "HEAD").trim();
  fs.writeFileSync(repo + "/.env", "AGENT=1\n");
  git(repo, "add", "-f", ".env");
  const tree = out(repo, "write-tree").trim();
  git(repo, "rm", "-q", "--cached", ".env");
  const planted = out(repo, "commit-tree", "-p", head, "-m", "x", tree).trim();
  git(repo, "update-ref", "refs/legion/undo/Owl/600", planted);
  Undo.undo_log(rules.state, "Owl", repo);
  fs.writeFileSync(repo + "/.env", "USER=1\n");
  const r = await Device.device_undo(rules, "u", "Owl") as any;
  expect(r.error).toBeUndefined();
  expect(fs.readFileSync(repo + "/.env", "utf8")).toBe("USER=1\n");
});

// nor a file that gates the hooks (Machine.gating): a planted snapshot
// with a hook in .claude/settings.json leaves the user's settings as they are
test("undo never writes Claude Code's settings, even from a planted snapshot", async () => {
  const { repo, rules } = fixture();
  const head = out(repo, "rev-parse", "HEAD").trim();
  fs.mkdirSync(repo + "/.claude");
  fs.writeFileSync(repo + "/.claude/settings.json", '{"hooks":{"x":"touch PWNED"}}');
  git(repo, "add", "-f", ".claude/settings.json");
  const tree = out(repo, "write-tree").trim();
  git(repo, "rm", "-q", "--cached", ".claude/settings.json");
  const planted = out(repo, "commit-tree", "-p", head, "-m", "x", tree).trim();
  git(repo, "update-ref", "refs/legion/undo/Owl/700", planted);
  Undo.undo_log(rules.state, "Owl", repo);
  fs.writeFileSync(repo + "/.claude/settings.json", '{"user":1}');
  const r = await Device.device_undo(rules, "u", "Owl") as any;
  expect(r.error).toBeUndefined();
  expect(fs.readFileSync(repo + "/.claude/settings.json", "utf8")).toBe('{"user":1}');
});

test("a snapshot that fails never breaks the write; snapshots are pruned to KEEP", async () => {
  const { repo, rules } = fixture();
  fs.writeFileSync(repo + "/.git/HEAD", "garbage\n");
  const w = await run(rules, job("write", { path: repo + "/a.txt", content: "still\n" }, 400));
  expect(w.fail).toBe(false);
  expect(fs.readFileSync(repo + "/a.txt", "utf8")).toBe("still\n");
  fs.writeFileSync(repo + "/.git/HEAD", "ref: refs/heads/trunk\n");
  // a state dir that can't be made: the snapshot throws, the write goes on
  const w2 = await run({ ...rules, state: repo + "/a.txt/state" }, job("write", { path: repo + "/b.txt", content: "on\n" }, 401));
  expect(w2.fail).toBe(false);
  expect(fs.readFileSync(repo + "/b.txt", "utf8")).toBe("on\n");
  fs.writeFileSync(repo + "/b.txt", "b\n");
  fs.writeFileSync(repo + "/.git/HEAD", "ref: refs/heads/trunk\n");
  for (let t = 1; t <= Undo.KEEP + 5; t++) {
    await run(rules, job("edit", { edits: [{ path: repo + "/a.txt", old: "still", new: "still" + t }] }, 1000 + t));
    fs.writeFileSync(repo + "/a.txt", "still\n");
  }
  const refs = Undo.undo_refs(Device.device_git, repo, "undo", "Owl");
  expect(refs.length).toBe(Undo.KEEP);
  expect(refs[0]).toBe(1006);
}, 30_000);

test("handoff: a 0600 brief and a 0700 script that reads it; the agent's text stays inert", async () => {
  const { top, repo, rules } = fixture();
  const odd = top + "/it's $(touch PWNED1) `x`";
  fs.mkdirSync(odd);
  Bun.spawnSync(["git", "init", "-q", odd]);
  git(odd, "commit", "-q", "--allow-empty", "-m", "x");
  const r2 = { ...rules, spaces: [repo, odd] };
  await run(r2, job("write", { path: odd + "/f.txt", content: "f\n" }, 500));
  const brief = "You're picking up Owl's work.\nTitle: $(touch PWNED2)'; touch PWNED3; '\"`touch PWNED4`\"\n";
  let script = "";
  const r = await Device.device_handoff(r2, "h", "Owl", brief, async (f) => (script = f, "Terminal")) as any;
  expect(r.error).toBeUndefined();
  expect(r.text).toContain("Terminal");
  expect(fs.statSync(script).mode & 0o777).toBe(0o700);
  const text = fs.readFileSync(script, "utf8");
  const file = /cat -- '([^']+)'/.exec(text)![1]!;
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(fs.readFileSync(file, "utf8")).toBe(brief);
  expect(text).not.toContain("PWNED2");
  // run with a fake claude that writes its arguments down
  const bin = top + "/bin";
  fs.mkdirSync(bin);
  fs.writeFileSync(bin + "/claude", "#!/bin/sh\npwd > \"$OUT.dir\"\nprintf '%s' \"$*\" > \"$OUT\"\nprintf '%s' \"$#\" > \"$OUT.n\"\nprintf '%s' \"$1\" > \"$OUT.first\"\n", { mode: 0o755 });
  const res = Bun.spawnSync(["/bin/sh", script], { cwd: top, env: { PATH: bin + ":/usr/bin:/bin", OUT: top + "/argv" } });
  expect(res.exitCode).toBe(0);
  // the brief after "--": never read as a flag, whatever it starts with
  expect(fs.readFileSync(top + "/argv.first", "utf8")).toBe("--");
  expect(fs.readFileSync(top + "/argv", "utf8")).toBe("-- " + brief.trimEnd());
  expect(fs.readFileSync(top + "/argv.n", "utf8")).toBe("2");
  expect(fs.readFileSync(top + "/argv.dir", "utf8").trim()).toBe(odd);
  expect(fs.readdirSync(top).filter((f) => f.startsWith("PWNED"))).toEqual([]);
  expect(fs.readdirSync(odd).filter((f) => f.startsWith("PWNED"))).toEqual([]);
  // a dir outside the roots is refused
  const r3 = await Device.device_handoff({ ...r2, spaces: [] }, "h2", "Owl", brief, async () => "Terminal") as any;
  expect(r3.error).toMatch(/not under/);
});
