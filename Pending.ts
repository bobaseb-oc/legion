// Pending
// =======
// RED ZONE (R4, DRAFT awaiting the user's sign-off): the approvals
// waiting for the user (auto mode's consents) or a boss (super mode's
// appeals), kept in view.json so a restart re-shows the consents (an open
// appeal it cuts). Disk never says yes: a record read at load only asks
// again; a grant is made in memory by the user's live yes (Server.ts
// Chat.consented), bound to the call's fingerprint, used once, expiring.
// Shown text comes from the hashed args.

export type Kind  = "consent" | "appeal";
export type State = "open" | "yes" | "no" | "cut" | "expired";
export type Pending = { id: number; kind: Kind; who: string; boss?: string; tool: string; args: string; reason?: string; fp: string; made: number; until: number; state: State };
export type Grant = { who: string; until: number };

export const CONSENT_MS = 24 * 3600_000;
export const GRANT_MS   = 30 * 60_000;
export const ARGS       = 32_000;
export const PENDS      = 50;
const KINDS: Kind[]   = ["consent", "appeal"];
const STATES: State[] = ["open", "yes", "no", "cut", "expired"];

// JSON with every object's keys sorted, so equal calls hash equal
export function canon(x: unknown): string {
  const walk = (v: unknown): unknown => Array.isArray(v) ? v.map(walk)
    : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]))
    : v;
  return JSON.stringify(walk(x) ?? null);
}

export function fp(who: string, tool: string, args: unknown): string {
  return new Bun.CryptoHasher("sha256").update(who + "\0" + tool + "\0" + canon(args)).digest("hex");
}

// RED ZONE (R4, DRAFT awaiting the user's sign-off): the records view.json
// holds, checked as they load: each field's type, args its own canonical
// JSON (≤ ARGS), fp its hash; any other dropped, no extra field kept;
// then kept by keep's rule, as on save, so no open record is cut
export function pending_read(x: unknown): Pending[] {
  if (!Array.isArray(x)) {
    return [];
  }
  const out: Pending[] = [];
  for (const r of x) {
    const p = record(r);
    if (p !== null) {
      out.push(p);
    }
  }
  return keep(out);
}

function record(r: unknown): Pending | null {
  if (r === null || typeof r !== "object") {
    return null;
  }
  const o = r as Record<string, unknown>;
  const { id, kind, who, tool, args, made, until, state, boss, reason } = o;
  if (!Number.isInteger(id) || !KINDS.includes(kind as Kind) || !STATES.includes(state as State)) {
    return null;
  }
  if (typeof who !== "string" || who === "" || typeof tool !== "string" || tool === "") {
    return null;
  }
  if (typeof args !== "string" || args.length > ARGS || !Number.isFinite(made) || !Number.isFinite(until)) {
    return null;
  }
  if ((boss !== undefined && typeof boss !== "string") || (reason !== undefined && typeof reason !== "string")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(args);
  } catch {
    return null;
  }
  if (canon(parsed) !== args || o.fp !== fp(who, tool, parsed)) {
    return null;
  }
  const p: Pending = { id: id as number, kind: kind as Kind, who, tool, args, fp: o.fp, made: made as number, until: until as number, state: state as State };
  if (boss !== undefined) {
    p.boss = boss;
  }
  if (reason !== undefined) {
    p.reason = reason;
  }
  return p;
}

// a restart: an open consent past `until` expired; an open appeal cut (its
// boss's wait died with the process)
export function restart(list: Pending[], now: number): Pending[] {
  return list.map((p): Pending => p.state !== "open" ? p
    : p.kind === "appeal" ? { ...p, state: "cut" }
    : p.until <= now ? { ...p, state: "expired" }
    : p);
}

// the list kept: every open record, then the newest closed ones, PENDS in all
export function keep(list: Pending[]): Pending[] {
  const open = list.filter((p) => p.state === "open").slice(-PENDS);
  const closed = list.filter((p) => p.state !== "open").sort((a, b) => b.made - a.made).slice(0, PENDS - open.length);
  const kept = new Set([...open, ...closed]);
  return list.filter((p) => kept.has(p));
}

// the user's live yes to record p: a grant for its fp till now + GRANT_MS;
// the fp hashed anew from the record's own fields
export function grant(grants: Map<string, Grant>, p: Pending, now: number): void {
  grants.set(fp(p.who, p.tool, JSON.parse(p.args)), { who: p.who, until: now + GRANT_MS });
}

// true once: a grant for this who, tool and args, live; it is used up
export function take(grants: Map<string, Grant>, who: string, tool: string, args: unknown, now: number): boolean {
  const key = fp(who, tool, args);
  const g = grants.get(key);
  if (g === undefined) {
    return false;
  }
  grants.delete(key);
  return g.who === who && now < g.until;
}
