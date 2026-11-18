// Cockpit
// =======
// The cockpit's pages (Herdr's) as the views work them out, before any
// markup (web/src/Pages.ts draws them): the inbox's sections and rows,
// filtered, and what changed since the user looked.

import type { Clean, DigestPr, Inbox, Note, Pr, Ticket } from "./Inbox.ts";
import type { Given } from "./Routines.ts";
import { explain_ago } from "./Explain.ts";
import { MAIN, minute, view_needs, view_notes, view_questions, type Act, type Assignment, type Crew, type Deck, type Draft, type Mark, type View } from "./View.ts";

// a row: its key (a link, a path), its kind, what it says, under it (repo#n,
// a ticket's status), a tag and its tone, its age; what it is
export type Row = {
  key: string; kind: "pr" | "ticket" | "clean" | "note" | "agent"; title: string; sub: string; url: string;
  tag: string; tone: "bad" | "warn" | "ok" | ""; age: string; stamp: string; old?: boolean;
  pr?: Pr; ticket?: Ticket; clean?: Clean; note?: Note; agent?: string;
};

// a section of the inbox: its id, title, rows counted, a line under its
// title, a word in place of rows (Jira not read)
export type SectionId = "alerts" | "reviews" | "mine" | "tickets" | "clean";
export type Section = { id: SectionId; title: string; count: number; sub: string; rows: Row[]; note?: string };

const DAY = 86400e3;
// a review request older than this is folded apart (Herdr's "older than
// 60 days"); the user's own PRs never are
export const OLD = 60 * DAY;

// a span as the inbox says it: 45s, 58m, 5h, 5d
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m" : s < 86400 ? Math.floor(s / 3600) + "h" : Math.floor(s / 86400) + "d";
}

const TAGS: Record<Pr["state"], [string, Row["tone"]]> = {
  failing   : ["Failing", "bad"],
  blocked   : ["Blocked: needs an approving review", "warn"],
  ready     : ["Ready to merge", "ok"],
  conflicts : ["Conflicts: resolve them first", "bad"],
  draft     : ["Draft: mark it ready for review", ""],
  pending   : ["Checks running", ""],
  changes   : ["Changes requested", "warn"],
};

function since(at: string, now: number): string {
  const t = Date.parse(at);
  return Number.isNaN(t) ? "" : age(now - t);
}

function pr_row(p: Pr, now: number): Row {
  const [tag, tone] = TAGS[p.state];
  const failing = p.state === "failing" && p.failing.length > 0 ? tag + ": " + p.failing.join(", ") : tag;
  const t = Date.parse(p.updated);
  return {
    key: p.url, kind: "pr", title: p.title, sub: p.repo + "#" + p.number, url: p.url, tag: failing, tone,
    age: since(p.updated, now), stamp: p.updated, old: !Number.isNaN(t) && now - t > OLD, pr: p,
  };
}

function plural(n: number, one: string, many = one + "s"): string {
  return n + " " + (n === 1 ? one : many);
}

// whether a row holds the filter (any case): its title, under it, its
// branch, its ticket's key
function holds(r: Row, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (f === "") {
    return true;
  }
  return [r.title, r.sub, r.pr?.branch ?? "", r.pr?.author ?? "", r.ticket?.key ?? "", r.clean?.branch ?? "", r.tag].some((x) => x.toLowerCase().includes(f));
}

// the inbox's sections, in Herdr's order; none read yet: none
export function inbox_sections(inbox: Inbox | null, crew: Crew[], filter: string, now: number): Section[] {
  if (inbox === null) {
    return [];
  }
  const failed = crew.filter((c) => c.status === "failed").map((c): Row => ({
    key: "agent:" + c.name, kind: "agent", title: (c.title ?? c.name) + " failed", sub: c.name, url: "", tag: "Agent failed", tone: "bad",
    age: age(now - c.since), stamp: String(c.since), agent: c.name,
  }));
  const red = inbox.mine.filter((p) => p.state === "failing").map((p): Row => ({ ...pr_row(p, now), key: "alert:" + p.url, title: "Failing: " + p.title }));
  const notes = inbox.notes.filter((n) => n.kind === "ci" || n.kind === "security").map((n): Row => ({
    key: "note:" + n.url + n.at, kind: "note", title: n.title, sub: n.repo, url: n.url, tag: n.kind === "ci" ? "CI" : "Security", tone: "bad",
    age: since(n.at, now), stamp: n.at, note: n,
  }));
  const reviews = inbox.reviews.map((p) => pr_row(p, now));
  const you = inbox.reviews.filter((p) => p.you).length;
  const bots = inbox.reviews.filter((p) => p.bot).length;
  const tickets = (inbox.tickets ?? []).map((t): Row => ({
    key: "ticket:" + t.key, kind: "ticket", title: t.key + " " + t.title, sub: t.status + (t.priority ? " · " + t.priority : ""), url: t.url,
    tag: t.status, tone: "", age: since(t.updated, now), stamp: t.updated, ticket: t,
  }));
  const clean = inbox.clean.map((c): Row => {
    const where = c.repo + " " + (c.branch ?? "(detached)");
    const title = c.changes > 0 ? plural(c.changes, "uncommitted change") + " in " + (c.merged ? "merged " : "") + where : "worktree of merged " + where + ": nothing left in it";
    return { key: "clean:" + c.path, kind: "clean", title, sub: c.path, url: "", tag: c.merged ? "Merged" : "Uncommitted", tone: c.changes > 0 ? "warn" : "", age: "", stamp: String(c.changes), clean: c };
  });
  const section = (id: SectionId, title: string, rows: Row[], sub = "", note?: string): Section => {
    const kept = rows.filter((r) => holds(r, filter));
    return note === undefined ? { id, title, count: kept.length, sub, rows: kept } : { id, title, count: kept.length, sub, rows: kept, note };
  };
  const jira = inbox.tickets === null ? inbox.errors.find((e) => e.startsWith("acli")) ?? "Jira isn't read on this device (acli)." : undefined;
  return [
    section("alerts", "Alerts", [...failed, ...red, ...notes]),
    section("reviews", "Reviews", reviews, you + " for you · " + (inbox.reviews.length - you - bots) + " team · " + plural(bots, "bot")),
    section("mine", "Your PRs", inbox.mine.map((p) => ({ ...pr_row(p, now), old: false }))),
    section("tickets", "Tickets", tickets, "", jira),
    section("clean", "To clean up", clean),
  ];
}

