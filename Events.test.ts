// Events test
// ===========
// `bun run test Events.test.ts`. RED ZONE (ADR 2; DRAFT awaiting the
// user's sign-off): the chat's inbox, kept in view.json. Who sent an
// event comes from the request's credential (src_of), never its payload;
// only the user's own origins (view, terminal, gchat) may answer an
// approval; a device's event waits (parked) while no view is open; one
// event per src and key; a restart retries a taken event at most TRIES
// times and never turns an approval found on disk into a yes.

import { expect, test } from "bun:test";

const Events = await import("./Events.ts");

const T = 1_800_000_000_000;

// a well formed event as it is kept
function ev(over: Record<string, unknown> = {}): any {
  return { id: 1, src: "view", key: "k1", kind: "work", to: "main", body: "b", at: T, tries: 0, state: "new", ...over };
}

// what an act asks to add
function req(over: Record<string, unknown> = {}): any {
  return { src: "view", key: "k1", kind: "work", to: "main", body: "b", ...over };
}

test("the constants: 3 tries, 200 events kept, 50 waiting, bodies of 4000 characters; the user's origins", () => {
  expect(Events.TRIES).toBe(3);
  expect(Events.EVENTS).toBe(200);
  expect(Events.WAITING).toBe(50);
  expect(Events.BODY).toBe(4000);
  expect([...Events.USERS]).toEqual(["view", "terminal", "gchat"]);
});

test("E1: src_of comes from the credential only: a view, a terminal key, else a device", () => {
  const table: Array<[string, boolean, string]> = [
    ["", true, "view"],
    ["mac", true, "terminal"],
    ["", false, "device"],
    ["mac", false, "device"],
  ];
  for (const [device, says, src] of table) {
    expect([device, says, Events.src_of(device, says)]).toEqual([device, says, src]);
  }
});

test("E2: trusted is true for the user's origins only", () => {
  for (const src of ["view", "terminal", "gchat"]) {
    expect([src, Events.trusted(ev({ src }))]).toEqual([src, true]);
  }
  for (const src of ["device", "routine", "timer"]) {
    expect([src, Events.trusted(ev({ src }))]).toEqual([src, false]);
  }
});

test("add: a new event is stored new, with its id, time and no tries", () => {
  const out: any = Events.add([], req({ body: "hello" }), 7, T);
  expect(out.event).toEqual({ id: 7, src: "view", key: "k1", kind: "work", to: "main", body: "hello", at: T, tries: 0, state: "new" });
  expect(out.list).toEqual([out.event]);
});

test("E5, L3-AC1: add with a src and key already seen stores nothing ({ dup: true }); another src's same key is stored", () => {
  const first: any = Events.add([], req(), 1, T);
  const again: any = Events.add(first.list, req({ body: "other" }), 2, T + 1);
  expect(again).toEqual({ dup: true });
  // a closed event's key is still seen
  const closed = [ev({ state: "done" })];
  expect(Events.add(closed, req(), 2, T + 1)).toEqual({ dup: true });
  const other: any = Events.add(first.list, req({ src: "device" }), 2, T + 1);
  expect(other.list).toHaveLength(2);
  expect(other.event).toMatchObject({ id: 2, src: "device", key: "k1" });
});

test("E8, L3-AC16: add past WAITING events new or parked is refused with an error; closed ones don't count", () => {
  const waiting = Array.from({ length: Events.WAITING }, (_, k) => ev({ id: k + 1, key: "w" + k, state: k % 2 === 0 ? "new" : "parked" }));
  const full: any = Events.add(waiting, req({ key: "one-more" }), 99, T);
  expect(typeof full.error).toBe("string");
  expect(full.list).toBeUndefined();
  const closed = [
    ...waiting.slice(1),
    ...["done", "failed", "taken"].map((state, k) => ev({ id: 100 + k, key: "c" + k, state })),
  ];
  const room: any = Events.add(closed, req({ key: "one-more" }), 99, T);
  expect(room.error).toBeUndefined();
  expect(room.event).toMatchObject({ id: 99, key: "one-more", state: "new" });
});

test("E2, L3-AC9: an approval from a device, a routine or a timer is refused; from the user's origins stored", () => {
  for (const src of ["device", "routine", "timer"]) {
    const out: any = Events.add([], req({ src, kind: "approval", ref: 3, body: "yes" }), 1, T);
    expect([src, typeof out.error]).toEqual([src, "string"]);
  }
  for (const src of ["view", "terminal", "gchat"]) {
    const out: any = Events.add([], req({ src, kind: "approval", ref: 3, body: "yes" }), 1, T);
    expect([src, out.event?.kind, out.event?.ref]).toEqual([src, "approval", 3]);
  }
});

