// Undo
// ====
// An agent's changes undone (the Crew view's Undo last turn, a user act
// only: no agent has a tool for it). Before an agent's first change of a
// turn (write, edit, a shell outside plan mode) in a git repo, the device
// snapshots the repo's working tree (Device.device_snap): a commit on HEAD
// of every file git would add (tracked or not, ignored ones left out, a
// secret's path never: Machine.secret), built in a temp index seeded from
// the repo's own (so only changed files are hashed), kept as
// refs/legion/undo/<agent>/<turn>. The user's working tree, index, HEAD
// and stash list are untouched; at most KEEP snapshots are kept per agent
// and repo (the oldest let go). Undo (undo_restore) first snapshots the
// tree as it is now (refs/legion/redo/<agent>/<ms>: the undo undone), then
// checks out from the snapshot what differs and deletes what was added
// since, in the working tree only; a HEAD moved since (the agent
// committed) is refused, never rewritten. The repos an agent snapshotted
// are listed in <state>/undo.jsonl (Device.ts's state dir).
// This side runs git only as the caller builds it (Git: Device.device_git,
// hardened), and imports nothing of the server's.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Machine } from "./Machine.ts";

// a git command in dir, as the caller hardens it (Device.device_git)
export type Git = (dir: string, ...args: string[]) => string[];

// what an undo did: files checked out from the snapshot, files deleted
// (added since), the ref keeping the tree as it was before
export type Undone = { restored: number; deleted: number; redo: string };

// the snapshots kept per agent and repo, of each kind
export const KEEP = 20;

// an agent's name, as a ref's part (Tools.ts names agents so)
export const NAME = /^[\w-]{1,64}$/;

// the most a git step may take (ms): a snapshot never holds a call long
const WAIT = 15_000;

// who a snapshot's commit says made it
const WHO = { GIT_AUTHOR_NAME: "Legion", GIT_AUTHOR_EMAIL: "legion@localhost", GIT_COMMITTER_NAME: "Legion", GIT_COMMITTER_EMAIL: "legion@localhost" };

// a gitlink's mode (a submodule): never checked out nor deleted here
const GITLINK = "160000";

// git run: its exit code and stdout; env added to this process's
function run(git: Git, dir: string, args: string[], env: Record<string, string> = {}, input?: Buffer): { code: number; out: string } {
  try {
    const proc = Bun.spawnSync(git(dir, ...args), { env: { ...process.env, GIT_LITERAL_PATHSPECS: "1", ...env }, stdin: input ?? "ignore", stdout: "pipe", stderr: "ignore", timeout: WAIT });
    return { code: proc.exitCode ?? 1, out: proc.stdout.toString() };
  } catch {
    return { code: 1, out: "" };
  }
}

// a snapshot's ref
export function undo_ref(kind: "undo" | "redo", agent: string, at: number): string {
  return "refs/legion/" + kind + "/" + agent + "/" + at;
}

// the top of the repo p (a file or a folder, there or not yet) is in, its
// real path; none: null
export function undo_top(git: Git, p: string): string | null {
  let dir = path.resolve(p);
  while (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    const up = path.dirname(dir);
    if (up === dir) {
      return null;
    }
    dir = up;
  }
  const r = run(git, dir, ["rev-parse", "--show-toplevel"]);
  const top = r.out.trim();
  return r.code === 0 && top !== "" ? fs.realpathSync(top) : null;
}

