// Device rules test
// =================
// A device call that touches a repo under the device's roots answers that
// repo's instruction files (Rules.rules_repo) with its output, those the
// server says the agent has not seen; never a repo outside the roots, and
// never at the cost of the output itself (View.FRAME).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as Device from "./Device.ts";
import * as View from "./View.ts";

function fixture(files: Record<string, string>, space = true) {
  const top = fs.realpathSync(fs.mkdtempSync(os.tmpdir() + "/legion-rules-"));
  const repo = top + "/repo";
  fs.mkdirSync(repo);
  Bun.spawnSync(["git", "init", "-q", repo]);
  for (const [f, text] of Object.entries(files)) {
    fs.writeFileSync(repo + "/" + f, text);
  }
  fs.mkdirSync(top + "/work");
  return { repo, rules: { work: top + "/work", computer: false, spaces: space ? [repo] : [top + "/work"], state: top + "/state", run: fake } };
}
let answer = { text: "file text", fail: false };
const fake = async () => answer;
async function run(rules: any, j: any): Promise<any> {
  let got: any = null;
  await Device.device_run(new Map(), "j", j, rules, (m: any) => (got = m.out));
  return got;
}
const read = (p: string, seen?: unknown) => ({ name: "read", input: { path: p }, cwd: "Owl", ...(seen === undefined ? {} : { seen }) });

test("a read in a repo under the roots answers its output and the repo's instruction files", async () => {
  answer = { text: "file text", fail: false };
  const { repo, rules } = fixture({ "CLAUDE.md": "be brief", "a.ts": "" });
  const out = await run(rules, read(repo + "/a.ts"));
  expect(out.text).toBe("file text");
  expect(out.rules).toHaveLength(1);
  expect(out.rules[0]).toMatchObject({ path: repo + "/CLAUDE.md", text: "be brief" });
});

test("files the job says were seen are left out; a seen list that isn't one counts as none", async () => {
  answer = { text: "file text", fail: false };
  const { repo, rules } = fixture({ "CLAUDE.md": "be brief" });
  const [first] = (await run(rules, read(repo + "/CLAUDE.md"))).rules;
  expect((await run(rules, read(repo + "/CLAUDE.md", [first.hash]))).rules).toBeUndefined();
  expect((await run(rules, read(repo + "/CLAUDE.md", "nope"))).rules).toHaveLength(1);
});

test("a repo outside the device's roots answers none", async () => {
  answer = { text: "file text", fail: false };
  const { repo, rules } = fixture({ "CLAUDE.md": "be brief" }, false);
  expect((await run(rules, read(repo + "/CLAUDE.md"))).rules).toBeUndefined();
});

test("a failed call answers none", async () => {
  answer = { text: "No file", fail: true };
  const { repo, rules } = fixture({ "CLAUDE.md": "be brief" });
  expect((await run(rules, read(repo + "/gone.ts"))).rules).toBeUndefined();
});

test("an output that fits alone but not with the files keeps the output, dropping the files", async () => {
  answer = { text: "x".repeat(View.FRAME - 1024 - 5000), fail: false };
  const { repo, rules } = fixture({ "CLAUDE.md": "y".repeat(20000) });
  const out = await run(rules, read(repo + "/CLAUDE.md"));
  expect(out.fail).toBe(false);
  expect(out.text).toBe(answer.text);
  expect(out.rules).toBeUndefined();
});
