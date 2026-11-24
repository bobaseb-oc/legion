// Sweep test
// ==========
// `bun run test Sweep.test.ts` (never bare `bun test`). PLP-2923 (RED
// ZONE: deletes the user's work dirs, only on their yes): a weekly sweep
// lists the work dirs untouched for 7 days that nothing still needs, and
// removes exactly that list, each re-checked, once the user answers yes.
// Every WORK here is a fake one under the test temp root.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as Sweep from "./Sweep.ts";

const DAY = 86400e3;
const ROOT = fs.realpathSync(process.env.UNII_TEST_ROOT ?? fs.mkdtempSync("/tmp/sweep-"));

// a fresh WORK of its own, and a dir outside it
const fresh = (): { work: string; out: string } => {
  const base = fs.mkdtempSync(ROOT + "/sweep-");
  fs.mkdirSync(base + "/work");
  fs.mkdirSync(base + "/out");
  return { work: base + "/work", out: base + "/out" };
};

// every entry under dir (dir too, .git too) last touched days ago
const age = (dir: string, days: number, now = Date.now()): void => {
  const t = new Date(now - days * DAY);
  const each = (p: string): void => {
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (st === undefined) {
      return; // gone meanwhile (a lock git dropped)
    }
    if (st.isDirectory()) {
      fs.readdirSync(p).forEach((e) => each(p + "/" + e));
    }
    if (!st.isSymbolicLink()) {
      fs.utimesSync(p, t, t);
    }
  };
  each(dir);
};

const git = (cwd: string, ...args: string[]): string => {
  const run = Bun.spawnSync(["git", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) {
    throw new Error("git " + args.join(" ") + ": " + run.stderr.toString());
  }
  return run.stdout.toString();
};

// a repo with one commit, pushed to a bare remote outside WORK (clean)
const repo = (dir: string, out: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(dir + "/a.txt", "a\n".repeat(100));
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "one");
  const bare = out + "/" + path.basename(dir) + ".git";
  git(out, "init", "-q", "--bare", bare);
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  return dir;
};

const none = { known: new Set<string>(), busy: new Set<string>(), shared: true };
const listed = (items: Sweep.Item[]): string[] => items.map((x) => x.path).sort();

test("AC1: a finished agent's dir untouched 8 days is listed once with its size; nothing is removed", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada/sub", { recursive: true });
  fs.writeFileSync(work + "/Ada/sub/f.bin", Buffer.alloc(5000));
  age(work + "/Ada", 8);
  const items = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  expect(listed(items)).toEqual([work + "/Ada"]);
  expect(items[0]!.bytes).toBeGreaterThanOrEqual(5000);
  expect(Sweep.sweep_text(items)).toContain(work + "/Ada");
  expect(fs.existsSync(work + "/Ada/sub/f.bin")).toBe(true);
});

test("age: a dir touched 6 days ago, or with one file touched today, is not listed", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.mkdirSync(work + "/Bob/deep", { recursive: true });
  fs.writeFileSync(work + "/Bob/deep/new.txt", "x");
  age(work + "/Ada", 6);
  age(work + "/Bob", 30);
  fs.utimesSync(work + "/Bob/deep/new.txt", new Date(), new Date());
  expect(await Sweep.sweep_list(work, { known: new Set(["Ada", "Bob"]), busy: new Set(), shared: true }, [], Date.now())).toEqual([]);
});

test("AC3: an old repo with a change, a stash, or a commit on no remote is not listed; a clean pushed one is", async () => {
  const { work, out } = fresh();
  const clean = repo(work + "/review/clean", out);
  const dirty = repo(work + "/review/dirty", out);
  fs.writeFileSync(dirty + "/a.txt", "changed\n");
  const stash = repo(work + "/review/stash", out);
  fs.writeFileSync(stash + "/a.txt", "stashed\n");
  git(stash, "stash", "-q");
  const local = repo(work + "/review/local", out);
  fs.writeFileSync(local + "/b.txt", "b\n");
  git(local, "add", ".");
  git(local, "commit", "-q", "-m", "unpushed");
  age(work + "/review", 8);
  expect(listed(await Sweep.sweep_list(work, none, [], Date.now()))).toEqual([clean]);
});

test("AC4: an agent at work, asking or waiting is not listed, however old", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  age(work + "/Ada", 90);
  expect(await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(["Ada"]) }, [], Date.now())).toEqual([]);
});

test("AC9: never WORK/main, the user's dirs, or a non-git dir not named after an agent", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/main");
  fs.mkdirSync(work + "/scratch/inner", { recursive: true });
  fs.mkdirSync(work + "/users/u1/docs/agent", { recursive: true });
  fs.writeFileSync(work + "/users/u1/view.json", "{}");
  age(work, 30);
  const keep = [work + "/users/u1"];
  expect(await Sweep.sweep_list(work, { known: new Set(["main", "users"]), busy: new Set(), shared: true }, keep, Date.now())).toEqual([]);
});

