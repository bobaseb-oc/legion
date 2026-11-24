// Gchat
// =====
// Google Chat as a second view of the questions pane, for the user away
// from their desk (config `gchat_space`, key GCHAT_WEBHOOK_URL: off
// unless both are set and agree). Out: each open approval, question,
// note, todo and super auto decision is posted once a process (a restart
// posts it again, in a new thread), as its pace says
// (Outbox.ts), through the space's incoming webhook (a bot's message, so
// the phone rings), one thread per item, its
// text in chunks of at most TEXT. In: the replies in an item's thread,
// read with the user's read-only Google grant (Google.replies), routed by
// the server (Server.ts Chat.bridge) as a view's acts. Pure but the post;
// the webhook's URL is a key: never logged, never in an error, a message
// or view.json. What agents wrote is posted scrubbed of secret-shaped
// strings (local/prime/redact.ts), as the space is outside this computer.

import type { Message } from "./Google.ts";
import { redact } from "./local/prime/redact.ts";
import type { Assignment, Decided, Question, Waiting } from "./View.ts";
import { DECIDED_MS } from "./View.ts";

// Types
// =====

// an item of the pane: its key ("a" an approval, "q" a question, "n" a
// note, "t" a todo, "d" a decision, then its number), its number, its
// text as posted; an approval's fp, its call's (Pending.fp)
export type Kind = "approval" | "question" | "note" | "todo" | "decision";
export type Item = { key: string; kind: Kind; n: number; text: string; options?: string[]; fp?: string };

// an item posted: its key, the thread's key and name (spaces/S/threads/T),
// when Google says it was posted (ms); an approval's fp as posted
export type Posted = { key: string; tk: string; thread: string; at: number; fp?: string };

// the bridge's state kept in view.json: the messages acted on (their
// names, the last ACTED), read across restarts. What was posted is never
// kept there
export type Gchat = { acted: string[] };

// what gchat_replies routes by: the items this process posted and still
// open (Server.ts chat.bridging.threads, in memory only), and the
// messages acted on (Gchat's acted)
export type Threads = { posted: Posted[]; acted: string[] };

// a reply to act on: the item, the message's name, its text
export type Reply = { item: Item; name: string; text: string };

// Constants
// =========

// the poll's period (ms); a message's characters at most (Chat's own
// limit is 4096, room left for a chunk's label); posts in one pass; the
// acted-on names kept
export const EVERY  = 15_000;
export const TEXT   = 4000;
export const POSTS  = 10;
export const GAP    = 1_100;  // between two posts or chunks: Google takes about one a second a space
export const HOLD   = 15_000; // no post for at least this long after a 429
export const ACTED  = 500;

const SPACE = /^spaces\/[\w-]{1,100}$/;

// Functions
// =========

export function gchat_new(): Gchat {
  return { acted: [] };
}

// on: a space and a webhook of that space on Chat's API (https, its key
// and token given); anything else is off
export function gchat_on(space: string, url: string): boolean {
  if (!SPACE.test(space) || url === "") {
    return false;
  }
  const u = URL.parse(url);
  return u !== null && u.protocol === "https:" && u.host === "chat.googleapis.com" && u.pathname === "/v1/" + space + "/messages" && u.searchParams.has("key") && u.searchParams.has("token");
}

