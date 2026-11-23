// Sweep
// =====
// RED ZONE (deletes the user's work, DRAFT awaiting the user's sign-off;
// PLP-2923): the work dirs (config.WORK) no one still needs, listed for
// the user, removed only on their yes (Server.ts Chat.sweep, Chat.swept).
// A candidate: a dir strictly inside WORK (its real path: no symlink out),
// never WORK/main nor the user's own dirs; an agent's dir (WORK/<Name>)
// whose agent is done or gone, or a git repo or worktree found up to
// DEPTH deep; untouched for AGE (its newest mtime, .git's insides aside);
// every repo in it clean (sweep_clean). The biggest MOST are listed. At
// apply each is checked again (sweep_check): changed since the listing,
// kept. This is the pure part: it reads the disk (async: a 20 GB WORK
// never holds the server) and runs git read-only; only sweep_remove deletes.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const DAY = 86400e3;
export const AGE = 7 * DAY;
// WORK past this: the sweep runs early (once a day at most)
export const SIZE_GB = 10;
const DEPTH = 3; // how deep under WORK a shared clone is looked for
const MOST = 50; // the dirs one listing holds, at most: the biggest
const ENVS = 10; // the .env files the question names per dir, at most

// a dir listed: its real path, its bytes, its newest mtime (ms), whether
// git's, the .env files in it (paths within it; ignored ones are deleted too)
export type Item = { path: string; bytes: number; mtime: number; git: "repo" | "worktree" | null; envs?: string[] };
// the agents' names known (live or on disk), and those not done (at work,
// asking, waiting, stopped)
export type Agents = { known: Set<string>; busy: Set<string> };

// git read-only: no optional locks (no index written), no fsmonitor (a
// repo's config never runs a command), argv only; null: it failed
async function git(dir: string, args: string[]): Promise<string | null> {
  const proc = Bun.spawn(["git", "-c", "core.fsmonitor=false", "-C", dir, ...args], { stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return code === 0 ? out : null;
}

function real(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// p's real path if strictly inside WORK's and not under WORK/main; else null
export function sweep_inside(work: string, p: string): string | null {
  const root = real(work);
  const at = real(p);
  if (root === null || at === null) {
    return null;
  }
  const rel = path.relative(root, at);
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep)[0] === "main" ? null : at;
}

// a dir's bytes, its newest mtime (.git's insides aside: git writes there
// on a read), the repos and worktrees in it (each dir holding a .git), its
// .env files (paths within it); symlinks not followed. Async, one entry
// at a time
export async function sweep_walk(dir: string): Promise<{ bytes: number; mtime: number; repos: string[]; envs: string[] }> {
  const out = { bytes: 0, mtime: 0, repos: [] as string[], envs: [] as string[] };
  const each = async (p: string, ingit: boolean): Promise<void> => {
    const st = await fs.promises.lstat(p).catch(() => null);
    if (st === null) {
      return;
    }
    out.bytes += st.size;
    out.mtime = ingit ? out.mtime : Math.max(out.mtime, st.mtimeMs);
    if (!ingit && st.isFile() && path.basename(p).startsWith(".env")) {
      out.envs.push(path.relative(dir, p));
    }
    if (!st.isDirectory()) {
      return;
    }
    const names = await fs.promises.readdir(p).catch(() => null);
    if (names === null) {
      out.mtime = Infinity; // unreadable: never old enough
      return;
    }
    if (!ingit && names.includes(".git")) {
      out.repos.push(p);
    }
    for (const e of names) {
      await each(p + "/" + e, ingit || e === ".git");
    }
  };
  await each(dir, false);
  return out;
}

// a git repo (.git a dir), a worktree (.git a file), or neither
export function sweep_git(dir: string): Item["git"] {
  const st = fs.lstatSync(dir + "/.git", { throwIfNoEntry: false });
  return st === undefined ? null : st.isDirectory() ? "repo" : st.isFile() ? "worktree" : null;
}

// nothing git would lose with it. Any: no change. A linked worktree (its
// branches, stash and objects stay in its repo): no commit at HEAD that
// is on no remote and on no branch (a detached HEAD's own). A repo (all
// of it goes): no stash, no branch's commit on no remote, no other
// worktree of it. A failed git: not clean
export async function sweep_clean(dir: string): Promise<boolean> {
  const empty = async (args: string[]) => (await git(dir, args))?.trim() === "";
  if (!(await empty(["status", "--porcelain"]))) {
    return false;
  }
  if (sweep_git(dir) === "worktree") {
    return empty(["log", "HEAD", "--not", "--remotes", "--branches", "--oneline"]);
  }
  if (!(await empty(["stash", "list"])) || !(await empty(["log", "--branches", "--not", "--remotes", "--oneline"]))) {
    return false;
  }
  const list = await git(dir, ["worktree", "list", "--porcelain"]);
  return list !== null && list.split("\n").filter((l) => l.startsWith("worktree ")).length === 1;
}

const overlap = (a: string, b: string): boolean => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");

// p as a candidate (p a real path), or null: inside WORK, no kept dir in
// it or around it, no busy agent's, an agent's dir or a git one, old,
// every repo in it clean
export async function sweep_candidate(work: string, p: string, agents: Agents, keep: string[], now: number): Promise<Item | null> {
  const at = sweep_inside(work, p);
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (at === null || at !== p || st === undefined || !st.isDirectory() || keep.some((k) => overlap(at, real(k) ?? k))) {
    return null;
  }
  const rel = path.relative(real(work) ?? work, at).split(path.sep);
  const top = rel[0] ?? "";
  const kind = sweep_git(at);
  if (agents.busy.has(top) || kind === null && !(rel.length === 1 && agents.known.has(top))) {
    return null;
  }
  const walk = await sweep_walk(at);
  if (now - walk.mtime < AGE) {
    return null;
  }
  for (const r of walk.repos) {
    if (!(await sweep_clean(r))) {
      return null;
    }
  }
  return { path: at, bytes: walk.bytes, mtime: walk.mtime, git: kind, ...(walk.envs.length === 0 ? {} : { envs: walk.envs }) };
}

// the candidates in WORK, the biggest MOST, biggest first: its entries,
// and below those neither git nor an agent's, DEPTH deep
export async function sweep_list(work: string, agents: Agents, keep: string[], now: number): Promise<Item[]> {
  const root = real(work);
  if (root === null) {
    return [];
  }
  const out: Item[] = [];
  const look = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.filter((x) => x.isDirectory())) {
      const p = dir + "/" + e.name;
      const item = await sweep_candidate(root, p, agents, keep, now);
      if (item !== null) {
        out.push(item);
      } else if (depth < DEPTH && sweep_git(p) === null && !(depth === 0 && agents.known.has(e.name))) {
        await look(p, depth + 1);
      }
    }
  };
  await look(root, 0);
  return out.sort((x, y) => y.bytes - x.bytes || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)).slice(0, MOST);
}