test("symlinks: one in WORK pointing outside is never listed nor removed; the outside dir stays", async () => {
  const { work, out } = fresh();
  fs.mkdirSync(out + "/precious");
  fs.writeFileSync(out + "/precious/keep.txt", "keep");
  fs.symlinkSync(out + "/precious", work + "/Eve");
  age(out, 30);
  expect(await Sweep.sweep_list(work, { known: new Set(["Eve"]), busy: new Set(), shared: true }, [], Date.now())).toEqual([]);
  const forged: Sweep.Item = { path: work + "/Eve", bytes: 4, mtime: 0, git: null };
  expect(await Sweep.sweep_remove(work, forged)).not.toBeNull();
  expect(await Sweep.sweep_remove(work, { ...forged, path: work + "/../out/precious" })).not.toBeNull();
  expect(await Sweep.sweep_remove(work, { ...forged, path: out + "/precious" })).not.toBeNull();
  expect(await Sweep.sweep_remove(work, { ...forged, path: work })).not.toBeNull();
  expect(fs.readFileSync(out + "/precious/keep.txt", "utf8")).toBe("keep");
  expect(fs.existsSync(work)).toBe(true);
});

test("AC5: a listed dir touched or made dirty since the listing fails its re-check; an unchanged one passes", async () => {
  const { work, out } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.writeFileSync(work + "/Ada/f", "x");
  const r = repo(work + "/rv/r", out);
  fs.mkdirSync(work + "/Bob");
  age(work, 8);
  const agents = { known: new Set(["Ada", "Bob"]), busy: new Set<string>(), shared: true };
  const items = await Sweep.sweep_list(work, agents, [], Date.now());
  expect(listed(items)).toEqual([work + "/Ada", work + "/Bob", r]);
  fs.writeFileSync(work + "/Ada/f", "y");
  fs.writeFileSync(r + "/a.txt", "dirty\n");
  age(r, 8);
  const ok = [];
  for (const x of items) {
    ok.push([x.path, await Sweep.sweep_check(work, x, agents, [], Date.now())]);
  }
  expect(ok.sort()).toEqual([[work + "/Ada", false], [work + "/Bob", true], [r, false]]);
  // touched again yet still older than AGE: newer than listed, so kept
  const bob = items.find((x) => x.path === work + "/Bob")!;
  fs.writeFileSync(work + "/Bob/later", "z");
  age(work + "/Bob", 7.5);
  expect(await Sweep.sweep_check(work, bob, agents, [], Date.now())).toBe(false);
  expect(await Sweep.sweep_check(work, bob, { ...agents, busy: new Set(["Bob"]) }, [], Date.now())).toBe(false);
});

test("AC6: a listed git worktree is removed by git worktree remove; its parent's list drops it", async () => {
  const { work, out } = fresh();
  const parent = repo(work + "/review/af", out);
  const wt = work + "/review/af-worktrees/pr1";
  git(parent, "worktree", "add", "-q", "--detach", wt);
  age(work, 8);
  const items = await Sweep.sweep_list(work, none, [], Date.now());
  // the parent has a worktree: kept; the worktree is the one listed
  expect(listed(items)).toEqual([wt]);
  expect(items[0]!.git).toBe("worktree");
  expect(await Sweep.sweep_remove(work, items[0]!)).toBeNull();
  expect(fs.existsSync(wt)).toBe(false);
  expect(git(parent, "worktree", "list", "--porcelain")).not.toContain(wt);
  expect(fs.existsSync(parent + "/a.txt")).toBe(true);
});

test("cap: the biggest dirs are listed first, so 60 empty agent dirs never crowd out a big clone", async () => {
  const { work, out } = fresh();
  const names = Array.from({ length: 60 }, (_, k) => "Ag" + String.fromCharCode(97 + Math.floor(k / 26)) + String.fromCharCode(97 + (k % 26)));
  names.forEach((n) => fs.mkdirSync(work + "/" + n));
  const big = repo(work + "/zz/big", out);
  fs.writeFileSync(big + "/blob.bin", Buffer.alloc(200_000));
  git(big, "add", ".");
  git(big, "commit", "-q", "-m", "blob");
  git(big, "push", "-q", "origin", "main");
  age(work, 8);
  const items = await Sweep.sweep_list(work, { known: new Set(names), busy: new Set(), shared: true }, [], Date.now());
  expect(items.length).toBe(50);
  expect(items[0]!.path).toBe(big);
  expect(items.map((x) => x.bytes)).toEqual(items.map((x) => x.bytes).sort((a, b) => b - a));
});

