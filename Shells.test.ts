// Shells test
// ===========
// `bun run test Shells.test.ts`. Shell commands running like Claude
// Code's (B2, user's ask 2026-11-19): a device's tails give each running
// command's last lines (Tools.shells); the user's Ctrl+B sends one to the
// background, its caller going on told its number; agents read and stop
// their own background commands only (RED ZONE, DRAFT awaiting the
// user's sign-off), within caps on count, time and output; Unii is told
// when one ends; the user's stop of all ends every one.

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";

process.env.UNII_DIR = fs.mkdtempSync(os.tmpdir() + "/unii-shells-");

const { Tools } = await import("./Tools.ts");
const { CAP } = await import("./Clip.ts");
const { USER_SHELL } = await import("./Machine.ts");

// a chat's tools with one device, mac, whose terminal hears its jobs
function chat(): { tools: any; jobs: any[]; notes: string[]; told: () => number; ids: () => string[] } {
  const notes: string[] = [];
  let told = 0;
  const jobs: any[] = [];
  let ids: string[] = [];
  const tools: any = Tools.serve({ agents: new Map(), dir: process.env.UNII_DIR + "/" } as any, { note: (t: string) => notes.push(t), shells: () => (told += 1) } as any);
  Tools.attach(tools, "t1", "mac", "u", { send: (m: any) => (m.$ === "job" ? jobs.push(m) : m.$ === "jobs" ? (ids = m.ids) : 0), live: () => true, computer: false, work: "~/w" });
  return { tools, jobs, notes, told: () => told, ids: () => ids };
}

// an agent's shell call, as dispatch makes it (its cwd: its name)
const call = (tools: any, who: string, command: string, id: string, signal = new AbortController().signal) =>
  Tools.job(tools, "mac", { name: "shell", input: { command }, cwd: who }, signal, id);

test("a running shell command shows its last lines as the device tells them; a tail of another device's job, or of no shell, is dropped", async () => {
  const { tools, told } = chat();
  void call(tools, "Ada", "npm test", "j1");
  void Tools.job(tools, "mac", { name: "read", input: { path: "x" }, cwd: "Ada" }, new AbortController().signal, "j2");
  expect(Tools.shells(tools)).toMatchObject([{ job: "j1", n: null, who: "Ada", device: "mac", command: "npm test", lines: [] }]);
  const was = told();
  Tools.tail(tools, "mac", "j1", "one\ntwo\nthree\nfour\r50%\r90%\n");
  expect(told()).toBe(was + 1);
  expect(Tools.shells(tools)[0].lines).toEqual(["two", "three", "90%"]);
  Tools.tail(tools, "pc", "j1", "evil\n");
  Tools.tail(tools, "mac", "j2", "evil\n");
  expect(Tools.shells(tools)).toHaveLength(1);
  expect(Tools.shells(tools)[0].lines).toEqual(["two", "three", "90%"]);
  expect(Tools.shells(tools)[0].command.length).toBeLessThanOrEqual(200);
});

test("Ctrl+B: an agent's call returns at once with its number, the command runs on; Unii is told as it ends", async () => {
  const { tools, notes, ids } = chat();
  let back: any = null;
  void call(tools, "Ada", "sleep 9", "j1").then((out) => (back = out));
  Tools.tail(tools, "mac", "j1", "so far\n");
  expect(Tools.background(tools, null, Date.now())).toEqual({ text: "Sent to the background: 1.", fail: false });
  await Bun.sleep(0);
  expect(back.fail).toBe(false);
  expect(back.text).toContain("background command 1");
  expect(ids()).toEqual(["j1"]);
  expect(Tools.shells(tools)[0]).toMatchObject({ job: "j1", n: 1, who: "Ada" });
  expect(Tools.background(tools, null, Date.now())).toEqual({ text: "No command is running in the foreground.", fail: true });
  Tools.done(tools, "mac", "j1", { text: "so far\ndone\n(exit 0 in 9.0 s)", fail: false });
  expect(notes).toEqual(["Background command 1 (Ada's, on mac) ended: (exit 0 in 9.0 s). Its output is Ada's to read (shell_output)."]);
  expect(Tools.shells(tools)[0]).toMatchObject({ n: 1, ended: expect.any(Number), fail: false, lines: ["so far", "done", "(exit 0 in 9.0 s)"] });
  expect((await Tools.dispatch(tools, "Ada", "shell_output", { n: 1 }, new AbortController().signal, "c1")).text).toBe("Background command 1 ended:\nso far\ndone\n(exit 0 in 9.0 s)");
});

test("the user's !command sent to the background is still waited on to its end (its note), and counts for the user", async () => {
  const { tools } = chat();
  let back: any = null;
  void Tools.job(tools, "mac", { name: USER_SHELL, input: { command: "make" }, cwd: "main" }, new AbortController().signal, "bang-1").then((out) => (back = out));
  expect(Tools.shells(tools)[0]).toMatchObject({ who: "user", command: "make" });
  expect(Tools.background(tools, "bang-1", Date.now()).fail).toBe(false);
  await Bun.sleep(0);
  expect(back).toBe(null);
  Tools.done(tools, "mac", "bang-1", { text: "built\n(exit 0 in 1.0 s)", fail: false });
  await Bun.sleep(0);
  expect(back.text).toBe("built\n(exit 0 in 1.0 s)");
});

