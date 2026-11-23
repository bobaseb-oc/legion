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
    const st = fs.lstatSync(p);
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
  const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
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

const none = { known: new Set<string>(), busy: new Set<string>() };
const listed = (items: Sweep.Item[]): string[] => items.map((x) => x.path).sort();

test("AC1: a finished agent's dir untouched 8 days is listed once with its size; nothing is removed", () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada/sub", { recursive: true });
  fs.writeFileSync(work + "/Ada/sub/f.bin", Buffer.alloc(5000));
  age(work + "/Ada", 8);
  const items = Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set() }, [], Date.now());
  expect(listed(items)).toEqual([work + "/Ada"]);
  expect(items[0]!.bytes).toBeGreaterThanOrEqual(5000);
  expect(Sweep.sweep_text(items)).toContain(work + "/Ada");
  expect(fs.existsSync(work + "/Ada/sub/f.bin")).toBe(true);
});

test("age: a dir touched 6 days ago, or with one file touched today, is not listed", () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.mkdirSync(work + "/Bob/deep", { recursive: true });
  fs.writeFileSync(work + "/Bob/deep/new.txt", "x");
  age(work + "/Ada", 6);
  age(work + "/Bob", 30);
  fs.utimesSync(work + "/Bob/deep/new.txt", new Date(), new Date());
  expect(Sweep.sweep_list(work, { known: new Set(["Ada", "Bob"]), busy: new Set() }, [], Date.now())).toEqual([]);
});

test("AC3: an old repo with a change, a stash, or a commit on no remote is not listed; a clean pushed one is", () => {
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
  expect(listed(Sweep.sweep_list(work, none, [], Date.now()))).toEqual([clean]);
});

test("AC4: an agent at work, asking or waiting is not listed, however old", () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/Ada");
  age(work + "/Ada", 90);
  expect(Sweep.sweep_list(work, { known: new Set(["Ada"]), busy: new Set(["Ada"]) }, [], Date.now())).toEqual([]);
});

test("AC9: never WORK/main, the user's dirs, or a non-git dir not named after an agent", () => {
  const { work } = fresh();
  fs.mkdirSync(work + "/main");
  fs.mkdirSync(work + "/scratch/inner", { recursive: true });
  fs.mkdirSync(work + "/users/u1/docs/agent", { recursive: true });
  fs.writeFileSync(work + "/users/u1/view.json", "{}");
  age(work, 30);
  const keep = [work + "/users/u1"];
  expect(Sweep.sweep_list(work, { known: new Set(["main", "users"]), busy: new Set() }, keep, Date.now())).toEqual([]);
});

test("symlinks: one in WORK pointing outside is never listed nor removed; the outside dir stays", () => {
  const { work, out } = fresh();
  fs.mkdirSync(out + "/precious");
  fs.writeFileSync(out + "/precious/keep.txt", "keep");
  fs.symlinkSync(out + "/precious", work + "/Eve");
  age(out, 30);
  expect(Sweep.sweep_list(work, { known: new Set(["Eve"]), busy: new Set() }, [], Date.now())).toEqual([]);
  const forged: Sweep.Item = { path: work + "/Eve", bytes: 4, mtime: 0, git: null };
  expect(Sweep.sweep_remove(work, forged)).not.toBeNull();
  expect(Sweep.sweep_remove(work, { ...forged, path: work + "/../out/precious" })).not.toBeNull();
  expect(Sweep.sweep_remove(work, { ...forged, path: work })).not.toBeNull();
  expect(fs.readFileSync(out + "/precious/keep.txt", "utf8")).toBe("keep");
  expect(fs.existsSync(work)).toBe(true);
});

test("AC5: a listed dir touched or made dirty since the listing fails its re-check; an unchanged one passes", () => {
  const { work, out } = fresh();
  fs.mkdirSync(work + "/Ada");
  fs.writeFileSync(work + "/Ada/f", "x");
  const r = repo(work + "/rv/r", out);
  fs.mkdirSync(work + "/Bob");
  age(work, 8);
  const agents = { known: new Set(["Ada", "Bob"]), busy: new Set<string>() };
  const items = Sweep.sweep_list(work, agents, [], Date.now());
  expect(listed(items)).toEqual([work + "/Ada", work + "/Bob", r]);
  fs.writeFileSync(work + "/Ada/f", "y");
  fs.writeFileSync(r + "/a.txt", "dirty\n");
  age(r, 8);
  const ok = items.map((x) => [x.path, Sweep.sweep_check(work, x, agents, [], Date.now())]);
  expect(ok).toEqual([[work + "/Ada", false], [work + "/Bob", true], [r, false]]);
  expect(Sweep.sweep_check(work, items[1]!, { ...agents, busy: new Set(["Bob"]) }, [], Date.now())).toBe(false);
});