test("worktrees: one is judged by its own HEAD and changes, not by the shared repo's other branches or stash", async () => {
  const { work, out } = fresh();
  const parent = repo(work + "/review/af", out);
  // an unpushed branch and a stash in the shared repo
  git(parent, "checkout", "-q", "-b", "ryanf/x");
  fs.writeFileSync(parent + "/r.txt", "r\n");
  git(parent, "add", ".");
  git(parent, "commit", "-q", "-m", "unpushed elsewhere");
  git(parent, "checkout", "-q", "main");
  fs.writeFileSync(parent + "/a.txt", "stashed\n");
  git(parent, "stash", "-q");
  const pr1 = work + "/review/wt/pr1"; // detached at a pushed commit: listed
  git(parent, "worktree", "add", "-q", "--detach", pr1, "main");
  const pr2 = work + "/review/wt/pr2"; // a commit on a detached HEAD only: lost on removal, kept
  git(parent, "worktree", "add", "-q", "--detach", pr2, "main");
  fs.writeFileSync(pr2 + "/d.txt", "d\n");
  git(pr2, "add", ".");
  git(pr2, "commit", "-q", "-m", "detached");
  const pr3 = work + "/review/wt/pr3"; // on a local branch: the branch outlives the worktree, listed
  git(parent, "worktree", "add", "-q", "-b", "local/pr3", pr3, "main");
  fs.writeFileSync(pr3 + "/l.txt", "l\n");
  git(pr3, "add", ".");
  git(pr3, "commit", "-q", "-m", "on a branch");
  const pr4 = work + "/review/wt/pr4"; // a change: kept
  git(parent, "worktree", "add", "-q", "--detach", pr4, "main");
  fs.writeFileSync(pr4 + "/a.txt", "changed\n");
  age(work, 8);
  const items = await Sweep.sweep_list(work, none, [], Date.now());
  expect(listed(items)).toEqual([pr1, pr3]);
  const three = items.find((x) => x.path === pr3)!;
  expect(await Sweep.sweep_remove(work, three)).toBeNull();
  expect(git(parent, "branch", "--list", "local/pr3").trim()).not.toBe("");
});

test("an agent dir holding a linked worktree: removed, then the worktree pruned from its repo's list", async () => {
  const { work, out } = fresh();
  const parent = repo(work + "/review/af", out);
  const wt = work + "/Ada/af-pr";
  git(parent, "worktree", "add", "-q", "--detach", wt);
  age(work, 8);
  const items = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  const ada = items.find((x) => x.path === work + "/Ada")!;
  expect(ada).toBeDefined();
  expect(await Sweep.sweep_remove(work, ada)).toBeNull();
  expect(fs.existsSync(work + "/Ada")).toBe(false);
  expect(git(parent, "worktree", "list", "--porcelain")).not.toContain(wt);
});

test("the question names each listed dir's .env files, by path within it", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada/app/.git-not", { recursive: true });
  fs.writeFileSync(work + "/Ada/.env", "A=1");
  fs.writeFileSync(work + "/Ada/app/.env.local", "B=2");
  fs.writeFileSync(work + "/Ada/app/env.txt", "not one");
  fs.mkdirSync(work + "/Bob");
  age(work, 8);
  const items = await Sweep.sweep_list(work, { known: new Set(["Ada", "Bob"]), busy: new Set(), shared: true }, [], Date.now());
  const text = Sweep.sweep_text(items);
  const ada = text.split("\n").find((l) => l.includes(work + "/Ada"))!;
  expect(ada).toContain(".env");
  expect(ada).toContain("app/.env.local");
  expect(ada).not.toContain("env.txt");
  expect(text.split("\n").find((l) => l.includes(work + "/Bob"))).not.toContain(".env");
});

test("only .env files git does not track are named: a tracked template is not; an ignored one and one outside any repo are", async () => {
  const { work, out } = fresh();
  fs.mkdirSync(work + "/Ada");
  const app = repo(work + "/Ada/app", out);
  fs.writeFileSync(app + "/.gitignore", ".env\n");
  fs.writeFileSync(app + "/.env.example", "A=");
  git(app, "add", ".");
  git(app, "commit", "-q", "-m", "template");
  git(app, "push", "-q", "origin", "main");
  fs.writeFileSync(app + "/.env", "A=secret"); // ignored
  fs.writeFileSync(work + "/Ada/.env.local", "B=secret"); // in no repo
  age(work, 8);
  const items = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  const ada = items.find((x) => x.path === work + "/Ada")!;
  expect(ada).toBeDefined();
  expect([...(ada.envs ?? [])].sort()).toEqual([".env.local", "app/.env"]);
  expect(Sweep.sweep_text(items)).not.toContain(".env.example");
});

test("H1: a parent swapped for a symlink out of WORK after the check: nothing outside is removed or moved", async () => {
  const { work, out } = fresh();
  const r = repo(work + "/rv/r", out);
  age(work, 8);
  const agents = { known: new Set<string>(), busy: new Set<string>(), shared: true };
  const items = await Sweep.sweep_list(work, agents, [], Date.now());
  const item = items.find((x) => x.path === r)!;
  expect(await Sweep.sweep_check(work, item, agents, [], Date.now())).toBe(true);
  // the attack: WORK/rv becomes a link to a dir outside holding its own
  // "r", swapped while sweep_remove is already under way (its walk of a
  // big tree is the window)
  fs.mkdirSync(out + "/home/r", { recursive: true });
  fs.writeFileSync(out + "/home/r/precious.txt", "keep");
  fs.mkdirSync(r + "/node_modules");
  for (let k = 0; k < 2000; k++) {
    fs.writeFileSync(r + "/node_modules/f" + k, "x");
  }
  const removing = Sweep.sweep_remove(work, item);
  setImmediate(() => {
    fs.renameSync(work + "/rv", work + "/rv-old");
    fs.symlinkSync(out + "/home", work + "/rv");
  });
  expect(await removing).not.toBeNull();
  expect(fs.readFileSync(out + "/home/r/precious.txt", "utf8")).toBe("keep");
});

