// Shared test
// ===========
// `bun run test Shared.test.ts`. Legion's own checkout of
// oncorps-shared-skills ($UNII_DIR/shared-skills): synced to the tip of its
// ref at each start, edits in it wiped, a failed fetch keeping the last
// copy; its plugins read from its marketplace.json, by the allowlist.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Shared } from "./Shared.ts";

const DIR = fs.mkdtempSync(os.tmpdir() + "/legion-shared-");

const git = (cwd: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a]);
  if (r.exitCode !== 0) {
    throw new Error("git " + a.join(" ") + ": " + r.stderr.toString());
  }
  return r.stdout.toString().trim();
};

// a marketplace repo (a bare origin and a work clone) on branch 0.x: a
// full plugin (skills/ folder, hooks), a flat one (SKILL.md at its root),
// one not allowlisted, one whose source leaves the checkout
function market(): { origin: string; work: string } {
  const work = fs.mkdtempSync(DIR + "/work-");
  git(work, "init", "-q", "-b", "0.x");
  const put = (p: string, text: string) => {
    fs.mkdirSync(work + "/" + p.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(work + "/" + p, text);
  };
  put(".claude-plugin/marketplace.json", JSON.stringify({ name: "oncorps-shared-skills", plugins: [
    { name: "full", source: "./skills/full" },
    { name: "flat", source: "./skills/flat" },
    { name: "other", source: "./skills/other" },
    { name: "out", source: "../../elsewhere" },
    { name: "remote", source: { source: "github", repo: "x/y" } },
  ] }));
  put("skills/full/skills/one/SKILL.md", "---\nname: one\ndescription: The first.\n---\n");
  put("skills/full/commands/go.md", "---\ndescription: Go.\n---\n");
  put("skills/full/hooks/hooks.json", "{}");
  put("skills/flat/SKILL.md", "---\nname: flat\ndescription: A flat one.\n---\n");
  put("skills/other/SKILL.md", "---\nname: other\ndescription: Not allowed.\n---\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "base");
  const origin = fs.mkdtempSync(DIR + "/origin-") + "/m.git";
  git(DIR, "clone", "-q", "--bare", work, origin);
  git(work, "remote", "add", "origin", origin);
  return { origin, work };
}

test("the config names the OnCorps repo, the 0.x branch, and an allowlist with the gated plugin", () => {
  const c = Shared.conf();
  expect(c.repo).toContain("OnCorps/oncorps-shared-skills");
  expect(c.ref).toBe("0.x");
  expect(c.plugins).toContain("oc-coding-assistant");
});

test("sync clones the ref, then follows its tip, wiping edits and stray files", () => {
  const { origin, work } = market();
  const dir = DIR + "/c1/shared-skills";
  const c = { repo: origin, ref: "0.x", plugins: [] };
  expect(Shared.sync(c, dir)).toContain("cloned");
  const first = git(dir, "rev-parse", "HEAD");
  expect(first).toBe(git(work, "rev-parse", "HEAD"));
  // a new commit on 0.x, an edit and a stray file in the checkout
  fs.writeFileSync(work + "/skills/flat/SKILL.md", "---\nname: flat\ndescription: Changed.\n---\n");
  git(work, "commit", "-qam", "next");
  git(work, "push", "-q", "origin", "0.x");
  fs.writeFileSync(dir + "/skills/full/hooks/hooks.json", "{\"disableAllHooks\":true}");
  fs.writeFileSync(dir + "/planted.json", "{}");
  const said = Shared.sync(c, dir);
  const next = git(work, "rev-parse", "HEAD");
  expect(git(dir, "rev-parse", "HEAD")).toBe(next);
  expect(said).toContain(first.slice(0, 7));
  expect(said).toContain(next.slice(0, 7));
  expect(fs.readFileSync(dir + "/skills/full/hooks/hooks.json", "utf8")).toBe("{}");
  expect(fs.existsSync(dir + "/planted.json")).toBe(false);
});

test("sync puts origin back to the configured repo", () => {
  const { origin } = market();
  const dir = DIR + "/c2/shared-skills";
  const c = { repo: origin, ref: "0.x", plugins: [] };
  Shared.sync(c, dir);
  git(dir, "remote", "set-url", "origin", DIR + "/nowhere.git");
  Shared.sync(c, dir);
  expect(git(dir, "remote", "get-url", "origin")).toBe(origin);
});

test("a failed fetch keeps the last copy and says so; a failed first clone leaves no checkout", () => {
  const { origin } = market();
  const dir = DIR + "/c3/shared-skills";
  Shared.sync({ repo: origin, ref: "0.x", plugins: [] }, dir);
  const head = git(dir, "rev-parse", "HEAD");
  const bad = { repo: DIR + "/missing.git", ref: "0.x", plugins: [] };
  expect(Shared.sync(bad, dir)).toContain("kept");
  expect(git(dir, "rev-parse", "HEAD")).toBe(head);
  expect(Shared.ready(dir)).toBe(true);
  const none = DIR + "/c4/shared-skills";
  expect(Shared.sync(bad, none)).toContain("no checkout");
  expect(fs.existsSync(none)).toBe(false);
  expect(Shared.ready(none)).toBe(false);
});

test("plugins: the allowlisted ones in the checkout's marketplace, with roots in it", () => {
  const { origin } = market();
  const dir = DIR + "/c5/shared-skills";
  Shared.sync({ repo: origin, ref: "0.x", plugins: [] }, dir);
  const found = Shared.plugins(["full", "flat", "out", "remote", "absent"], dir);
  expect(found).toEqual([
    { name: "full", key: "full@oncorps-shared-skills", root: dir + "/skills/full" },
    { name: "flat", key: "flat@oncorps-shared-skills", root: dir + "/skills/flat" },
  ]);
  expect(Shared.inside(dir + "/skills/full", dir)).toBe(true);
  expect(Shared.inside(dir + "/../elsewhere", dir)).toBe(false);
  expect(Shared.plugins(["full"], DIR + "/none")).toEqual([]);
});

test("the checkout is $UNII_DIR/shared-skills", () => {
  const was = process.env.UNII_DIR;
  process.env.UNII_DIR = DIR + "/u";
  try {
    expect(Shared.dir()).toBe(DIR + "/u/shared-skills");
  } finally {
    was === undefined ? delete process.env.UNII_DIR : (process.env.UNII_DIR = was);
  }
});