test("add: a body past BODY is cut to BODY characters", () => {
  const body = "a".repeat(Events.BODY) + "b".repeat(1000);
  const out: any = Events.add([], req({ body }), 1, T);
  expect(out.event.body).toBe("a".repeat(Events.BODY));
});

test("add: a key not matching KEY (empty, a space, a shell, past 200) is refused; colons, slashes, dots and dashes allowed", () => {
  for (const key of ["", "a b", "$(rm -rf ~)", "k\n", "x".repeat(201)]) {
    const out: any = Events.add([], req({ key }), 1, T);
    expect([key, typeof out.error]).toEqual([key, "string"]);
  }
  for (const key of ["consent:1:c1", "spaces/T/messages/r1", "a.b-c_d", "x".repeat(200)]) {
    const out: any = Events.add([], req({ key }), 1, T);
    expect([key, out.event?.key]).toEqual([key, key]);
  }
});

test("E6, L3-AC2..AC4, L3-AC11, L3-AC19: restart: work and notify new or taken are parked (taken: one more try); at TRIES failed; approvals and replies done; others kept", () => {
  const list = [
    ev({ id: 1, key: "a", state: "taken", tries: 0 }),
    ev({ id: 2, key: "b", state: "taken", tries: 1, kind: "notify" }),
    ev({ id: 3, key: "c", state: "taken", tries: 2 }),
    ev({ id: 4, key: "d", state: "new", tries: 0, src: "terminal", kind: "notify" }),
    ev({ id: 5, key: "e", state: "parked", src: "device" }),
    ev({ id: 6, key: "f", state: "done" }),
    ev({ id: 7, key: "g", state: "new", kind: "approval", ref: 2, body: "yes" }),
    ev({ id: 8, key: "h", state: "taken", kind: "approval", ref: 3, body: "yes" }),
    ev({ id: 9, key: "i", state: "failed", tries: 3 }),
    ev({ id: 10, key: "j", state: "new", src: "gchat", kind: "reply", body: "{}" }),
    ev({ id: 11, key: "k", state: "taken", src: "gchat", kind: "reply", body: "{}" }),
  ];
  const out: any = Events.restart(list);
  const by = Object.fromEntries(out.list.map((e: any) => [e.id, e.state]));
  expect(by).toEqual({ 1: "parked", 2: "parked", 3: "failed", 4: "parked", 5: "parked", 6: "done", 7: "done", 8: "done", 9: "failed", 10: "done", 11: "done" });
  const tries = Object.fromEntries(out.list.map((e: any) => [e.id, e.tries]));
  // a taken one gets one more try (a new one's tries, an approval's and a failed one's are not part of the contract)
  expect([tries[1], tries[2]]).toEqual([1, 2]);
  // the events this restart failed, not the ones failed before
  expect(out.failed.map((e: any) => e.id)).toEqual([3]);
});

