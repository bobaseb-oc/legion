// Outbox test
// ===========
// `bun run test Outbox.test.ts`. The pacing policy for GChat posts
// (Outbox.ts, L4): an approval posts at once whatever the pace (O1);
// under "quiet" questions post at once and notes, todos and decisions
// wait for the digest, "digest" holds questions too, "all" posts all at
// once (O2); the digest is due at most once per DIGEST_MS (O3); an item
// recorded sent is never planned again (O4).

import { expect, test } from "bun:test";
import type { Item } from "./Gchat.ts";

const Outbox = await import("./Outbox.ts");

const T0 = 1_800_000_000_000;
const A = { key: "a1", kind: "approval", n: 1, text: "Approval 1: main wants to run: make deploy", fp: "f1" } as unknown as Item;
const Q: Item = { key: "q2", kind: "question", n: 2, text: "Question 2: ship?" };
const N: Item = { key: "n3", kind: "note", n: 3, text: "Note 3: green" };
const T: Item = { key: "t4", kind: "todo", n: 4, text: "Todo 4: review" };
const D: Item = { key: "d5", kind: "decision", n: 5, text: "Decision 5: pushed" };
const ALL = [A, Q, N, T, D];
const keys = (xs: Item[]) => xs.map((x) => x.key).sort();

test("the constants: a digest every 30 min, 500 outbox records", () => {
  expect(Outbox.DIGEST_MS).toBe(30 * 60_000);
  expect(Outbox.OUTS).toBe(500);
});

test("L4-AC1, L4-AC5, L4-AC2, O1, O2: quiet, digest not due: the approval and the question now; notes, todos, decisions wait", () => {
  const p = Outbox.plan(ALL, [], "quiet", T0, T0 + 1000);
  expect(keys(p.now)).toEqual(["a1", "q2"]);
  expect(p.digest).toEqual([]);
});

test("L4-AC3, O2, O3: quiet, DIGEST_MS passed since the last digest: the waiting note, todo and decision in the digest", () => {
  const p = Outbox.plan(ALL, [], "quiet", T0, T0 + Outbox.DIGEST_MS + 1);
  expect(keys(p.now)).toEqual(["a1", "q2"]);
  expect(keys(p.digest)).toEqual(["d5", "n3", "t4"]);
});

test("O3: one ms before DIGEST_MS has passed, the digest is not due", () => {
  expect(Outbox.plan(ALL, [], "quiet", T0, T0 + Outbox.DIGEST_MS - 1).digest).toEqual([]);
});

test("L4-AC6, O2: all: every item now, no digest", () => {
  const p = Outbox.plan(ALL, [], "all", T0, T0 + 1000);
  expect(keys(p.now)).toEqual(keys(ALL));
  expect(p.digest).toEqual([]);
});

test("L4-AC7, O1, O2: digest: only the approval now; the question waits with the rest", () => {
  const early = Outbox.plan(ALL, [], "digest", T0, T0 + 1000);
  expect(keys(early.now)).toEqual(["a1"]);
  expect(early.digest).toEqual([]);
  const due = Outbox.plan(ALL, [], "digest", T0, T0 + Outbox.DIGEST_MS + 1);
  expect(keys(due.now)).toEqual(["a1"]);
  expect(keys(due.digest)).toEqual(["d5", "n3", "q2", "t4"]);
});

test("L4-AC4, O4: an item recorded sent is never planned again, under any pace, digest due or not", () => {
  let o = Outbox.sent([], N, 1, T0);
  o = Outbox.sent(o, A, 2, T0);
  expect(o.find((x) => x.key === "n3")).toMatchObject({ key: "n3", kind: "note", state: "sent", sent: T0, must: false });
  expect(o.find((x) => x.key === "a1")).toMatchObject({ key: "a1", kind: "approval", state: "sent", must: true });
  for (const pace of ["quiet", "digest", "all"] as const) {
    for (const now of [T0 + 1000, T0 + Outbox.DIGEST_MS + 1]) {
      const p = Outbox.plan(ALL, o, pace, T0, now);
      const planned = [...keys(p.now), ...keys(p.digest)];
      expect([pace, now, planned.includes("n3") || planned.includes("a1")]).toEqual([pace, now, false]);
    }
  }
});

test("L4-AC12: pace_read: an unknown pace is quiet; the three paces kept", () => {
  expect(Outbox.pace_read("loud")).toBe("quiet");
  expect(Outbox.pace_read(undefined)).toBe("quiet");
  expect(Outbox.pace_read(3)).toBe("quiet");
  expect(Outbox.pace_read({ pace: "all" })).toBe("quiet");
  expect(Outbox.pace_read("quiet")).toBe("quiet");
  expect(Outbox.pace_read("digest")).toBe("digest");
  expect(Outbox.pace_read("all")).toBe("all");
});

test("outbox_read drops malformed rows and keeps well formed ones", () => {
  const good = { id: 1, key: "n3", kind: "note", made: T0, must: false, state: "sent", via: "gchat", sent: T0 };
  const rows = [good, null, "x", 7, { ...good, key: 1 }, { ...good, kind: "spam" }, { ...good, state: "bogus" }, { ...good, id: "1" }, { ...good, made: "now" }, { ...good, must: "yes" }];
  expect(Outbox.outbox_read(rows)).toEqual([good]);
  expect(Outbox.outbox_read("nope")).toEqual([]);
  expect(Outbox.outbox_read(undefined)).toEqual([]);
  expect(Outbox.outbox_read({ key: "n3" })).toEqual([]);
});

test("sent caps the outbox at OUTS records, the newest kept", () => {
  let o: ReturnType<typeof Outbox.sent> = [];
  const over = Outbox.OUTS + 20;
  for (let i = 0; i < over; i++) {
    o = Outbox.sent(o, { key: "n" + i, kind: "note", n: i, text: "t" }, i + 1, T0 + i);
  }
  expect(o.length).toBeLessThanOrEqual(Outbox.OUTS);
  expect(o.some((x) => x.key === "n" + (over - 1))).toBe(true);
  expect(o.some((x) => x.key === "n0")).toBe(false);
});
