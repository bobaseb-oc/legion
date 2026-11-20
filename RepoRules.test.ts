// Repo rules test
// ===============
// `bun run test RepoRules.test.ts`. An agent's device call tells the device
// which repo instruction files the agent has (their hashes: Tools.seen);
// those the device answers with its output (Device.device_rules) reach the
// agent once, after the call's result, as Claude Code's nested CLAUDE.md
// do; each agent its own; never as part of the system prompt.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

process.env.UNII_DIR = fs.mkdtempSync(os.tmpdir() + "/unii-repo-rules-");

const { Tools } = await import("./Tools.ts");

function chat(): { tools: any; jobs: any[] } {
  const jobs: any[] = [];
  const tools: any = Tools.serve({ agents: new Map(), dir: process.env.UNII_DIR + "/" } as any, { note: () => {} } as any);
  Tools.attach(tools, "t1", "mac", "u", { send: (m: any) => (m.$ === "job" ? jobs.push(m) : 0), live: () => true, computer: false, work: "~/w" });
  return { tools, jobs };
}
const file = (hash: string, text = "be brief") => ({ path: "/r/CLAUDE.md", hash, text });

// an agent's read on mac, answered with out
async function read(c: { tools: any; jobs: any[] }, who: string, id: string, out: any): Promise<{ job: any; back: any }> {
  const back = Tools.dispatch(c.tools, who, "read", { device: "mac", path: "/r/a.ts" }, new AbortController().signal, id);
  for (let k = 0; k < 100 && !c.jobs.some((j) => j.id === id); k++) await Bun.sleep(5);
  const job = c.jobs.find((j) => j.id === id).job;
  Tools.done(c.tools, "mac", id, out);
  return { job, back: await back };
}

test("a repo's files reach the agent once, after the result, fenced by path; the device is told which it has", async () => {
  const c = chat();
  const one = await read(c, "Ada", "c1", { text: "file text", fail: false, rules: [file("h1")] });
  expect(one.job.seen).toEqual([]);
  expect(one.back.text.startsWith("file text\n\n")).toBe(true);
  expect(one.back.text).toContain('<instructions file="/r/CLAUDE.md">\nbe brief\n</instructions>');
  expect(one.back.rules).toBeUndefined();
  const two = await read(c, "Ada", "c2", { text: "file text", fail: false, rules: [file("h1")] });
  expect(two.job.seen).toEqual(["h1"]);
  expect(two.back.text).toBe("file text");
});

test("each agent gets them on its own; an edited file (a new hash) comes back", async () => {
  const c = chat();
  await read(c, "Ada", "c1", { text: "t", fail: false, rules: [file("h1")] });
  const bo = await read(c, "Bo", "c2", { text: "t", fail: false, rules: [file("h1")] });
  expect(bo.job.seen).toEqual([]);
  expect(bo.back.text).toContain("be brief");
  const again = await read(c, "Ada", "c3", { text: "t", fail: false, rules: [file("h2", "be briefer")] });
  expect(again.back.text).toContain("be briefer");
});

test("a device's files that aren't path, hash and text strings are dropped", async () => {
  const c = chat();
  const { back } = await read(c, "Ada", "c1", { text: "t", fail: false, rules: [{ path: 1, hash: "h", text: "x" }, "junk", file("h3")] });
  expect(back.text.match(/<instructions /g)).toHaveLength(1);
});

test("the files never go into the system prompt", () => {
  expect(Tools.system("HEAD")).not.toContain("<instructions");
});
