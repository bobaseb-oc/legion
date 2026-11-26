// Inbox
// =====
// The cockpit's inbox (Herdr's): what waits on the user in GitHub, Jira and
// their worktrees. A device reads it with the user's own CLIs, read-only
// (gh, acli, git: Device.device_inbox), so no token passes through Legion;
// these are the pure parts: the GitHub query and its reading, acli's and
// git's output read, and the server's check of a device's report (its
// shape, capped), which is all a view is shown.

// a PR's state, worst first: a draft; conflicts with its base; checks
// failing; checks running; changes asked; a review needed; ready to merge
export const STATES = ["draft", "conflicts", "failing", "pending", "changes", "blocked", "ready"] as const;
export type State = (typeof STATES)[number];

// a PR: where, what, by whom (bot: an app's), last change, its size, its
// branch, its state and failing checks' names, its body (cut), and, for a
// review request, whether it was asked of the user (else of a team)
export type Pr = {
  repo: string; number: number; title: string; url: string; author: string; bot: boolean; updated: string;
  add: number; del: number; files: number; branch: string; state: State; failing: string[]; body: string; you: boolean;
};

// a Jira work item assigned to the user (acli): its key, title, status,
// priority, last change, its page ("" unknown)
export type Ticket = { key: string; title: string; status: string; priority: string; updated: string; url: string };

// a worktree to clean up: uncommitted changes in it, or its branch merged
// or gone on origin (as of the repo's last fetch). For the tidy: its
// commits on no remote, its branch's stashes, its size (bytes) and last
// commit (ms), whether a process works in it, and safe, which only the
// server works out (inbox_safe). A field left out: not known
export type Clean = {
  repo: string; path: string; branch: string | null; changes: number; merged: boolean;
  gone?: boolean; unpushed?: number; stashes?: number; bytes?: number; at?: number; live?: boolean; safe?: boolean;
  squashed?: boolean; // its HEAD is exactly a merged PR's head (Device.device_squashes)
  envs?: string[]; // the .env files in it git can't give back (untracked, ignored too)
  why?: string; // not safe: why it is kept (inbox_why), the server's, never a device's
};

// RED ZONE (DRAFT awaiting the user's sign-off): a worktree may be removed
// only when its branch is merged or gone on origin, it has no change, no
// commit on no remote, no stash of its branch, and no process works in it.
// What isn't known counts against it (fail closed). RED ZONE (security
// review 4 D2, signed off by the user 2026-11-25): nor an untracked or
// ignored .env file in it (git status shows no ignored file; the remove
// deletes them with the dir)
export function inbox_safe(c: Clean): boolean {
  // a squash merge's own commits are on no remote: only with HEAD exactly
  // the merged PR's head do they not count
  return (c.merged || c.gone === true || c.squashed === true) && c.changes === 0 && (c.unpushed === 0 || c.squashed === true) && c.stashes === 0 && c.envs !== undefined && c.envs.length === 0 && c.live === false;
}

// a device's row checked: what it sent of the tidy's fields, then safe
// worked out here, never taken from the device
function clean_row(c: any): Clean {
  const row: Clean = { repo: str(c?.repo), path: str(c?.path), branch: c?.branch === null ? null : str(c?.branch), changes: num(c?.changes), merged: bool(c?.merged) };
  for (const k of ["unpushed", "stashes", "bytes", "at"] as const) {
    if (c?.[k] !== undefined) {
      row[k] = num(c[k]);
    }
  }
  for (const k of ["gone", "live", "squashed"] as const) {
    if (c?.[k] !== undefined) {
      row[k] = bool(c[k]);
    }
  }
  if (c?.envs !== undefined) {
    row.envs = list(c.envs, (e) => str(e, 200)).slice(0, 10);
  }
  const safe = inbox_safe(row);
  return safe ? { ...row, safe } : { ...row, safe, why: inbox_why(row) };
}

// why a worktree is kept, not removed (the inbox's Kept rows, and the
// device's re-check before a remove: Device.device_tidy_one)
export function inbox_why(c: Clean | undefined): string {
  if (c === undefined) {
    return "not a worktree to clean up now";
  }
  const why = [
    c.merged || c.gone === true || c.squashed === true ? "" : "its branch is neither merged nor gone",
    c.changes === 0 ? "" : "it has changes",
    c.unpushed === 0 || c.squashed === true ? "" : "it has commits on no remote (and its HEAD is no merged PR's head)",
    c.stashes === 0 ? "" : "its branch has stashes",
    c.envs === undefined ? "its .env files are not known" : c.envs.length === 0 ? "" : "it holds .env files git can't give back (" + c.envs.join(", ") + ")",
    c.live === false ? "" : "a process works in it",
  ].filter((w) => w !== "");
  return why.join(", ") || "not safe";
}

