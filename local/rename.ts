// Rename
// ======
// `bun local/rename.ts [--dry]`: moves Legion's data from before the
// rename (UniiChat, its AI Unii) once, with the server and the device
// stopped (`legion stop`, `legion device --uninstall`, `legion server
// --uninstall`). --dry counts what would change and writes nothing.
//
// RED ZONE (rename, DRAFT awaiting the user's sign-off):
// - refused while a server answers on ~/.unii's lock (Server.ts LOCK, a
//   unix socket), server.pid names a live process, or a launchd job of Legion's is loaded; refused if ~/.legion holds data of
//   its own (only the tests' heavy.lock may be there: it is replaced);
// - users/ is copied whole to ~/.unii/users.bak-rename first (once: a
//   later run keeps the first copy);
// - a history line's top-level kind "unii" (Legion's replies) becomes
//   "legion", the line parsed, never text-replaced: a line that doesn't
//   read back as written is left as it is, and counted (skipped); chat
//   text naming Unii is the user's history and stays;
// - the *.index files go (Memory.index makes them anew at the next start:
//   the lines grew, so their byte offsets are wrong);
// - the browsers' sessions (Cloud.ts BROWSER, term 0) go: their cookie had
//   the old name, so they sign in again; terminals' and devices' stay;
// - ~/.unii moves to ~/.legion and ~/.unii-prime to ~/.legion-prime, each
//   leaving a link by the old name (git worktrees, launchd plists and
//   settings that name the old path still reach it; Machine.HOME_DIRS
//   guards the trust state by both names). A run after that changes
//   nothing.

import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";

// launchd jobs that run the server or the device (local/legion --install)
const LABELS = ["com.oncorps.legion.server", "com.oncorps.legion.device"];
// the socket a running server listens on (Server.ts LOCK), and the file
// holding its pid (local/legion PID)
const LOCK = "lock";
const PID = "server.pid";
// what ~/.legion may hold before the move: the tests' lock (test/run.sh)
const ALONE = ["heavy.lock"];
const BACKUP = "users.bak-rename";
// Cloud.ts BROWSER: a browser's session
const BROWSER = 0;

export type Opts = { alive: (pid: number) => boolean; held: (sock: string) => boolean; loaded: (label: string) => boolean; dry?: boolean };
export type Report = { done: boolean; already?: true; error?: string; lines: number; skipped: number; files: number; indexes: number; sessions: number };

export function rename(home: string, opts: Opts): Report {
  const old = home + "/.unii";
  const dir = home + "/.legion";
  const report: Report = { done: false, lines: 0, skipped: 0, files: 0, indexes: 0, sessions: 0 };
  const at = fs.lstatSync(old, { throwIfNoEntry: false });
  if (at === undefined || at.isSymbolicLink()) {
    return { ...report, done: at !== undefined, already: true };
  }
  const error = refusal(old, dir, opts);
  if (error !== null) {
    return { ...report, error };
  }
  const dry = opts.dry === true;
  const users = old + "/users";
  if (!dry && fs.existsSync(users) && !fs.existsSync(old + "/" + BACKUP)) {
    fs.cpSync(users, old + "/" + BACKUP, { recursive: true, preserveTimestamps: true });
  }
  for (const file of files(users)) {
    if (file.endsWith(".index")) {
      report.indexes += 1;
      if (!dry) {
        fs.unlinkSync(file);
      }
    } else if (file.endsWith(".jsonl")) {
      history(file, report, dry);
    }
  }
  report.sessions = sessions(old + "/cloud.db", dry);
  if (!dry) {
    fs.rmSync(dir, { recursive: true, force: true });
    move(old, dir);
    if (fs.lstatSync(home + "/.unii-prime", { throwIfNoEntry: false })?.isDirectory() === true && !fs.existsSync(home + "/.legion-prime")) {
      move(home + "/.unii-prime", home + "/.legion-prime");
    }
  }
  return { ...report, done: !dry };
}

