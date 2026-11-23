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
// where a dir is moved before it is deleted (sweep_remove): in WORK, never listed
export const TRASH = ".sweep-trash";

// a dir listed: its real path, its bytes, its newest mtime (ms), whether
// git's, the .env files in it (paths within it; ignored ones are deleted too)
// dev, ino: its identity when listed (sweep_remove deletes that dir only)
export type Item = { path: string; bytes: number; mtime: number; git: "repo" | "worktree" | null; envs?: string[]; dev?: number; ino?: number };
// the agents' names known (live or on disk), and those not done (at work,
// asking, waiting, stopped)
// shared: whether dirs not named after an agent (shared clones like
// WORK/review) may be listed. M1: config.WORK is one per server, agent
// names unique per user only, so a chat lists only its own agents' dirs,
// and the shared ones only on a server with one user (Server.ts
// Chat.sweep_agents); absent: not
export type Agents = { known: Set<string>; busy: Set<string>; shared?: boolean };

// git read-only, argv only: no optional locks (no index written), no
// fsmonitor, hooks or signature check, no system or global config, no
// prompt, no GIT_* from our env (an agent's shell may set them). A repo's
// own config can still name commands (filters, gpg): sweep_runs is asked
// before any git runs in a candidate. Never into submodules. Killed past
// GIT_MS (a FIFO, an endless file): null, as any failure is
const GIT_MS = 10_000;
async function git(dir: string, args: string[]): Promise<string | null> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const hard = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "log.showSignature=false", "-c", "submodule.recurse=false", "-c", "diff.ignoreSubmodules=all"];
  const proc = Bun.spawn(["git", ...hard, "-C", dir, ...args], { stdout: "pipe", stderr: "ignore", env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" } });
  const timer = setTimeout(() => proc.kill(9), GIT_MS);
  try {
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 && proc.signalCode === null ? out : null;
  } finally {
    clearTimeout(timer);
  }
}

function real(p: string): string | null {
  try {
    return fs.realpathSync.native(p); // the name as on disk (a case-insensitive file system: "Main" is main)
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
  // L1: a name with a control character (a newline forging a line of the
  // question) never listed; Info: main and TRASH compared case-folded
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || /[\x00-\x1f\x7f]/.test(at) || ["main", TRASH].includes((rel.split(path.sep)[0] ?? "").toLowerCase()) ? null : at;
}

// a dir's bytes, its newest mtime (.git's insides aside: git writes there
// on a read), the repos and worktrees in it (each dir holding a .git), its
// .env files (paths within it), its .gitattributes files; symlinks not
// followed. Async, one entry at a time
export async function sweep_walk(dir: string): Promise<{ bytes: number; mtime: number; repos: string[]; envs: string[]; attrs: string[] }> {
  const out = { bytes: 0, mtime: 0, repos: [] as string[], envs: [] as string[], attrs: [] as string[] };
  const each = async (p: string, ingit: boolean): Promise<void> => {
    // L2: gone meanwhile, skipped; any other error, never old enough
    const st = await fs.promises.lstat(p).catch((e: NodeJS.ErrnoException) => {
      out.mtime = e.code === "ENOENT" ? out.mtime : Infinity;
      return null;
    });
    if (st === null) {
      return;
    }
    out.bytes += st.blocks * 512; // LOW c: what it takes on disk (a sparse file: its blocks only)
    // L1: a name with a control character in it: the dir is never listed
    out.mtime = /[\x00-\x1f\x7f]/.test(path.basename(p)) ? Infinity : ingit ? out.mtime : Math.max(out.mtime, st.mtimeMs);
    // L4: ENVS + 1 at most (one more: "and more"), so git's argv stays small
    if (!ingit && st.isFile() && path.basename(p).startsWith(".env") && out.envs.length <= ENVS) {
      out.envs.push(path.relative(dir, p));
    }
    if (!ingit && path.basename(p) === ".gitattributes") {
      out.attrs.push(p);
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
  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(dir + "/.git", { throwIfNoEntry: false });
  } catch {
    return null; // unreadable: not git; its walk keeps it (L2)
  }
  return st === undefined ? null : st.isDirectory() ? "repo" : st.isFile() ? "worktree" : null;
}

// config keys and attributes that make git run a command (or pull in
// config that may: include)
const RUNS = /^(filter|gpg|include|includeif|diff|merge)\.|^core\.(fsmonitor|hookspath|pager|editor|sshcommand)=|^log\.showsignature=/;
const DRIVER = /(^|\s)(filter|diff|merge)=/;

// a repo's git dirs: its .git, or a worktree's own and its repo's
// (commondir); null: unreadable
function gitdirs(dir: string): string[] | null {
  let dirs: string[];
  if (sweep_git(dir) === "repo") {
    dirs = [dir + "/.git"];
  } else {
    try {
      const own = path.resolve(dir, /^gitdir: (.+)$/m.exec(fs.readFileSync(dir + "/.git", "utf8"))?.[1]?.trim() ?? "");
      // a linked worktree's: and its repo's (commondir); a submodule's: its own
      const common = fs.existsSync(own + "/commondir") ? [path.resolve(own, fs.readFileSync(own + "/commondir", "utf8").trim())] : [];
      dirs = [own, ...common];
    } catch {
      return null;
    }
  }
  // H2-bis: every submodule's git dir under modules/, however deep
  const modules = (d: string): string[] => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(d + "/modules");
    } catch {
      return [];
    }
    return names.map((n) => d + "/modules/" + n).filter((m) => fs.lstatSync(m, { throwIfNoEntry: false })?.isDirectory() === true).flatMap((m) => (fs.existsSync(m + "/HEAD") ? [m, ...modules(m)] : modules(m)));
  };
  return dirs.flatMap((d) => [d, ...modules(d)]);
}

// LOW a: a config or attributes file read only if a regular file (no
// FIFO, no symlink) under 1 MB; missing: nothing to read; else unsafe
const FILE_MOST = 2 ** 20;
function readable(f: string): "none" | "ok" | "bad" {
  try {
    const st = fs.lstatSync(f, { throwIfNoEntry: false });
    return st === undefined ? "none" : st.isFile() && st.size < FILE_MOST ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

// whether git in dir might run a command its config names: a config key
// in RUNS, or a filter=/diff=/merge= attribute (attrs: its .gitattributes
// files, the walk's; plus info/attributes), in its git dirs and every
// submodule's. Read as files: `git config --file --no-includes` reads one
// and runs nothing. Unreadable, odd or too big: true
export async function sweep_runs(dir: string, attrs: string[]): Promise<boolean> {
  const dirs = gitdirs(dir);
  if (dirs === null) {
    return true;
  }
  const files = [...dirs.flatMap((d) => [d + "/config", d + "/config.worktree", d + "/info/attributes"]), ...attrs.filter((a) => a.startsWith(dir + "/"))];
  const kinds = files.map(readable);
  if (kinds.includes("bad")) {
    return true;
  }
  const exists = (f: string) => kinds[files.indexOf(f)] === "ok";
  for (const f of dirs.flatMap((d) => [d + "/config", d + "/config.worktree"]).filter(exists)) {
    const keys = await git("/", ["config", "--file", f, "--no-includes", "--list"]);
    if (keys === null || keys.split("\n").some((l) => RUNS.test(l.toLowerCase()))) {
      return true;
    }
  }
  for (const f of [...attrs.filter((a) => a.startsWith(dir + "/")), ...dirs.map((d) => d + "/info/attributes")].filter(exists)) {
    const text = await fs.promises.readFile(f, "utf8").catch(() => null);
    if (text === null || text.split("\n").some((l) => DRIVER.test(l))) {
      return true;
    }
  }
  return false;
}

// nothing git would lose with it. Any: no change. A linked worktree (its
// branches, stash and objects stay in its repo): no commit at HEAD that
// is on no remote and on no branch (a detached HEAD's own). A repo (all
// of it goes): no stash, no branch's commit on no remote, no other
// worktree of it. A repo whose config may run a command (sweep_runs): not
// clean, and no git runs in it. A failed git: not clean
export async function sweep_clean(dir: string, attrs: string[] = []): Promise<boolean> {
  if (await sweep_runs(dir, attrs)) {
    return false;
  }
  const empty = async (args: string[]) => (await git(dir, args))?.trim() === "";
  if (!(await empty(["status", "--porcelain", "--ignore-submodules=all"]))) {
    return false;
  }
  if (sweep_git(dir) === "worktree") {
    return empty(["log", "--no-show-signature", "HEAD", "--not", "--remotes", "--branches", "--oneline"]);
  }
  if (!(await empty(["stash", "list"])) || !(await empty(["log", "--no-show-signature", "--branches", "--not", "--remotes", "--oneline"]))) {
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
  if (at === null || at !== p || st === undefined || !st.isDirectory() || keep.some((k) => at === (real(k) ?? k) || (real(k) ?? k).startsWith(at + "/"))) {
    return null;
  }
  const rel = path.relative(real(work) ?? work, at).split(path.sep);
  const top = rel[0] ?? "";
  const kind = sweep_git(at);
  if (agents.busy.has(top) || !agents.known.has(top) && agents.shared !== true || kind === null && !(rel.length === 1 && agents.known.has(top))) {
    return null;
  }
  const walk = await sweep_walk(at);
  if (now - walk.mtime < AGE) {
    return null;
  }
  // H2-bis: every repo in it (and each one's submodules) checked before
  // any git runs in any of them: a parent's status reads its submodules
  for (const r of walk.repos) {
    if (await sweep_runs(r, walk.attrs)) {
      return null;
    }
  }
  for (const r of walk.repos) {
    if (!(await sweep_clean(r, walk.attrs))) {
      return null;
    }
  }
  const envs = await untracked(at, walk.envs, walk.repos);
  return { path: at, bytes: walk.bytes, mtime: walk.mtime, git: kind, ...(envs.length === 0 ? {} : { envs }), dev: st.dev, ino: st.ino };
}

// of the .env files in dir (paths within it), those git cannot give back:
// in no repo, or not tracked by the innermost repo holding them (a
// tracked template, .env.example, is left out). A failed git: named
async function untracked(dir: string, envs: string[], repos: string[]): Promise<string[]> {
  const by = new Map<string, string[]>();
  const loose: string[] = [];
  for (const rel of envs) {
    const abs = dir + "/" + rel;
    const repo = repos.filter((r) => abs.startsWith(r + "/")).sort((x, y) => y.length - x.length)[0];
    if (repo === undefined) {
      loose.push(rel);
    } else {
      by.set(repo, [...(by.get(repo) ?? []), rel]);
    }
  }
  const kept = [...loose];
  for (const [repo, rels] of by) {
    const listed = await git(repo, ["--literal-pathspecs", "ls-files", "-z", "--", ...rels.map((rel) => path.relative(repo, dir + "/" + rel))]);
    const tracked = new Set((listed ?? "").split("\0").filter((x) => x !== "").map((x) => path.relative(dir, repo + "/" + x)));
    kept.push(...rels.filter((rel) => listed === null || !tracked.has(rel)));
  }
  return kept;
}

// the candidates in WORK, the biggest MOST, biggest first: its entries,
// and below those neither git nor an agent's, DEPTH deep
export async function sweep_list(work: string, agents: Agents, keep: string[], now: number): Promise<Item[]> {
  const root = real(work);
  // Info: WORK is, or holds, a kept dir (Legion's DIR, HOME, the user's
  // dir): no sweep at all
  if (root === null || keep.some((k) => root === (real(k) ?? k) || (real(k) ?? k).startsWith(root + "/"))) {
    return [];
  }
  const out: Item[] = [];
  const look = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.filter((x) => x.isDirectory())) {
      const p = dir + "/" + e.name;
      // L4: one dir that fails (EACCES) is skipped, not the whole listing
      const item = await sweep_candidate(root, p, agents, keep, now).catch(() => undefined);
      if (item !== null && item !== undefined) {
        out.push(item);
      } else if (item === null && depth < DEPTH && sweep_git(p) === null && !(depth === 0 && (agents.known.has(e.name) || agents.shared !== true))) {
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

// RED ZONE: the one delete, bound to the dir listed (its dev and ino), so
// an agent swapping a path under it (a parent for a symlink out of WORK)
// gets nothing outside deleted. Walked first (the repos whose linked
// worktrees it holds); then its real path and identity checked; then
// renamed into WORK/TRASH (same file system: EXDEV, kept) and checked
// again there: a real dir, inside the quarantine, the same dev and ino.
// Only then removed; a mismatch is left in the quarantine (recoverable),
// never removed. Then `git worktree prune` in each repo inside WORK whose
// worktree went (a worktree itself: its own repo's). null: done; else why not
export async function sweep_remove(work: string, item: Item): Promise<string | null> {
  const root = real(work);
  const before = await fs.promises.lstat(item.path).catch(() => null);
  if (root === null || before === null || !before.isDirectory() || sweep_inside(work, item.path) !== item.path) {
    return "not a dir inside WORK";
  }
  const repos = item.git === "worktree" ? [item.path] : (await sweep_walk(item.path)).repos;
  const trash = root + "/" + TRASH;
  const held = (r: string) => sweep_inside(work, r) === r && !overlap(r, item.path) && !overlap(r, trash);
  const parents = [...new Set(repos.filter((r) => sweep_git(r) === "worktree").map(linked))].filter((r): r is string => r !== null && held(r));
  const same = (st: fs.Stats | null) => st !== null && st.isDirectory() && !st.isSymbolicLink() && st.dev === item.dev && st.ino === item.ino;
  if (sweep_inside(work, item.path) !== item.path || !same(await fs.promises.lstat(item.path).catch(() => null))) {
    return "not the dir listed";
  }
  // the quarantine must be WORK's own before anything moves into it: named
  // exactly TRASH (no case variant beside it), a real dir (no symlink),
  // ours, writable by no one else; made here if there is none
  if (fs.readdirSync(root).some((n) => n !== TRASH && n.toLowerCase() === TRASH)) {
    return "quarantine refused: a case variant of " + TRASH + " is in WORK; nothing moved";
  }
  await fs.promises.mkdir(trash, { mode: 0o700 }).catch(() => undefined);
  const q = fs.lstatSync(trash, { throwIfNoEntry: false });
  if (q === undefined || q.isSymbolicLink() || !q.isDirectory() || q.uid !== process.getuid?.() || (q.mode & 0o022) !== 0 || real(trash) !== trash) {
    return "quarantine refused: " + trash + " is not a private dir of ours; nothing moved";
  }
  const id = crypto.randomUUID();
  const to = trash + "/" + id;
  try {
    await fs.promises.rename(item.path, to);
  } catch (e) {
    return "not moved: " + String((e as Error).message).slice(0, 120);
  }
  if (real(to) !== to || !same(await fs.promises.lstat(to).catch(() => null))) {
    return "moved to " + to + " but not the dir listed: kept there, not deleted";
  }
  // deleted by rm (fts: no symlink followed) from inside the quarantine,
  // checked again to be the one made above; a changed one: kept, not deleted
  const now = fs.lstatSync(trash, { throwIfNoEntry: false });
  if (now === undefined || now.isSymbolicLink() || now.dev !== q.dev || now.ino !== q.ino) {
    return "quarantine changed: " + to + " kept, not deleted";
  }
  const rm = Bun.spawn(["/bin/rm", "-rf", "--", id], { cwd: trash, stdout: "ignore", stderr: "ignore" });
  if ((await rm.exited) !== 0) {
    return "not removed: rm failed; kept in " + to;
  }
  for (const r of parents) {
    await git(r, ["worktree", "prune"]);
  }
  return null;
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
  const envs = (x: Item) => (x.envs === undefined ? "" : "; holds " + x.envs.slice(0, ENVS).join(", ") + (x.envs.length > ENVS ? " and more .env files" : ""));
  const lines = items.map((x) => "- " + x.path + " (" + sweep_size(x.bytes) + (x.git === null ? "" : ", git " + x.git) + envs(x) + ")");
  return "Work sweep: " + items.length + " work dirs untouched for 7 days or more, " + sweep_size(total) + " in all. Delete them? Answer yes to delete exactly these, with every file in them (ignored ones, .env files, too); each is checked again first, and one changed since is kept. No answer in 24 h: nothing is deleted. A no: these are not asked again for 7 days.\n" + lines.join("\n");
}
