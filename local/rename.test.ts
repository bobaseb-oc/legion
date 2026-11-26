// RED ZONE (rename, DRAFT awaiting the user's sign-off): the one-time move
// of Legion's data from before the rename (local/rename.ts), on a fixture
// home: never the user's

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { rename } from "./rename.ts";

const DAY = "users/10/main/2026-11-01.jsonl";
const REPLY = JSON.stringify({ i: 1, kind: "unii", text: "Filed." });
const USER = JSON.stringify({ i: 2, kind: "user", text: 'paste {"kind":"unii"} here' });
const ODD = '{"i": 3, "kind": "unii", "text": "spaced"}';
const CUT = '{"i":4,"kind":"un';
const BY = JSON.stringify({ i: 5, kind: "note", by: "unii" });

const idle = { alive: () => false, held: () => false, loaded: () => false };

// a home as it was before the rename: ~/.unii with a day of history, its
// index, the sessions of a browser and a terminal; ~/.unii-prime
function home(): string {
  const h = fs.mkdtempSync(os.tmpdir() + "/legion-rename-");
  const old = h + "/.unii";
  fs.mkdirSync(old + "/users/10/main", { recursive: true });
  fs.writeFileSync(old + "/" + DAY, [REPLY, USER, ODD, CUT, BY, ""].join("\n"), { mode: 0o600 });
  fs.writeFileSync(old + "/users/10/main.index", "x".repeat(64));
  const db = new Database(old + "/cloud.db", { create: true });
  db.run("create table sessions (hash text primary key, id text not null, name text not null, made integer, seen integer, term integer not null default 0)");
  db.run("insert into sessions values ('b', 'u', 'n', 1, 1, 0), ('t', 'u', 'n', 1, 1, 2)");
  db.close();
  fs.mkdirSync(h + "/.unii-prime");
  fs.writeFileSync(h + "/.unii-prime/knowledge.json", "{}");
  return h;
}

const terms = (dir: string) => {
  const db = new Database(dir + "/cloud.db", { readonly: true });
  try {
    return db.query("select term from sessions order by term").all();
  } finally {
    db.close();
  }
};

test("the move: replies say legion, other text untouched, indexes and browser sessions gone, links left", () => {
  const h = home();
  const out = rename(h, idle);
  const dir = h + "/.legion";
  expect(out).toMatchObject({ done: true, lines: 1, skipped: 1, indexes: 1, sessions: 1 });
  const lines = fs.readFileSync(dir + "/" + DAY, "utf8").split("\n");
  expect(JSON.parse(lines[0] ?? "")).toEqual({ i: 1, kind: "legion", text: "Filed." });
  expect(lines.slice(1)).toEqual([USER, ODD, CUT, BY, ""]);
  expect((fs.statSync(dir + "/" + DAY).mode & 0o777).toString(8)).toBe("600");
  expect(fs.existsSync(dir + "/users/10/main.index")).toBe(false);
  expect(terms(dir)).toEqual([{ term: 2 }]);
  // the backup holds the history as it was
  expect(fs.readFileSync(dir + "/users.bak-rename/10/main/2026-11-01.jsonl", "utf8").split("\n")[0]).toBe(REPLY);
  expect(fs.readlinkSync(h + "/.unii")).toBe(dir);
  expect(fs.readlinkSync(h + "/.unii-prime")).toBe(h + "/.legion-prime");
  expect(fs.readFileSync(h + "/.legion-prime/knowledge.json", "utf8")).toBe("{}");
});

test("a second run finds the move done and changes nothing", () => {
  const h = home();
  rename(h, idle);
  const before = fs.readFileSync(h + "/.legion/" + DAY, "utf8");
  expect(rename(h, idle)).toMatchObject({ done: true, already: true });
  expect(fs.readFileSync(h + "/.legion/" + DAY, "utf8")).toBe(before);
});