// the stamps a look leaves: each row's key, its last change
export function inbox_seen(sections: Section[]): Record<string, string> {
  return Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.key, r.stamp]));
}

// the rows new or changed since the stamps (none kept: the first look,
// nothing called changed)
export function inbox_changed(sections: Section[], seen: Record<string, string> | null): number {
  if (seen === null) {
    return 0;
  }
  return sections.flatMap((s) => s.rows).filter((r) => seen[r.key] !== r.stamp).length;
}

// the inbox's count (its link's badge): review requests for the user, and
// their PRs that fail, conflict or had changes asked
export function inbox_badge(inbox: Inbox | null): number {
  if (inbox === null) {
    return 0;
  }
  return inbox.reviews.filter((p) => p.you).length + inbox.mine.filter((p) => FIX.includes(p.state)).length;
}

// Home
// ====
// Herdr's digest: a greeting, who needs the user, the stat cards, Unii's
// own agents as cards (working, then done), the apps' lines, the
// activity. An agent's cost is an estimate at list price (Tools.spent).

// the greeting by the local hour
export function home_greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// what needs the user: agents asking or failed, open questions, calls
// waiting, a plan to approve
function needing(v: View): number {
  return view_needs(v).length + view_questions(v).length + (v.calls ?? []).length + (v.plan ? 1 : 0);
}

// "3 need you · 2 working"
export function home_line(v: View): string {
  const need = needing(v);
  const working = v.crew.filter((c) => c.status === "working").length;
  return (need === 0 ? "no agent needs you" : need + " need you") + " · " + working + " working";
}

// a stat card: what, its number, under it, where a click goes
export type Stat = { label: string; value: string; sub: string; href: string };

const usd = (x: number) => "$" + x.toFixed(2);

export function home_stats(v: View): Stat[] {
  const crew = v.crew;
  const inbox = v.inbox;
  const working = crew.filter((c) => c.status === "working" || c.status === "waiting" || c.status === "asking").length;
  const you = inbox?.reviews.filter((p) => p.you).length ?? 0;
  const fix = inbox?.mine.filter((p) => FIX.includes(p.state)).length ?? 0;
  const week = v.status?.week ?? null;
  const today = v.status?.spend ?? null;
  return [
    { label: "Agents", value: String(crew.length), sub: working + " working · " + (crew.length - working) + " done", href: "#crew" },
    { label: "Reviews for you", value: inbox === null ? "–" : String(you), sub: inbox === null ? "" : inbox.reviews.length - you + " for your team", href: "#inbox" },
    { label: "Your PRs", value: inbox === null ? "–" : String(inbox.mine.length), sub: inbox === null ? "" : fix + " to fix", href: "#inbox" },
    { label: "Merged this week", value: inbox === null ? "–" : String(inbox.merged), sub: inbox === null ? "" : inbox.today + " today", href: "#digest" },
    { label: "Agent spend", value: week === null ? "–" : usd(week), sub: today === null ? "" : usd(today) + " today", href: "#home" },
  ];
}

// a PR's states that ask for a fix
export const FIX = ["failing", "conflicts", "changes"];

// a ticket key in a text (AO-10852), or none
export function ticket_of(text: string): string | null {
  return /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.exec(text)?.[0] ?? null;
}

// an agent's card: its name, title, first repo, ticket, PR, estimated
// cost, age, status, how many agents under it
export type Card = { name: string; title: string; repo: string | null; ticket: string | null; pr: string | null; cost: string; age: string; status: Crew["status"]; under: number };

