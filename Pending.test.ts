// Pending test
// ============
// `bun run test Pending.test.ts`. RED ZONE (R4, ADR 1; DRAFT awaiting the
// user's sign-off): the approvals kept in view.json. Disk never says yes:
// a record read back only asks again; a grant is bound to the call's
// fingerprint (who, tool, args, the device among them), used once, and
// expires; a record not well formed is dropped as it loads.

import { expect, test } from "bun:test";

const Pending = await import("./Pending.ts");

const ARGS = { device: "mac", command: "make deploy" };
const T = 1_800_000_000_000;

// a well formed record, its fp its own hash
function rec(over: Record<string, unknown> = {}): any {
  const who = (over.who as string) ?? "main";
  const tool = (over.tool as string) ?? "shell";
  const args = (over.argv as unknown) ?? ARGS;
  const base = { id: 1, kind: "consent", who, tool, args: Pending.canon(args), fp: Pending.fp(who, tool, args), made: T, until: T + Pending.CONSENT_MS, state: "open" };
  const { argv: _argv, ...rest } = over;
  return { ...base, ...rest };
}

test("the constants: a consent waits 24 h, a grant 30 min, args 32 000 characters, 50 records", () => {
  expect(Pending.CONSENT_MS).toBe(24 * 3600_000);
  expect(Pending.GRANT_MS).toBe(30 * 60_000);
  expect(Pending.ARGS).toBe(32_000);
  expect(Pending.PENDS).toBe(50);
});

test("P4: canon is JSON with every object's keys sorted, at every depth", () => {
  const a = { b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } };
  const b = { a: { c: [{ y: 2, z: 1 }], d: 2 }, b: 1 };
  expect(Pending.canon(a)).toBe(Pending.canon(b));
  expect(Pending.canon(a)).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
});

test("P4, L1-AC5, L1-AC6: fp is sha256(who \\0 tool \\0 canon(args)); who, tool, each arg and the device change it", () => {
  const base = Pending.fp("main", "shell", ARGS);
  const want = new Bun.CryptoHasher("sha256").update("main\0shell\0" + Pending.canon(ARGS)).digest("hex");
  expect(base).toBe(want);
  expect(Pending.fp("main", "shell", { command: "make deploy", device: "mac" })).toBe(base);
  const others = [
    Pending.fp("Wkr", "shell", ARGS),
    Pending.fp("main", "write", ARGS),
    Pending.fp("main", "shell", { ...ARGS, command: "make deploy2" }),
    Pending.fp("main", "shell", { ...ARGS, device: "pc" }),
    Pending.fp("main", "shell", { ...ARGS, dir: "/r" }),
  ];
  for (const other of others) {
    expect(other).not.toBe(base);
  }
});

test("P3, L1-AC4: take is true once for a grant, then false", () => {
  const grants = new Map();
  Pending.grant(grants, rec(), T);
  expect(Pending.take(grants, "main", "shell", { command: "make deploy", device: "mac" }, T + 1)).toBe(true);
  expect(Pending.take(grants, "main", "shell", ARGS, T + 2)).toBe(false);
});

test("P4, L1-AC5, L1-AC6: take misses for another who, tool, arg or device, and the grant stays for the exact call", () => {
  const grants = new Map();
  Pending.grant(grants, rec(), T);
  expect(Pending.take(grants, "Wkr", "shell", ARGS, T + 1)).toBe(false);
  expect(Pending.take(grants, "main", "write", ARGS, T + 1)).toBe(false);
  expect(Pending.take(grants, "main", "shell", { ...ARGS, command: "make deploy2" }, T + 1)).toBe(false);
  expect(Pending.take(grants, "main", "shell", { ...ARGS, device: "pc" }, T + 1)).toBe(false);
  expect(Pending.take(grants, "main", "shell", ARGS, T + 1)).toBe(true);
});

test("P5, L1-AC13: a grant made at t is taken before t + GRANT_MS, missed at t + GRANT_MS + 1 ms", () => {
  const live = new Map();
  Pending.grant(live, rec(), T);
  expect(Pending.take(live, "main", "shell", ARGS, T + Pending.GRANT_MS - 1)).toBe(true);
  const late = new Map();
  Pending.grant(late, rec(), T);
  expect(Pending.take(late, "main", "shell", ARGS, T + Pending.GRANT_MS + 1)).toBe(false);
});