test("E6 (restart decision): an event parked by a restart is from a restart: never trusted, never due with no view, due once one is open", () => {
  const list = ["view", "terminal", "gchat"].flatMap((src, k) => [
    ev({ id: 2 * k + 1, key: src + "-new", src, state: "new" }),
    ev({ id: 2 * k + 2, key: src + "-taken", src, state: "taken", kind: "notify" }),
  ]);
  const out: any = Events.restart(list);
  for (const e of out.list) {
    expect([e.key, e.state, Events.trusted(e)]).toEqual([e.key, "parked", false]);
  }
  expect(Events.due(out.list, false)).toEqual([]);
  expect(Events.due(out.list, true).map((e: any) => e.id)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("E6: restart never leaves an approval found on disk new or taken (disk never says yes)", () => {
  for (const state of ["new", "taken"]) {
    for (const src of ["view", "terminal", "gchat"]) {
      const out: any = Events.restart([ev({ src, state, kind: "approval", ref: 1, body: "yes" })]);
      expect([state, src, out.list[0].state]).toEqual([state, src, "done"]);
    }
  }
});

test("E3, L3-AC6: due with no view: the user's events new, in id order; a device's set parked and not returned", () => {
  const list = [
    ev({ id: 3, key: "c", src: "view" }),
    ev({ id: 1, key: "a", src: "device" }),
    ev({ id: 2, key: "b", src: "gchat", kind: "reply" }),
    ev({ id: 4, key: "d", src: "device", state: "parked" }),
    ev({ id: 5, key: "e", src: "terminal" }),
    ev({ id: 6, key: "f", state: "done" }),
    ev({ id: 7, key: "g", state: "taken" }),
    ev({ id: 8, key: "h", src: "routine" }),
  ];
  const out = Events.due(list, false);
  expect(out.map((e: any) => e.id)).toEqual([2, 3, 5]);
  const state = Object.fromEntries(list.map((e: any) => [e.id, e.state]));
  expect(state).toEqual({ 1: "parked", 2: "new", 3: "new", 4: "parked", 5: "new", 6: "done", 7: "taken", 8: "parked" });
});

test("E3, L3-AC8: due with a view open: new and parked events, every source's, in id order", () => {
  const list = [
    ev({ id: 4, key: "d", src: "device", state: "parked" }),
    ev({ id: 1, key: "a", src: "device" }),
    ev({ id: 3, key: "c", src: "view" }),
    ev({ id: 2, key: "b", state: "done" }),
    ev({ id: 5, key: "e", state: "failed" }),
  ];
  expect(Events.due(list, true).map((e: any) => e.id)).toEqual([1, 3, 4]);
});

test("keep: every event new, taken or parked, then the newest closed ones, EVENTS in all", () => {
  const open = ["new", "taken", "parked", "new", "parked"].map((state, k) => ev({ id: k + 1, key: "o" + k, at: T + k, state }));
  const closed = Array.from({ length: 250 }, (_, k) => ev({ id: 6 + k, key: "c" + k, at: T + 6 + k, state: k % 2 === 0 ? "done" : "failed" }));
  const out = Events.keep([...open, ...closed]);
  expect(out).toHaveLength(Events.EVENTS);
  const ids = out.map((e: any) => e.id).sort((a: number, b: number) => a - b);
  expect(ids.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
  // the 195 newest closed: ids 61..255
  expect(ids.slice(5)).toEqual(Array.from({ length: 195 }, (_, k) => 61 + k));
  expect(Events.keep([open[0], closed[0]])).toHaveLength(2);
});

test("events_read: not a list loads as none; more than EVENTS loads the last EVENTS", () => {
  expect(Events.events_read(undefined)).toEqual([]);
  expect(Events.events_read({ 0: ev() })).toEqual([]);
  const many = Array.from({ length: Events.EVENTS + 10 }, (_, k) => ev({ id: k + 1, key: "m" + k, state: "done" }));
  const out = Events.events_read(many);
  expect(out).toHaveLength(Events.EVENTS);
  expect(out[0].id).toBe(11);
  expect(out.at(-1)?.id).toBe(Events.EVENTS + 10);
});

test("E2: events_read drops an approval not from the user's origins; keeps a view's", () => {
  const good = ev({ id: 1, key: "a", kind: "approval", ref: 2, body: "yes" });
  const forged = ev({ id: 2, key: "b", kind: "approval", ref: 2, body: "yes", src: "device" });
  expect(Events.events_read([good, forged])).toEqual([good]);
});

// RED ZONE (security review 4 N4, DRAFT awaiting the user's sign-off): a
// device's events (its key is within an agent's reach), each one a billed
// turn once a view is open, at most RATE a minute, done or not; the
// user's own never capped, and a minute later there is room again
test("N4: past RATE untrusted events in a minute, add is refused; the user's are not; a minute on, room again", () => {
  const recent = Array.from({ length: Events.RATE }, (_, k) => ev({ id: k + 1, src: "device", key: "d" + k, state: "done", at: T - 1000 }));
  const over: any = Events.add(recent, req({ src: "device", key: "one-more" }), 99, T);
  expect(over.error).toMatch(/a minute/);
  expect(over.list).toBeUndefined();
  const user: any = Events.add(recent, req({ src: "view", key: "mine" }), 99, T);
  expect(user.error).toBeUndefined();
  const later: any = Events.add(recent, req({ src: "device", key: "one-more" }), 99, T + 60_000);
  expect(later.error).toBeUndefined();
  const one: any = Events.add(recent.slice(1), req({ src: "device", key: "one-more" }), 99, T);
  expect(one.error).toBeUndefined();
  expect(Events.RATE).toBeLessThanOrEqual(10);
});