// Unii's own agents (the crew's top), working (or waiting, asking) first,
// then done (done, stopped, failed)
export function home_cards(v: View, now: number): { working: Card[]; done: Card[] } {
  const top = v.crew.filter((c) => c.parent === "main");
  const under = (name: string): number => v.crew.filter((c) => c.parent === name).reduce((n, c) => n + 1 + under(c.name), 0);
  const card = (c: Crew): Card => {
    const title = c.title ?? c.name;
    return {
      name: c.name, title, repo: c.repos?.[0] ?? null, ticket: ticket_of(title), pr: /#(\d+)\b/.exec(title)?.[0] ?? null,
      cost: c.spent === undefined ? "" : "≈" + usd(c.spent), age: c.since === 0 ? "" : age(now - c.since), status: c.status, under: under(c.name),
    };
  };
  const live = (c: Crew) => c.status === "working" || c.status === "waiting" || c.status === "asking";
  return { working: top.filter(live).map(card), done: top.filter((c) => !live(c)).map(card) };
}

// the apps' lines: the inbox's (PRs failing), the questions', the routines'
export function home_apps(v: View): { inbox: string; questions: string; routines: string } {
  const routines = (v.routines ?? []).filter((r) => r.on).length;
  const failing = v.inbox?.mine.filter((p) => p.state === "failing").length ?? 0;
  const open = view_questions(v).length;
  return {
    inbox: v.inbox === null ? "not read yet" : failing === 0 ? "nothing failing" : failing + " PR" + (failing === 1 ? "" : "s") + " failing",
    questions: open === 0 ? "none open" : open + " open",
    routines: routines === 0 ? "none scheduled" : routines + " scheduled",
  };
}

// the inbox's notifications, newest first, the 12 last
export function home_activity(v: View): Note[] {
  return [...(v.inbox?.notes ?? [])].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
}

// While you were away
// ===================
// Home's card when the user comes back: what happened since their last
// look (main.ts keeps it in the browser, kept("away-seen")), worked out
// here from the view, no model asked. Questions and notes only counted:
// their text is the Questions pane's.

// away this long, the card shows; the most agents (and routines) it lists
export const AWAY = 2 * 3600e3;
export const AWAY_LIST = 5;

// a look: when, each agent's status then
export type Seen = { at: number; crew: Record<string, Crew["status"]> };
// an agent done or failed since (why: its report's last line, if told)
export type AwayAgent = { name: string; title: string; status: "done" | "failed"; why: string };
// how long away; the agents (failed first, capped; more: the rest), how
// many done and failed; the routines run; new open questions, new notes
// and the inbox's rows changed, counted
export type Away = { span: string; agents: AwayAgent[]; more: number; done: number; failed: number; routines: string[]; questions: number; notes: number; inbox: number };

// the look the user leaves now
export function away_seen(v: View, now: number): Seen {
  return { at: now, crew: Object.fromEntries(v.crew.map((c) => [c.name, c.status])) };
}

// what happened since the look (none kept, the first look; or away less
// than AWAY; or nothing: none): Unii's own agents done, any agent failed,
// each only if not so at the look; inbox: the rows changed (inbox_changed)
export function away(v: View, seen: Seen | null, now: number, inbox = 0): Away | null {
  if (seen === null || now - seen.at < AWAY) {
    return null;
  }
  const fresh = (c: Crew) => seen.crew[c.name] !== c.status;
  const why = (c: Crew) => (v.pulses.get(c.name)?.last ?? "").split("\n")[0].trim();
  const failed = v.crew.filter((c) => c.status === "failed" && fresh(c)).map((c): AwayAgent => ({ name: c.name, title: c.title ?? c.name, status: "failed", why: why(c) }));
  const done = v.crew.filter((c) => c.status === "done" && c.parent === "main" && fresh(c)).map((c): AwayAgent => ({ name: c.name, title: c.title ?? c.name, status: "done", why: "" }));
  const agents = [...failed, ...done];
  const ran = (v.routines ?? []).filter((r) => r.last !== null && r.last > seen.at).map((r) => r.name);
  const after = (q: { date: string }) => Date.parse(q.date) > seen.at;
  const questions = view_questions(v).filter(after).length;
  const notes = view_notes(v).filter(after).length;
  if (agents.length + ran.length + questions + notes + inbox === 0) {
    return null;
  }
  return {
    span: age(now - seen.at), agents: agents.slice(0, AWAY_LIST), more: Math.max(0, agents.length - AWAY_LIST), done: done.length, failed: failed.length,
    routines: ran.slice(0, AWAY_LIST), questions, notes, inbox,
  };
}

// Sidebar, bar, palette
// =====================

// a group of the sidebar's agents: their ticket (null: none), them
// The terminal's home
// ===================
// Home and its away card as text, for Term.ts (/home, and on coming back
// to the terminal): the same pieces as Pages.ts draws.