test("H1: a removal goes through a quarantine in WORK that is never listed; the listed dir is gone", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  age(work, 8);
  const agents = { known: new Set(["Ada"]), busy: new Set<string>(), shared: true };
  const [ada] = await Sweep.sweep_list(work, agents, [], Date.now());
  expect(ada!.ino).toBeGreaterThan(0);
  expect(await Sweep.sweep_remove(work, ada!)).toBeNull();
  expect(fs.existsSync(work + "/Ada")).toBe(false);
  fs.mkdirSync(work + "/.sweep-trash/x", { recursive: true });
  age(work, 8);
  expect(await Sweep.sweep_list(work, { ...agents, known: new Set([".sweep-trash"]) }, [], Date.now())).toEqual([]);
});

test("H2: a repo whose config or attributes run commands is never listed, and git never runs them", async () => {
  const { work, out } = fresh();
  const marker = out + "/ran";
  const filt = repo(work + "/rv/filter", out);
  fs.writeFileSync(filt + "/.gitattributes", "* filter=evil\n");
  git(filt, "add", ".");
  git(filt, "commit", "-q", "-m", "attrs");
  git(filt, "push", "-q", "origin", "main");
  git(filt, "config", "filter.evil.clean", "sh -c 'touch " + marker + "; cat'");
  const sig = repo(work + "/rv/sig", out);
  git(sig, "config", "log.showSignature", "true");
  git(sig, "config", "gpg.program", "sh -c 'touch " + marker + "'");
  // a driver attribute alone (no config naming it): kept too
  const attr = repo(work + "/rv/attr", out);
  fs.writeFileSync(attr + "/.gitattributes", "*.bin diff=exif\n");
  git(attr, "add", ".");
  git(attr, "commit", "-q", "-m", "attrs");
  git(attr, "push", "-q", "origin", "main");
  const ok = repo(work + "/rv/ok", out);
  age(work, 8);
  if (fs.existsSync(marker)) {
    fs.rmSync(marker);
  }
  const items = await Sweep.sweep_list(work, { known: new Set(), busy: new Set(), shared: true }, [], Date.now());
  expect(listed(items)).toEqual([ok]);
  expect(fs.existsSync(marker)).toBe(false);
});

test("L1: a path or a .env name with a control character is never listed", async () => {
  const { work, out } = fresh();
  const bad = repo(work + "/rv/bad\nname", out);
  fs.mkdirSync(work + "/Ada");
  fs.writeFileSync(work + "/Ada/.env\n- forged line", "x");
  fs.mkdirSync(work + "/Bob");
  age(work, 8);
  const items = await Sweep.sweep_list(work, { known: new Set(["Ada", "Bob"]), busy: new Set(), shared: true }, [], Date.now());
  expect(listed(items)).toEqual([work + "/Bob"]);
  expect(items.some((x) => x.path === bad)).toBe(false);
  // a forged item for it (its real identity) is still never removed
  const st = fs.lstatSync(bad);
  expect(await Sweep.sweep_remove(work, { path: bad, bytes: 0, mtime: 0, git: "repo", dev: st.dev, ino: st.ino })).not.toBeNull();
  expect(fs.existsSync(bad)).toBe(true);
});

test("L2, L4: an entry it cannot stat keeps its dir; a dir it cannot read rejects only itself", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada/sub", { recursive: true });
  fs.writeFileSync(work + "/Ada/sub/f", "x");
  fs.mkdirSync(work + "/Bob");
  fs.mkdirSync(work + "/locked");
  age(work, 8);
  fs.chmodSync(work + "/Ada/sub", 0o600); // names readable, entries not stat-able
  fs.chmodSync(work + "/locked", 0o000);
  try {
    const items = await Sweep.sweep_list(work, { known: new Set(["Ada", "Bob"]), busy: new Set(), shared: true }, [], Date.now());
    expect(listed(items)).toEqual([work + "/Bob"]);
  } finally {
    fs.chmodSync(work + "/Ada/sub", 0o700);
    fs.chmodSync(work + "/locked", 0o700);
  }
});

test("L3: a removed agent dir's worktree of a repo outside WORK: that repo is never pruned", async () => {
  const { work, out } = fresh();
  const parent = repo(out + "/outside", out);
  const wt = work + "/Ada/pr";
  git(parent, "worktree", "add", "-q", "--detach", wt);
  age(work, 8);
  const [ada] = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  expect(ada!.path).toBe(work + "/Ada");
  expect(await Sweep.sweep_remove(work, ada!)).toBeNull();
  expect(git(parent, "worktree", "list", "--porcelain")).toContain(wt);
});

test("Info: no sweep at all when WORK holds a kept dir (Legion's DIR, HOME); a dir named main in any case is never listed", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.mkdirSync(work + "/Main");
  fs.mkdirSync(work + "/dir");
  age(work, 8);
  const agents = { known: new Set(["Ada", "Main"]), busy: new Set<string>(), shared: true };
  expect(listed(await Sweep.sweep_list(work, agents, [], Date.now()))).toEqual([work + "/Ada"]);
  expect(await Sweep.sweep_list(work, agents, [work + "/dir"], Date.now())).toEqual([]);
  expect(await Sweep.sweep_list(work, agents, [work], Date.now())).toEqual([]);
});

