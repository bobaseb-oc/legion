// Outbox test
// ===========
// `bun run test Outbox.test.ts`. The pacing policy for GChat posts
// (Outbox.ts, L4): an approval posts at once whatever the pace (O1);
// under "quiet" questions post at once and notes, todos and decisions
// wait for the digest, "digest" holds questions too, "all" posts all at
// once (O2); the digest is due at most once per DIGEST_MS (O3). Nothing
// posted twice in a process (O4) is the bridge's (Server.ts Chat.bridge,
// Server.test.ts): no record of what was sent is kept (PLP-2924).

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

test("the constants: a digest every 30 min", () => {
  expect(Outbox.DIGEST_MS).toBe(30 * 60_000);
});

test("PLP-2924: no record of what was sent: no sent, outbox_read or OUTS", () => {
  expect(Object.keys(Outbox).filter((k) => ["sent", "outbox_read", "OUTS"].includes(k))).toEqual([]);
});

test("L4-AC1, L4-AC5, L4-AC2, O1, O2: quiet, digest not due: the approval and the question now; notes, todos, decisions wait", () => {
  const p = Outbox.plan(ALL, "quiet", T0, T0 + 1000);
  expect(keys(p.now)).toEqual(["a1", "q2"]);
  expect(p.digest).toEqual([]);
});

test("L4-AC3, O2, O3: quiet, DIGEST_MS passed since the last digest: the waiting note, todo and decision in the digest", () => {
  const p = Outbox.plan(ALL, "quiet", T0, T0 + Outbox.DIGEST_MS + 1);
  expect(keys(p.now)).toEqual(["a1", "q2"]);
  expect(keys(p.digest)).toEqual(["d5", "n3", "t4"]);
});

test("O3: one ms before DIGEST_MS has passed, the digest is not due", () => {
  expect(Outbox.plan(ALL, "quiet", T0, T0 + Outbox.DIGEST_MS - 1).digest).toEqual([]);
});

test("L4-AC6, O2: all: every item now, no digest", () => {
  const p = Outbox.plan(ALL, "all", T0, T0 + 1000);
  expect(keys(p.now)).toEqual(keys(ALL));
  expect(p.digest).toEqual([]);
});

test("L4-AC7, O1, O2: digest: only the approval now; the question waits with the rest", () => {
  const early = Outbox.plan(ALL, "digest", T0, T0 + 1000);
  expect(keys(early.now)).toEqual(["a1"]);
  expect(early.digest).toEqual([]);
  const due = Outbox.plan(ALL, "digest", T0, T0 + Outbox.DIGEST_MS + 1);
  expect(keys(due.now)).toEqual(["a1"]);
  expect(keys(due.digest)).toEqual(["d5", "n3", "q2", "t4"]);
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