export const MARK: Record<Crew["status"], string> = { asking: "?", failed: "✗", working: "●", waiting: "◐", stopped: "■", done: "✓" };

// a card on one line, as the terminal shows it (/home, the deck's home)
export function card_text(c: Card): string {
  return [MARK[c.status] + " " + c.name, c.title === c.name ? "" : c.title, c.repo, c.ticket, c.pr, c.cost, c.age, c.under === 0 ? "" : c.under + " under it"]
    .filter((x) => x !== null && x !== "").join(" · ");
}

// the stat cards on one line
export function stats_text(v: View): string {
  return home_stats(v).map((s) => s.label + " " + s.value + (s.sub === "" ? "" : " (" + s.sub + ")")).join(" · ");
}

export function home_text(v: View, now: Date): string {
  const { working, done } = home_cards(v, now.getTime());
  const group = (head: string, cards: Card[]) => cards.length === 0 ? [] : [head, ...cards.map(card_text)];
  const empty = working.length + done.length === 0 ? ["No agents yet: tell Legion what to do, or /agent <task>."] : [];
  return [
    home_greeting(now) + ". " + home_line(v),
    stats_text(v),
    ...group("Working (" + working.length + "):", working),
    ...group("Done (" + done.length + "), /archive all takes them:", done),
    ...empty,
  ].join("\n");
}

export function away_text(a: Away): string {
  const counts = [a.done === 0 ? "" : a.done + " done", a.failed === 0 ? "" : a.failed + " failed"].filter((x) => x !== "");
  const agent = (x: AwayAgent) => [MARK[x.status] + " " + x.name, x.title === x.name ? "" : x.title, x.why].filter((s) => s !== "").join(" · ");
  const asked = [a.questions === 0 ? "" : plural(a.questions, "new question"), a.notes === 0 ? "" : plural(a.notes, "new note")].filter((x) => x !== "");
  return [
    "While you were away (" + [a.span, ...counts].join(" · ") + "):",
    ...a.agents.map(agent),
    ...(a.more === 0 ? [] : ["+" + a.more + " more: /crew"]),
    ...(a.routines.length === 0 ? [] : ["Routines ran: " + a.routines.join(", ")]),
    ...(asked.length === 0 ? [] : [asked.join(" · ") + ": /questions"]),
    ...(a.inbox === 0 ? [] : [plural(a.inbox, "inbox change") + ": /inbox"]),
  ].join("\n");
}

// /archive [name|all]: home's done agents, as its Archive buttons
export function archive_cmd(v: View, arg: string, now: number): Act | string {
  const { working, done } = home_cards(v, now);
  const name = arg.trim();
  if (name === "" || name === "all") {
    return done.length === 0 ? "Nothing done to archive." : { $: "Archive", names: done.map((c) => c.name) };
  }
  if (working.some((c) => c.name === name)) {
    return name + " is at work: /stop " + name + " first, or wait till it is done.";
  }
  return done.some((c) => c.name === name) ? { $: "Archive", names: [name] } : "No agent " + name + " on home: /home lists them.";
}

// the inbox's rows, numbered as the terminal shows them (unfiltered, so a
// filter keeps each row's number), with their section
function inbox_numbered(v: View, now: number): { n: number; s: SectionId; r: Row }[] {
  return inbox_sections(v.inbox, v.crew, "", now).flatMap((s) => s.rows.map((r) => ({ s: s.id, r }))).map((x, k) => ({ n: k + 1, ...x }));
}

// /inbox [words]: the inbox page as text; changed: rows changed since the
// terminal last showed it (inbox_changed)
export function inbox_text(v: View, filter: string, now: number, changed: number): string {
  const inbox = v.inbox;
  if (inbox === null) {
    return "No device has read the inbox yet: a terminal (legion) or legion device reads it with your gh, acli and git. /refresh asks again.";
  }
  const number = new Map(inbox_numbered(v, now).map((x) => [x.s + " " + x.r.key, x.n]));
  const row = (s: Section, r: Row) => "  " + number.get(s.id + " " + r.key) + ". " + [r.sub + " " + r.title, r.tag, r.age, r.old ? "older than 60 days" : ""].filter((x) => x !== "").join(" · ");
  const shown = inbox_sections(inbox, v.crew, filter, now).filter((s) => s.count > 0 || s.note !== undefined);
  const section = (s: Section) => [s.title + " (" + s.count + ")" + (s.sub === "" ? "" : " · " + s.sub) + ":", ...(s.note === undefined ? [] : ["  " + s.note]), ...s.rows.map((r) => row(s, r))];
  return [
    "Inbox · updated " + minute(new Date(inbox.at).toISOString()) + " · " + changed + " changed since you looked",
    ...inbox.errors.filter((e) => !e.startsWith("acli")),
    ...shown.flatMap(section),
    ...(shown.length === 0 ? [filter.trim() === "" ? "Nothing in the inbox." : "No row holds “" + filter.trim() + "”."] : []),
    "/review <n…>, /fix <n…> (add claude: as Claude Code workers), /refresh; /inbox <words> filters.",
  ].join("\n");
}

