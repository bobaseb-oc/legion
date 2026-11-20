// Rules
// =====
// Instruction files as Claude Code reads them: a file with its @imports
// expanded. The server reads its rules file with them (Tools.rules); it
// imports nothing of the server's, so the device side can use it too.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Constants
// =========

// how deep a rules file's @imports go (Claude Code's limit)
export const RULES_DEPTH = 5;

// Rules
// =====

// a rules file with its @imports expanded as Claude Code's are: a line
// that is only "@path" (relative to the file's real folder, as a symlink
// is followed; absolute; or "~/") is that file's rules; "@dir/" is each
// .md file in the folder, by name (Claude Code loads ~/.claude/rules/
// so). One in a code fence, missing, not a file (or not a folder, with
// the slash), already open (a loop, by real path) or past RULES_DEPTH
// stays as it is
export function rules_read(file: string, depth = 0, open: string[] = []): string {
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
      const files = rules_dir(to).filter((f) => !stack.includes(f));
      return files.length === 0 ? line : files.map((f) => rules_read(f, depth + 1, stack)).join("\n");
    }
    const sure = rules_real(to);
    return sure === null || !fs.statSync(sure).isFile() || stack.includes(sure) ? line : rules_read(sure, depth + 1, stack);
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