test("H2-bis: a filter planted only in a submodule's git dir never runs, and its parent is not listed", async () => {
  const { work, out } = fresh();
  const marker = out + "/ran";
  const sub = repo(out + "/subsrc", out);
  const parent = repo(work + "/rv/parent", out);
  git(parent, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
  git(parent, "commit", "-q", "-m", "sub");
  git(parent, "push", "-q", "origin", "main");
  const mod = parent + "/.git/modules/sub";
  git(mod, "config", "filter.evil.clean", "sh -c 'touch " + marker + "; cat'");
  fs.mkdirSync(mod + "/info", { recursive: true });
  fs.writeFileSync(mod + "/info/attributes", "* filter=evil\n");
  age(work, 8);
  if (fs.existsSync(marker)) {
    fs.rmSync(marker);
  }
  const items = await Sweep.sweep_list(work, { known: new Set(), busy: new Set(), shared: true }, [], Date.now());
  expect(fs.existsSync(marker)).toBe(false);
  expect(listed(items)).toEqual([]);
});

test("quarantine: a pre-made symlink, a case variant or a writable-by-others dir: the apply is refused, nothing moves", async () => {
  for (const make of ["symlink", "case", "mode"]) {
    const { work, out } = fresh();
    fs.mkdirSync(work + "/Ada");
    fs.writeFileSync(work + "/Ada/f", "x");
    fs.mkdirSync(out + "/elsewhere");
    if (make === "symlink") {
      fs.symlinkSync(out + "/elsewhere", work + "/.sweep-trash");
    } else if (make === "case") {
      fs.mkdirSync(work + "/.SWEEP-TRASH");
    } else {
      fs.mkdirSync(work + "/.sweep-trash");
      fs.chmodSync(work + "/.sweep-trash", 0o777);
    }
    age(work + "/Ada", 8);
    const [ada] = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
    expect(await Sweep.sweep_remove(work, ada!)).toContain("quarantine");
    expect(fs.readFileSync(work + "/Ada/f", "utf8")).toBe("x");
    expect(fs.readdirSync(out + "/elsewhere")).toEqual([]);
  }
});

test("quarantine: swapped for a symlink while the delete runs: nothing outside WORK is deleted", async () => {
  const { work, out } = fresh();
  fs.mkdirSync(work + "/Ada/deep", { recursive: true });
  for (let k = 0; k < 2000; k++) {
    fs.writeFileSync(work + "/Ada/deep/f" + k, "x");
  }
  age(work + "/Ada", 8);
  const [ada] = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  let swapped = false;
  const removing = Sweep.sweep_remove(work, ada!);
  const watch = (): void => {
    const trash = work + "/.sweep-trash";
    const names = fs.existsSync(trash) && !fs.lstatSync(trash).isSymbolicLink() ? fs.readdirSync(trash) : [];
    if (names.length > 0 && !swapped) {
      // the attack: the same names, outside WORK, behind a link
      names.forEach((n) => fs.mkdirSync(out + "/fake/" + n + "/deep", { recursive: true }));
      names.forEach((n) => fs.writeFileSync(out + "/fake/" + n + "/deep/precious", "keep"));
      fs.renameSync(trash, work + "/trash-old");
      fs.symlinkSync(out + "/fake", trash);
      swapped = true;
    } else if (!swapped) {
      setImmediate(watch);
    }
  };
  setImmediate(watch);
  await removing;
  for (const n of fs.existsSync(out + "/fake") ? fs.readdirSync(out + "/fake") : []) {
    expect(fs.readFileSync(out + "/fake/" + n + "/deep/precious", "utf8")).toBe("keep");
  }
});

test("LOW a: a FIFO as a repo's config: no hang, the repo is not listed", async () => {
  const { work, out } = fresh();
  const r = repo(work + "/rv/fifo", out);
  fs.renameSync(r + "/.git/config", r + "/.git/config.real");
  expect(Bun.spawnSync(["mkfifo", r + "/.git/config"]).exitCode).toBe(0);
  age(work, 8);
  const t0 = Date.now();
  const items = await Sweep.sweep_list(work, { known: new Set(), busy: new Set(), shared: true }, [], Date.now());
  expect(listed(items)).toEqual([]);
  expect(Date.now() - t0).toBeLessThan(12_000);
}, 20_000);

test("LOW c: a sparse file counts by the blocks it uses, not its length", async () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  const fd = fs.openSync(work + "/Ada/sparse", "w");
  fs.ftruncateSync(fd, 2 ** 30);
  fs.closeSync(fd);
  age(work + "/Ada", 8);
  const [ada] = await Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(), shared: true }, [], Date.now());
  expect(ada!.bytes).toBeLessThan(2 ** 20);
  expect((await Sweep.sweep_walk(work)).bytes).toBeLessThan(2 ** 20);
});