// the picked rows' acts (the web's picked panel, the terminal deck's r
// and f): each PR picked once (picks: rows' keys, in the order picked),
// reviewed if picked as a review request, fixed if picked as the user's
// to fix; always by the PR's own URL (an Alerts row's key is not one)
export function picks_acts(sections: Section[], picks: Set<string>, claude: boolean): { picked: Row[]; review: Act | null; fix: Act | null } {
  const rows = sections.flatMap((s) => s.rows.filter((r) => r.pr !== undefined).map((r) => ({ s: s.id, r, url: r.pr!.url })));
  const urls = [...new Set([...picks].flatMap((k) => rows.filter((x) => x.r.key === k).map((x) => x.url)))];
  const as = (u: string, ok: (x: (typeof rows)[number]) => boolean) => rows.some((x) => x.url === u && picks.has(x.r.key) && ok(x));
  const act = (prs: string[], how: "review" | "fix"): Act | null => prs.length === 0 ? null : claude ? { $: "Review", prs, how, claude: true } : { $: "Review", prs, how };
  return {
    picked: urls.map((u) => rows.find((x) => x.url === u)!.r),
    review: act(urls.filter((u) => as(u, (x) => x.s === "reviews")), "review"),
    fix: act(urls.filter((u) => as(u, (x) => x.s !== "reviews" && FIX.includes(x.r.pr!.state))), "fix"),
  };
}

// /review <n…> [claude], /fix <n…> [claude]: as the inbox's Review (a
// review request) and Fix (the user's PR failing, in conflict, changes
// asked) buttons, each PR to its own Legion agent
export function review_cmd(v: View, how: "review" | "fix", arg: string, now: number): Act | string {
  const words = arg.trim().split(/\s+/).filter((w) => w !== "");
  const claude = words.includes("claude");
  const ns = words.filter((w) => w !== "claude");
  if (ns.length === 0) {
    return "Which? /" + how + " <n…>, as /inbox numbers them.";
  }
  const rows = inbox_numbered(v, now);
  const fits = (x: { s: SectionId; r: Row }) => x.r.pr !== undefined && (how === "review" ? x.s === "reviews" : (x.s === "mine" || x.s === "alerts") && FIX.includes(x.r.pr.state));
  const prs: string[] = [];
  for (const n of ns) {
    const x = rows.find((y) => String(y.n) === n);
    if (x === undefined || !fits(x)) {
      return how === "review" ? "Nothing to review in " + n + ": /review takes review requests (/inbox numbers them)."
        : "Nothing to fix in " + n + ": /fix takes your PRs failing, in conflict or with changes asked (/inbox numbers them).";
    }
    prs.push(x.r.pr!.url);
  }
  const unique = [...new Set(prs)];
  return claude ? { $: "Review", prs: unique, how, claude: true } : { $: "Review", prs: unique, how };
}

// /digest: the team's week, as the Digest page
export function digest_text(v: View): string {
  const d = v.inbox?.digest ?? null;
  if (d === null) {
    return "No digest yet: a device reads it from your spaces' GitHub repos (UNII_SPACES on the device, else its home repo). /refresh asks again.";
  }
  const pr = (p: DigestPr) => p.title + " #" + p.number;
  const merged = digest_groups(d.merged).map((g) => "  " + g.author + ": " + ((v.themes?.[g.author] ?? []).length > 0 ? v.themes![g.author]!.join("; ") : g.prs.map(pr).join("; ")));
  const open = digest_groups(d.open).map((g) => "  " + g.author + ": " + g.prs.map(pr).join("; "));
  return [
    d.repos.join(", ") + ": last 7 days · " + d.merged.length + " merged · " + d.open.length + " open",
    "Merged:", ...(merged.length === 0 ? ["  Nothing merged this week."] : merged),
    "In progress:", ...(open.length === 0 ? ["  Nothing open."] : open),
    "/themes summarizes by theme (one call to the compactor's model); /refresh reads it anew.",
  ].join("\n");
}

// /transcripts: the recorded calls of the last 14 days, numbered
export function transcripts_text(v: View): string {
  const g = v.inbox?.google ?? null;
  if (g === null) {
    return (v.inbox?.errors.find((e) => e.startsWith("google:")) ?? "google: run legion google-login on your device").replace(/^google: /, "Google: ");
  }
  if (g.docs.length === 0) {
    return "No transcripts in the last 14 days.";
  }
  const doc = (d: (typeof g.docs)[number], k: number) => "  " + (k + 1) + ". " + minute(d.at) + " · " + d.title + (v.summaries.has(d.id) ? " · summarized" : "");
  return ["Transcripts, last 14 days:", ...g.docs.map(doc), "/transcript <n> summarizes one (its text goes to the compactor's model, once)."].join("\n");
}

