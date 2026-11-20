// Rules
// =====
// Instruction files as Claude Code reads them: a file with its @imports
// expanded. The server reads its rules file with them (Tools.rules); a
// device, a repo's files when an agent's call touches it (rules_repo,
// Device.device_rules). It imports nothing of the server's.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Constants
// =========

// how deep a rules file's @imports go (Claude Code's limit)
export const RULES_DEPTH = 5;

// the most characters of one repo file an agent gets (Claude Code warns
// at a CLAUDE.md this long); past it, cut, saying where
export const RULES_CAP = 40000;

// a repo folder's instruction files, in the order they load: Claude
// Code's, then AGENTS.md (Codex's, which the user's repos keep too)
export const RULES_NAMES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];

// a repo file as an agent gets it: its path, a hash of path and text (an
// agent gets each once, again if it changes: Tools.seen), its text
export type RuleFile = { path: string; hash: string; text: string };

// a shell command's leading cd: its folder, quoted or not, then &&, ; or
// the end (local/rules.md asks agents for `cd <worktree> && …`)
const CD = /^\s*cd\s+(?:'([^']*)'|"([^"]*)"|([^\s;&|'"]+))\s*(?:&&|;|$)/;

// Rules
// =====

// a rules file with its @imports expanded as Claude Code's are: a line
// that is only "@path" (relative to the file's real folder, as a symlink
// is followed; absolute; or "~/") is that file's rules; "@dir/" is each
// .md file in the folder, by name (Claude Code loads ~/.claude/rules/
// so). One in a code fence, missing, not a file (or not a folder, with
// the slash), already open (a loop, by real path) or past RULES_DEPTH
// stays as it is
// keep: whether an import's real path may be read (a repo's files: no
// secret's, rules_repo)
export function rules_read(file: string, depth = 0, open: string[] = [], keep: (real: string) => boolean = () => true): string {
  const real  = fs.realpathSync(file);
  const stack = [...open, real];
  let fence = false;
  return fs.readFileSync(real, "utf8").split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      return line;
    }
    const at = line.trim().match(/^@(\S+)$/);
    if (fence || at === null || depth >= RULES_DEPTH) {
      return line;
    }
    const to = at[1].startsWith("~/") ? os.homedir() + at[1].slice(1) : path.resolve(path.dirname(real), at[1]);
    if (at[1].endsWith("/")) {
      const files = rules_dir(to).filter((f) => !stack.includes(f) && keep(f));
      return files.length === 0 ? line : files.map((f) => rules_read(f, depth + 1, stack, keep)).join("\n");
    }
    const sure = rules_real(to);
    return sure === null || !fs.statSync(sure).isFile() || stack.includes(sure) || !keep(sure) ? line : rules_read(sure, depth + 1, stack, keep);
  }).join("\n");
}