// a GitHub notification (activity; ci and security ones are alerts)
export const KINDS = ["review", "assign", "mention", "ci", "security", "other"] as const;
export type Note = { kind: (typeof KINDS)[number]; title: string; repo: string; url: string; at: string; unread: boolean };

// the team digest (Herdr's "last 7 days"): the spaces' GitHub repos, their
// PRs merged since a week ago and open now (at: merged, else opened)
export type DigestPr = { repo: string; number: number; title: string; url: string; author: string; at: string };
export type Digest = { repos: string[]; merged: DigestPr[]; open: DigestPr[] };

// a device's report: when (ms), whose (GitHub login), the review requests,
// the user's open PRs, how many merged this week and today, Jira's (null:
// acli missing or signed out), worktrees to clean, notifications, and what
// failed to be read, the team digest (null: no space on GitHub), the
// spaces (repos) active there
export type Inbox = {
  at: number; login: string; reviews: Pr[]; mine: Pr[]; merged: number; today: number;
  tickets: Ticket[] | null; clean: Clean[]; notes: Note[]; errors: string[]; digest?: Digest | null;
  spaces?: string[]; // the device's active repos, newest first (Device.device_discover)
  google?: { events: Event[]; docs: Doc[] } | null; // the user's calendar and transcripts (Google.ts; null: signed out or failing)
};

import type { Doc, Event } from "./Google.ts";

// the most kept of a list; a field's and a body's most characters
export const MOST = 100;
export const TEXT = 300;
export const BODY = 1200;

// the GitHub query: the user's login, review requests, open PRs (their
// checks, review, mergeability), and counts merged this week and today
export const QUERY = `query($reviews:String!,$mine:String!,$merged:String!,$today:String!){
  viewer{login}
  reviews: search(query:$reviews,type:ISSUE,first:50){ issueCount nodes{ ...pr } }
  mine: search(query:$mine,type:ISSUE,first:50){ issueCount nodes{ ...pr } }
  merged: search(query:$merged,type:ISSUE,first:1){ issueCount }
  today: search(query:$today,type:ISSUE,first:1){ issueCount }
}
fragment pr on PullRequest { number title url isDraft updatedAt additions deletions changedFiles body headRefName
  repository{ nameWithOwner } author{ __typename login } reviewDecision mergeable
  reviewRequests(first:10){ nodes{ requestedReviewer{ __typename ... on User{login} ... on Team{slug} } } }
  commits(last:1){ nodes{ commit{ statusCheckRollup{ state contexts(first:50){ nodes{ __typename ... on CheckRun{ name conclusion status } ... on StatusContext{ context state } } } } } } } }`;

// a local day, YYYY-MM-DD
function day(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// the query's searches, as of now
export function inbox_vars(now: Date): Record<string, string> {
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  return {
    reviews : "is:open is:pr review-requested:@me archived:false",
    mine    : "is:open is:pr author:@me archived:false",
    merged  : "is:pr author:@me is:merged merged:>=" + day(week),
    today   : "is:pr author:@me is:merged merged:>=" + day(now),
  };
}

const FAILED = ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

// a PullRequest node read, for the user `login`
export function inbox_pr(n: any, login: string): Pr {
  const roll = n?.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  const checks: any[] = roll?.contexts?.nodes ?? [];
  const failing = checks
    .filter((c) => FAILED.includes(c?.__typename === "StatusContext" ? c.state : c?.conclusion))
    .map((c) => String(c.__typename === "StatusContext" ? c.context : c.name));
  const asked: any[] = (n?.reviewRequests?.nodes ?? []).map((r: any) => r?.requestedReviewer);
  const state: State =
    n?.isDraft ? "draft"
    : n?.mergeable === "CONFLICTING" ? "conflicts"
    : FAILED.includes(roll?.state) ? "failing"
    : roll?.state === "PENDING" || roll?.state === "EXPECTED" ? "pending"
    : n?.reviewDecision === "CHANGES_REQUESTED" ? "changes"
    : n?.reviewDecision === "REVIEW_REQUIRED" ? "blocked"
    : "ready";
  return {
    repo: String(n?.repository?.nameWithOwner ?? ""), number: Number(n?.number), title: String(n?.title ?? ""), url: String(n?.url ?? ""),
    author: String(n?.author?.login ?? ""), bot: n?.author?.__typename === "Bot", updated: String(n?.updatedAt ?? ""),
    add: Number(n?.additions ?? 0), del: Number(n?.deletions ?? 0), files: Number(n?.changedFiles ?? 0), branch: String(n?.headRefName ?? ""),
    state, failing, body: String(n?.body ?? "").slice(0, BODY), you: asked.some((r) => r?.__typename === "User" && r.login === login),
  };
}

// the query's answer read; a GraphQL error kept as error
export function inbox_github(res: any): { login: string; reviews: Pr[]; mine: Pr[]; merged: number; today: number; error?: string } {
  const d = res?.data;
  const login = String(d?.viewer?.login ?? "");
  const prs = (s: any) => ((s?.nodes ?? []) as any[]).filter((n) => Number.isInteger(n?.number)).map((n) => inbox_pr(n, login));
  const out = { login, reviews: prs(d?.reviews), mine: prs(d?.mine), merged: Number(d?.merged?.issueCount ?? 0), today: Number(d?.today?.issueCount ?? 0) };
  const error = res?.errors?.[0]?.message;
  return error === undefined ? out : { ...out, error: String(error) };
}

// acli's work items (`--json`): a list, or Jira's {issues}
export function inbox_tickets(json: any): Ticket[] {
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.issues) ? json.issues : [];
  return list.filter((i) => typeof i?.key === "string").map((i) => {
    const site = /^(https:\/\/[^/]+)\/rest\//.exec(String(i.self ?? ""));
    return {
      key: i.key, title: String(i.fields?.summary ?? ""), status: String(i.fields?.status?.name ?? ""),
      priority: String(i.fields?.priority?.name ?? ""), updated: String(i.fields?.updated ?? ""),
      url: site === null ? "" : site[1] + "/browse/" + i.key,
    };
  });
}