test("M1: another user's agent dirs are never listed; shared clones only when this server has one user", async () => {
  const { work, out } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.mkdirSync(work + "/Bob");
  const clone = repo(work + "/review/clone", out);
  age(work, 8);
  const mine = { known: new Set(["Ada"]), busy: new Set<string>(), shared: false };
  expect(listed(await Sweep.sweep_list(work, mine, [], Date.now()))).toEqual([work + "/Ada"]);
  expect(listed(await Sweep.sweep_list(work, { ...mine, shared: true }, [], Date.now()))).toEqual([work + "/Ada", clone]);
  // at apply too (sweep_check): no shared clone unless the server has one user
  const [item] = await Sweep.sweep_list(work, { known: new Set(), busy: new Set(), shared: true }, [], Date.now());
  expect(await Sweep.sweep_check(work, item!, { ...mine, shared: false }, [], Date.now())).toBe(false);
});

test("the fingerprint covers each listed dir's path, size and time", async () => {
  const a: Sweep.Item = { path: "/w/A", bytes: 1, mtime: 1, git: null };
  const fp = Sweep.sweep_fp([a]);
  expect(Sweep.sweep_fp([a])).toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, path: "/w/B" }])).not.toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, bytes: 2 }])).not.toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, mtime: 2 }])).not.toBe(fp);
  expect(Sweep.sweep_fp([a, a])).not.toBe(fp);
});

test("due: weekly at the first Sunday 03:00 (local) since the last; early over the size, once a day", async () => {
  const sun = new Date(2026, 10, 29, 3, 0).getTime(); // Sunday 29 Nov 2026, 03:00
  const wed = new Date(2026, 10, 25, 12, 0).getTime();
  const most = 10 * 2 ** 30;
  expect(Sweep.sweep_due(wed, null, sun - 60e3, 0, most)).toBe(false);
  expect(Sweep.sweep_due(wed, null, sun, 0, most)).toBe(true);
  expect(Sweep.sweep_due(wed, sun, sun + 3600e3, 0, most)).toBe(false);
  expect(Sweep.sweep_due(wed, null, wed + 3600e3, most + 1, most)).toBe(true);
  expect(Sweep.sweep_due(wed, wed + 3600e3, wed + 2 * 3600e3, most + 1, most)).toBe(false);
  expect(Sweep.sweep_due(wed, wed + 3600e3, wed + 3600e3 + Sweep.DAY, most + 1, most)).toBe(true);
  expect(Sweep.sweep_due(wed, null, wed + 3600e3, most, most)).toBe(false);
});

// the chat's side (Server.ts): the tick lists and asks, the user's yes
// (a view's answer only: SAYS) removes the listed dirs that pass their
// re-check, the rest named as skipped; no answer in a day: nothing goes
const HEAD = `
const { Chat } = await import(${JSON.stringify(import.meta.dir + "/Server.ts")});
const { AskAI } = await import(${JSON.stringify(import.meta.dir + "/AskAI.ts")});
const { Cloud } = await import(${JSON.stringify(import.meta.dir + "/Cloud.ts")});
const fs = await import("node:fs");
Chat.cloud = Cloud.open(() => {}, () => {}, async () => null);
const chat = Chat.open({ id: "u1", name: "a@b.c" });
Chat.chats.set("u1", chat);
AskAI.ask = (ask, on) => AskAI.tie(on, ask.bill, () => {}, () => {})[0];
const work = process.env.UNII_WORK;
const DAY = 86400e3;
const age = (dir, days) => {
  const t = new Date(Date.now() - days * DAY);
  const each = (p) => { if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((e) => each(p + "/" + e)); fs.utimesSync(p, t, t); };
  each(dir);
};
const agent = (name) => {
  fs.mkdirSync(chat.mem.dir + "/docs/agent", { recursive: true });
  fs.writeFileSync(chat.mem.dir + "/docs/agent/" + name + ".jsonl", JSON.stringify({ kind: "note", text: "n", date: "2026-01-01T00:00:00.000Z" }) + "\\n");
  fs.mkdirSync(work + "/" + name, { recursive: true });
  fs.writeFileSync(work + "/" + name + "/f.bin", Buffer.alloc(3000));
  age(work + "/" + name, 8);
};
const sweeps = () => chat.mem.questions.filter((q) => q.sweep !== undefined);
const answer = (q, text, device = "") => Chat.act(chat, "a" + Math.random(), { $: "answer", q, text }, device);
Chat.SWEEP_BYTES = 1; // WORK is "over the size": the sweep runs early
// the tick only starts the sweep (Chat.sweep); this waits for its run
const tick = async (t) => { Chat.ticked(chat, t); await chat.sweeps?.running; };
`;

const YES = HEAD + `
agent("Ada");
agent("Bob");
const log = fs.readFileSync(chat.mem.dir + "/docs/agent/Ada.jsonl");
const now = Date.now();
await tick(now);
const first = sweeps().map((q) => ({ id: q.id, text: q.text, options: q.options }));
const asked = chat.mem.asked;
await tick(now + 3600e3);
await tick(now + 20 * 3600e3);
const again = { ids: sweeps().map((q) => q.id), asked: chat.mem.asked };
const listedboth = fs.existsSync(work + "/Ada") && fs.existsSync(work + "/Bob");
const bydevice = await answer(first[0].id, "yes", "mac");
const afterdevice = fs.existsSync(work + "/Ada");
fs.writeFileSync(work + "/Bob/new.txt", "touched after the listing");
const yes = await answer(first[0].id, "yes");
const told = chat.mem.questions.filter((q) => q.fyi).map((q) => q.text).at(-1) ?? "";
console.log(JSON.stringify({ first, asked, again, listedboth, bydevice: "error" in bydevice, afterdevice, yes, ada: fs.existsSync(work + "/Ada"), bob: fs.existsSync(work + "/Bob"), log: fs.readFileSync(chat.mem.dir + "/docs/agent/Ada.jsonl").equals(log), told, open: sweeps().length }));
process.exit(0);
`;