// /transcript <n>: its summary if made, else the act asking for it
export function transcript_cmd(v: View, arg: string): Act | string {
  const d = v.inbox?.google?.docs[Number(arg.trim()) - 1];
  if (d === undefined || !/^\d+$/.test(arg.trim())) {
    return "No transcript " + arg.trim() + ": /transcripts lists them.";
  }
  const s = v.summaries.get(d.id);
  return s === undefined ? { $: "Transcript", id: d.id } : d.title + ":\n" + s.text + (d.url === "" ? "" : "\nFull transcript: " + d.url);
}

// the routine that drafts the timesheet on Friday mornings (the user's
// rule, 2026-11-13; offered on the Timesheet page and by /timesheet
// weekly): a native worker reads the week's harvest, calendar, PRs,
// commits and tickets, and files drafts for Monday to Friday; only the
// user submits them
export const TIMESHEET_ROUTINE: Given = {
  name: "Timesheet drafts",
  task: "Draft this week's Harvest timesheet, Monday to Friday, for the user's review. Read harvest projects and this week's harvest entries (don't draft time already logged); read this week's calendar (google calendar), their merged and open PRs and this week's commits in their spaces, and their Jira tickets in progress. Map each piece of work to one of their Harvest projects and tasks by id, in hundredths of an hour, a day at most 8 hours unless the calendar shows more; for today, draft only what the evidence shows so far. File them with timesheet (each with its date, notes as the user would write them and why: the evidence). Skip days with no evidence. Then say in a line what you drafted, by day.",
  when: { $: "weekly", day: 5, at: "09:00" },
  tier: "worker",
};

const draft_open = (d: Draft) => d.state === "draft" || d.state === "failed";

// Todo
// ====
// What agents need the user to do (Tools.assign), as the Todo page lists
// them: each its number, text, who filed it (Legion's: MAIN) and when

export function todo_who(a: Assignment): string {
  return a.by === "main" ? MAIN : a.by;
}

export function todo_line(a: Assignment): string {
  return a.n + ". " + a.text + " · by " + todo_who(a) + " · " + minute(a.date);
}

// the Todo page with none open (web, deck, /todos)
export const TODO_NONE = "Nothing to do: agents put here what only you can do (approve a PR, run a login, send something).";

// /todos: the open todos, oldest first, and how to tick them
export function todo_text(v: View): string {
  const all = v.assigned ?? [];
  if (all.length === 0) {
    return TODO_NONE;
  }
  return ["Your todos (" + all.length + "):", ...all.map(todo_line), "/todos done <n> when it is done (its agent hears it), drop <n> if it isn't yours to do."].join("\n");
}

// /todos done <n> | drop <n>: the page's Done and Drop
export function todo_cmd(v: View, arg: string): Act | string {
  const [verb, n] = arg.trim().split(/\s+/);
  if ((verb !== "done" && verb !== "drop") || !/^\d+$/.test(n ?? "")) {
    return "/todos done <n> or /todos drop <n>, as /todos numbers them.";
  }
  const a = (v.assigned ?? []).find((x) => x.n === Number(n));
  return a === undefined ? "No todo " + n + ": /todos lists them." : { $: "Assignment", n: a.n, done: verb === "done" };
}

// Explain
// =======
// What the crew is building, for a manager (Explain.ts): /explain and the
// deck's Explain page show the observer's cards and the questions asked

export const EXPLAIN_NONE = "Nothing being built right now: once the crew works, an observer writes here what it builds and why.";

// /explain: when written, each card, then the questions and answers
export function explain_text(v: View, now: number): string {
  const ex = v.explain;
  if (ex === null || ex.at === null && !ex.writing) {
    return "Explain · not written yet: an observer writes here what the crew builds and why, once it works.\n/explain <question> asks about it (answered here, not in the chat).";
  }
  const cards = ex.cards.flatMap((c) => [c.title, "  What: " + c.what, "  Why: " + c.why, "  Status: " + c.status, "  Watch: " + c.watch, ""]);
  const qa = ex.qa.flatMap((x) => ["You: " + x.q, "  " + x.a, ""]);
  return [
    "Explain · " + explain_ago(ex, now) + (ex.error ? " · " + ex.error : ""), "",
    ...(cards.length === 0 ? [EXPLAIN_NONE, ""] : cards),
    ...(qa.length === 0 && ex.asking === null ? [] : ["Asked:", ...qa]),
    ...(ex.asking === null ? [] : ["You: " + ex.asking, "  answering…", ""]),
    "/explain <question> asks about it (answered here, not in the chat).",
  ].join("\n");
}

// /explain <question>: the page's box
export function explain_cmd(_v: View, arg: string): Act | string {
  const q = arg.trim();
  return q === "" ? "/explain <question>: ask about what the crew is building (answered on the Explain page, not in the chat)." : { $: "Explain", q };
}