// the pane's open items: the calls waiting for the user's yes first, then
// oldest first questions and notes, todos, the decisions still undoable
// (DECIDED_MS); each text as posted scrubbed of secret-shaped strings
// (redact's shapes: [REDACTED:<name>]), its options kept as they are (an
// answer by number is one)
export function gchat_items(mem: { questions: Question[]; assigned: Assignment[]; decided: Decided[]; calls?: Array<Waiting & { fp: string }> }, now: number): Item[] {
  const as = (mem.calls ?? []).map((c): Item => ({
    key: "a" + c.id, kind: "approval", n: c.id, fp: c.fp,
    text: "Approval " + c.id + ": " + c.who + " wants to run: " + c.what + "\n\nReply yes or no in this thread (exactly one word). Or answer in Legion.",
  }));
  const qs = mem.questions.map((q): Item => {
    const kind = q.fyi ? "note" : "question";
    const opts = (q.options ?? []).map((o, i) => (i + 1) + ". " + o).join("\n");
    const how = q.fyi ? "Reply in this thread to answer Legion." : "Reply in this thread to answer" + (opts === "" ? "." : " (an option's number or your words).");
    const text = (q.fyi ? "Note " : "Question ") + q.id + ": " + q.text + (opts === "" ? "" : "\n" + opts) + "\n\n" + how;
    return { key: (q.fyi ? "n" : "q") + q.id, kind, n: q.id, text, ...(q.options === undefined ? {} : { options: q.options }) };
  });
  const ts = mem.assigned.map((a): Item => ({ key: "t" + a.n, kind: "todo", n: a.n, text: "Todo " + a.n + " (" + a.by + "): " + a.text + "\n\nReply done or drop." }));
  const ds = mem.decided.filter((d) => now - Date.parse(d.date) < DECIDED_MS).map((d): Item => ({
    key: "d" + d.id, kind: "decision", n: d.id,
    text: "Decided for you " + d.id + " (" + d.kind + "): " + d.question + "\nTaken: " + d.answer + "\n\nReply undo (and what instead) to reverse it, or keep.",
  }));
  return [...as, ...qs, ...ts, ...ds].map((x) => ({ ...x, text: redact(x.text, []).text }));
}

// text in chunks of at most most characters, cut at a blank line, else a
// line, else hard (gchat_daemon's _chunk_text); more than one labelled
export function gchat_chunks(text: string, most = TEXT): string[] {
  const room = most - 12;
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > room) {
    let at = rest.lastIndexOf("\n\n", room);
    at = at > 0 ? at : rest.lastIndexOf("\n", room);
    at = at > 0 ? at : room;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "" || chunks.length === 0) {
    chunks.push(rest);
  }
  return chunks.length === 1 ? chunks : chunks.map((c, i) => "[" + (i + 1) + "/" + chunks.length + "]\n" + c);
}

// a post's first message: its thread and time (Google's clock)
export type Sent = { thread: string; at: number };
// why a post failed: its HTTP status (null: not reachable), a 429's
// Retry-After (ms), and, if a later chunk failed, the first message and
// the chunk to go on from
export type Failed = { error: string; status: number | null; retry: number | null; done: Sent | null; next: number };
// a post to send, or the rest of one cut short: done its first message
// (null: none sent yet), next the chunk to go on from
export type Part = { key: string; tk: string; text: string; fp?: string; done: Sent | null; next: number };
// how: the wait between chunks (GAP; a test's records it), and to go on
// from chunk `from` of a post whose first message was `done`
export type Pace = { wait?: (ms: number) => Promise<void>; from?: number; done?: Sent };

