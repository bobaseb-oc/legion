// Outbox
// ======
// The pacing of GChat posts (Server.ts Chat.bridge), its pace and last
// digest kept in view.json: an approval posts at once whatever the pace
// (O1); "quiet" (the default) posts questions at once and holds notes,
// todos and decisions for the digest, "digest" holds questions too, "all"
// posts each at once (O2); the digest is due at most once per DIGEST_MS
// (O3). Nothing posted twice in a process (O4) is the bridge's: it plans
// only the items it has not posted (Server.ts Chat.bridge); no record of
// what was sent is kept, so a restart posts the open ones again.
// No text is kept: an item's is rebuilt from live state (Gchat.gchat_items).

import type { Item } from "./Gchat.ts";

// Types
// =====

export type Pace = "quiet" | "digest" | "all";

// Constants
// =========

export const DIGEST_MS = 30 * 60_000;
const PACES: Pace[] = ["quiet", "digest", "all"];

// Functions
// =========

// a pace read from view.json or an act; anything else is quiet
export function pace_read(x: unknown): Pace {
  return PACES.includes(x as Pace) ? (x as Pace) : "quiet";
}

// what to post: now, the items due at once; digest, those held, once the
// digest is due (due: DIGEST_MS since last, the last digest's time)
export function plan(items: Item[], pace: Pace, last: number, now: number): { now: Item[]; digest: Item[]; due: boolean } {
  const at_once = (x: Item) => x.kind === "approval" || pace === "all" || (pace === "quiet" && x.kind === "question");
  const due = pace !== "all" && now - last >= DIGEST_MS;
  return { now: items.filter(at_once), digest: due ? items.filter((x) => !at_once(x)) : [], due };
}