// the working tree of top as a commit on HEAD, kept as ref (made only if
// it is new: a snapshot already there stays); its hash, or null (no HEAD,
// a git that failed); never throws, never touches the user's index
export function undo_snap(git: Git, top: string, ref: string): string | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "legion-undo-"));
  try {
    const head = run(git, top, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]).out.trim();
    if (head === "") {
      return null;
    }
    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    const own = run(git, top, ["rev-parse", "--path-format=absolute", "--git-path", "index"]).out.trim();
    try {
      fs.copyFileSync(own, env.GIT_INDEX_FILE);
    } catch {
      if (run(git, top, ["read-tree", "HEAD"], env).code !== 0) {
        return null;
      }
    }
    if (run(git, top, ["add", "-A"], env).code !== 0) {
      return null;
    }
    // a secret's path never kept (nor, as it is in neither tree, undone);
    // by its name: git keeps a link, not what it points to
    const secrets = run(git, top, ["ls-files", "-z"], env).out.split("\0").filter((f) => f !== "" && Machine.secret_name(path.join(top, f)));
    if (secrets.length > 0 && run(git, top, ["update-index", "--force-remove", "-z", "--stdin"], env, Buffer.from(secrets.join("\0") + "\0")).code !== 0) {
      return null;
    }
    const tree = run(git, top, ["write-tree"], env).out.trim();
    const commit = tree === "" ? "" : run(git, top, ["commit-tree", "--no-gpg-sign", "-p", head, "-m", "Legion: " + ref, tree], WHO).out.trim();
    if (commit === "" || run(git, top, ["update-ref", ref, commit, ""]).code !== 0) {
      return null;
    }
    return commit;
  } catch {
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// an agent's snapshots of a kind in top, by their times, oldest first
export function undo_refs(git: Git, top: string, kind: "undo" | "redo", agent: string): number[] {
  const base = "refs/legion/" + kind + "/" + agent + "/";
  const refs = run(git, top, ["for-each-ref", "--format=%(refname)", base]).out.split("\n");
  return refs.filter((r) => r.startsWith(base) && /^\d+$/.test(r.slice(base.length))).map((r) => Number(r.slice(base.length))).sort((a, b) => a - b);
}

// all but an agent's newest `keep` snapshots of a kind let go
export function undo_prune(git: Git, top: string, kind: "undo" | "redo", agent: string, keep = KEEP): void {
  for (const at of undo_refs(git, top, kind, agent).slice(0, -keep)) {
    run(git, top, ["update-ref", "-d", undo_ref(kind, agent, at)]);
  }
}

// why a snapshot can't be restored in top: none there, or HEAD moved since
// it (the agent committed: undoing would rewrite history); null: it can
export function undo_check(git: Git, top: string, ref: string): string | null {
  const snap = run(git, top, ["rev-parse", "--verify", "-q", ref + "^{commit}"]).out.trim();
  const base = snap === "" ? "" : run(git, top, ["rev-parse", "--verify", "-q", snap + "^"]).out.trim();
  const head = run(git, top, ["rev-parse", "--verify", "-q", "HEAD^{commit}"]).out.trim();
  if (snap === "" || base === "") {
    return "No snapshot " + ref + " in " + top + ".";
  }
  if (head !== base) {
    return path.basename(top) + "'s HEAD moved since (" + base.slice(0, 8) + " to " + (head.slice(0, 8) || "none") + ": a commit?): not undone, as that would rewrite history. Undo it with git yourself.";
  }
  return null;
}

// top's working tree put back as the snapshot ref keeps it: what differs
// checked out from it, what was added since deleted, the index and HEAD
// left alone; the tree as it was kept first (refs/legion/redo). A string:
// why not (nothing changed then)
export function undo_restore(git: Git, top: string, ref: string, agent: string, now: number): Undone | string {
  const why = undo_check(git, top, ref);
  if (why !== null) {
    return why;
  }
  const snap = run(git, top, ["rev-parse", "--verify", "-q", ref + "^{commit}"]).out.trim();
  const redo = undo_ref("redo", agent, now);
  const was = undo_snap(git, top, redo);
  if (was === null) {
    return path.basename(top) + ": the tree as it is now couldn't be kept first: not undone.";
  }
  const diff = run(git, top, ["diff-tree", "-r", "-z", "--no-renames", was, snap]);
  if (diff.code !== 0) {
    return path.basename(top) + ": git diff-tree failed: not undone.";
  }
  // ":<mode now> <mode then> <hash> <hash> <status>", then its path
  const parts = diff.out.split("\0");
  const back: string[] = [];
  const gone: string[] = [];
  for (let k = 0; k + 1 < parts.length; k += 2) {
    const [now_mode, then_mode, , , status] = parts[k]!.slice(1).split(" ");
    const file = parts[k + 1]!;
    // secrets and files that gate the hooks (Machine.gating) are left as
    // they are: a planted snapshot can't put a hook back
    if (file === "" || Machine.secret(path.join(top, file)) || Machine.gating(path.join(top, file))) {
      continue;
    }
    if (status === "D" && now_mode !== GITLINK) {
      gone.push(file);
    } else if (status !== "D" && then_mode !== GITLINK) {
      back.push(file);
    }
  }
  if (back.length > 0 && run(git, top, ["restore", "--source=" + snap, "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"], {}, Buffer.from(back.join("\0") + "\0")).code !== 0) {
    return path.basename(top) + ": git restore failed; the tree as it was is kept as " + redo + ".";
  }
  let deleted = 0;
  for (const file of gone) {
    deleted += remove(top, file) ? 1 : 0;
  }
  run(git, top, ["update-ref", "-d", ref]);
  undo_prune(git, top, "redo", agent);
  return { restored: back.length, deleted, redo };
}

// a file added since a snapshot deleted (a file or a link, never a folder,
// only under top by its real folder), its folders emptied by it too
function remove(top: string, file: string): boolean {
  const at = path.join(top, file);
  const dir = Machine.real(path.dirname(at));
  if (dir !== top && !dir.startsWith(top + path.sep)) {
    return false;
  }
  const st = fs.lstatSync(at, { throwIfNoEntry: false });
  if (st === undefined || st.isDirectory()) {
    return false;
  }
  fs.unlinkSync(at);
  for (let up = path.dirname(at); up !== top && up.startsWith(top + path.sep); up = path.dirname(up)) {
    try {
      fs.rmdirSync(up);
    } catch {
      break;
    }
  }
  return true;
}

// the repos an agent snapshotted, newest last (undo.jsonl in state)
export function undo_repos(state: string, agent: string): string[] {
  let text = "";
  try {
    text = fs.readFileSync(path.join(state, "undo.jsonl"), "utf8");
  } catch {
    return [];
  }
  const repos = text.split("\n").flatMap((line) => {
    try {
      const e = JSON.parse(line);
      return e?.agent === agent && typeof e.repo === "string" ? [e.repo as string] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(repos.reverse())].reverse();
}

// a repo an agent snapshotted, listed once (0600, in a 0700 state dir)
export function undo_log(state: string, agent: string, top: string): void {
  if (undo_repos(state, agent).includes(top)) {
    return;
  }
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  fs.appendFileSync(path.join(state, "undo.jsonl"), JSON.stringify({ agent, repo: top }) + "\n", { mode: 0o600 });
}
