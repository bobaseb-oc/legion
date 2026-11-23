// Events
// ======
// RED ZONE (R4, DRAFT awaiting the user's sign-off): ADR 2, the chat's
// inbox, kept in view.json. Who sent an event comes from the request's
// credential (src_of), never its payload; only the user's own origins may
// answer an approval or start work with no view open; a device's waits
// (parked). Disk never speaks for the user: at a restart an approval or a
// reply found open is closed, and every other open event parked, untrusted.

export type Src   = "view" | "terminal" | "gchat" | "device" | "routine" | "timer";
export type Kind  = "approval" | "reply" | "notify" | "work";
export type State = "new" | "taken" | "done" | "parked" | "failed";
export type Event = { id: number; src: Src; key: string; kind: Kind; to: string; body: string; ref?: number; at: number; tries: number; state: State; restarted?: true };
export type Ask   = { src: Src; key: string; kind: Kind; to: string; body: string; ref?: number };

export const USERS: readonly Src[] = ["view", "terminal", "gchat"];
export const TRIES   = 3;
export const EVENTS  = 200;
export const WAITING = 50;
export const BODY    = 4000;
export const KEY     = /^[\w.:/-]{1,200}$/;
const SRCS: Src[]     = ["view", "terminal", "gchat", "device", "routine", "timer"];
const KINDS: Kind[]   = ["approval", "reply", "notify", "work"];
const STATES: State[] = ["new", "taken", "done", "parked", "failed"];

// RED ZONE (R4, DRAFT awaiting the user's sign-off): E1: the act's own
// credential (says: Cloud.speaks), never a field it sends
export function src_of(device: string, says: boolean): Src {
  return !says ? "device" : device === "" ? "view" : "terminal";
}

// RED ZONE (R4, DRAFT awaiting the user's sign-off): an event read back at
// a restart is never the user's, whoever sent it
export function trusted(e: { src: Src; restarted?: true }): boolean {
  return USERS.includes(e.src) && e.restarted !== true;
}

function waits(e: Event): boolean {
  return e.state === "new" || e.state === "parked";
}

// RED ZONE (R4, DRAFT awaiting the user's sign-off): the events view.json
// holds, checked as they load; an approval not from the user's origins
// dropped (E2), the last EVENTS kept
export function events_read(x: unknown): Event[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const out: Event[] = [];
  for (const r of x) {
    const e = record(r);
    if (e !== null) {
      out.push(e);
    }
  }
  return out.slice(-EVENTS);
}

function record(r: unknown): Event | null {
  if (r === null || typeof r !== "object") {
    return null;
  }
  const { id, src, key, kind, to, body, ref, at, tries, state, restarted } = r as Record<string, unknown>;
  if (!Number.isInteger(id) || !SRCS.includes(src as Src) || !KINDS.includes(kind as Kind) || !STATES.includes(state as State)) {
    return null;
  }
  if (typeof key !== "string" || !KEY.test(key) || typeof to !== "string" || typeof body !== "string" || body.length > BODY) {
    return null;
  }
  if (!Number.isFinite(at) || !Number.isInteger(tries) || (tries as number) < 0 || (ref !== undefined && !Number.isInteger(ref))) {
    return null;
  }
  if (kind === "approval" && !USERS.includes(src as Src)) {
    return null;
  }
  const e: Event = { id: id as number, src: src as Src, key, kind: kind as Kind, to, body, at: at as number, tries: tries as number, state: state as State };
  if (ref !== undefined) {
    e.ref = ref as number;
  }
  if (restarted === true) {
    e.restarted = true;
  }
  return e;
}

// a new event stored (id given), or why not: a bad key; an approval not
// from the user's origins (E2); a src and key seen (E5: { dup: true }); its
// class (the user's, or not) past WAITING waiting, so a device's flood
// never blocks the user's own events (E8)
export function add(list: Event[], e: Ask, id: number, now: number): { list: Event[]; event: Event } | { dup: true } | { error: string } {
  if (!KEY.test(e.key)) {
    return { error: "An event's key is 1 to 200 letters, digits, or . : / - _." };
  }
  if (e.kind === "approval" && !trusted(e)) {
    return { error: "Only the user answers an approval." };
  }
  if (list.some((x) => x.src === e.src && x.key === e.key)) {
    return { dup: true };
  }
  if (list.filter((x) => waits(x) && trusted(x) === trusted(e)).length >= WAITING) {
    return { error: "Legion's inbox is full: wait a moment." };
  }
  const event: Event = { id, src: e.src, key: e.key, kind: e.kind, to: e.to, body: e.body.slice(0, BODY), at: now, tries: 0, state: "new" };
  if (e.ref !== undefined) {
    event.ref = e.ref;
  }
  return { list: [...list, event], event };
}

// RED ZONE (R4, DRAFT awaiting the user's sign-off): E6, a restart: an
// approval or a reply open is done (never answered from disk); every other
// open one marked restarted and parked till a view opens, a taken one with
// one more try, failed at TRIES; failed: the events this restart failed
export function restart(list: Event[]): { list: Event[]; failed: Event[] } {
  const failed: Event[] = [];
  const out = list.map((e): Event => {
    const open = e.state === "new" || e.state === "taken" || e.state === "parked";
    if (!open) {
      return e;
    }
    if (e.kind === "approval" || e.kind === "reply") {
      return { ...e, state: "done" };
    }
    const tries = e.state === "taken" ? e.tries + 1 : e.tries;
    if (tries >= TRIES) {
      const f: Event = { ...e, tries, state: "failed" };
      failed.push(f);
      return f;
    }
    return { ...e, tries, state: "parked", restarted: true };
  });
  return { list: out, failed };
}

// RED ZONE (R4, DRAFT awaiting the user's sign-off): E3: the events to
// deliver now, in id order. With no view open, only the user's: any
// other new one is set parked in place, and waits for a view
export function due(list: Event[], viewed: boolean): Event[] {
  const out: Event[] = [];
  for (const e of list) {
    if (!waits(e)) {
      continue;
    }
    if (viewed || trusted(e)) {
      out.push(e);
    } else {
      e.state = "parked";
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

// the list kept: every event new, taken or parked, then the newest closed
// ones, EVENTS in all
export function keep(list: Event[]): Event[] {
  const open = list.filter((e) => waits(e) || e.state === "taken").slice(-EVENTS);
  const closed = list.filter((e) => e.state === "done" || e.state === "failed").sort((a, b) => b.at - a.at).slice(0, EVENTS - open.length);
  const kept = new Set([...open, ...closed]);
  return list.filter((e) => kept.has(e));
}