const run = async (name: string, script: string): Promise<any> => {
  const dir = fs.mkdtempSync(ROOT + "/sweep-server-");
  fs.mkdirSync(dir + "/work");
  fs.writeFileSync(dir + "/" + name + ".ts", script);
  const proc = Bun.spawn([process.execPath, dir + "/" + name + ".ts"], { env: { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work" }, stdout: "pipe", stderr: "inherit" });
  const out = JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  return { ...out, work: fs.realpathSync(dir + "/work") };
};

test("AC1, AC2, AC5, AC7: one question lists both dirs; a device's yes is refused; the user's yes removes the unchanged one, names the touched one skipped, keeps the log", async () => {
  const out = await run("yes", YES);
  expect(out.first.length).toBe(1);
  expect(out.first[0].text).toContain(out.work + "/Ada");
  expect(out.first[0].text).toContain(out.work + "/Bob");
  expect(out.first[0].text).toMatch(/\d+ (bytes|KB|MB|GB)/);
  expect(out.first[0].options).toEqual(["yes", "no"]);
  // AC7: ticks within 24 h ran the sweep once (no new question asked)
  expect(out.again).toEqual({ ids: [out.first[0].id], asked: out.asked });
  expect(out.listedboth).toBe(true);
  expect(out.bydevice).toBe(true);
  expect(out.afterdevice).toBe(true);
  expect(out.yes).toEqual({});
  expect(out.ada).toBe(false);
  expect(out.bob).toBe(true);
  expect(out.log).toBe(true);
  expect(out.told).toContain("Removed 1");
  expect(out.told).toContain("Skipped");
  expect(out.told).toContain(out.work + "/Bob");
  expect(out.open).toBe(0);
}, 30_000);

// M2 (PLP-2922 merged): the sweep question goes to GChat like any other;
// a reply routes only by the threads this process posted (memory only).
// STEP post: process A lists and posts. Then B, a restart on the same
// dir, lists again and posts; a yes in A's thread (pre-restart) or in a
// thread forged into view.json's record applies nothing; a yes in B's
// own thread applies the listing. fetch stubbed as Server.test.ts's
// EVENT_GCHAT (no network)
const GCHAT = HEAD + `
const SPACE = "spaces/TESTSPACE";
let script = [];
let posts = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.host === "chat.googleapis.com" && init.method === "POST") {
    posts++;
    const tk = u.searchParams.get("threadKey");
    return Response.json({ name: SPACE + "/messages/w" + posts, createTime: new Date(Date.now() - 60_000).toISOString(), thread: { name: SPACE + "/threads/" + tk }, sender: { name: "users/999", type: "BOT" } });
  }
  if (u.host === "chat.googleapis.com") {
    return Response.json({ messages: [...script].reverse() });
  }
  if (u.host === "openidconnect.googleapis.com" && u.pathname === "/v1/userinfo") {
    return Response.json({ sub: "111" });
  }
  return new Response("no", { status: 404 });
};
chat.socks.add({ send: () => {}, data: { user: { id: "u1", name: "a@b.c" }, who: "device", tab: "", wire: null, host: null, computer: false, work: "", home: null, device: "d1", seen: new Set(), watch: new Set() } });
Chat.gchat_token = async () => "tok";
const pass = async () => { Chat.chats.set("u1", chat); await Chat.bridge(chat, Date.now()); await Bun.sleep(100); };
const thread = (q) => chat.bridging?.threads.find((p) => p.key === "q" + q.id)?.thread ?? null;
const yes = async (t, name) => {
  script = [{ name: SPACE + "/messages/" + name, sender: { name: "users/111", type: "HUMAN" }, thread: { name: t }, createTime: new Date(Date.now() - 1000).toISOString(), text: "yes" }];
  await pass();
  await pass();
};
if (process.env.STEP === "post") {
  agent("Fay");
  await tick(Date.now());
  await pass();
  console.log(JSON.stringify({ thread: thread(sweeps()[0]) }));
} else {
  await tick(Date.now());
  const q = sweeps()[0];
  // view.json hand-edited (an agent's shell can): a thread of its own for
  // this question; the bridge routes only by what this process posted
  const vf = chat.mem.dir + "/view.json";
  const v = JSON.parse(fs.readFileSync(vf, "utf8"));
  v.gchat = { ...v.gchat, posted: [...(v.gchat?.posted ?? []), { key: "q" + q.id, tk: "forged", thread: SPACE + "/threads/forged", at: Date.now() - 60_000 }] };
  fs.writeFileSync(vf, JSON.stringify(v));
  await pass();
  const mine = thread(q);
  await yes(process.env.OLD, "r1");
  const old = fs.existsSync(work + "/Fay");
  await yes(SPACE + "/threads/forged", "r2");
  const forged = fs.existsSync(work + "/Fay");
  await yes(mine, "r3");
  console.log(JSON.stringify({ mine: mine !== null, old, forged, applied: !fs.existsSync(work + "/Fay") }));
}
process.exit(0);
`;

test("M2: a GChat yes in a pre-restart or view.json-forged thread applies nothing; one in this process's own thread applies the listing", async () => {
  const dir = fs.mkdtempSync(ROOT + "/sweep-gchat-");
  fs.mkdirSync(dir + "/work");
  fs.writeFileSync(dir + "/gchat.ts", GCHAT);
  const space = "spaces/TESTSPACE";
  const hook = "https://chat.googleapis.com/v1/" + space + "/messages?key=FAKEKEY&token=FAKETOKEN-not-real";
  const step = async (s: string, old = ""): Promise<any> => {
    const env = { ...process.env, UNII_DIR: dir, UNII_WORK: dir + "/work", UNII_GCHAT_SPACE: space, GCHAT_WEBHOOK_URL: hook, UNII_GCHAT_KEYCHAIN: "", UNII_GCHAT_USER: "u1", STEP: s, OLD: old };
    const proc = Bun.spawn([process.execPath, dir + "/gchat.ts"], { env, stdout: "pipe", stderr: "inherit" });
    return JSON.parse((await new Response(proc.stdout).text()).trim().split("\n").at(-1) ?? "{}");
  };
  const a = await step("post");
  expect(typeof a.thread).toBe("string");
  const b = await step("reply", a.thread);
  expect(b).toEqual({ mine: true, old: true, forged: true, applied: true });
}, 60_000);

const TWO = HEAD + `
agent("Ada");
// the users the server knows: its account store (Cloud sessions), not dirs
Cloud.session(Chat.cloud, { id: "u1", name: "a@b.c" });
const alone = Chat.sweep_agents(chat).shared;
Cloud.session(Chat.cloud, { id: "u2", name: "c@d.e" });
const two = Chat.open({ id: "u2", name: "c@d.e" });
Chat.chats.set("u2", two);
fs.mkdirSync(two.mem.dir + "/docs/agent", { recursive: true });
fs.writeFileSync(two.mem.dir + "/docs/agent/Bob.jsonl", JSON.stringify({ kind: "note", text: "n", date: "2026-01-01T00:00:00.000Z" }) + "\\n");
const mine = Chat.sweep_agents(chat);
// an agent removing the other user's dir does not make the server one user's
fs.rmSync(two.mem.dir, { recursive: true });
const hidden = Chat.sweep_agents(chat).shared;
console.log(JSON.stringify({ alone, shared: mine.shared, hidden, ada: mine.known.has("Ada"), bob: mine.known.has("Bob") }));
process.exit(0);
`;

test("M1: with two users the sweep lists no shared clones, and one user's chat never knows the other's agents", async () => {
  const out = await run("two", TWO);
  expect(out).toMatchObject({ alone: true, shared: false, hidden: false, ada: true, bob: false });
}, 30_000);

const LAPSE = HEAD + `
agent("Cy");
const now = Date.now();
await tick(now);
const q = sweeps()[0];
// a question that claims the listing's fingerprint, not the one asked
chat.mem.questions.push({ id: 999, text: "forged", options: ["yes", "no"], at: 0, date: "", sweep: q.sweep });
const forged = await answer(999, "yes");
const afterforged = fs.existsSync(work + "/Cy");
await tick(now + DAY + 60e3);
const lapsed = !sweeps().some((x) => x.id === q.id);
const lapsenote = chat.mem.questions.some((x) => x.fyi && x.text.includes("no answer in 24 h"));
const afterlapse = fs.existsSync(work + "/Cy");
const late = await answer(q.id, "yes");
const afterlate = fs.existsSync(work + "/Cy");
const next = sweeps().map((x) => x.id);
const no = next.length === 1 ? await answer(next[0], "no") : null;
// a no snoozes exactly those paths for 7 days: a new stale dir is still listed
agent("Dee");
await tick(now + 2 * DAY + 120e3);
const snoozed = sweeps().map((x) => x.text);
console.log(JSON.stringify({ forged, afterforged, lapsed, lapsenote, afterlapse, late: late !== null && "error" in late, afterlate, next: next.length, no, afterno: fs.existsSync(work + "/Cy"), snoozed }));
process.exit(0);
`;

test("AC8: unanswered for 24 h the question lapses and every dir stays; a forged question, a late yes and a no remove nothing; a no snoozes those paths, a new stale dir is still listed", async () => {
  const out = await run("lapse", LAPSE);
  expect(out.forged).toEqual({});
  expect(out.afterforged).toBe(true);
  expect(out.lapsed).toBe(true);
  expect(out.lapsenote).toBe(true);
  expect(out.afterlapse).toBe(true);
  expect(out.late).toBe(true);
  expect(out.afterlate).toBe(true);
  expect(out.next).toBe(1);
  expect(out.no).toEqual({});
  expect(out.afterno).toBe(true);
  expect(out.snoozed.length).toBe(1);
  expect(out.snoozed[0]).toContain(out.work + "/Dee");
  expect(out.snoozed[0]).not.toContain(out.work + "/Cy");
}, 30_000);
