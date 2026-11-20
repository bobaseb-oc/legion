import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { rules_repo, rules_touched, RULES_CAP } from "./Rules.ts";

// a git repo of files (path: text), real path
function repo(files: Record<string, string>): string {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/unii-repo-"));
  Bun.spawnSync(["git", "init", "-q", top]);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(top + "/" + f), { recursive: true });
    fs.writeFileSync(top + "/" + f, text.replaceAll("$TOP", top));
  }
  return top;
}
const none = () => false;
const names = (top: string, got: { path: string }[]) => got.map((r) => path.relative(top, r.path));

test("a repo's instruction files load root first, down to the touched folder, as Claude Code's", () => {
  const top = repo({
    "CLAUDE.md": "root", ".claude/CLAUDE.md": "dot", "CLAUDE.local.md": "local", "AGENTS.md": "agents",
    "a/CLAUDE.md": "a", "a/b/AGENTS.md": "ab", "a/b/c.ts": "", "z/CLAUDE.md": "elsewhere",
  });
  const got = rules_repo(top, top + "/a/b/c.ts", [], none);
  expect(names(top, got)).toEqual(["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md", "a/CLAUDE.md", "a/b/AGENTS.md"]);
  expect(got.map((r) => r.text)).toEqual(["root", "dot", "local", "agents", "a", "ab"]);
});

test("a folder touched loads its own files too", () => {
  const top = repo({ "CLAUDE.md": "root", "a/AGENTS.md": "a" });
  expect(names(top, rules_repo(top, top + "/a", [], none))).toEqual(["CLAUDE.md", "a/AGENTS.md"]);
});

test(".claude/rules load at the root; one with paths: only when the touched file matches", () => {
  const top = repo({
    ".claude/rules/b.md": "always", ".claude/rules/sub/a.md": "nested",
    ".claude/rules/ts.md": "---\npaths:\n  - \"src/**/*.ts\"\n---\nts only",
    ".claude/rules/py.md": "---\npaths: \"**/*.py\"\n---\npy only",
    "src/x/y.ts": "",
  });
  const got = rules_repo(top, top + "/src/x/y.ts", [], none);
  expect(names(top, got)).toEqual([".claude/rules/b.md", ".claude/rules/sub/a.md", ".claude/rules/ts.md"]);
  expect(got[2].text).toContain("ts only");
});

test("imports expand inside the repo; one outside it or a secret's stays as text", () => {
  const outside = fs.mkdtempSync(os.tmpdir() + "/unii-out-") + "/x.md";
  fs.writeFileSync(outside, "OUTSIDE");
  const top = repo({ "CLAUDE.md": "@docs/inc.md\n@" + outside + "\n@.env", "docs/inc.md": "inc", ".env": "SECRET" });
  const [r] = rules_repo(top, top + "/CLAUDE.md", [], (p) => p.endsWith(".env"));
  expect(r.text).toBe("inc\n@" + outside + "\n@.env");
});

test("a secret file is never loaded; a symlink out of the repo neither", () => {
  const outside = fs.mkdtempSync(os.tmpdir() + "/unii-out-") + "/CLAUDE.md";
  fs.writeFileSync(outside, "OUTSIDE");
  const top = repo({ "AGENTS.md": "secret one", "a/x": "" });
  fs.symlinkSync(outside, top + "/a/CLAUDE.md");
  expect(rules_repo(top, top + "/a/x", [], (p) => p.endsWith("AGENTS.md"))).toEqual([]);
});

test("files already seen (by hash) are left out; an edited one comes back", () => {
  const top = repo({ "CLAUDE.md": "one" });
  const [first] = rules_repo(top, top, [], none);
  expect(rules_repo(top, top, [first.hash], none)).toEqual([]);
  fs.writeFileSync(top + "/CLAUDE.md", "two");
  const [again] = rules_repo(top, top, [first.hash], none);
  expect(again.text).toBe("two");
  expect(again.hash).not.toBe(first.hash);
});

test("a file over RULES_CAP is cut, saying where", () => {
  const top = repo({ "CLAUDE.md": "x".repeat(RULES_CAP + 10) });
  const [r] = rules_repo(top, top, [], none);
  expect(r.text.length).toBeLessThan(RULES_CAP + 200);
  expect(r.text).toContain("cut at " + RULES_CAP);
});

test("which paths a call touches: read, write, edit, glob, grep by path; a shell by its leading cd", () => {
  const cwd = "/w/agent";
  const t = (name: string, input: any) => rules_touched({ name, input, cwd: "agent" }, cwd);
  expect(t("read", { path: "a.ts" })).toEqual(["/w/agent/a.ts"]);
  expect(t("write", { path: "/r/b.ts" })).toEqual(["/r/b.ts"]);
  expect(t("edit", { edits: [{ path: "/r/c.ts" }, { path: "/s/d.ts" }] })).toEqual(["/r/c.ts", "/s/d.ts"]);
  expect(t("glob", { pattern: "*", path: "/r" })).toEqual(["/r"]);
  expect(t("glob", { pattern: "*" })).toEqual([]);
  expect(t("grep", { pattern: "x", path: "/r/src" })).toEqual(["/r/src"]);
  expect(t("shell", { command: "cd /r/wt && git status" })).toEqual(["/r/wt"]);
  expect(t("shell", { command: "cd '/r/my wt'; ls" })).toEqual(["/r/my wt"]);
  expect(t("shell", { command: "cd ~/x && ls" })).toEqual([os.homedir() + "/x"]);
  expect(t("shell", { command: "git -C /r status" })).toEqual([]);
  expect(t("shell", { command: "ls" })).toEqual([]);
  expect(t("computer", { task: "x" })).toEqual([]);
});