// RED ZONE (DRAFT): shell_output and shell_stop take the caller's own
// background command only: another agent's, Unii's or the user's is as
// none
test("an agent reads and stops only its own background commands", async () => {
  const { tools, ids } = chat();
  void call(tools, "Ada", "tail -f log", "j1");
  void call(tools, "main", "watch", "j2");
  void Tools.job(tools, "mac", { name: USER_SHELL, input: { command: "top" }, cwd: "main" }, new AbortController().signal, "bang-1");
  Tools.background(tools, null, Date.now());
  Tools.tail(tools, "mac", "j1", "secret of Ada\n");
  const s = new AbortController().signal;
  const none = "No background command 1 of yours (shell_output and shell_stop take your own only).";
  expect(await Tools.dispatch(tools, "Bob", "shell_output", { n: 1 }, s, "c1")).toEqual({ text: none, fail: true });
  expect(await Tools.dispatch(tools, "main", "shell_output", { n: 1 }, s, "c2")).toEqual({ text: none, fail: true });
  expect(await Tools.dispatch(tools, "Bob", "shell_stop", { n: 1 }, s, "c3")).toEqual({ text: none, fail: true });
  expect((await Tools.dispatch(tools, "Ada", "shell_stop", { n: 3 }, s, "c4")).fail).toBe(true);
  expect(ids()).toEqual(["j1", "j2", "bang-1"]);
  const read = await Tools.dispatch(tools, "Ada", "shell_output", { n: 1 }, s, "c5");
  expect(read.text).toMatch(/^Background command 1, running for \d+ s, printed so far:\nsecret of Ada\n$/);
  expect(await Tools.dispatch(tools, "Ada", "shell_stop", { n: 1 }, s, "c6")).toEqual({ text: "Stopped background command 1.", fail: false });
  expect(ids()).toEqual(["j2", "bang-1"]);
  expect((await Tools.dispatch(tools, "main", "shell_stop", { n: 2 }, s, "c7")).fail).toBe(false);
  expect(ids()).toEqual(["bang-1"]);
});

// RED ZONE (DRAFT): at most 4 a caller and 8 a chat run in the background
test("background commands are capped a caller and a chat", async () => {
  const { tools } = chat();
  for (let k = 1; k <= 5; k++) {
    void call(tools, "Ada", "sleep " + k, "a" + k);
  }
  expect(Tools.background(tools, null, Date.now())).toEqual({ text: "Sent 1, 2, 3, 4; the rest not: Ada has 4 there already. Stop one first.", fail: true });
  expect(Tools.shells(tools).filter((s: any) => s.n === null).map((s: any) => s.job)).toEqual(["a5"]);
  for (const who of ["Bob", "Cy"]) {
    for (let k = 1; k <= 3; k++) {
      void call(tools, who, "sleep " + k, who + k);
    }
  }
  expect(Tools.background(tools, "Bob1", Date.now()).fail).toBe(false);
  expect(Tools.background(tools, "Bob2", Date.now()).fail).toBe(false);
  expect(Tools.background(tools, "Bob3", Date.now()).fail).toBe(false);
  expect(Tools.background(tools, "Cy1", Date.now()).fail).toBe(false);
  expect(Tools.background(tools, "Cy2", Date.now())).toEqual({ text: "Not sent to the background: 8 commands run in the background already. Stop one first.", fail: true });
});

// RED ZONE (DRAFT): a background command stops bg_ms after it began
test("a background command is stopped past its time", async () => {
  const { tools, ids } = chat();
  Tools.bg_ms = 80;
  void call(tools, "Ada", "sleep 99", "j1");
  Tools.background(tools, null, Date.now());
  expect(ids()).toEqual(["j1"]);
  await Bun.sleep(150);
  expect(ids()).toEqual([]);
  expect((await Tools.dispatch(tools, "Ada", "shell_output", { n: 1 }, new AbortController().signal, "c1")).text).toContain("(stopped: in the background past");
  Tools.bg_ms = 10 * 60_000;
});

// RED ZONE (DRAFT): what a command printed is kept as a call's output is,
// its head and tail within CAP
test("a background command's output is kept to its head and tail", async () => {
  const { tools } = chat();
  void call(tools, "Ada", "yes", "j1");
  Tools.background(tools, null, Date.now());
  for (let k = 0; k < 10; k++) {
    Tools.tail(tools, "mac", "j1", "y\n".repeat(CAP));
  }
  const read = await Tools.dispatch(tools, "Ada", "shell_output", { n: 1 }, new AbortController().signal, "c1");
  expect(read.text.length).toBeLessThan(CAP + 200);
  expect(read.text).toContain("characters cut");
});

// RED ZONE (DRAFT): the user's stop of all work ends every shell
// command, the background's too; an agent's stop ends its own
test("the user's stop ends every shell command; an agent stopped takes its background commands with it", async () => {
  const { tools, ids } = chat();
  void call(tools, "Ada", "a", "j1");
  void call(tools, "main", "b", "j2");
  void Tools.job(tools, "mac", { name: USER_SHELL, input: { command: "c" }, cwd: "main" }, new AbortController().signal, "bang-1");
  Tools.background(tools, "j1", Date.now());
  Tools.background(tools, "bang-1", Date.now());
  void call(tools, "Bob", "d", "j3");
  expect(Tools.halt_shells(tools, null, false)).toBe(2);
  expect(ids()).toEqual(["j1", "bang-1"]);
  tools.agents.set("Ada", { name: "Ada", parent: "main", role: { $: "sub", tier: "worker", effort: null, model: null }, call: { stop: () => {} }, live: [], calls: {}, stop: false, replies: [], user: false });
  Tools.stop(tools, "Ada");
  expect(ids()).toEqual(["bang-1"]);
  void call(tools, "main", "e", "j4");
  expect(Tools.halt_shells(tools, null, true)).toBe(2);
  expect(ids()).toEqual([]);
});