test("AC6: a listed git worktree is removed by git worktree remove; its parent's list drops it", () => {
  const { work, out } = fresh();
  const parent = repo(work + "/review/af", out);
  const wt = work + "/review/af-worktrees/pr1";
  git(parent, "worktree", "add", "-q", "--detach", wt);
  age(work, 8);
  const items = Sweep.sweep_list(work, none, [], Date.now());
  // the parent has a worktree: kept; the worktree is the one listed
  expect(listed(items)).toEqual([wt]);
  expect(items[0]!.git).toBe("worktree");
  expect(Sweep.sweep_remove(work, items[0]!)).toBeNull();
  expect(fs.existsSync(wt)).toBe(false);
  expect(git(parent, "worktree", "list", "--porcelain")).not.toContain(wt);
  expect(fs.existsSync(parent + "/a.txt")).toBe(true);
});

test("the fingerprint covers each listed dir's path, size and time", () => {
  const a: Sweep.Item = { path: "/w/A", bytes: 1, mtime: 1, git: null };
  const fp = Sweep.sweep_fp([a]);
  expect(Sweep.sweep_fp([a])).toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, path: "/w/B" }])).not.toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, bytes: 2 }])).not.toBe(fp);
  expect(Sweep.sweep_fp([{ ...a, mtime: 2 }])).not.toBe(fp);
  expect(Sweep.sweep_fp([a, a])).not.toBe(fp);
});

test("due: weekly at the first Sunday 03:00 (local) since the last; early over the size, once a day", () => {
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
`;

const YES = HEAD + `
agent("Ada");
agent("Bob");
const log = fs.readFileSync(chat.mem.dir + "/docs/agent/Ada.jsonl");
const now = Date.now();
Chat.ticked(chat, now);
const first = sweeps().map((q) => ({ id: q.id, text: q.text, options: q.options }));
const asked = chat.mem.asked;
Chat.ticked(chat, now + 3600e3);
Chat.ticked(chat, now + 20 * 3600e3);
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

const LAPSE = HEAD + `
agent("Cy");
const now = Date.now();
Chat.ticked(chat, now);
const q = sweeps()[0];
// a question that claims the listing's fingerprint, not the one asked
chat.mem.questions.push({ id: 999, text: "forged", options: ["yes", "no"], at: 0, date: "", sweep: q.sweep });
const forged = await answer(999, "yes");
const afterforged = fs.existsSync(work + "/Cy");
Chat.ticked(chat, now + DAY + 60e3);
const lapsed = !sweeps().some((x) => x.id === q.id);
const afterlapse = fs.existsSync(work + "/Cy");
const late = await answer(q.id, "yes");
const afterlate = fs.existsSync(work + "/Cy");
const next = sweeps().map((x) => x.id);
const no = next.length === 1 ? await answer(next[0], "no") : null;
console.log(JSON.stringify({ forged, afterforged, lapsed, afterlapse, late: late !== null && "error" in late, afterlate, next: next.length, no, afterno: fs.existsSync(work + "/Cy"), open: sweeps().length }));
process.exit(0);
`;

test("AC8: unanswered for 24 h the question lapses and every dir stays; a forged question, a late yes and a no remove nothing", async () => {
  const out = await run("lapse", LAPSE);
  expect(out.forged).toEqual({});
  expect(out.afterforged).toBe(true);
  expect(out.lapsed).toBe(true);
  expect(out.afterlapse).toBe(true);
  expect(out.late).toBe(true);
  expect(out.afterlate).toBe(true);
  expect(out.next).toBe(1);
  expect(out.no).toEqual({});
  expect(out.afterno).toBe(true);
  expect(out.open).toBe(0);
}, 30_000);
