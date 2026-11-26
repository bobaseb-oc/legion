// Skills test
// ===========
// `bun test local/skills.test.ts`. The skills index holds what Claude
// Code loads: the user's skills (links followed) and the skills of the
// plugins enabled for the user, at their installed version; nothing
// disabled, excluded (claude-mem), local to a project, or left in the
// cache.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { skills, skills_index } from "./skills.ts";

function skill(dir: string, head: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + "/SKILL.md", "---\n" + head + "\n---\n\n# Body\n");
}

function home(): string {
  const h = fs.mkdtempSync(os.tmpdir() + "/legion-skills-");
  const cache = h + "/.claude/plugins/cache";
  skill(h + "/.claude/skills/mine", "name: mine\ndescription: My own skill.");
  skill(h + "/shared/linked", 'name: linked\ndescription: "A linked one: quoted."');
  fs.symlinkSync(h + "/shared/linked", h + "/.claude/skills/linked");
  skill(cache + "/mk/on/2.0/skills/alpha", "name: alpha\ndescription: >\n  Folded over\n  two lines.");
  skill(cache + "/mk/on/1.0/skills/stale", "name: stale\ndescription: An old version's.");
  skill(cache + "/mk/off/1.0/skills/beta", "name: beta\ndescription: Disabled plugin.");
  skill(cache + "/mk/here/1.0/skills/gamma", "name: gamma\ndescription: Local to a project.");
  skill(cache + "/mk/claude-mem/1.0/skills/recall", "name: recall\ndescription: Excluded plugin.");
  skill(cache + "/mk/on/2.0/skills/long", "name: long\ndescription: " + "x".repeat(400));
  fs.mkdirSync(cache + "/mk/on/2.0/commands", { recursive: true });
  fs.writeFileSync(cache + "/mk/on/2.0/commands/review.md", '---\ndescription: "Review a PR."\nargument-hint: "<PR>"\n---\n\nBody\n');
  fs.mkdirSync(cache + "/mk/on/2.0/agents", { recursive: true });
  fs.writeFileSync(cache + "/mk/on/2.0/agents/pr-reviewer.md", "---\nname: pr-reviewer\ndescription: Reviews a diff.\n---\n\nBody\n");
  skill(cache + "/mk/coding-assistant/1.0/skills/dup", "name: dup\ndescription: The home fork.");
  fs.writeFileSync(h + "/.claude/settings.json", JSON.stringify({ enabledPlugins: { "on@mk": true, "off@mk": false, "here@mk": true, "claude-mem@mk": true, "coding-assistant@mk": true } }));
  fs.writeFileSync(h + "/.claude/plugins/installed_plugins.json", JSON.stringify({ version: 2, plugins: {
    "on@mk"   : [{ scope: "user", installPath: cache + "/mk/on/2.0" }],
    "off@mk"  : [{ scope: "user", installPath: cache + "/mk/off/1.0" }],
    "here@mk" : [{ scope: "local", projectPath: "/p", installPath: cache + "/mk/here/1.0" }],
    "claude-mem@mk" : [{ scope: "user", installPath: cache + "/mk/claude-mem/1.0" }],
    "coding-assistant@mk" : [{ scope: "user", installPath: cache + "/mk/coding-assistant/1.0" }],
  } }));
  return h;
}

test("the user's skills and the enabled plugins' installed ones, by name", () => {
  const h = home();
  const found = skills(h);
  expect(found.map((s) => s.name).sort()).toEqual(["/on:review", "linked", "mine", "on:alpha", "on:long", "on:pr-reviewer"]);
  expect(found.find((s) => s.name === "/on:review")).toEqual({ name: "/on:review", description: "Review a PR.", path: h + "/.claude/plugins/cache/mk/on/2.0/commands/review.md", kind: "command" });
  expect(found.find((s) => s.name === "on:pr-reviewer")).toEqual({ name: "on:pr-reviewer", description: "Reviews a diff.", path: h + "/.claude/plugins/cache/mk/on/2.0/agents/pr-reviewer.md", kind: "agent" });
  expect(found.find((s) => s.name === "on:alpha")!.description).toBe("Folded over two lines.");
  expect(found.find((s) => s.name === "linked")!.description).toBe("A linked one: quoted.");
  expect(found.find((s) => s.name === "on:alpha")!.path).toBe(h + "/.claude/plugins/cache/mk/on/2.0/skills/alpha/SKILL.md");
});