// a path's real path, or null if it is missing
function rules_real(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// a folder's .md files, real paths, by name; none if it isn't a folder
function rules_dir(dir: string): string[] {
  const real = rules_real(dir);
  if (real === null || !fs.statSync(real).isDirectory()) {
    return [];
  }
  return fs.readdirSync(real).filter((f) => f.endsWith(".md")).sort()
    .map((f) => rules_real(path.join(real, f)))
    .filter((f): f is string => f !== null && fs.statSync(f).isFile());
}

// Repo files
// ==========

// the paths a device call touches, as Machine.run resolves them in cwd:
// read's and write's path, each edit's, glob's and grep's when given (by
// default, the agent's own folder), a shell's leading cd; else none
export function rules_touched(job: { name: string; input: any; cwd: string }, cwd: string): string[] {
  const input = job.input ?? {};
  const at = (p: string) => path.resolve(cwd, p);
  switch (job.name) {
    case "read":
    case "write":
    case "glob":
    case "grep": {
      return typeof input.path === "string" ? [at(input.path)] : [];
    }
    case "edit": {
      return (Array.isArray(input.edits) ? input.edits : []).filter((e: any) => typeof e?.path === "string").map((e: any) => at(e.path));
    }
    case "shell": {
      const cd = String(input.command ?? "").match(CD);
      const dir = cd === null ? null : cd[1] ?? cd[2] ?? cd[3];
      return dir === null || dir === undefined ? [] : [at(dir.startsWith("~/") ? os.homedir() + dir.slice(1) : dir)];
    }
    default: {
      return [];
    }
  }
}

// the instruction files of the repo at top (its real path) that apply to
// the path touched in it, as Claude Code loads them: RULES_NAMES in each
// folder from top down to the touched one (a file's: its folder), the
// top's .claude/rules/**/*.md after its own (one whose front matter
// lists paths: only if the touched path matches one). Only files whose
// real path is in the repo and not a secret (secret: Machine.secret); an
// import anywhere but a secret's (user's call 2026-11-20, as Claude Code
// once approved); each cut at RULES_CAP; none whose hash is seen
export function rules_repo(top: string, touched: string, seen: string[], secret: (p: string) => boolean): RuleFile[] {
  const root = fs.realpathSync(top);
  const inside = (p: string) => p === root || p.startsWith(root + path.sep);
  const at = path.resolve(touched);
  const rel = path.relative(root, rules_isdir(at) ? at : path.dirname(at));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return [];
  }
  const parts = rel === "" ? [] : rel.split(path.sep);
  const dirs = [root, ...parts.map((_, i) => path.join(root, ...parts.slice(0, i + 1)))];
  const named = (dir: string) => RULES_NAMES.map((n) => path.join(dir, n));
  const files = [...named(root), ...rules_scoped(root, path.relative(root, at)), ...dirs.slice(1).flatMap(named)];
  const keep = (real: string) => !secret(real);
  const out: RuleFile[] = [];
  const done = new Set<string>();
  for (const file of files) {
    const real = rules_real(file);
    if (real === null || done.has(real) || !fs.statSync(real).isFile() || !inside(real) || secret(real) || secret(file)) {
      continue;
    }
    done.add(real);
    const whole = rules_read(real, 0, [], keep);
    const text = whole.length > RULES_CAP ? whole.slice(0, RULES_CAP) + "\n[" + file + " cut at " + RULES_CAP + " of " + whole.length + " characters: read the rest with your tools]" : whole;
    const hash = new Bun.CryptoHasher("sha256").update(file + "\0" + text).digest("hex");
    if (!seen.includes(hash)) {
      out.push({ path: file, hash, text });
    }
  }
  return out;
}

// whether p is a folder
function rules_isdir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// the top's .claude/rules/**/*.md that apply to rel (the touched path,
// from the top), by path: all but those whose front matter's paths: (a
// glob, or a list of them) rel matches none of
function rules_scoped(root: string, rel: string): string[] {
  const dir = path.join(root, ".claude", "rules");
  if (!rules_isdir(dir)) {
    return [];
  }
  const all = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".md")).sort();
  return all.map((f) => path.join(dir, f)).filter((f) => {
    const globs = rules_paths(f);
    return globs.length === 0 || globs.some((g) => new Bun.Glob(g).match(rel));
  });
}

// a rules file's front matter's paths: globs (none: it always applies)
function rules_paths(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const front = text.match(/^---\n([\s\S]*?)\n---/);
  const unq = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  if (front === null) {
    return [];
  }
  const lines = front[1].split("\n");
  const i = lines.findIndex((l) => /^paths:/.test(l));
  if (i < 0) {
    return [];
  }
  const inline = lines[i].slice("paths:".length).trim();
  if (inline.startsWith("[")) {
    return inline.slice(1, -1).split(",").map(unq).filter((g) => g !== "");
  }
  if (inline !== "") {
    return [unq(inline)];
  }
  const list: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s+-\s+(.+)$/);
    if (m === null) {
      break;
    }
    list.push(unq(m[1]));
  }
  return list;
}