test("--dry counts what would change and writes nothing", () => {
  const h = home();
  expect(rename(h, { ...idle, dry: true })).toMatchObject({ done: false, lines: 1, skipped: 1, indexes: 1, sessions: 1 });
  expect(fs.lstatSync(h + "/.unii").isDirectory()).toBe(true);
  expect(fs.readFileSync(h + "/.unii/" + DAY, "utf8").split("\n")[0]).toBe(REPLY);
  expect(fs.existsSync(h + "/.unii/users.bak-rename")).toBe(false);
  expect(terms(h + "/.unii")).toEqual([{ term: 0 }, { term: 2 }]);
});

test("refused while the server runs (its lock socket answers, or server.pid names a live process) or a launchd job is loaded", () => {
  const lock = home();
  fs.writeFileSync(lock + "/.unii/lock", "");
  const held = rename(lock, { ...idle, held: (p) => p === lock + "/.unii/lock" });
  expect([held.done, held.error]).toEqual([false, expect.stringContaining("server")]);
  expect(fs.lstatSync(lock + "/.unii").isDirectory()).toBe(true);
  // a lock left by a server that crashed: nothing answers, so the move runs
  expect(rename(home(), { ...idle, held: () => false }).done).toBe(true);
  const pid = home();
  fs.writeFileSync(pid + "/.unii/server.pid", "4242\n");
  const live = rename(pid, { ...idle, alive: (n) => n === 4242 });
  expect([live.done, live.error]).toEqual([false, expect.stringContaining("4242")]);
  const h = home();
  const out = rename(h, { ...idle, loaded: (label) => label === "com.oncorps.legion.device" });
  expect(out.error).toContain("com.oncorps.legion.device");
  expect(fs.readFileSync(h + "/.unii/" + DAY, "utf8").split("\n")[0]).toBe(REPLY);
});

test("a ~/.legion with data of its own is refused; one holding only the test lock is replaced", () => {
  const h = home();
  fs.mkdirSync(h + "/.legion");
  fs.writeFileSync(h + "/.legion/heavy.lock", "");
  expect(rename(h, idle).done).toBe(true);
  const both = home();
  fs.mkdirSync(both + "/.legion/users", { recursive: true });
  const out = rename(both, idle);
  expect(out.done).toBe(false);
  expect(out.error).toContain(".legion");
  expect(fs.lstatSync(both + "/.unii").isDirectory()).toBe(true);
});

test("no ~/.unii: nothing to move", () => {
  const h = fs.mkdtempSync(os.tmpdir() + "/legion-rename-");
  expect(rename(h, idle)).toMatchObject({ done: false, already: true });
});

// the launcher (local/legion) starts nothing while ~/.unii is a dir: only
// stop, the --uninstalls and the move run; once ~/.unii is the link, or
// with LEGION_DIR set, it runs as before
test("the launcher refuses to start on an empty ~/.legion while ~/.unii holds the data", () => {
  const { LEGION_DIR: _, ...env } = process.env;
  const legion = (h: string, args: string[], more: Record<string, string> = {}) => {
    const out = Bun.spawnSync(["bash", import.meta.dir + "/legion", ...args], { env: { ...env, HOME: h, ...more } });
    return { code: out.exitCode, text: out.stdout.toString() + out.stderr.toString() };
  };
  const h = home();
  for (const args of [[], ["web"], ["server"], ["login"]]) {
    const out = legion(h, args);
    expect([args, out.code, out.text]).toEqual([args, 1, expect.stringContaining("legion rename --dry")]);
  }
  expect(fs.existsSync(h + "/.legion")).toBe(false);
  // the move is let through (here refused by what runs on this computer, or not)
  expect(legion(h, ["rename", "--dry"]).text).toContain('"done": false');
  // LEGION_DIR set: no guard; ~/.unii the link: no guard (server's usage, exit 2)
  expect(legion(h, ["server"], { LEGION_DIR: h + "/elsewhere" }).code).toBe(2);
  fs.mkdirSync(h + "/.legion", { recursive: true });
  fs.renameSync(h + "/.unii", h + "/.legion/x");
  fs.symlinkSync(h + "/.legion", h + "/.unii");
  expect(legion(h, ["server"]).code).toBe(2);
});
