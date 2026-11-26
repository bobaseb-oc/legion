// Routines
// ========
// The cockpit's routines (Herdr's Routines and inbox automations): a task
// a native Legion agent is started on, by the user's leave, daily at a
// time (the server's local time), every N hours, or for each new review
// request of the user's (Server.ts Chat.inboxed). The server keeps them
// with the chat (view.json) and its tick runs those due (Chat.ticked),
// a chat with one on by the clock kept open with no view (timed);
// this is the pure part: what a routine may say, when it's due, how the
// terminal's /routine add reads one.

// weekly: day 0 Sunday … 6 Saturday (Date.getDay)
export type When = { $: "daily"; at: string } | { $: "weekly"; day: number; at: string } | { $: "every"; hours: number } | { $: "review" };

// a routine: its number, name, task, when (it starts a worker), whether on,
// when it last ran and was made (ms), the review requests it has seen
// by, why: the agent that proposed it (the routine tool) and its reason;
// none, the user's own
export type Routine = {
  id: number; name: string; task: string; when: When; on: boolean;
  last: number | null; made: number; seen?: string[]; by?: string; why?: string;
};

// what the user gives for one
export type Given = { name: string; task: string; when: When };

// the most routines a chat keeps; a name's and a task's most characters;
// the most hours between runs (a week)
export const MOST = 20;
export const NAME = 80;
export const TASK = 4000;
export const HOURS = 168;

const DAY = 86400e3;

// a routine as given, checked: kept trimmed and cut, or why not (a tier
// given, as one kept from before managers went has, is dropped)
export function routine_check(x: any): Given | string {
  if (typeof x !== "object" || x === null) {
    return "A routine needs a name, a task and a when.";
  }
  const name = typeof x.name === "string" ? x.name.trim().replace(/\s+/g, " ").slice(0, NAME) : "";
  const task = typeof x.task === "string" ? x.task.trim().slice(0, TASK) : "";
  const w = x.when;
  const hhmm = typeof w?.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(w.at);
  const when: When | null =
    w?.$ === "daily" && hhmm ? { $: "daily", at: w.at }
    : w?.$ === "weekly" && hhmm && Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 ? { $: "weekly", day: w.day, at: w.at }
    : w?.$ === "every" && Number.isInteger(w.hours) && w.hours >= 1 && w.hours <= HOURS ? { $: "every", hours: w.hours }
    : w?.$ === "review" ? { $: "review" }
    : null;
  if (name === "") {
    return "A routine needs a name.";
  }
  if (when === null) {
    return "A routine runs daily at HH:MM, weekly on a day at HH:MM, every 1 to " + HOURS + " hours, or on each new review request.";
  }
  if (task === "" && when.$ !== "review") {
    return "A routine needs a task.";
  }
  return { name, task, when };
}

// when a routine is next due by the clock (ms; null: never, a review
// routine's): daily, today's time if it hasn't run since and it was made
// before, else tomorrow's; weekly, this week's day and time the same way,
// else a week on; every N hours, N after it last ran or was made
export function routine_next(r: Routine, now: number): number | null {
  const base = r.last ?? r.made;
  if (r.when.$ === "every") {
    return base + r.when.hours * 3600e3;
  }
  if (r.when.$ !== "daily" && r.when.$ !== "weekly") {
    return null;
  }
  const [h, m] = r.when.at.split(":").map(Number);
  const d = new Date(now);
  if (r.when.$ === "daily") {
    const today = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    return today > base ? today : today + DAY;
  }
  // the latest such day and time at or before now (local dates: DST-safe)
  const back = (d.getDay() - r.when.day + 7) % 7;
  let week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, h, m).getTime();
  if (week > now) {
    week = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back - 7, h, m).getTime();
  }
  if (week > base) {
    return week;
  }
  const on = new Date(week);
  return new Date(on.getFullYear(), on.getMonth(), on.getDate() + 7, h, m).getTime();
}

// whether a routine is on and due now
export function routine_due(r: Routine, now: number): boolean {
  const next = routine_next(r, now);
  return r.on && next !== null && next <= now;
}

