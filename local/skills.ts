// Skills
// ======
// `bun local/skills.ts [out]`. An index of the skills Claude Code loads,
// for the agent's rules (local/rules.md imports it; the wrapper makes it
// at each start, to ~/.unii/skills.md): the user's (~/.claude/skills,
// links followed) and those of the plugins enabled for the user
// (settings.json enabledPlugins), at their installed version
// (installed_plugins.json), never a disabled or excluded one, one local to a
// project, or an old version left in the cache. A plugin's skill is
// named "plugin:skill", as Claude Code names it; a plugin's commands
// ("/plugin:command") and agents ("plugin:agent") are listed too, their
// files the flows the agent follows (local/rules.md: PR work goes through
// oc-coding-assistant's). The agent reads a skill's SKILL.md when a task
// matches it, as Claude Code does.

import * as fs from "node:fs";
import * as os from "node:os";
import { Hooks } from "../Hooks.ts";

// Types
// =====

// kind: a plugin's command or agent file, else a skill
export type Skill = { name: string; description: string; path: string; kind?: "command" | "agent" };

// Constants
// =========

// plugins and MCP servers left out (local/mcp.ts too): claude-mem, whose
// memory the chat has its own of; coding-assistant (the user's home fork
// of oc-coding-assistant): Legion uses the OnCorps one only
export const EXCLUDE = ["claude-mem", "coding-assistant"];

// a description's most characters in the index
const SAY = 250;

const HEAD = `# Skills

Packaged instructions, the same your user's Claude Code has. When a task matches one, read its SKILL.md with the shell on this computer's device and follow it; it may point to scripts and files beside it. Skills written for Claude Code may name its tools: use yours.

A [command] is a plugin's slash command and an [agent] its subagent: to run a command, read its file and follow it; to dispatch one of its agents, start a subagent whose task is that agent file with the inputs the command gives it. In a plugin's file, \${CLAUDE_PLUGIN_ROOT} is the plugin's folder: the one holding the commands/, agents/ or skills/ folder the file is in.
`;

// Skills
// ======

// a SKILL.md's frontmatter keys: plain, quoted, or folded (> or |) over
// the indented lines after
function front(text: string): Record<string, string> {
  const body = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv === null) {
      continue;
    }
    let value = kv[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const more: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        more.push(lines[++i].trim());
      }
      value = more.join(" ");
    }
    out[kv[1]] = value.replace(/^(["'])([\s\S]*)\1$/, "$2").replace(/\s+/g, " ").trim();
  }
  return out;
}

// the skills in a folder of skill folders (each with a SKILL.md), named
// with `prefix`
function folder(dir: string, prefix: string): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).flatMap((d) => {
    const path = dir + "/" + d + "/SKILL.md";
    if (!fs.existsSync(path)) {
      return [];
    }
    const f = front(fs.readFileSync(path, "utf8"));
    return [{ name: prefix + (f.name || d), description: f.description ?? "", path }];
  });
}

// a plugin's command or agent files (*.md in `dir`), named with `prefix`
function files(dir: string, prefix: string, kind: "command" | "agent"): Skill[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const path = dir + "/" + f;
    const fm = front(fs.readFileSync(path, "utf8"));
    return { name: prefix + (fm.name || f.slice(0, -3)), description: fm.description ?? "", path, kind };
  });
}

export function json(path: string): any {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function skills(home: string): Skill[] {
  const plugins = Hooks.plugins(home + "/.claude").filter((p) => !EXCLUDE.includes(p.name)).flatMap((p) => [
    ...folder(p.root + "/skills", p.name + ":"),
    ...files(p.root + "/commands", "/" + p.name + ":", "command"),
    ...files(p.root + "/agents", p.name + ":", "agent"),
  ]);
  return [...folder(home + "/.claude/skills", ""), ...plugins];
}

export function skills_index(list: Skill[]): string {
  const cut = (s: string) => (s.length > SAY ? s.slice(0, SAY - 1) + "…" : s);
  return HEAD + "\n" + list.map((s) => "- " + s.name + (s.kind ? " [" + s.kind + "]" : "") + ": " + cut(s.description) + " (" + s.path + ")").join("\n") + "\n";
}

if (import.meta.main) {
  const out = process.argv[2] ?? os.homedir() + "/.unii/skills.md";
  const list = skills(os.homedir());
  const text = skills_index(list);
  fs.writeFileSync(out, text);
  console.log("skills:", list.length, "in", out, "(" + text.length + " chars)");
}