// text posted through the webhook into the thread tk (made if new), its
// chunks GAP apart; the first message's thread and time, or why not: its
// HTTP status only, never the URL (a key)
export async function gchat_post(url: string, tk: string, text: string, f: typeof fetch = fetch, o: Pace = {}): Promise<Sent | Failed> {
  const u = new URL(url);
  u.searchParams.set("threadKey", tk);
  u.searchParams.set("messageReplyOption", "REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
  const chunks = gchat_chunks(text);
  const from = o.from ?? 0;
  let first: Sent | null = o.done ?? null;
  for (let i = from; i < chunks.length; i++) {
    if (i > from) {
      await (o.wait ?? Bun.sleep)(GAP);
    }
    const res = await f(u.href, { method: "POST", headers: { "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify({ text: chunks[i] }), redirect: "error", signal: AbortSignal.timeout(20e3) }).catch(() => null);
    if (res === null || !res.ok) {
      const error = "GChat: " + (res === null ? "not reachable." : "HTTP " + res.status + (await gchat_why(res, url, u)));
      return { error, status: res?.status ?? null, retry: res === null ? null : gchat_retry(res), done: first, next: i };
    }
    const json: any = await res.json().catch(() => null);
    const at = Date.parse(String(json?.createTime ?? ""));
    first ??= { thread: String(json?.thread?.name ?? ""), at: Number.isFinite(at) ? at : Date.now() };
  }
  return first!;
}

// a 429's Retry-After in ms (seconds, or an HTTP date), else null
function gchat_retry(res: Response): number | null {
  const h = res.headers.get("retry-after");
  if (res.status !== 429 || h === null) {
    return null;
  }
  const ms = /^\d+$/.test(h.trim()) ? Number(h) * 1000 : Date.parse(h) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// Google's reason for a refused post (": <message>", else "."): one line,
// at most 200 chars, the URL (as given, and as posted) and its key and
// token (decoded and percent-encoded) cut from it, as it
// may echo the request
async function gchat_why(res: Response, url: string, u: URL): Promise<string> {
  const json: any = await res.json().catch(() => null);
  let why = String(json?.error?.message ?? "").replace(/\s+/g, " ").trim();
  const parts = [u.searchParams.get("key") ?? "", u.searchParams.get("token") ?? ""];
  const secrets = [u.href, url, ...parts, ...parts.map(encodeURIComponent)].filter((s) => s !== "");
  for (const secret of secrets) {
    why = why.split(secret).join("<redacted>");
  }
  return why === "" ? "." : ": " + why.slice(0, 200);
}

// RED ZONE (access control: who may answer; signed off by the user
// 2026-11-18): the messages that count as the user's replies, deny by
// default. Only one whose sender is me (the signed-in Google user's
// users/<id>; none known: none counts) and HUMAN, in the space, in the
// thread of an item posted and still open, made after it was posted, and
// never acted on (acted). A bot's, the webhook's or anyone else's never
export function gchat_replies(said: Message[], me: string | null, space: string, g: Threads, items: Item[]): Reply[] {
  if (me === null || !/^users\/\d+$/.test(me) || !SPACE.test(space)) {
    return [];
  }
  const out: Reply[] = [];
  for (const m of said) {
    const p = g.posted.find((x) => x.thread !== "" && x.thread === m.thread);
    const item = p === undefined ? undefined : items.find((x) => x.key === p.key);
    const ok = m.sender === me && m.type === "HUMAN" && m.name.startsWith(space + "/messages/") && m.thread.startsWith(space + "/threads/")
      && p !== undefined && item !== undefined && m.at > p.at && !g.acted.includes(m.name) && !out.some((r) => r.name === m.name);
    if (ok) {
      out.push({ item, name: m.name, text: m.text.trim() });
    }
  }
  return out;
}

// a message's name kept as acted on (the last ACTED)
export function gchat_acted(g: Gchat, name: string): void {
  g.acted = [...g.acted.filter((x) => x !== name), name].slice(-ACTED);
}

// a reply as the act a view would send: an approval's consent, a
// question's or a note's answer (an option's number as its text), a
// todo's done or drop, a decision's undo (with what instead) or keep;
// null: not understood
export function gchat_act(r: Reply): any {
  const word = r.text.split(/\s+/)[0]!.toLowerCase().replace(/[.!:,]+$/, "");
  const rest = r.text.slice(r.text.split(/\s+/)[0]!.length).replace(/^[\s:,-]+/, "").trim();
  switch (r.item.kind) {
    case "approval": {
      // RED ZONE (R4, DRAFT awaiting the user's sign-off): O6, the exact
      // word only, trimmed, any case; "yes please", "y", "ok" are no answer
      const w = r.text.trim().toLowerCase();
      return w === "yes" || w === "no" ? { $: "consent", n: r.item.n, yes: w === "yes" } : null;
    }
    case "question":
    case "note": {
      const k = /^\d+$/.test(r.text) ? Number(r.text) - 1 : -1;
      return r.text === "" ? null : { $: "answer", q: r.item.n, text: r.item.options?.[k] ?? r.text };
    }
    case "todo": {
      return word === "done" ? { $: "assignment", n: r.item.n, done: true } : word === "drop" ? { $: "assignment", n: r.item.n, done: false } : null;
    }
    case "decision": {
      return word === "undo" ? { $: "decision", n: r.item.n, undo: true, ...(rest === "" ? {} : { text: rest }) } : word === "keep" ? { $: "decision", n: r.item.n, undo: false } : null;
    }
  }
}