test("P6, L1-AC9: at restart an open consent made 24 h + 1 s ago is expired; a newer one stays open", () => {
  const old = rec({ id: 1, made: T - Pending.CONSENT_MS - 1000, until: T - 1000 });
  const fresh = rec({ id: 2, made: T - 1000, until: T - 1000 + Pending.CONSENT_MS });
  const out = Pending.restart([old, fresh], T);
  expect(out.map((p: any) => [p.id, p.state])).toEqual([[1, "expired"], [2, "open"]]);
});

test("P7, L1-AC10: at restart an open appeal is cut", () => {
  const appeal = rec({ id: 3, kind: "appeal", who: "Wkr", boss: "main", reason: "r", until: T + 600_000 });
  expect(Pending.restart([appeal], T).map((p: any) => p.state)).toEqual(["cut"]);
});

test("P1, L1-AC7: at restart a yes record stays yes (closed), never open again; closed records are kept as they are", () => {
  const closed = ["yes", "no", "cut", "expired"].map((state, k) => rec({ id: 10 + k, state }));
  const out = Pending.restart(closed, T + 2 * Pending.CONSENT_MS);
  expect(out.map((p: any) => p.state)).toEqual(["yes", "no", "cut", "expired"]);
  expect(out.some((p: any) => p.state === "open")).toBe(false);
});

test("P8, L1-AC8, L1-AC11: pending_read keeps a well formed record and drops each one not well formed", () => {
  const good = rec();
  expect(Pending.pending_read([good])).toEqual([good]);
  const big = { device: "mac", command: "x".repeat(Pending.ARGS) };
  const table: Array<[string, unknown]> = [
    ["bad fp", { ...good, fp: Pending.fp("main", "shell", { ...ARGS, command: "ls" }) }],
    ["fp not hex of its own args", { ...good, fp: "0".repeat(64) }],
    ["args not canonical", { ...good, args: JSON.stringify({ device: "mac", command: "make deploy" }) }],
    ["args not JSON", { ...good, args: "{nope" }],
    ["args over ARGS", rec({ argv: big })],
    ["args not a string", { ...good, args: ARGS }],
    ["unknown state", { ...good, state: "approved" }],
    ["unknown kind", { ...good, kind: "grant" }],
    ["id not an integer", { ...good, id: 1.5 }],
    ["id a string", { ...good, id: "1" }],
    ["empty who", rec({ who: "" })],
    ["made not finite", { ...good, made: Infinity }],
    ["until missing", { ...good, until: undefined }],
    ["boss not a string", { ...good, boss: 7 }],
    ["reason not a string", { ...good, reason: {} }],
    ["null", null],
    ["a string", "record"],
  ];
  for (const [why, bad] of table) {
    expect([why, Pending.pending_read([good, bad])]).toEqual([why, [good]]);
  }
});

test("P8, L1-AC11: pending_read strips an injected what field (and any other extra field)", () => {
  const good = rec();
  const out = Pending.pending_read([{ ...good, what: "ls", extra: 1 }]);
  expect(out).toEqual([good]);
  expect("what" in out[0]!).toBe(false);
  expect("extra" in out[0]!).toBe(false);
});

test("pending_read: not a list loads as none; more than PENDS loads PENDS", () => {
  expect(Pending.pending_read(undefined)).toEqual([]);
  expect(Pending.pending_read({ 0: rec() })).toEqual([]);
  const many = Array.from({ length: Pending.PENDS + 10 }, (_, k) => rec({ id: k + 1 }));
  expect(Pending.pending_read(many)).toHaveLength(Pending.PENDS);
});

test("keep: every open record, then the newest closed ones, PENDS in all", () => {
  const open = Array.from({ length: 5 }, (_, k) => rec({ id: k + 1, made: T + k }));
  const closed = Array.from({ length: 55 }, (_, k) => rec({ id: 6 + k, made: T + 6 + k, state: "no" }));
  const out = Pending.keep([...open, ...closed]);
  expect(out).toHaveLength(Pending.PENDS);
  const ids = out.map((p: any) => p.id).sort((a: number, b: number) => a - b);
  expect(ids.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  // the 45 newest closed: ids 16..60
  expect(ids.slice(5)).toEqual(Array.from({ length: 45 }, (_, k) => 16 + k));
  expect(Pending.keep([open[0], closed[0]])).toHaveLength(2);
});