// /timesheet: the drafts by day, newest first, as the Timesheet page
export function timesheet_text(v: View): string {
  const drafts = v.drafts ?? [];
  if (drafts.length === 0) {
    return "No drafts yet. Agents draft with the timesheet tool (they need legion harvest-login on your device): ask in the chat, or /timesheet weekly.";
  }
  const hours = (ds: Draft[]) => Math.round(ds.reduce((h, d) => h + d.hours, 0) * 100) / 100 + " h";
  const state = (d: Draft) => d.state === "sent" ? " · Harvest #" + (d.harvest ?? "") : d.state === "failed" ? " · failed: " + (d.error ?? "") : d.state === "sending" ? " · sending" : "";
  const row = (d: Draft) => "  " + d.n + ". " + d.hours + " h · " + d.project + " · " + d.task + " · " + d.notes + " · " + d.why + " · by " + d.by + state(d);
  const days = [...new Set(drafts.map((d) => d.date))].sort().reverse();
  const open = drafts.filter(draft_open).length;
  return [
    "Timesheet drafts (nothing is sent until you submit):",
    ...days.flatMap((day) => [day + " · " + hours(drafts.filter((d) => d.date === day)), ...drafts.filter((d) => d.date === day).map(row)]),
    (open === 0 ? "Nothing open to submit" : "/timesheet submit sends the " + open + " open to Harvest") + "; drop <n>; weekly drafts every Friday.",
  ].join("\n");
}

// /timesheet submit | drop <n> | weekly: the page's Submit (exactly the
// open drafts, as its button), ×, and its routine button
export function timesheet_cmd(v: View, arg: string): Act | string {
  const [verb, n] = arg.trim().split(/\s+/);
  const drafts = v.drafts ?? [];
  if (verb === "submit") {
    const ns = drafts.filter(draft_open).map((d) => d.n);
    return ns.length === 0 ? "No open drafts to submit." : { $: "Timesheet", op: "submit", ns };
  }
  if (verb === "drop") {
    const d = drafts.find((x) => String(x.n) === n);
    return d === undefined ? "No draft " + (n ?? "") + ": /timesheet lists them." : !draft_open(d) ? "Draft " + d.n + " is " + d.state + ": only open drafts drop." : { $: "Timesheet", op: "drop", ns: [d.n] };
  }
  if (verb === "weekly") {
    return (v.routines ?? []).some((r) => r.name === TIMESHEET_ROUTINE.name) ? "The weekly drafting routine is on already: /routines." : { $: "Routine", op: "add", routine: TIMESHEET_ROUTINE };
  }
  return timesheet_text(v);
}

// /lane: the agent page's timeline (View.view_lane), a mark a line
export function lane_text(name: string, marks: Mark[]): string {
  if (marks.length === 0) {
    return "Nothing on " + name + "'s timeline yet.";
  }
  return [name + "'s timeline:", ...marks.map((m) => "  " + new Date(m.t).toTimeString().slice(0, 5) + " " + m.kind + " · " + m.label)].join("\n");
}

export type SideAgent = { name: string; title: string; status: Crew["status"]; age: string; under: number };
export type SideGroup = { ticket: string | null; agents: SideAgent[] };

// Unii's own agents by the ticket in their title, in the order first
// seen; those with none last
export function side_groups(v: View, now: number): SideGroup[] {
  const { working, done } = home_cards(v, now);
  const groups = new Map<string | null, SideAgent[]>();
  for (const c of [...working, ...done].sort((a, b) => v.crew.findIndex((x) => x.name === a.name) - v.crew.findIndex((x) => x.name === b.name))) {
    const list = groups.get(c.ticket) ?? [];
    list.push({ name: c.name, title: c.title, status: c.status, age: c.age, under: c.under });
    groups.set(c.ticket, list);
  }
  const all = [...groups.entries()].map(([ticket, agents]) => ({ ticket, agents }));
  return [...all.filter((g) => g.ticket !== null), ...all.filter((g) => g.ticket === null)];
}

// a space: a repo, the agents on it, its worktrees to clean up
export type Space = { repo: string; agents: number; clean: number };

// the repos the crew, the inbox's worktrees and the device work in
export function side_spaces(v: View): Space[] {
  const repos: string[] = [];
  const add = (r: string) => r !== "" && !repos.includes(r) && repos.push(r);
  v.crew.forEach((c) => (c.repos ?? []).forEach(add));
  (v.inbox?.clean ?? []).forEach((c) => add(c.repo));
  (v.inbox?.spaces ?? []).forEach(add);
  if (v.status) {
    add(v.status.dir);
  }
  return repos.map((repo) => ({
    repo, agents: v.crew.filter((c) => (c.repos ?? []).includes(repo)).length, clean: (v.inbox?.clean ?? []).filter((c) => c.repo === repo).length,
  }));
}