// what the user's yes covers: each dir's path, size, time and kind, in order
export function sweep_fp(items: Item[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(items.map((x) => [x.path, x.bytes, x.mtime, x.git]))).digest("hex");
}

// at apply: still a candidate, nothing newer in it than when listed
export async function sweep_check(work: string, item: Item, agents: Agents, keep: string[], now: number): Promise<boolean> {
  const again = await sweep_candidate(work, item.path, agents, keep, now);
  return again !== null && again.mtime <= item.mtime && again.git === item.git;
}

// the repo a linked worktree belongs to, from its .git file ("gitdir:
// <repo>/.git/worktrees/<name>", that dir's commondir); null: not one
function linked(dir: string): string | null {
  try {
    const gitdir = /^gitdir: (.+)$/m.exec(fs.readFileSync(dir + "/.git", "utf8"))?.[1]?.trim();
    if (gitdir === undefined) {
      return null;
    }
    const from = path.resolve(dir, gitdir);
    const common = path.resolve(from, fs.readFileSync(from + "/commondir", "utf8").trim());
    return path.basename(common) === ".git" ? path.dirname(common) : null;
  } catch {
    return null;
  }
}

// RED ZONE: the one delete. A dir (its real path, inside WORK, no symlink)
// removed, then each repo outside it whose linked worktree it held pruned
// (`git worktree prune`); a worktree by `git worktree remove` in its repo
// (no --force), then gone from its list. null: done; else why not
export async function sweep_remove(work: string, item: Item): Promise<string | null> {
  const at = sweep_inside(work, item.path);
  const st = fs.lstatSync(item.path, { throwIfNoEntry: false });
  if (at === null || at !== item.path || st === undefined || st.isSymbolicLink() || !st.isDirectory()) {
    return "not a dir inside WORK";
  }
  if (item.git !== "worktree") {
    const walk = await sweep_walk(at);
    const parents = [...new Set(walk.repos.filter((r) => sweep_git(r) === "worktree").map(linked))].filter((r): r is string => r !== null && !overlap(r, at));
    try {
      await fs.promises.rm(at, { recursive: true });
    } catch (e) {
      return "not removed: " + String((e as Error).message).slice(0, 120);
    }
    for (const r of parents) {
      await git(r, ["worktree", "prune"]);
    }
    return null;
  }
  const common = (await git(at, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))?.trim() ?? "";
  if (common === "") {
    return "its repo not found";
  }
  const parent = path.dirname(common);
  if ((await git(parent, ["worktree", "remove", at])) === null) {
    return "git worktree remove refused it";
  }
  const list = await git(parent, ["worktree", "list", "--porcelain"]);
  return list !== null && !list.split("\n").includes("worktree " + at) ? null : "still in its repo's worktree list";
}

// due: a day at least since the last sweep, and a Sunday 03:00 (local)
// passed since it (or since base, the first tick), or WORK over most bytes
export function sweep_due(base: number, last: number | null, now: number, bytes: number, most: number): boolean {
  const d = new Date(now);
  const sunday = (back: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay() - back, 3, 0).getTime();
  const week = sunday(0) > now ? sunday(7) : sunday(0);
  return (last === null || now - last >= DAY) && (week > (last ?? base) || bytes > most);
}

export function sweep_size(n: number): string {
  return n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + " GB" : n >= 2 ** 20 ? (n / 2 ** 20).toFixed(1) + " MB" : n >= 2 ** 10 ? (n / 2 ** 10).toFixed(1) + " KB" : n + " bytes";
}

// the question put to the user, each dir's .env files named
export function sweep_text(items: Item[]): string {
  const total = items.reduce((n, x) => n + x.bytes, 0);
  const envs = (x: Item) => (x.envs === undefined ? "" : "; holds " + x.envs.slice(0, ENVS).join(", ") + (x.envs.length > ENVS ? " and " + (x.envs.length - ENVS) + " more .env files" : ""));
  const lines = items.map((x) => "- " + x.path + " (" + sweep_size(x.bytes) + (x.git === null ? "" : ", git " + x.git) + envs(x) + ")");
  return "Work sweep: " + items.length + " work dirs untouched for 7 days or more, " + sweep_size(total) + " in all. Delete them? Answer yes to delete exactly these, with every file in them (ignored ones, .env files, too); each is checked again first, and one changed since is kept. No answer in 24 h: nothing is deleted. A no: these are not asked again for 7 days.\n" + lines.join("\n");
}