// whether a chat must stay open with no view for its routines and timers
// (Server.ts Chat.free, Chat.wake): a routine on and by the clock (a
// review routine runs on an inbox, which only a connected device sends),
// or a timer pending
export function timed(routines: Routine[], timers: Timer[] = []): boolean {
  return timers.length > 0 || routines.some((r) => r.on && r.when.$ !== "review");
}

// Proposals
// ---------
// A routine an agent proposes (Tools.ts routine, RED ZONE: who may start
// unattended work): added off, marked by whom and why; only the user's
// own Turn on, from a view (Server.ts Chat.routine), starts it. By the
// clock only: a review routine reads PRs that may be an attacker's.

// a proposal's why, at most; the most proposals pending at once
export const WHY = 1000;
export const PROPOSALS = 3;

export function proposal_check(x: any): (Given & { why: string }) | string {
  const given = routine_check(x);
  if (typeof given === "string") {
    return given;
  }
  if (given.when.$ === "review") {
    return "A proposed routine runs by the clock: daily, weekly or every N hours.";
  }
  const why = typeof x.why === "string" ? x.why.trim().replace(/\s+/g, " ").slice(0, WHY) : "";
  return why === "" ? "A proposed routine needs a why: what the user gets from it." : { ...given, why };
}

// a proposal the user never turned on
export function pending(r: Routine): boolean {
  return r.by !== undefined && !r.on && r.last === null;
}

// Timers
// ------
// An agent's timer (Tools.ts timer): a note that wakes whoever set it,
// as a message "[Timer n] note", once its time comes (Server.ts
// Chat.ticked, every minute). Kept with the chat (view.json), so it
// survives a restart, and keeps the chat open with no view (timed).

export type Timer = { id: number; who: string; at: number; note: string; made: number };

// the most minutes ahead (a day); a note's most characters; the most
// timers a chat, and one agent, keeps
export const TIMER_MINUTES = 1440;
export const TIMER_NOTE = 500;
export const TIMERS = 20;
export const TIMERS_EACH = 5;

export function timer_check(x: any): { minutes: number; note: string } | string {
  const minutes = x?.minutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > TIMER_MINUTES) {
    return "A timer is whole minutes ahead, 1 to " + TIMER_MINUTES + " (a day).";
  }
  const note = typeof x.note === "string" ? x.note.trim().replace(/\s+/g, " ").slice(0, TIMER_NOTE) : "";
  return note === "" ? "A timer needs a note: what to do when it wakes you." : { minutes, note };
}

// the timers whose time came, soonest first
export function timers_due(timers: Timer[], now: number): Timer[] {
  return timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function when_text(w: When): string {
  return w.$ === "daily" ? "daily at " + w.at : w.$ === "weekly" ? DAYS[w.day] + "s at " + w.at : w.$ === "every" ? (w.hours === 1 ? "every hour" : "every " + w.hours + " hours") : "on each new review request";
}

// the terminal's `/routine add daily HH:MM | weekly DAY HH:MM | every Nh | on review
// <name>: <task>` (a review routine: a name, no task needed)
export function routine_parse(arg: string): Given | string {
  const m = /^(?:daily\s+(\d\d:\d\d)|weekly\s+([a-z]+)\s+(\d\d:\d\d)|every\s+(\d+)\s*h|on\s+review)\s+(.+)$/si.exec(arg.trim());
  const usage = "Use /routine add daily HH:MM | weekly DAY HH:MM | every Nh | on review, then name: task.";
  // a day: its name or a start of it, 3 letters at least (fri, Friday)
  const day = m?.[2] === undefined ? -1 : DAYS.findIndex((d) => m[2].length >= 3 && d.toLowerCase().startsWith(m[2].toLowerCase()));
  if (m === null || (m[2] !== undefined && day < 0)) {
    return usage;
  }
  const when: When = m[1] !== undefined ? { $: "daily", at: m[1] } : m[3] !== undefined ? { $: "weekly", day, at: m[3] } : m[4] !== undefined ? { $: "every", hours: Number(m[4]) } : { $: "review" };
  const rest = m[5];
  const colon = rest.indexOf(":");
  if (colon < 0 && when.$ !== "review") {
    return usage;
  }
  const given = { name: colon < 0 ? rest : rest.slice(0, colon), task: colon < 0 ? "" : rest.slice(colon + 1), when };
  return routine_check(given);
}