test("the index says how to use a skill and lists each with its path, descriptions cut to 250", () => {
  const h = home();
  const text = skills_index(skills(h));
  expect(text).toStartWith("# Skills\n");
  expect(text).toContain("read its SKILL.md");
  expect(text).toContain("- on:alpha: Folded over two lines. (" + h + "/.claude/plugins/cache/mk/on/2.0/skills/alpha/SKILL.md)");
  expect(text).toContain("- on:long: " + "x".repeat(249) + "…");
  expect(text).not.toContain("beta");
  expect(text).not.toContain("gamma");
  expect(text).not.toContain("stale");
  expect(text).not.toContain("home fork");
  expect(text).toContain("- /on:review [command]: Review a PR. (");
  expect(text).toContain("- on:pr-reviewer [agent]: Reviews a diff. (");
  expect(text).toContain("${CLAUDE_PLUGIN_ROOT}");
});

// PLP-2945: with Legion's own oncorps-shared-skills checkout, its
// allowlisted plugins replace Claude Code's OnCorps ones; a skill of yours
// of the same name (a link into a clone) is not listed twice; without a
// checkout, Claude Code's stay
function shared(h: string): string {
  const dir = h + "/.legion/shared-skills";
  fs.mkdirSync(dir + "/.claude-plugin", { recursive: true });
  fs.writeFileSync(dir + "/.claude-plugin/marketplace.json", JSON.stringify({ name: "oncorps-shared-skills", plugins: [
    { name: "oc", source: "./skills/oc" },
    { name: "xlsx", source: "./skills/xlsx" },
    { name: "unlisted", source: "./skills/unlisted" },
    { name: "out", source: "../../.." },
  ] }));
  skill(dir + "/skills/oc/skills/fresh", "name: fresh\ndescription: From 0.x.");
  fs.mkdirSync(dir + "/skills/oc/commands", { recursive: true });
  fs.writeFileSync(dir + "/skills/oc/commands/ship.md", "---\ndescription: Ship it.\n---\n");
  skill(dir + "/skills/xlsx", "name: xlsx\ndescription: Flat, at 0.x.");
  skill(dir + "/skills/unlisted", "name: unlisted\ndescription: Not allowlisted.");
  // Claude Code's older OnCorps install, and your link of the same skill
  const cc = h + "/.claude/plugins/cache/oncorps-shared-skills/oc/0.6.0";
  skill(cc + "/skills/stale-oc", "name: stale-oc\ndescription: Claude Code's copy.");
  const s = JSON.parse(fs.readFileSync(h + "/.claude/settings.json", "utf8"));
  s.enabledPlugins["oc@oncorps-shared-skills"] = true;
  fs.writeFileSync(h + "/.claude/settings.json", JSON.stringify(s));
  const i = JSON.parse(fs.readFileSync(h + "/.claude/plugins/installed_plugins.json", "utf8"));
  i.plugins["oc@oncorps-shared-skills"] = [{ scope: "user", installPath: cc }];
  fs.writeFileSync(h + "/.claude/plugins/installed_plugins.json", JSON.stringify(i));
  skill(h + "/clone/skills/xlsx", "name: xlsx\ndescription: Your linked clone's.");
  fs.symlinkSync(h + "/clone/skills/xlsx", h + "/.claude/skills/xlsx");
  return dir;
}

test("Legion's checkout gives the allowlisted OnCorps plugins, in place of Claude Code's and your same-named links", () => {
  const h = home();
  const dir = shared(h);
  const found = skills(h, { dir, plugins: ["oc", "xlsx", "out"] });
  const names = found.map((s) => s.name).sort();
  expect(names).toEqual(["/oc:ship", "/on:review", "linked", "mine", "oc:fresh", "on:alpha", "on:long", "on:pr-reviewer", "xlsx"]);
  expect(found.find((s) => s.name === "xlsx")).toEqual({ name: "xlsx", description: "Flat, at 0.x.", path: dir + "/skills/xlsx/SKILL.md" });
  expect(found.find((s) => s.name === "oc:fresh")!.path).toBe(dir + "/skills/oc/skills/fresh/SKILL.md");
});

test("without a checkout, Claude Code's OnCorps plugins and your links stay", () => {
  const h = home();
  shared(h);
  const found = skills(h, { dir: h + "/no-checkout", plugins: ["oc", "xlsx"] });
  const names = found.map((s) => s.name);
  expect(names).toContain("oc:stale-oc");
  expect(found.find((s) => s.name === "xlsx")!.description).toBe("Your linked clone's.");
  expect(names).not.toContain("oc:fresh");
});