// `git worktree list --porcelain`: the worktrees but the main one (the
// first), with their branches (null: detached)
export function inbox_worktrees(text: string): { path: string; branch: string | null }[] {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b !== "");
  return blocks.slice(1).map((b) => {
    const path = /^worktree (.+)$/m.exec(b)?.[1] ?? "";
    const branch = /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? null;
    return { path, branch };
  }).filter((w) => w.path !== "");
}

const REASONS: Record<string, Note["kind"]> = {
  review_requested: "review", assign: "assign", mention: "mention", team_mention: "mention", ci_activity: "ci", security_alert: "security",
};

// GitHub's notifications (`gh api notifications`): a PR's or issue's API
// url turned into its page
export function inbox_notes(json: any): Note[] {
  const list: any[] = Array.isArray(json) ? json : [];
  return list.map((n) => {
    const api = String(n?.subject?.url ?? "");
    const url = api.replace(/^https:\/\/api\.github\.com\/repos\//, "https://github.com/").replace(/\/pulls\/(\d+)$/, "/pull/$1");
    return {
      kind: REASONS[n?.reason] ?? "other", title: String(n?.subject?.title ?? ""), repo: String(n?.repository?.full_name ?? ""),
      url: url.startsWith("https://github.com/") ? url : "https://github.com/notifications", at: String(n?.updated_at ?? ""), unread: n?.unread === true,
    };
  });
}

// a remote's GitHub repo (owner/name), else none
export function inbox_repo(remote: string): string | null {
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?\s*$/.exec(remote.trim());
  return m === null ? null : m[1];
}

// the digest's query: PRs merged in the repos since a week ago, and open
export const DIGEST = `query digest($merged:String!,$open:String!){
  merged: search(query:$merged,type:ISSUE,first:100){ nodes{ ...d ... on PullRequest{ mergedAt } } }
  open: search(query:$open,type:ISSUE,first:100){ nodes{ ...d } }
}
fragment d on PullRequest { number title url createdAt repository{ nameWithOwner } author{ login } }`;

export function digest_vars(repos: string[], now: Date): Record<string, string> {
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const where = repos.map((r) => "repo:" + r).join(" ");
  return { merged: where + " is:pr is:merged merged:>=" + day(week), open: where + " is:pr is:open" };
}

// GitHub's search takes 256 characters a query, and 30 searches a minute:
// the repos split into searches that fit, the first (newest) MOST_SEARCHES
const QUERY_MOST = 256;
export const MOST_SEARCHES = 5;
export function digest_chunks(repos: string[], now: Date): Record<string, string>[] {
  const tail = digest_vars([], now).merged.length + 1;
  const groups: string[][] = [];
  for (const r of repos) {
    const last = groups.at(-1);
    const size = last === undefined ? 0 : last.reduce((n, x) => n + x.length + 6, 0);
    if (last !== undefined && size + r.length + 6 + tail <= QUERY_MOST) {
      last.push(r);
    } else if (groups.length < MOST_SEARCHES) {
      groups.push([r]);
    } else {
      break;
    }
  }
  return groups.map((g) => digest_vars(g, now));
}

// the digest's answer read
export function inbox_digest(res: any, repos: string[]): Digest {
  const prs = (s: any): DigestPr[] => ((s?.nodes ?? []) as any[]).filter((n) => Number.isInteger(n?.number)).map((n) => ({
    repo: String(n.repository?.nameWithOwner ?? ""), number: n.number, title: String(n.title ?? ""), url: String(n.url ?? ""),
    author: String(n.author?.login ?? ""), at: String(n.mergedAt ?? n.createdAt ?? ""),
  }));
  return { repos, merged: prs(res?.data?.merged), open: prs(res?.data?.open) };
}

// Check
// =====
// A device's report is the only way the inbox reaches a view, so the
// server keeps only what's right: each field of its type, links only to
// https pages (no "javascript:"), lists capped, text cut; else refused.

class Bad extends Error {}

function str(x: unknown, most = TEXT): string {
  if (typeof x !== "string") {
    throw new Bad("a text field isn't text");
  }
  return x.slice(0, most);
}
function num(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
    throw new Bad("a count isn't a count");
  }
  return x;
}
function bool(x: unknown): boolean {
  if (typeof x !== "boolean") {
    throw new Bad("a flag isn't true or false");
  }
  return x;
}
function link(x: unknown): string {
  const s = str(x, 2 * TEXT);
  if (s !== "" && !/^https:\/\/[^\s"'<>]+$/.test(s)) {
    throw new Bad("a link isn't an https page");
  }
  return s;
}
function list<T>(x: unknown, each: (y: any) => T): T[] {
  if (!Array.isArray(x)) {
    throw new Bad("a list isn't a list");
  }
  return x.slice(0, MOST).map(each);
}
function one<T extends string>(x: unknown, of: readonly T[]): T {
  if (!of.includes(x as T)) {
    throw new Bad("no such kind: " + String(x).slice(0, 40));
  }
  return x as T;
}

function pr(p: any): Pr {
  return {
    repo: str(p?.repo), number: num(p?.number), title: str(p?.title), url: link(p?.url), author: str(p?.author), bot: bool(p?.bot),
    updated: str(p?.updated), add: num(p?.add), del: num(p?.del), files: num(p?.files), branch: str(p?.branch),
    state: one(p?.state, STATES), failing: list(p?.failing, (f) => str(f)), body: str(p?.body, BODY), you: bool(p?.you),
  };
}

// a link only to that site's pages (or none)
function site(x: unknown, at: string): string {
  const s = link(x);
  if (s !== "" && !s.startsWith(at)) {
    throw new Bad("a link isn't " + at);
  }
  return s;
}
// a Drive file id
function drive(x: unknown): string {
  const s = str(x, 200);
  if (!/^[\w-]+$/.test(s)) {
    throw new Bad("not a Drive file id");
  }
  return s;
}

function dpr(p: any): DigestPr {
  return { repo: str(p?.repo), number: num(p?.number), title: str(p?.title), url: link(p?.url), author: str(p?.author), at: str(p?.at, 60) };
}

// a device's report checked: the inbox kept, or why it's refused
export function inbox_check(x: any): Inbox | string {
  try {
    if (typeof x !== "object" || x === null) {
      throw new Bad("an inbox is an object");
    }
    return {
      at: num(x.at), login: str(x.login), merged: num(x.merged), today: num(x.today),
      reviews: list(x.reviews, pr), mine: list(x.mine, pr),
      tickets: x.tickets === null ? null : list(x.tickets, (t) => ({
        key: str(t?.key, 40), title: str(t?.title), status: str(t?.status, 60), priority: str(t?.priority, 60), updated: str(t?.updated, 60), url: link(t?.url),
      })),
      clean: list(x.clean, clean_row),
      notes: list(x.notes, (n) => ({ kind: one(n?.kind, KINDS), title: str(n?.title), repo: str(n?.repo), url: link(n?.url), at: str(n?.at, 60), unread: bool(n?.unread) })),
      errors: list(x.errors, (e) => str(e)),
      spaces: x.spaces === undefined ? [] : list(x.spaces, (r) => str(r, 120)),
      google: x.google === undefined || x.google === null ? null : {
        events: list(x.google.events, (e) => ({ id: str(e?.id, 200), title: str(e?.title), start: str(e?.start, 60), end: str(e?.end, 60), meet: site(e?.meet, "https://meet.google.com/"), people: num(e?.people) })),
        docs: list(x.google.docs, (d) => ({ id: drive(d?.id), title: str(d?.title), at: str(d?.at, 60), url: site(d?.url, "https://docs.google.com/") })),
      },
      digest: x.digest === undefined || x.digest === null ? null : {
        repos: list(x.digest.repos, (r) => str(r)),
        merged: list(x.digest.merged, dpr), open: list(x.digest.open, dpr),
      },
    };
  } catch (err) {
    if (err instanceof Bad) {
      return "Not an inbox: " + err.message + ".";
    }
    throw err;
  }
}