// why the move may not run now; null: it may
function refusal(old: string, dir: string, opts: Opts): string | null {
  if (fs.existsSync(old + "/" + LOCK) && opts.held(old + "/" + LOCK)) {
    return "a server answers on ~/.unii/" + LOCK + ": stop it first (legion stop)";
  }
  const pid = Number.parseInt(fs.lstatSync(old + "/" + PID, { throwIfNoEntry: false })?.isFile() === true ? fs.readFileSync(old + "/" + PID, "utf8") : "", 10);
  if (Number.isInteger(pid) && pid > 0 && opts.alive(pid)) {
    return "the server runs (pid " + pid + " in ~/.unii/" + PID + "): stop it first (legion stop)";
  }
  for (const label of LABELS) {
    if (opts.loaded(label)) {
      return "launchd job " + label + " is loaded: run legion " + (label.endsWith("device") ? "device" : "server") + " --uninstall first";
    }
  }
  const there = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (there !== undefined && (!there.isDirectory() || fs.readdirSync(dir).some((name) => !ALONE.includes(name)))) {
    return "~/.legion already holds data of its own: move it aside first";
  }
  return null;
}

// every file under a dir (none: no dir), links not followed
function files(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.parentPath + "/" + e.name);
}

// a history file's replies of kind "unii" made "legion", written whole
// (its mode kept) and moved in place
function history(file: string, report: Report, dry: boolean): void {
  let changed = false;
  const lines = fs.readFileSync(file, "utf8").split("\n").map((line) => {
    const out = reread(line, report);
    changed ||= out !== line;
    return out;
  });
  if (changed && !dry) {
    const tmp = file + ".rename";
    fs.writeFileSync(tmp, lines.join("\n"), { mode: fs.statSync(file).mode & 0o777, flag: "wx" });
    fs.renameSync(tmp, file);
  }
  report.files += changed ? 1 : 0;
}

function reread(line: string, report: Report): string {
  if (!line.includes('"unii"')) {
    return line;
  }
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return line;
  }
  if (typeof rec !== "object" || rec === null || Array.isArray(rec) || (rec as { kind?: unknown }).kind !== "unii") {
    return line;
  }
  if (JSON.stringify(rec) !== line) {
    report.skipped += 1;
    return line;
  }
  report.lines += 1;
  return JSON.stringify({ ...rec, kind: "legion" });
}

// the browsers' sessions, deleted (dry: counted)
function sessions(file: string, dry: boolean): number {
  if (!fs.existsSync(file)) {
    return 0;
  }
  const db = new Database(file, dry ? { readonly: true } : {});
  try {
    if (dry) {
      return (db.query("select count(*) as n from sessions where term = ?").get(BROWSER) as { n: number }).n;
    }
    return db.query("delete from sessions where term = ?").run(BROWSER).changes;
  } finally {
    db.close();
  }
}

function move(from: string, to: string): void {
  fs.renameSync(from, to);
  fs.symlinkSync(to, from);
}

if (import.meta.main) {
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as { code?: string }).code === "EPERM";
    }
  };
  // whether a server accepts on the lock socket: a stale one refuses at once;
  // no answer in 2 s counts as held (fail closed)
  const lock = os.homedir() + "/.unii/" + LOCK;
  const answers = !fs.existsSync(lock) ? false : await new Promise<boolean>((done) => {
    const sock = net.connect(lock);
    const end = (held: boolean) => {
      sock.destroy();
      done(held);
    };
    sock.once("connect", () => end(true));
    sock.once("error", () => end(false));
    setTimeout(() => end(true), 2000).unref();
  });
  const held = () => answers;
  const loaded = (label: string) => spawnSync("launchctl", ["list", label], { stdio: "ignore" }).status === 0;
  const out = rename(os.homedir(), { alive, held, loaded, dry: process.argv.includes("--dry") });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.error === undefined ? 0 : 1);
}