// the bottom bar: "1 need you · 1 working · 1 ready · 2 done" (ready:
// waiting for a word)
export function bar_text(v: View): string {
  const n = (...s: Crew["status"][]) => v.crew.filter((c) => s.includes(c.status)).length;
  return needing(v) + " need you · " + n("working") + " working · " + n("waiting") + " ready · " + n("done", "stopped") + " done";
}

// a palette item: what it says, a hint, what choosing it does (a link, a
// page opened, an act)
export type Go = { href: string } | { open: string } | { act: Act } | { cmd: "new-agent" | "focus" } | { space: string };
export type Item = { label: string; hint: string; go: Go };

// g and a letter: the page it goes to, on the web (main.ts) and in the
// terminal's deck (Deck.ts)
export const CHORDS: Record<string, "chat" | "crew" | Deck> = {
  h: "home", i: "inbox", o: "todo", m: "chat", c: "crew", r: "routines", d: "digest", t: "transcripts", f: "files", s: "timesheet", p: "memory", x: "explain",
};

const PAGE_ITEMS: Item[] = [
  { label: "Home", hint: "page · g h", go: { href: "#home" } },
  { label: "Inbox", hint: "page · g i", go: { href: "#inbox" } },
  { label: "Todo", hint: "page · g o", go: { href: "#todo" } },
  { label: "Chat", hint: "page · g m", go: { href: "#chat" } },
  { label: "Crew", hint: "page · g c", go: { href: "#crew" } },
  { label: "Explain", hint: "page · g x", go: { href: "#explain" } },
  { label: "Routines", hint: "page · g r", go: { href: "#routines" } },
  { label: "Digest", hint: "page · g d", go: { href: "#digest" } },
  { label: "Transcripts", hint: "page · g t", go: { href: "#transcripts" } },
  { label: "Files", hint: "page · g f", go: { href: "#files" } },
  { label: "Timesheet", hint: "page · g s", go: { href: "#timesheet" } },
  { label: "Memory", hint: "page · g p · search, pins, the tree", go: { href: "#memory" } },
  { label: "New agent…", hint: "command · /agent", go: { cmd: "new-agent" } },
  { label: "Refresh the inbox", hint: "command", go: { act: { $: "Fetch" } } },
  { label: "Focus", hint: "command · hide the side columns", go: { cmd: "focus" } },
  { label: "Plan mode", hint: "command · only reading till a plan is approved", go: { act: { $: "Mode", mode: "plan" } } },
  { label: "Auto mode", hint: "command · a reviewer checks each change", go: { act: { $: "Mode", mode: "auto" } } },
  { label: "Full mode", hint: "command · hooks only", go: { act: { $: "Mode", mode: "full" } } },
];

// what the palette offers for the words typed: each word must be in the
// label or the hint (any case); labels that start with the first word first
export function palette(v: View, q: string): Item[] {
  const agents = v.crew.map((c): Item => ({ label: c.title ?? c.name, hint: "agent " + c.name + " · " + c.status, go: { href: "#crew/" + encodeURIComponent(c.name) } }));
  const prs = [...(v.inbox?.reviews ?? []), ...(v.inbox?.mine ?? [])].map((p): Item => ({ label: p.title, hint: p.repo + "#" + p.number + " · " + p.state, go: { open: p.url } }));
  const spaces = side_spaces(v).map((s): Item => ({ label: s.repo, hint: "space · a repo", go: { space: s.repo } }));
  const all = [...PAGE_ITEMS, ...agents, ...prs, ...spaces];
  const words = q.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) {
    return all;
  }
  const hits = all.filter((i) => words.every((w) => (i.label + " " + i.hint).toLowerCase().includes(w)));
  const starts = (i: Item) => i.label.toLowerCase().startsWith(words[0]);
  return [...hits.filter(starts), ...hits.filter((i) => !starts(i))];
}

// Digest
// ======

// PRs by author, the most first (then by name)
export function digest_groups(prs: DigestPr[]): { author: string; prs: DigestPr[] }[] {
  const by = new Map<string, DigestPr[]>();
  prs.forEach((p) => by.set(p.author, [...(by.get(p.author) ?? []), p]));
  return [...by.entries()].map(([author, list]) => ({ author, prs: list })).sort((a, b) => b.prs.length - a.prs.length || a.author.localeCompare(b.author));
}

// Up next (Google.ts, RED ZONE draft)
// ===================================

// today's and tomorrow's events not over yet, soonest first: its day and
// local time
export type Next = { title: string; day: "today" | "tomorrow"; time: string; meet: string; people: number };
export function up_next(v: View, now: number): Next[] {
  const today = new Date(now).toDateString();
  const p = (n: number) => String(n).padStart(2, "0");
  return (v.inbox?.google?.events ?? [])
    .filter((e) => Date.parse(e.end || e.start) > now)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((e) => {
      const d = new Date(e.start);
      return { title: e.title, day: d.toDateString() === today ? "today" : "tomorrow", time: e.start.length <= 10 ? "all day" : p(d.getHours()) + ":" + p(d.getMinutes()), meet: e.meet, people: e.people };
    });
}
