// Outbox
// ======
// The pacing of GChat posts (Server.ts Chat.bridge), kept in view.json:
// an approval posts at once whatever the pace (O1); "quiet" (the default)
// posts questions at once and holds notes, todos and decisions for the
// digest, "digest" holds questions too, "all" posts each at once (O2);
// the digest is due at most once per DIGEST_MS (O3). The outbox is the
// record of what was reported; plan skips an item it holds sent (O4), but
// the bridge passes none (a restart posts again: Server.ts Chat.bridge).
// No text is kept: an item's is rebuilt from live state (Gchat.gchat_items).

import type { Item } from "./Gchat.ts";

// Types
// =====

export type Pace = "quiet" | "digest" | "all";
export type Out = { id: number; key: string; kind: "approval" | "question" | "outcome" | "note" | "todo" | "decision"; made: number; must: boolean; state: "queued" | "sent" | "dropped"; via?: "gchat"; sent?: number };

// Constants
// =========

export const DIGEST_MS = 30 * 60_000;
export const OUTS      = 500;
const PACES: Pace[]         = ["quiet", "digest", "all"];
const KINDS: Out["kind"][]  = ["approval", "question", "outcome", "note", "todo", "decision"];
const STATES: Out["state"][] = ["queued", "sent", "dropped"];

// Functions
// =========

// a pace read from view.json or an act; anything else is quiet
export function pace_read(x: unknown): Pace {
  return PACES.includes(x as Pace) ? (x as Pace) : "quiet";
}

// the outbox view.json holds, each record checked as it loads
export function outbox_read(x: unknown): Out[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const out: Out[] = [];
  for (const r of x) {
    const o = record(r);
    if (o !== null) {
      out.push(o);
    }
  }
  return out.slice(-OUTS);
}

function record(r: unknown): Out | null {
  if (r === null || typeof r !== "object") {
    return null;
  }
  const { id, key, kind, made, must, state, via, sent } = r as Record<string, unknown>;
  if (!Number.isInteger(id) || typeof key !== "string" || !KINDS.includes(kind as Out["kind"]) || !Number.isFinite(made) || typeof must !== "boolean" || !STATES.includes(state as Out["state"])) {
    return null;
  }
  if ((via !== undefined && via !== "gchat") || (sent !== undefined && !Number.isFinite(sent))) {
    return null;
  }
  const o: Out = { id: id as number, key, kind: kind as Out["kind"], made: made as number, must, state: state as Out["state"] };
  if (via !== undefined) {
    o.via = "gchat";
  }
  if (sent !== undefined) {
    o.sent = sent as number;
  }
  return o;
}

// what to post: now, the items due at once; digest, those held, once the
// digest is due (due: DIGEST_MS since last, the last digest's time).
// An item recorded sent is in neither
export function plan(items: Item[], outbox: Out[], pace: Pace, last: number, now: number): { now: Item[]; digest: Item[]; due: boolean } {
  const fresh = items.filter((x) => !outbox.some((o) => o.key === x.key && o.state === "sent"));
  const at_once = (x: Item) => x.kind === "approval" || pace === "all" || (pace === "quiet" && x.kind === "question");
  const due = pace !== "all" && now - last >= DIGEST_MS;
  return { now: fresh.filter(at_once), digest: due ? fresh.filter((x) => !at_once(x)) : [], due };
}

// the outbox with item recorded sent (number id) at now, the last OUTS kept
export function sent(outbox: Out[], item: Item, id: number, now: number): Out[] {
  const o: Out = { id, key: item.key, kind: item.kind, made: now, must: item.kind === "approval", state: "sent", via: "gchat", sent: now };
  return [...outbox.filter((x) => x.key !== item.key), o].slice(-OUTS);
}
