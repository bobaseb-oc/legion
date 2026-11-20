#!/usr/bin/env bun
// Server
// ======
// The agent: chats that never end (Memory.ts), one per user signed in
// (Cloud.ts), at config.DIR/users/<id>, and their views, terminals
// (Term.ts) and browser tabs (web/), each one WebSocket (View.ts's Link)
// carrying the chat's events and its acts (one with a body: a post to
// /api/act), each done once (Chat.apply), within USERS' limit. A
// terminal's socket names its device, which the agent's tools reach
// (Tools.ts) until it quits.
//
// One turn at a time. A message is logged as it arrives; the running call
// takes it between tool calls if it goes whole beside its view, else the
// next call does, on the chat's pick (Pick.ts). Its paid calls ask its
// wallet (Billing.ts), and what the billing refuses stops; a chat at
// rest settles what it owes; one nobody views is let go.
//
// Alone, this process serves the site. Workers (config.WORKERS, behind a
// proxy: README) each serve the users shard() gives them, under this
// process (Main.supervise), which only routes. A deploy is a handover:
// told so (SIGHUP), the supervisor starts each worker anew beside the
// old one, on the same port; the old one takes no more connections and
// gives the new one each chat once no post of it runs (Chat.give): its
// work goes on there, the calls it runs (its turn's, agents', summaries')
// going on where they started, fed straight to where the chat is (Main.away,
// Main.far), and its views open again there at once (View.ts MOVE). It
// ends once those calls do (a process that ran none, at once). A stop or
// crash cuts all: a start resumes what ran (Chat.wake), told so.
//
// Usage: Server.ts [port]   (127.0.0.1; default 8788)

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import type { ServerWebSocket } from "bun";
import { Agent, READING } from "./Agent.ts";
import { gateway_budget, type Budget } from "./Gateway.ts";
import { AskAI, type Bill, type Grant, type Call, type End, type Event, type Kind, type Say, type Sink } from "./AskAI.ts";
import type { Wallet } from "./Billing.ts";
import { clip, clip_pages } from "./Clip.ts";
import { Cloud, type Account, type User } from "./Cloud.ts";
import { Disk } from "./Disk.ts";
import { USER_SHELL } from "./Machine.ts";
import { Mail } from "./Mail.ts";
import * as Import from "./Import.ts";
import { Mcp } from "./Mcp.ts";
import { Harvest } from "./Harvest.ts";
import { JOBS, Memory, type Given, type Msg as Log, type Share } from "./Memory.ts";
import { ABOUT, MODES, Modes, type Mode } from "./Modes.ts";
import { OpenAI, TRANSCRIBER } from "./OpenAI.ts";
import { Pick } from "./Pick.ts";
import * as Inbox from "./Inbox.ts";
import * as Routines from "./Routines.ts";
import * as Explain from "./Explain.ts";
import * as Gchat from "./Gchat.ts";
import * as Notes from "./Notes.ts";
import { Directives } from "./Directives.ts";
import * as Pending from "./Pending.ts";
import { Google } from "./Google.ts";
import { Price } from "./Price.ts";
import { MASTER, SEARCHES, Tools, type Agent, type Live, type Moved as Kit } from "./Tools.ts";
import { DECIDED_MS, email_ask, FIND, FRAME, IMAGES, live_push, LOOK_KINDS, MOVE, PING, QUIT, SUMMARIES, TICK, TURN, WIRE, type Answer, type Decided, type DeviceStatus, type Look, type Looked, type Mine, type Part, type Question, type Server as Out, type Todo, type Wait } from "./View.ts";
import * as config from "./Config.ts";
import hello_md from "./hello.md" with { type: "text" };
import app_js from "./web/app.js" with { type: "file" };
import index_html from "./web/index.html" with { type: "file" };
import install_sh from "./web/install.sh" with { type: "file" };
import legal_css from "./web/legal.css" with { type: "file" };
import mark_svg from "./web/mark.svg" with { type: "file" };
import oncorps_png from "./web/oncorps.png" with { type: "file" };
import experimental_jpg from "./web/experimental.jpg" with { type: "file" };
import og_png from "./web/og.png" with { type: "file" };
import style_css from "./web/style.css" with { type: "file" };

// Types
// =====

// a socket: its user, sign-in (hashed), its query's fields, its device,
// the parts it was shown (Chat.teach), the agents whose pages it asked for;
// says: it speaks for the user (Cloud.speaks: a browser's, or a terminal
// key's; none said: it doesn't)
type Sock = ServerWebSocket<{ user: User; who: string; tab: string; wire: string | null; host: string | null; computer: boolean; work: string; home: string | null; device: string | null; seen: Set<string>; watch: Set<string>; says?: boolean }>;

// a body: its file, its size so far
type Body = { fh: fs.promises.FileHandle; size: number };

// a message logged: its pages [id, end)
type Msg = { id: number; end: number };

// what the agent saw at its last call: the view before message `from`,
// then every message from it on
type Eye = { parts: Part[]; from: number };

// a goal check (Chat.check): its call (here, or by its ref as its chat
// moves), the goal it asks of
type Check<C> = { call: C; goal: string };

// an import as kept: messages [a, b), those sent (not notes), USD spent;
// as run: by level what each node costs (micro-USD, Import.import_guess)
// and how many are not built; their cost; its time (Chat.time) in all
type Kept  = { a: number; b: number; said: number; spent: number };
type Batch = Kept & { micros: number[][]; open: number[]; left: number; all: number };

// a chat: acts being done (Chat.apply); posts: requests and acts being
// taken, its start till what it resumed runs, and the command after a
// turn; model: what the turn's call runs on, as picked when it began (a
// /model since picks the next call's); asked: a request out, nothing
// back; open: tool calls without results; check: the turn's goal check
// running (Chat.check); sent, wait: messages given and waiting; ending:
// what to do once at rest as it ends (all: nothing runs) or moves (no
// post runs); writes, held: the posts logging, one after another, and
// the logging held meanwhile (null: none); wallet: what pays its calls
// the team digest's themes (Chat.themes): the digest's key (its merged
// PRs), each author's lines
export type Themes = { key: string; by: Record<string, string[]> };

type Chat = {
  status?: DeviceStatus; // the latest device's report, for the web's status line
  inbox?: Inbox.Inbox;   // the latest device's inbox (Device.device_inbox), checked
  themes?: Themes;       // the digest's themes (Chat.themes), for the digest they were made of
  reading?: Set<string>; // transcript Docs asked of the devices (Chat.transcript), whose text is taken
  acct  : Account;
  mem   : Memory;
  tools : Tools;
  pick  : Pick;
  socks : Set<Sock>;
  acts  : Map<string, Promise<Answer>>;
  busy  : boolean;
  posts : number;
  call  : Call | null;
  model : string;
  check : Check<Call> | null;
  asked : boolean;
  open  : number;
  sent  : Msg[];
  wait  : Msg[];
  halt  : AbortController;
  live  : Live[];
  calls : Record<string, string>; // its tool calls awaiting their results, by id (Chat.on)
  eye   : Eye;
  after : Promise<void>;
  batch : Batch | null;
  ending: { all: boolean; then: () => void } | null;
  writes: Promise<unknown>;
  held  : Array<() => void> | null;
  rolled: boolean; // the turn's last call rolled over: the next goes on from it
  wallet: Wallet;
  tick?: ReturnType<typeof setInterval>; // the routines' (Chat.ticked)
  bridging?: { timer?: ReturnType<typeof setInterval>; busy: boolean; me: string | null }; // the GChat bridge's (Chat.bridge): its pass running, the signed-in user (Google.me)
  looks?: Map<string, number>; // the looks asked of the devices, not yet answered: how many devices may still answer (Chat.look)
  harvests?: Map<string, number[]>; // the timesheet's submits sent to a device, not yet answered: their drafts (Chat.timesheet)
  dids?: Set<string>; // the Crew view's undos and handoffs sent to a device, not yet answered (Chat.crew_op)
  edits?: number[]; // when the user's track edits were taken, the last minute's (Chat.track: Explain.EDITS)
  jots?: Map<string, string[]>; // the track notes waiting to be sent, by agent (Chat.tracked: Explain.NOTE_GAP)
  nudged?: Map<string, number[]>; // when each agent's stall reminders went, the last hour's (Chat.stalls: Explain.REMINDS)
};

// a chat as it moves to another process (Chat.move): its user (an id:
// a chat moved is never new, so no hello needs their name, and they may
// have signed out since), their credit as their billing last told it,
// its turn (its call and goal check's by their refs, Main.away), the
// tools' part, its summaries running
type Moved = { user: string; credit: number | undefined; turn: Turn; tools: Kit; sums: Given[] };
type Turn = { busy: boolean; call: string | null; model: string; check: Check<string> | null; sent: Msg[]; wait: Msg[]; asked: boolean; open: number; live: Live[]; calls: Record<string, string>; eye: Eye };

// another process (the one this gives its chats to or takes them from,
// or one a call is fed from or to), by a line of JSON a message
// (Main.told): the replies to payments asked of it; the calls fed from it
// here, by ref (Main.far), and the payments let through for them; end:
// the line closed once all sent is out, then `then`
type Peer = {
  send   : (msg: object) => void;
  end    : (then: () => void) => void;
  asks   : Map<string, (grant: Grant | string) => void>;
  feeds  : Map<string, Sink>;
  grants : Map<string, Grant>;
};

// a call fed from here to the process its chat is in (Main.away): run
// here, or passed on (a relay) till its origin feeds that process itself
type Away = { call: Call; link: Peer };

// a call fed here by its origin while its relay (the process its chat
// came from) still passes on what reached it first: what came straight
// meanwhile, held; whether its origin's line was lost
type Gate = { relay: Peer; origin: Peer; held: any[]; lost: boolean };

// a rate limit (Main.spend): what each key (a user, a network) may still
// spend, as of when; it grows `rate` a second, up to `most`
type Limit = { rate: number; most: number; keys: Map<string, { n: number; at: number }> };

// Constants
// =========

// one server at a time for this user, whatever its dir: HOME's lock (a
// test run's dir, deleted, would free its own); UNII_ANOTHER=1 runs one
// beside it, held only per dir. One that holds it is waited on for HELD
// ms (launchd's restart starts one before the last has ended), then this
// one ends, naming it
const LOCK       = process.env.UNII_ANOTHER === "1" ? config.DIR + "/lock" : os.homedir() + "/.unii/lock";
const HELD       = 10_000;
// L6: who may take the lock now (Main.taking): a file made only if none
// is there (O_EXCL), holding its maker's pid, so two starts at once never
// both find a stale lock, remove it and listen; one whose maker is gone
// (or that says no pid, TAKING ms on) is removed
const TAKE       = LOCK + ".take";
const TAKING     = 5_000;
// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
// unix socket devices and terminals reach this server on (Main.unix)
const SOCK       = config.DIR + "/server.sock";
// where worker k's successor reaches it, HAND + k (Main.listen); how
// often one that gave its chats looks whether its last requests ended
const HAND       = config.DIR + "/hand";
const LEAVE      = 500;

// an agent's pulse (Tools.pulse) goes to every view at most once a PULSE
// ms while it streams; a view watches (hears the deltas of) at most WATCH
// agents: its focus and tiles in sight
const PULSE      = 1000;
const WATCH      = 16;
// the agents of a chat with a pulse due
const PULSES     = new WeakMap<object, Set<string>>();
// the shell commands running (B2: Tools.shells) go to every view at most
// once a SHELLS ms while they change (a device tails each a second); the
// chats with them due
const SHELLS     = 500;
const SHELLED    = new WeakSet<object>();
// how a call ends whose process ended first (a crash)
const ENDED      = "the server process that ran it ended";
// a turn's head, as a summary's is "Compaction:": one prompt serves both
const HEAD       = "Turn: the user's new message:\n\n";
// a turn asked again as its call rolled over (Agent.ts): the user's
// message whole, then what the turn did since, its lines as "i|kind: text"
const ROLLED     = "\n\nYour call for this message rolled over, its context too long: it was asked again from the chat above, which summarizes all you did. What you did since the message, as \"i|kind: text\" lines (zoom an id for more), then go on:\n\n";
// a goal's check (Chat.check): its own system prompt (Unii's, which says
// a call is a turn or a compaction, made the model summarize the chat
// instead of answering), asked after the chat (the view, its latest
// messages whole) of its goal; unmet, the user's nudge
const GOAL       = "You check a goal. Below is a chat between a user and Unii, an AI agent: its older messages as summary lines (id+n|text), then its latest messages whole, then the goal the user set with /goal. Answer yes if the chat shows the goal fully satisfied now, else no. Write that one word, nothing else.";
const GOAL_ASK   = "\nThe goal:\n\n";
const GOAL_NO    = "The goal isn't satisfied yet: keep working.";
// the most messages back the directives check reads for a turn (Chat.directed)
const SCAN       = 200;
const FULL       = "Legion's disk is full; try again soon.";
// an import running: its batch's file in the chat's dir (Chat.keep)
const BATCH      = "/import.json";
// under SPARE free, the disk takes no more (Chat.post)
const SPARE      = 2 ** 30;

// the acts with a body (Chat.post)
const BODIES     = ["say", "import", "voice"];

// RED ZONE (R1, signed off by the user 2026-11-19): the device an act
// posted (/api/act) with no browser's session comes from: no view
// (Cloud.browser), so every act a view only may do is refused it
const POSTED     = "api";

// RED ZONE (R3, signed off by the user 2026-11-19): the user's say over
// what agents may do: the mode, the plan, a waiting call's yes, a Claude
// Code worker's start, a question's answer. A view's acts only (Chat.act):
// a device's socket is within an agent's reach, so an agent must not
// approve itself (as Chat.routine, Chat.pin refuse it). The terminal is a
// device too: its /mode, /plan, /allow, /approve, /answer are refused,
// unless its socket is on its terminal key (K1, Chat.act's `says`)
const SAYS       = ["mode", "plan", "consent", "approve", "answer"];

// a read of a body: a buffer, no limit
const READ       = 2 ** 20;

// a piece of a long answer (Main.stream)
const PIECE      = 2 ** 16;

// what a user's clients may send (Main.spend): 200 messages (acts, asks,
// sockets opened) at once, 100 more a second, each counting once more
// for each UNIT in it (none is over View.FRAME); past it, a socket is
// closed (FLOOD) unread, a socket or an act posted refused (429), so no
// user's flood holds the worker every chat on it shares (a client opens
// again and sends what wasn't answered; a person's clicks, keys and
// tools never come near: a screenshot counts ~3)
const USERS: Limit = { rate: 100, most: 200, keys: new Map() };
const UNIT       = 2 ** 16;
const FLOOD      = 1008;

// the sockets a user's clients may hold open at once (Main.sockets: a
// view each, a tab, a terminal, the app); past it a new one is refused
// (429), so no user fills the worker's memory with sockets, each of which
// may hold an unfinished message up to View.FRAME
const SOCKETS    = 32;

// what a network (Cloud.net: an IPv4 address, an IPv6 /48) may ask of the
// site: 1,000 requests at once, 100 more a second; past it the supervisor
// answers 429, so no worker hears it. A page opens in ~10, then lives on
// its socket: a hundred people behind one NAT opening it at once never
// come near
const NETS: Limit = { rate: 100, most: 1000, keys: new Map() };

// the model requests a worker may have open at once (Bun's fetch: 256)
const FETCHES    = 65535;

// the paths of a user signed in, but /api/'s (the rest: the site's files)
const OWN        = ["/ws", "/tree", "/export"];

// what a recording is written out by, and its fewest bytes a second
// (Opus's least, 6 kbps)
const VOICE: Pick = { vendor: "openai-api", model: TRANSCRIBER, effort: "", speed: "slow" };
const AUDIO      = 750;

// the first message, ending in the installer every terminal starts from,
// signed out (it signs in by email: Term.ts login_run), so the message
// holds no credential a screenshot could leak
const HELLO      = hello_md.trim().replace("{install}", config.SITE + "/install.sh");

// the site's files, by path (a new one is imported above)
const WEB: Record<string, string> = {
  "/"               : index_html,
  "/account"        : index_html,
  "/app.js"         : app_js,
  "/experimental.jpg": experimental_jpg,
  "/favicon.svg"    : mark_svg,
  "/install.sh"     : install_sh,
  "/legal.css"      : legal_css,
  "/mark.svg"       : mark_svg,
  "/oncorps.png"    : oncorps_png,
  "/og.png"         : og_png,
  "/style.css"      : style_css,
};

// a new account's chat opens as its guest's talk went (main.ts guest), so
// its next line follows from the email: hello.md asking for it (View.ask),
// the email, and SIGNED. The hello's node is written with it, so no
// compactor call summarizes the three (with an email of up to 254 bytes,
// a node of at most 512 bytes) and a new account owes nothing.
const HELLO_LINE = "unii: hello: Legion, one endless chat kept in a memory tree, recent days in more detail; build anything for years; recalls the past (ad2cat.py); a chatbot with a memory system; the user's terminal install; asks their email.";
const SIGNED     = "You're in! What should we start with?";

// Chat
// ====

export namespace Chat {

  // the accounts (set at start); the chats loaded, by user
  export let cloud: Cloud;
  export const chats = new Map<string, Chat>();

  // a chat's paid calls ask its wallet (Billing.ts), each sent only while
  // its credit pays it (a balance not told yet is none): its summaries
  // start once told. One
  // moving here takes what ran (`moved`); none opens as this process
  // gives its chats away (null). A chat is kept only once open whole, so
  // one that fails to (throws) is never left half open
  export function open(user: User, moved: Moved | null = null, peer: Peer | null = null): Chat | null {
    const cloud = Chat.cloud;
    const old = Chat.chats.get(user.id);
    if (old !== undefined || (Main.given && moved === null)) {
      return old ?? null;
    }
    const acct = { cloud, user: user.id };
    const dir = config.DIR + "/users/" + user.id;
    const mem = Memory.load(dir, () => Chat.share(chat), (id, ans) => Cloud.act_put(acct, id, ans));
    // RED ZONE (R4, DRAFT awaiting the user's sign-off): the approvals the
    // last process left open: a consent past its time expired, an appeal
    // cut; the rest only shown again (no record read here says yes, P1)
    mem.pending = Pending.restart(mem.pending, Date.now());
    Memory.save(mem);
    const tools = Tools.serve(mem, {
      push   : (agent, kind, text) => Chat.push(chat, agent, kind, text),
      on     : (agent, ev) => Chat.on(chat, agent, ev),
      report : (agent, text, stopped) => Chat.report(chat, agent, text, stopped),
      boss   : (text) => Chat.work(chat, text, true),
      change : () => Chat.change(chat),
      pick   : () => chat.pick,
      halt   : () => chat.halt.signal,
      note   : (text) => Chat.note(chat, text),
      viewed : () => Chat.viewed(chat),
      shells : () => Chat.shelled(chat),
      pinned : (who, marks, texts) => Chat.pinned(chat, who, marks, texts),
      pended : () => Memory.save(chat.mem),
    }, moved?.tools.key);
    const wallet = cloud.billing.wallet({
      user  : user.id,
      mem,
      batch : () => chat.batch,
      told  : () => Chat.all(chat, Chat.state(chat)),
      rest  : () => Chat.free(chat),
    });
    const pick = Pick.load(mem.pick, config.OFFER, config.PICK);
    const chat: Chat = {
      acct, mem, tools, pick, socks: new Set(), acts: new Map(), busy: false, posts: 1, call: null, model: "", check: null, asked: false, open: 0, sent: [], wait: [],
      halt: new AbortController(), live: [], calls: {}, eye: { parts: [], from: 0 }, after: Promise.resolve(), batch: null, ending: null,
      writes: Promise.resolve(), held: null, wallet, rolled: false,
    };
    // a saved pick not offered gave way: told once
    const saved = mem.pick === null ? null : Pick.label(mem.pick as Pick);
    if (saved !== null && saved !== Pick.label(pick)) {
      mem.pick = pick;
      Memory.save(mem);
      Chat.note(chat, saved + " isn't offered here, so the chat now runs on " + Pick.label(pick) + ".");
    }
    mem.pay = tools.pay = wallet.pay;
    if (mem.count === 0) {
      const hello = HELLO + "\n\n" + email_ask(cloud.billing.github !== null);
      Memory.push(mem, [{ kind: "unii", text: hello, line: HELLO_LINE }, { kind: "user", text: user.name }, { kind: "unii", text: SIGNED }]);
    }
    chat.eye = Chat.eye(mem, Memory.turn(mem));
    mem.made = (l, i) => Chat.made(chat, l, i);
    mem.troubled = () => Chat.all(chat, Chat.state(chat));
    chat.tick = setInterval(() => (Chat.ticked(chat, Date.now()), void Chat.observe(chat, Date.now())), Chat.TICKS);
    chat.tick.unref?.();
    if (Chat.gchat_for(user.id, config.KEYS.gchat ?? "")) {
      chat.bridging = { busy: false, me: null, timer: setInterval(() => void Chat.bridge(chat, Date.now()), Gchat.EVERY) };
      chat.bridging.timer!.unref?.();
    }
    mem.wait.add(() => Chat.progress(chat));
    mem.wait.add(() => Chat.free(chat));
    const work = moved === null ? mem.work : [];
    chat.batch = Chat.resumed(chat);
    if (moved !== null) {
      Chat.arrive(chat, moved, peer!);
    }
    Chat.chats.set(user.id, chat);
    cloud.billing.balance(user.id).then(async () => {
      Memory.pump(mem);
      Chat.progress(chat);
      await Chat.resume(chat, work);
    }).finally(() => {
      chat.posts -= 1;
      Chat.change(chat);
    }).catch((err) => console.error("chat " + acct.user + ": open: " + (err?.message ?? err)));
    return chat;
  }

  // what every call of the chat starts with, a summary's too: its system
  // prompt. A summary gets no tools: one it called, ours or the API's
  // own (web search brings code execution), sent its whole input again
  export function share(chat: Chat): Share {
    const system = Tools.system(MASTER);
    return { ...Pick.ask(chat.pick), system, searches: 0, server: "" };
  }

  // at rest (nothing runs): pays, and lets go of a chat nobody views but
  // one whose routines tick (Routines.timed);
  // one ending or moving does that once at its rest (Chat.ending), and
  // one ended or moved never (it pays where it is, or as it closes)
  export function free(chat: Chat): void {
    const acct = chat.acct;
    const ending = chat.ending;
    if (ending !== null && chat.posts === 0 && (!ending.all || Chat.idle(chat))) {
      chat.ending = null;
      ending.then();
    }
    if (ending !== null || !Chat.idle(chat) || Chat.chats.get(acct.user) !== chat) {
      return;
    }
    Chat.cloud.billing.settle(acct.user);
    if (chat.socks.size === 0 && !Routines.timed(chat.mem.routines, chat.mem.timers)) {
      clearInterval(chat.tick);
      Chat.unbridge(chat, Date.now());
      Tools.close(chat.tools);
      Memory.stop(chat.mem);
      Chat.chats.delete(acct.user);
    }
  }

  // no turn, post, agent, summary or paid request runs (one stopped is
  // read on to its end, then billed: Billing.ts book)
  export function idle(chat: Chat): boolean {
    return !chat.busy && chat.posts === 0 && Tools.working(chat.tools).length === 0 && chat.mem.busy.size === 0 && chat.wallet.booked() === 0;
  }

  // stops a chat for good; done at rest, its work logged where it was cut
  // the process going (its exit: a supervised restart's SIGTERM, a lone
  // server's): every chat stopped at once, as Chat.end does, its waits
  // left open on disk.
  // RED ZONE (R4, DRAFT awaiting the user's sign-off): without ending set,
  // each cut wait would close as no and a restart erase it (P10)
  export function quit(): void {
    for (const chat of Chat.chats.values()) {
      chat.tools.ending = true;
      Chat.stop(chat, null);
      Memory.stop(chat.mem);
    }
  }

  export function end(chat: Chat): Promise<void> {
    Chat.chats.delete(chat.acct.user);
    chat.socks.forEach((sock) => sock.close());
    // RED ZONE (R4, DRAFT awaiting the user's sign-off): the waits cut
    // here stay open on disk, for the next process to show again (P10)
    chat.tools.ending = true;
    Chat.stop(chat, null);
    Memory.stop(chat.mem);
    return new Promise((done) => {
      const then = () => {
        Tools.close(chat.tools);
        done();
      };
      chat.ending = { all: true, then };
      Chat.free(chat);
    });
  }

  // a message (its body: its images, sizes given, then its text), logged
  // and taken
  export async function say(chat: Chat, id: string, sizes: number[], body: Body, says = false): Promise<Answer> {
    const images: string[] = [];
    let at = 0;
    for (const size of sizes) {
      const name = await Memory.image_add(chat.mem, await Chat.read(body, at, size));
      if (name === null) {
        return { error: IMAGES };
      }
      images.push(name);
      at += size;
    }
    await Chat.writing(chat, async () => Chat.take(chat, await Chat.text(chat, body, at, images, id, says)));
    return {};
  }

  // up to n bytes of a body, from byte `at`
  export async function read(body: Body, at: number, n: number): Promise<Buffer> {
    const buf = Buffer.alloc(n);
    const got = await body.fh.read(buf, 0, n, at);
    return buf.subarray(0, got.bytesRead);
  }

  // a body's text from byte `at`, logged as the user's message, a read
  // at a time, the last with the images and the act's record. RED ZONE
  // (K3, DRAFT awaiting the user's sign-off): one that speaks for the user
  // (says: a view's, or the terminal key's) tells the user is here, so
  // timers may be set again (Tools.timer); a device key's (an agent's
  // shell can type it) does not
  export async function text(chat: Chat, body: Body, at: number, images: string[], act: string, says = false): Promise<Msg> {
    if (says) {
      chat.tools.rung = false;
    }
    const id = chat.mem.count;
    for await (const [pages, more] of Chat.pieces(body, at, clip_pages)) {
      Chat.push(chat, null, "user", pages.join(""), more ? [] : images, more, more ? undefined : act);
    }
    return { id, end: chat.mem.count };
  }

  // a post's logging, after the chat's earlier ones, holding its other
  // logging (Chat.hold) till it ends, so a long post's pages stay together
  export function writing<T>(chat: Chat, write: () => Promise<T>): Promise<T> {
    const run = chat.writes.then(async () => {
      chat.held = [];
      try {
        return await write();
      } finally {
        const held = chat.held ?? [];
        chat.held = null;
        chat.mem.open = 0;
        held.forEach((step) => step());
      }
    });
    chat.writes = run.catch(() => {});
    return run;
  }

  // a step that logs to the chat: now, or once the post logging ends
  export function hold(chat: Chat, step: () => void): void {
    if (chat.held === null) {
      step();
    } else {
      chat.held.push(step);
    }
  }

  // a body's text from byte `at`, cut in pieces a READ at a time, and
  // whether more come; none over READ
  export async function* pieces(body: Body, at: number, cut: (text: string) => string[]): AsyncGenerator<[string[], boolean]> {
    const dec = new TextDecoder();
    let rest = "";
    do {
      const buf = await Chat.read(body, at, READ);
      at += buf.length;
      const all = cut(rest + dec.decode(buf, { stream: at < body.size }));
      rest = at < body.size ? all.pop()! : "";
      if (rest.length > READ) {
        throw Chat.told("A line over " + READ + " characters: no import sends it.");
      }
      yield [all, at < body.size];
    } while (at < body.size);
  }

  // a recording's words, logged as the act's answer, then billed (booked
  // as its bytes at AUDIO a second)
  export async function voice(chat: Chat, id: string, type: string, body: Body): Promise<Answer> {
    const most = Price.cost(VOICE.model, { ...Price.usage("slow"), seconds: body.size / AUDIO });
    const pay = await chat.mem.pay?.("voice", id)?.({ input: most, token: 0, exact: null }, 0);
    if (typeof pay === "string") {
      return { error: pay };
    }
    const got = await OpenAI.transcribe(new Blob([await Chat.read(body, 0, body.size)], { type })).catch((err: Error) => err);
    if (got instanceof Error) {
      pay?.end(null);
      return { error: got.message };
    }
    Chat.mark(chat, id, { ans: { text: got.text } });
    pay?.end({ run: VOICE, use: { ...Price.usage("slow"), seconds: got.seconds } });
    return { text: got.text };
  }

  // a message logged: to the running call if whole beside its view, else
  // to the next
  export function take(chat: Chat, msg: Msg): void {
    const mem = chat.mem;
    if (chat.call !== null && Memory.whole(mem, msg.id) === msg.id) {
      chat.sent.push(msg);
      chat.call.send(Memory.say(mem, msg.id, msg.end));
      return;
    }
    chat.wait.push(msg);
    if (!chat.busy) {
      Chat.turn(chat);
    }
  }

  // first: the end of the call running (its chat moved here)
  export async function turn(chat: Chat, first: Promise<boolean> | null = null): Promise<void> {
    chat.busy = true;
    try {
      let go = first === null || (await first);
      while (go && chat.wait.length > 0) {
        go = await Chat.call(chat);
      }
    } catch (err: any) {
      Chat.failed(chat, String(err?.message ?? err));
    } finally {
      const why: string | null = chat.halt.signal.aborted ? chat.halt.signal.reason : null;
      if (why !== null) {
        Chat.note(chat, why);
      }
      chat.call = null;
      chat.sent = [];
      chat.wait = [];
      chat.busy = false;
      Chat.live(chat, null, []);
      Chat.phone(chat);
      Chat.after(chat);
      Chat.change(chat);
    }
  }

  // where a call's messages go whole from (a message meanwhile may move it)
  export function from(chat: Chat): number {
    return Memory.whole(chat.mem, chat.wait[0].id);
  }

  // false: the turn ends
  export async function call(chat: Chat): Promise<boolean> {
    const mem = chat.mem;
    const halt = (chat.halt = new AbortController());
    Chat.change(chat);
    let from = -1;
    while (from !== Chat.from(chat)) {
      from = Chat.from(chat);
      const why = await Memory.settle(mem, from, halt.signal);
      if (why !== null) {
        if (!halt.signal.aborted) {
          Chat.failed(chat, why);
        }
        return false;
      }
    }
    const msgs = (chat.sent = chat.wait.splice(0));
    const rolled = chat.rolled;
    chat.rolled = false;
    const says = (rolled ? msgs : msgs.filter((m) => m.end > from)).map((m) => Memory.say(mem, rolled ? m.id : Math.max(m.id, from), m.end));
    const view = Memory.view(mem, from);
    const after = Math.max(from, msgs.at(-1)!.end);
    const text = says.map((say) => say.text).join("\n\n") + (rolled ? ROLLED + Memory.tail(mem, after) : "");
    const imgs = says.flatMap((say) => say.imgs);
    const server = Tools.at(chat.tools, "main");
    chat.eye = Chat.eye(mem, from);
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    const bill = mem.pay?.("chat", String(msgs[0].id));
    const blocks = [...view, Tools.devices(chat.tools), ...Tools.likes(chat.tools), ...Tools.notes_block(chat.tools), ...Tools.directives_block(chat.tools), Tools.at_work(chat.tools), { text: HEAD + text, mark: true }];
    const ask = { ...Chat.share(chat), searches: SEARCHES, server, blocks, imgs, bill };
    chat.model = chat.pick.model;
    chat.asked = true;
    chat.open = 0;
    const call = (chat.call = AskAI.ask(ask, (ev) => Chat.on(chat, null, ev)));
    Chat.change(chat);
    return Chat.ended(chat, call, halt);
  }

  // the turn's call ends; false: the turn ends
  export async function ended(chat: Chat, call: Call, halt: AbortController): Promise<boolean> {
    const end = await call.done;
    chat.call = null;
    Chat.unanswered(chat, null);
    Chat.live(chat, null, []);
    chat.wait.unshift(...chat.sent.slice(chat.sent.length - end.left.length));
    if (end.roll && !halt.signal.aborted) {
      chat.wait.unshift(...chat.sent);
      chat.rolled = true;
    }
    if (!end.ok && !halt.signal.aborted) {
      Chat.failed(chat, end.text);
    }
    if (end.note) {
      Chat.all(chat, { $: "note", text: end.note });
    }
    if (end.ok && !halt.signal.aborted && chat.wait.length === 0 && (await Chat.directed(chat, halt))) {
      return !halt.signal.aborted;
    }
    const goal = chat.mem.goal;
    if (end.ok && !halt.signal.aborted && chat.wait.length === 0 && goal !== null) {
      return Chat.checked(chat, Chat.check(chat, goal), halt);
    }
    return !halt.signal.aborted;
  }

  // the turn-end directives check (Directives.ts): the ask-guard, then,
  // with a directives note, the checker (config.CHECKER, no tools) on the
  // turn's reply; a nudge goes to the turn as the checker's message
  // (true); a turn answering one is never checked; a check that fails, a
  // stop or a message meanwhile: no nudge (a failure noted: fail loud)
  export async function directed(chat: Chat, halt: AbortController): Promise<boolean> {
    const mem = chat.mem;
    const msgs: Array<{ kind: string; text: string }> = [];
    for (let i = mem.count - 1; i >= 0 && msgs.length < SCAN; i--) {
      const m = Memory.message(mem, i);
      if (m === null) {
        break;
      }
      msgs.unshift(m);
      if (m.kind === "user") {
        break;
      }
    }
    const turn = Directives.turn(msgs);
    if (turn.nudged || turn.reply === null) {
      return false;
    }
    const guard = Directives.guard(turn);
    if (guard !== null) {
      return Chat.nudge(chat, guard);
    }
    const note = Notes.notes_read(mem.dir, Directives.NAME);
    if (typeof note === "string" || note.big === true) {
      return false;
    }
    const call = AskAI.ask({ ...Pick.ask(config.CHECKER), system: Directives.SYSTEM, blocks: [{ text: Directives.judge_text(note.text, turn), mark: false }], searches: 0, server: "", bill: mem.pay?.("chat", "check") }, () => {});
    halt.signal.addEventListener("abort", () => call.stop(), { once: true });
    const end = await call.done;
    if (halt.signal.aborted || chat.wait.length > 0) {
      return false;
    }
    if (!end.ok) {
      Chat.note(chat, "No directives check: " + end.text.replace(/\.$/, "") + ".");
      return false;
    }
    const why = Directives.judged(end.text);
    return why !== null && (await Chat.nudge(chat, Directives.nudge(why)));
  }

  // a nudge to the turn, as the goal check's (GOAL_NO): true
  export async function nudge(chat: Chat, text: string): Promise<boolean> {
    await Chat.writing(chat, async () => Chat.take(chat, Chat.push(chat, null, "user", text)));
    return true;
  }

  // the user's goal (/goal), asked of the chat's model, without tools, on
  // the chat as it is now
  export function check(chat: Chat, goal: string): Check<Call> {
    const mem  = chat.mem;
    const at   = Memory.whole(mem, 0);
    const tail = Array.from({ length: mem.count - at }, (_, k) => at + k).map((i) => {
      const msg = Memory.message(mem, i)!;
      return Memory.line({ l: 0, i }, msg.kind + ": " + msg.text) + "\n";
    });
    const blocks = [...Memory.view(mem, at), { text: tail.join("") + GOAL_ASK + goal, mark: true }];
    return { call: AskAI.ask({ ...Chat.share(chat), system: GOAL, blocks, bill: mem.pay?.("chat", "goal") }, () => {}), goal };
  }

  // a goal check's answer, as the turn's call's is, read where the chat
  // is (its call moves with it: Chat.move): unmet (any answer but yes),
  // the user's nudge goes to the turn as their message; met, the goal
  // ends. A check that fails, a stop, a message or a /halt meanwhile end
  // it with no nudge, so the turn ends; false: it ends
  export async function checked(chat: Chat, check: Check<Call>, halt: AbortController): Promise<boolean> {
    const { call, goal } = (chat.check = check);
    halt.signal.addEventListener("abort", () => call.stop(), { once: true });
    const end = await call.done;
    const mem = chat.mem;
    const on = !halt.signal.aborted && mem.goal === goal && chat.wait.length === 0;
    chat.check = null;
    if (on && !end.ok) {
      Chat.note(chat, "No goal check: " + end.text.replace(/\.$/, "") + ". The goal stays; /halt drops it.");
    } else if (on && /^\W*yes\b/i.test(end.text)) {
      mem.goal = null;
      Memory.save(mem);
      Chat.note(chat, "Goal met.");
    } else if (on) {
      await Chat.writing(chat, async () => Chat.take(chat, Chat.push(chat, null, "user", GOAL_NO)));
    }
    return !halt.signal.aborted;
  }

  // a failed turn's why, as a note
  export function failed(chat: Chat, why: string): void {
    Chat.note(chat, "No reply: " + why.replace(/\.$/, "") + ". Send a message to try again.");
  }

  // a note in the chat, why work ended as it did
  export function note(chat: Chat, text: string): void {
    Chat.hold(chat, () => Chat.push(chat, null, "note", text));
  }

  // to the chat (in pages), or an agent's log; each told to every view
  export function push(chat: Chat, agent: Agent | null, kind: Kind, text: string, images: string[] = [], more = false, act?: string): Msg {
    if (agent !== null) {
      const roots = Memory.agent_push(chat.mem, agent.name, kind, text);
      for (const { i, kind, text, date } of roots) {
        Chat.to(chat, agent.name, { $: "entry", agent: agent.name, id: i, kind, text, date });
      }
      Chat.pulse(chat, agent);
      return { id: roots[0].i, end: roots[roots.length - 1].i + 1 };
    }
    const roots = Memory.push(chat.mem, [{ kind, text, images, more, act }]);
    for (const { i, kind, text, date, images } of roots) {
      Chat.all(chat, { $: "entry", id: i, kind, text, date, images });
    }
    return { id: roots[0].i, end: chat.mem.count };
  }

  // a message the call took was logged as it came
  export function on(chat: Chat, agent: Agent | null, ev: Event): void {
    const at = agent ?? chat;
    const name = agent?.name;
    if (agent === null) {
      Chat.asks(chat, ev);
    }
    if (ev.$ === "Delta") {
      live_push(at.live, ev.kind, ev.text, ev.fresh);
      Chat.to(chat, name, { $: "delta", agent: name, kind: ev.kind, text: ev.text, fresh: ev.fresh });
      if (agent !== null) {
        Chat.pulse(chat, agent);
      }
      return;
    }
    if (ev.kind === "tool" && ev.of !== undefined) {
      at.calls[ev.of] = ev.text;
    } else if (ev.kind === "mind") {
      Chat.to(chat, name, { $: "entry", agent: name, kind: ev.kind, text: ev.text });
    } else if (ev.kind !== "user") {
      const call = ev.of === undefined ? undefined : at.calls[ev.of];
      delete at.calls[ev.of ?? ""];
      Chat.hold(chat, () => {
        if (call !== undefined) {
          Chat.push(chat, agent, "tool", call);
        }
        Chat.push(chat, agent, ev.kind, ev.text);
      });
    }
    Chat.live(chat, agent, Chat.waiting(at));
  }

  // what streams once an entry came: the tool calls awaiting their
  // results, as they will be logged; what was drawn never vanishes
  // before it is printed
  export function waiting(at: { calls: Record<string, string> }): Live[] {
    return Object.values(at.calls).map((text) => ({ kind: "tool", text }));
  }

  // a call's tool calls left without a result (it was stopped), logged
  // as they are, once it ends
  export function unanswered(chat: Chat, agent: Agent | null): void {
    const at = agent ?? chat;
    const calls = Object.values(at.calls);
    at.calls = {};
    Chat.hold(chat, () => calls.forEach((call) => Chat.push(chat, agent, "tool", call)));
    Chat.live(chat, agent, []);
  }

  // the model is asked again once handed all it waits for, until its
  // answer starts
  export function asks(chat: Chat, ev: Event): void {
    const kind = ev.$ === "Entry" ? ev.kind : "";
    const step = kind === "tool" ? 1 : kind === "echo" ? -1 : 0;
    chat.open = ev.$ === "Delta" ? 0 : Math.max(0, chat.open + step);
    const asked = (kind === "echo" || kind === "user") && chat.open === 0;
    if (asked !== chat.asked) {
      chat.asked = asked;
      Chat.change(chat);
    }
  }

  // what streams for the chat (agent: null) or an agent, set and told
  export function live(chat: Chat, agent: Agent | null, live: Live[]): void {
    (agent ?? chat).live = live;
    Chat.to(chat, agent?.name, { $: "live", agent: agent?.name, live });
  }

  // an agent's report, once it ends: a turn of its own, unless stopped or
  // out of credit; none once its chat ended (the next start resumes it).
  // It is taken as a post is, so the chat never rests between logging it
  // and its turn
  export function report(chat: Chat, agent: Agent, text: string, stopped: boolean): void {
    Chat.unanswered(chat, agent);
    Chat.live(chat, agent, []);
    Chat.work(chat, text, !stopped && !agent.user);
  }

  // RED ZONE (R4, DRAFT awaiting the user's sign-off): the user's answer
  // to a waiting call (the consent act, behind SAYS: never a device's). A
  // live wait takes it; else a record a restart cut: a yes grants one
  // identical re-issue (P2, the one place a grant is made), its agent told
  export function consented(chat: Chat, n: number, yes: boolean): Answer {
    if (Tools.consent(chat.tools, n, yes)) {
      return {};
    }
    const p = Tools.regrant(chat.tools, n, yes);
    if (p === null) {
      return { error: "No call " + n + " waits for you." };
    }
    if (!yes) {
      Chat.note(chat, "Call " + n + " of " + p.who + " refused.");
      return {};
    }
    const text = "The user approved your call " + n + " (" + p.tool + "), cut by a restart: make it again exactly as before within " + Math.round(Pending.GRANT_MS / 60_000) + " minutes; any change asks again.";
    if (p.who === "main") {
      Chat.work(chat, text, true);
    } else {
      void Tools.tell(chat.tools, "main", p.who, text).then((out) => {
        if (out.fail) {
          Chat.note(chat, "Call " + n + " of " + p.who + " approved, but " + p.who + " was not told: " + out.text);
        }
      });
    }
    return {};
  }

  // a work message to Unii, logged; taken as a turn of its own (take, and
  // credit left), as a post is, so the chat never rests between the two.
  // A report (Chat.report), or a refused call of an agent Unii started
  // waiting for its overrule (Tools.appeal; RED ZONE, DRAFT)
  export function work(chat: Chat, text: string, take: boolean): void {
    Chat.hold(chat, () => {
      chat.posts += 1;
      const msg = Chat.chats.get(chat.acct.user) !== chat ? null : Chat.push(chat, null, "work", text);
      if (msg !== null && take && Chat.cloud.billing.refuse(chat.acct.user, 0) === null) {
        Chat.take(chat, msg);
      }
      chat.posts -= 1;
      Chat.change(chat);
      Chat.free(chat);
    });
  }

  // a turn's last message, Unii's reply or why there was none, to the
  // user's phones (Cloud.push)
  export function phone(chat: Chat): void {
    const last = Memory.message(chat.mem, chat.mem.count - 1);
    if (last !== null && (last.kind === "unii" || last.kind === "note")) {
      Cloud.push(Chat.cloud, chat.acct.user, last.text);
    }
  }

  // config.AFTER, a shell command, after each turn
  export function after(chat: Chat): void {
    if (!config.AFTER) {
      return;
    }
    chat.posts += 1;
    chat.after = chat.after.then(async () => {
      const proc = Bun.spawn(["/bin/sh", "-c", config.AFTER], { stdout: "ignore", stderr: "pipe" });
      const err = await new Response(proc.stderr).text();
      if ((await proc.exited) !== 0) {
        Chat.all(chat, { $: "note", text: "after: " + err.trim() });
      }
    }).catch((err) => console.error("after: " + (err?.message ?? err))).finally(() => {
      chat.posts -= 1;
      Chat.free(chat);
    });
  }

  // Import
  // ------

  // an import (its body: messages as JSON lines), those new (fresh) logged
  // as one, summarized on the compactor; refused amid a turn or an
  // import, or past the credits
  export async function ingest(chat: Chat, id: string, body: Body): Promise<Answer> {
    if (chat.busy || chat.batch !== null) {
      return { error: (chat.busy ? "Unii is answering" : "An import is under way") + ": import again once it ends." };
    }
    const done = Chat.done(chat);
    const sizes: number[] = [];
    let said = 0;
    for await (const msgs of Chat.fresh(body, done)) {
      sizes.push(...msgs.map(Import.import_size));
      said += msgs.filter((m) => m.kind !== "note").length;
    }
    const a = chat.mem.count;
    const usd = Import.import_usd(a, sizes);
    if (sizes.length === 0) {
      return { error: "Nothing to import: no new messages found." };
    }
    const refused = Chat.cloud.billing.refuse(chat.acct.user, usd);
    if (refused !== null) {
      return refused;
    }
    chat.mem.hold[1] = null;
    const tag = (m: Log, of: boolean): Log => ({ ...m, imported: true, ...(of ? { more: true } : { more: false, act: id }) });
    let held: Log[] = [];
    for await (const msgs of Chat.fresh(body, done)) {
      const all = [...held, ...msgs];
      held = all.splice(-1);
      Memory.push(chat.mem, all.map((m) => tag(m, true)));
    }
    Memory.push(chat.mem, held.map((m) => tag(m, false)));
    chat.batch = Chat.batch(chat, { a, b: chat.mem.count, said, spent: 0 });
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    Chat.progress(chat);
    return { going: chat.batch !== null };
  }

  // an import run: its estimate, of its messages' sizes as logged, timed
  // with none built, then its summaries built counted
  export function batch(chat: Chat, { a, b, said, spent }: Kept): Batch {
    const sizes = Array.from({ length: b - a }, (_, k) => Memory.message(chat.mem, a + k)?.size ?? 0);
    const micros = Import.import_guess(a, sizes);
    const batch = { a, b, said, spent, micros, open: micros.map((level) => level.length), left: micros.flat().reduce((x, y) => x + y, 0), all: 0 };
    batch.all = Chat.time(batch);
    micros.forEach((level, l) => level.forEach((_, j) => Memory.node(chat.mem, { l, i: Math.floor(a / 2 ** l) + j }) !== null && Chat.built(batch, l, j)));
    return batch;
  }

  // node j of level l built (none such: the chat's)
  export function built(batch: Batch, l: number, j: number): void {
    const cost = batch.micros[l]?.[j];
    if (cost !== undefined) {
      batch.left -= cost;
      batch.open[l] -= 1;
    }
  }

  // its time left in micro-USD (a call's, as its cost, is its thinking):
  // its cost left over JOBS, then each level not built's last call (the
  // tree's top builds a call a level)
  export function time(batch: Batch): number {
    return batch.left / JOBS + batch.micros.reduce((t, level, l) => t + (batch.open[l] > 0 ? level.at(-1)! : 0), 0);
  }

  // kept as it is till it ends (a restart changes nothing): written
  // whole, then moved in place
  export function keep(batch: Batch, chat: Chat): void {
    const file = chat.mem.dir + BATCH;
    const { a, b, said, spent } = batch;
    fs.writeFileSync(file + ".new", JSON.stringify({ a, b, said, spent, why: chat.mem.hold[1] }));
    fs.renameSync(file + ".new", file);
  }

  // the import a chat ran when let go (BATCH); null: none
  export function resumed(chat: Chat): Batch | null {
    const file = chat.mem.dir + BATCH;
    if (!fs.existsSync(file)) {
      return null;
    }
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    chat.mem.hold[1] = saved.why === "paused" ? "paused" : null;
    return Chat.batch(chat, saved);
  }

  // a body's JSON lines, as messages imported (a line is a page)
  export async function* reads(body: Body): AsyncGenerator<Log[]> {
    for await (const [lines] of Chat.pieces(body, 0, (text) => text.split("\n"))) {
      yield lines.filter((line) => line !== "").map((line) => Chat.imported(JSON.parse(line)));
    }
  }

  // a body's messages new to the chat (Import.import_new): a session
  // imported before brings only what came after, its note only then
  export async function* fresh(body: Body, done: Import.Done): AsyncGenerator<Log[]> {
    let note: Log | null = null;
    let last: string | undefined;
    for await (const msgs of Chat.reads(body)) {
      const out: Log[] = [];
      for (const m of msgs) {
        if (m.kind === "note") {
          [note, last] = [m, done[Import.import_key(m)]];
        } else if (Import.import_new(m, last)) {
          out.push(...(note === null ? [] : [note]), m);
          note = null;
        }
      }
      yield out;
    }
  }

  // the sessions the chat imported (Import.Done), read from its log
  export function done(chat: Chat): Import.Done {
    const done: Import.Done = {};
    let key = "";
    for (let i = 0; i < chat.mem.count; i++) {
      const m = Memory.message(chat.mem, i)!;
      if (m.imported && m.kind === "note") {
        key = Import.import_key(m);
      } else if (m.imported && m.date > (done[key] ?? "")) {
        done[key] = m.date;
      }
    }
    return done;
  }

  // a message imported (a page); a line with no kind or no text refuses
  // the import whole (ingest reads every line before it logs one)
  export function imported(x: any): Log {
    const kinds: Kind[] = ["user", "unii", "tool", "echo", "note"];
    if (!kinds.includes(x?.kind)) {
      throw Chat.told("An import has no kind " + x?.kind + ".");
    }
    if (typeof x.text !== "string") {
      throw Chat.told("An import has a " + x.kind + " message with no text.");
    }
    const date = Number.isNaN(Date.parse(x.date)) ? undefined : new Date(x.date).toISOString();
    return { kind: x.kind, text: x.text, date, more: x.more === true };
  }

  // a summary built (Memory's made): counted, if the import's; sent to
  // each view shown its block (Chat.teach)
  export function made(chat: Chat, l: number, i: number): void {
    if (chat.batch !== null) {
      Chat.built(chat.batch, l, i - Math.floor(chat.batch.a / 2 ** l));
    }
    const [a] = Memory.span({ l, i });
    for (const sock of chat.socks) {
      if (sock.data.seen.has(a + "+" + 2 ** l)) {
        Chat.know(chat, sock, a, 2 ** l);
      }
    }
  }

  // as the view changes (Memory's wait): the state; done when all are
  // built; not as the chat is let go (Chat.resumed)
  export function progress(chat: Chat): void {
    const batch = chat.batch;
    if (batch === null || chat.mem.done) {
      return;
    }
    if (batch.open.every((n) => n === 0)) {
      return Chat.digest(chat, batch);
    }
    Chat.keep(batch, chat);
    Chat.all(chat, Chat.state(chat));
  }

  export function digest(chat: Chat, batch: Batch): void {
    chat.batch = null;
    fs.rmSync(chat.mem.dir + BATCH, { force: true });
    chat.eye = Chat.eye(chat.mem, Math.max(chat.eye.from, batch.b));
    chat.socks.forEach((sock) => Chat.show(chat, sock));
    const said = "Imported " + Import.import_count(batch.said, "") + ".";
    Chat.all(chat, { $: "note", text: said });
    Chat.change(chat);
  }

  // an import paused, at once (Memory.pause), or resumed (short of credit,
  // it waits for it)
  export function go(chat: Chat, on: boolean): Answer {
    if (chat.batch === null) {
      return { error: "No import is running." };
    }
    if (on) {
      chat.mem.hold[1] = null;
    } else {
      Memory.pause(chat.mem);
    }
    Chat.keep(chat.batch, chat);
    Chat.all(chat, Chat.state(chat));
    Memory.pump(chat.mem);
    Chat.change(chat);
    return {};
  }

  // the chats a restart cut at work or importing, or with a routine on by
  // the clock (its tick runs with no view: Routines.timed), opened; one that fails
  // to load is logged and left (its user's page gets the error), never
  // keeping the worker, which serves every other user, from starting
  export function wake(): void {
    const dir = config.DIR + "/users/";
    for (const id of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const user = Main.shard(id) === Main.index ? Cloud.user(Chat.cloud, id) : null;
      const saved = user === null ? null : Memory.saved(dir + id);
      if (user !== null && ((saved?.work ?? []).length > 0 || fs.existsSync(dir + id + BATCH) || Routines.timed(saved?.routines ?? [], saved?.timers ?? []))) {
        Main.event("waking the chat of user " + id, () => Chat.open(user));
      }
    }
  }

  // the work a restart cut goes on, told so: each agent, and Unii's turn
  // by a note (none for a chat ended meanwhile)
  export async function resume(chat: Chat, work: string[]): Promise<void> {
    if (work.length === 0 || Chat.chats.get(chat.acct.user) !== chat) {
      return;
    }
    const text = "The server restarted, cutting " + work.join(", ") + "; nothing was lost: go on.";
    const msg = Chat.push(chat, null, "note", text);
    await Promise.all(work.map((w) => (w === TURN ? Chat.take(chat, msg) : Tools.tell(chat.tools, "main", w, text))));
  }

  // Moving
  // ------

  // the chat moves to `peer`'s process, whose tools are at `url`, once no
  // post of it runs; no summary starts meanwhile, and those running go
  // along (Memory.give): waiting for them hung the chat (an import's run
  // on), cutting them asked each again there, billed twice
  export function give(chat: Chat, peer: Peer, url: string): void {
    Memory.halt(chat.mem);
    chat.ending = { all: false, then: () => Chat.move(chat, peer, url) };
    Chat.free(chat);
  }

  // the chat moves: what it runs goes on there (its calls by Main.away),
  // and its views open again there
  export function move(chat: Chat, peer: Peer, url: string): void {
    const user = chat.acct.user;
    const far = (call: Call) => Main.away(peer, call);
    const { busy, model, sent, wait, asked, open, live, calls, eye } = chat;
    const check = chat.check && { call: far(chat.check.call), goal: chat.check.goal };
    const turn = { busy, call: chat.call && far(chat.call), model, check, sent, wait, asked, open, live, calls, eye };
    const tools = Tools.give(chat.tools, url, far);
    if (chat.batch !== null) {
      Chat.keep(chat.batch, chat);
    }
    const sums = Memory.give(chat.mem, far);
    Chat.chats.delete(user);
    Memory.stop(chat.mem);
    peer.send({ $: "chat", moved: { user, credit: Chat.cloud.billing.credit.get(user), turn, tools, sums } });
    chat.socks.forEach((sock) => sock.close(MOVE));
    Main.done();
  }

  // a chat moved here (Chat.move) goes on: its turn, agents and summaries,
  // each call running there by Main.far
  export function arrive(chat: Chat, moved: Moved, peer: Peer): void {
    const { call, check, ...turn } = moved.turn;
    const far = (id: string, on: (ev: Event) => void, bill?: Bill) => Main.far(peer, id, chat.tools.key, on, bill);
    Object.assign(chat, turn);
    Tools.take(chat.tools, moved.tools, far);
    Memory.take(chat.mem, moved.sums, (id, bill) => far(id, () => {}, bill));
    if (turn.busy) {
      const run = call === null ? null : (chat.call = far(call, (ev) => Chat.on(chat, null, ev), chat.mem.pay?.("chat", String(turn.sent[0].id))));
      const checking = check ? { call: far(check.call, () => {}, chat.mem.pay?.("chat", "goal")), goal: check.goal } : null;
      Chat.turn(chat, run ? Chat.ended(chat, run, chat.halt) : checking && Chat.checked(chat, checking, chat.halt));
    }
  }

  // what runs: Unii's turn, the agents at work
  export function running(chat: Chat): string[] {
    return [...(chat.busy ? [TURN] : []), ...Tools.working(chat.tools).map((a) => a.name)];
  }

  // Legion's turn only, with the spawns and tells it waits on (for the
  // view: Tools.view, on chat.halt); agents go on. why: the note the turn's
  // end logs (Chat.turn), so after the reply the stop cut; null: none
  export function interrupt(chat: Chat, why: string | null): void {
    chat.halt.abort(why);
    chat.call?.stop();
  }

  // all work, agents too; its why noted at the turn's end, or at once if
  // no turn is left to end
  export function stop(chat: Chat, why: string | null): void {
    const turn = chat.busy && !chat.halt.signal.aborted;
    Chat.interrupt(chat, turn ? why : null);
    Tools.stop(chat.tools, null);
    if (!turn && why !== null) {
      Chat.note(chat, why);
    }
  }

  // Views
  // -----
  // A socket message carries at most one log entry, summary or job, so
  // none is too large to hear the next tick in time.

  export function all(chat: Chat, msg: Out): void {
    chat.socks.forEach((sock) => Chat.send(sock, msg));
  }

  // the chat's (agent: none) to every view, an agent's to those showing
  // its page (they asked for it: Chat.ask)
  export function to(chat: Chat, agent: string | undefined, msg: Out): void {
    chat.socks.forEach((sock) => (agent === undefined || sock.data.watch.has(agent)) && Chat.send(sock, msg));
  }

  // an agent's pulse to every view, once PULSE ms after the first event
  // since its last: a burst is one, told as it is then
  export function pulse(chat: Chat, agent: Agent): void {
    const due = PULSES.get(chat) ?? new Set<string>();
    PULSES.set(chat, due);
    if (due.has(agent.name)) {
      return;
    }
    due.add(agent.name);
    setTimeout(() => {
      due.delete(agent.name);
      const now = chat.tools.agents.get(agent.name);
      if (now !== undefined) {
        Chat.all(chat, Tools.pulse(chat.tools, now));
      }
    }, PULSE);
  }

  // the shell commands running to every view (B2), once SHELLS ms after
  // the first change since the last: as they are then
  export function shelled(chat: Chat): void {
    if (SHELLED.has(chat)) {
      return;
    }
    SHELLED.add(chat);
    setTimeout(() => {
      SHELLED.delete(chat);
      Chat.all(chat, { $: "shells", shells: Tools.shells(chat.tools) });
    }, SHELLS);
  }

  export function send(sock: Sock, msg: object): void {
    sock.send(JSON.stringify(msg));
  }

  export function state(chat: Chat): Out {
    const agents = Tools.working(chat.tools).map((a) => a.name);
    const crew = Tools.crew(chat.tools);
    const batch = chat.batch;
    const why = chat.mem.hold[1];
    const importing = batch && { done: batch.all - Chat.time(batch), total: batch.all, spent: batch.spent, left: batch.left / 1e6, why, msgs: batch.b - batch.a, open: batch.open };
    const billing = Chat.cloud.billing;
    return { $: "state", busy: chat.busy, wait: Chat.waits(chat), agents, crew, pick: chat.pick, ...config.OFFER, bills: billing.bills, credits: billing.credits(chat.acct.user), importing, questions: chat.mem.questions, mode: chat.mem.mode, plan: chat.mem.plan, status: chat.status ?? null, calls: Tools.consents(chat.tools), trouble: chat.mem.trouble, routines: chat.mem.routines, timers: chat.mem.timers, drafts: chat.mem.drafts, assigned: chat.mem.assigned, decided: chat.mem.decided, tallies: chat.mem.tallies, pins: chat.mem.pinned, notebook: Notes.notes_list(chat.mem.dir), shells: Tools.shells(chat.tools), tracks: Explain.track_views(crew, chat.mem.tracks) };
  }

  export function waits(chat: Chat): Wait {
    if (chat.call !== null) {
      return chat.asked ? chat.model : "";
    }
    const summing = chat.busy && chat.wait.length > 0 && Memory.first(chat.mem) < Chat.from(chat);
    return summing ? SUMMARIES : "";
  }

  // the wallet told the change (Billing.ts changed): what it ends stops
  // all work running, saying so; what runs is saved, unless the chat ended
  export function change(chat: Chat): void {
    const stop = chat.wallet.changed();
    const work = Chat.running(chat);
    if (Chat.chats.get(chat.acct.user) === chat && String(work) !== String(chat.mem.work)) {
      chat.mem.work = work;
      Memory.save(chat.mem);
    }
    const turn = chat.busy && !chat.halt.signal.aborted;
    const agents = [...chat.tools.agents.values()].some((a) => a.call !== null && !a.stop);
    if ((turn || agents) && stop !== null) {
      Chat.stop(chat, stop);
    }
    Chat.all(chat, Chat.state(chat));
    Chat.free(chat);
  }

  // a view joins on the chat as it is now; a terminal's device too (told
  // its name if its host's was taken)
  export function join(chat: Chat, sock: Sock): void {
    const { tab, host, computer, work, home } = sock.data;
    chat.socks.add(sock);
    Chat.send(sock, Chat.state(chat));
    if (chat.inbox !== undefined) {
      Chat.send(sock, { $: "inbox", inbox: chat.inbox });
    }
    if (chat.themes !== undefined) {
      Chat.send(sock, { $: "themes", themes: chat.themes });
    }
    for (const [id, summary] of Object.entries(chat.mem.summaries)) {
      Chat.send(sock, { $: "summary", id, summary });
    }
    Chat.send(sock, { $: "explain", explain: chat.mem.explain });
    Chat.show(chat, sock);
    Chat.send(sock, { $: "live", live: chat.live });
    if (host === null) {
      return;
    }
    const link = { send: (msg: object) => Chat.send(sock, msg), live: () => chat.socks.has(sock), computer, work, home: home ?? undefined };
    sock.data.device = Tools.attach(chat.tools, tab, host, sock.data.who, link);
    if (sock.data.device !== host) {
      Chat.send(sock, { $: "note", text: host + " was taken: Unii calls this computer " + sock.data.device + "." });
    }
  }

  // a socket closed; a terminal's device goes only if it quit (a link lost
  // is no quit)
  export function leave(chat: Chat, sock: Sock, quit: boolean): void {
    chat.socks.delete(sock);
    if (quit && sock.data.device !== null) {
      Tools.detach(chat.tools, sock.data.tab, sock.data.device);
    }
    Chat.free(chat);
  }

  // a view's message answered (ack): a read at once, else as Chat.apply
  // does it. A client sends it, so it may be anything (not JSON, a field
  // missing): one that fails is answered its error, as a failed act is,
  // and never ends the process, which serves other users too
  export async function answer(chat: Chat, sock: Sock, data: string): Promise<void> {
    chat.posts += 1;
    let msg: any = null;
    const out = await Promise.try(() => {
      msg = JSON.parse(data);
      return Chat.ask(chat, sock, msg) ?? Chat.apply(chat, msg, sock.data.device ?? "", sock.data.says === true);
    }).catch(Chat.fail);
    chat.posts -= 1;
    Chat.send(sock, { $: "ack", id: msg?.id, ...out });
    Chat.free(chat);
  }

  // what a message or act that threw answers: an error meant for the user
  // (Chat.told) as it is; any other (a bug's, a library's: paths, a
  // query) logged here, the client told only that it failed (security
  // review SC)
  export function fail(err: any): Answer {
    if (err?.told === true) {
      return { error: String(err.message) };
    }
    console.error("unii: failed: " + (err?.stack ?? err));
    return { error: "Something went wrong on the server; it was logged." };
  }

  // an error whose words are for the user (Chat.fail tells them)
  export function told(text: string): Error {
    return Object.assign(new Error(text), { told: true });
  }

  // a read, answered by what it sends; null: no read
  export function ask(chat: Chat, sock: Sock, msg: any): Answer | null {
    switch (msg.$) {
      case "zoom": {
        const [id, n] = [...msg.part].map(Number);
        if (n > 1 && Memory.part(chat.mem, id, n) !== null) {
          const parts: Part[] = [[id, n / 2], [id + n / 2, n / 2]];
          Chat.teach(chat, sock, parts);
          Chat.send(sock, { $: "zoom", id, n, parts });
        }
        return {};
      }
      case "root": {
        const parts = Memory.roots(chat.mem.count).map(({ l, i }): Part => [i * 2 ** l, 2 ** l]);
        Chat.teach(chat, sock, parts);
        Chat.send(sock, { $: "root", parts });
        return {};
      }
      // the user's search of their chat (the Memory page): answered at
      // once, its hits sent as recalled (Chat.search)
      case "search": {
        const q = typeof msg.q === "string" ? msg.q.trim() : "";
        if (q === "" || q.length > FIND) {
          return { error: q === "" ? "Search for what?" : "A search is " + FIND + " characters at most." };
        }
        void Chat.search(chat, sock, q);
        return {};
      }
      // what the view has in sight: those it hears the deltas and
      // entries of from now (its focus asks for its log: "agent")
      case "watch": {
        const names: string[] = Array.isArray(msg.names) ? [...new Set<string>(msg.names.map((n: unknown) => String(n)))] : [];
        sock.data.watch = new Set(names.filter((n) => Memory.agent(chat.mem, n) !== null).slice(0, WATCH));
        return {};
      }
      case "agent": {
        const name = String(msg.name);
        const log = Memory.agent(chat.mem, name);
        if (log !== null) {
          sock.data.watch.add(name);
        }
        Chat.send(sock, { $: "agent", name, found: log !== null });
        log?.forEach(({ kind, text, date }) => Chat.send(sock, { $: "entry", agent: name, kind, text, date }));
        Chat.send(sock, { $: "live", agent: name, live: chat.tools.agents.get(name)?.live ?? [] });
        return {};
      }
    }
    return null;
  }

  // THE apply point: every change is done here once, however often it
  // comes. An act being done, or recorded done (its record's answer, kept
  // by Cloud.act_put as the log indexes it), gets that answer; else
  // Chat.act does it, answered once on disk (says: as Chat.act's)
  export function apply(chat: Chat, msg: any, device: string, says = device === ""): Promise<Answer> {
    const id = String(msg.id);
    const was = chat.acts.get(id) ?? (Cloud.act_get(chat.acct, id) as Answer | null);
    if (was !== null) {
      return Promise.resolve(was);
    }
    const run = Chat.act(chat, id, msg, device, says).catch(Chat.fail).then(async (out) => {
      await Disk.synced();
      chat.acts.delete(id);
      return out;
    });
    chat.acts.set(id, run);
    return run;
  }

  // an act changes the chat. One that would change it again if done again
  // (a post adds again; a stop ends what runs by then) is recorded: logged
  // (Chat.mark) before any effect off the log, or as the last page of
  // what it logs; each costs credit or ends what credit started. The rest
  // set state (a pick: view.json; an import's hold: its file) or end a
  // job, so done again they change nothing, and only that state is kept,
  // written over; a stop with nothing to stop is one (so one a client
  // sends again, its answer lost, may end what runs by then).
  // device: the device whose socket sent it ("": a view's). RED ZONE (K1,
  // DRAFT awaiting the user's sign-off): says: the act speaks for the user
  // (Cloud.speaks: a browser's, or the terminal key's socket, a device
  // too), so the acts only the user may do take it as a view's (asker
  // ""); one on a device key (a file an agent's shell can read) is refused
  export async function act(chat: Chat, id: string, msg: any, device: string, says = device === ""): Promise<Answer> {
    if ("req" in msg && BODIES.includes(msg.$)) {
      return Chat.post(chat, id, msg, says);
    }
    const asker = says ? "" : device;
    if (asker !== "" && SAYS.includes(msg.$)) {
      return { error: "That is the user's say: give it in a view (the web), or in the terminal once legion login signed it in." };
    }
    switch (msg.$) {
      case "stop": {
        const name = msg.name === undefined ? null : String(msg.name);
        const what = Chat.running(chat).filter((w) => name === null || w === name);
        const why = "Stopped by the user: " + what.join(", ") + ".";
        const turn = what.includes(TURN);
        // the user's Stop of all work: every timer goes too, Unii's and
        // an agent's not at work (R4, RED ZONE: signed off by the user
        // 2026-11-19); one agent's Stop drops its own (Tools.stop)
        if (name === null && chat.mem.timers.length > 0) {
          Chat.note(chat, "Stopped by the user: timers " + chat.mem.timers.map((t) => t.id).join(", ") + " closed.");
          chat.mem.timers = [];
          Memory.save(chat.mem);
          Chat.change(chat);
        }
        // RED ZONE (B2, DRAFT awaiting the user's sign-off): the user's
        // Stop of all work (from what speaks for them: says) ends every
        // shell command too, the background's (Tools.halt_shells); a
        // device key's stops the agents as ever, so their calls, not
        // what was sent to the background
        const shells = name === null && says ? Tools.halt_shells(chat.tools, null, true) : 0;
        if (shells > 0) {
          Chat.note(chat, "Stopped by the user: " + shells + (shells === 1 ? " shell command." : " shell commands."));
        }
        if (what.length === 0) {
          return {};
        }
        Chat.mark(chat, id, {});
        if (turn) {
          Chat.interrupt(chat, why);
        }
        what.forEach((w) => Tools.stop(chat.tools, w));
        if (!turn) {
          Chat.note(chat, why);
        }
        return {};
      }
      case "goal": {
        const goal = msg.text === null ? null : String(msg.text);
        if (goal === chat.mem.goal) {
          return {};
        }
        chat.mem.goal = goal;
        Memory.save(chat.mem);
        if (goal === null) {
          Chat.note(chat, "Goal halted by the user.");
        }
        return {};
      }
      case "go": {
        return Chat.go(chat, msg.on === true || msg.on === "true");
      }
      case "guess": {
        // a read: an import priced here, not by a unii older than PRICE
        let sizes = "";
        for await (const data of msg.req?.body ?? []) {
          sizes += Buffer.from(data);
          if (sizes.length > FRAME) {
            return { error: "Too large.", status: 413 };
          }
        }
        return { usd: Import.import_usd(chat.mem.count, sizes.split(",").map(Number)) };
      }
      case "pick": {
        const pick = Pick.read(msg.to, config.OFFER);
        if (pick === null) {
          return { error: "No pick " + JSON.stringify(msg.to) + "." };
        }
        chat.pick = chat.mem.pick = pick;
        Memory.save(chat.mem);
        Chat.change(chat);
        return {};
      }
      case "out": {
        Tools.done(chat.tools, device, String(msg.job), msg.out);
        return {};
      }
      // a device's shell command's output so far (B2: its own jobs only)
      case "tail": {
        Tools.tail(chat.tools, device, String(msg.job), String(msg.text ?? ""));
        return {};
      }
      case "shell": {
        return Chat.shell(chat, msg.op, msg.job, says);
      }
      case "spawn": {
        // refused as a post is, short of credit
        const task = String(msg.task ?? "").trim();
        if (task === "") {
          return { error: "No task." };
        }
        const refused = await Chat.afford(chat);
        if (refused !== null) {
          return refused;
        }
        Chat.mark(chat, id, {});
        const begun = await Tools.begin(chat.tools, task);
        Chat.note(chat, "name" in begun ? "Started " + begun.name + " (by the user): " + task : "No agent started: " + begun.why);
        return {};
      }
      case "mode": {
        return Chat.remode(chat, msg.mode);
      }
      case "status": {
        return Chat.reported(chat, device, msg);
      }
      case "inbox": {
        return Chat.inboxed(chat, device, msg.inbox);
      }
      case "review": {
        return Chat.review(chat, id, msg);
      }
      case "routine": {
        return Chat.routine(chat, id, msg, asker);
      }
      case "timer": {
        return Chat.untimed(chat, asker, msg);
      }
      case "themes": {
        return Chat.themes(chat);
      }
      case "transcript": {
        return Chat.transcript(chat, device, msg);
      }
      case "look": {
        return Chat.look(chat, id, msg.what, asker);
      }
      case "timesheet": {
        return Chat.timesheet(chat, id, msg);
      }
      case "harvested": {
        return Chat.harvested(chat, device, msg);
      }
      case "looked": {
        return Chat.looked(chat, device, msg);
      }
      case "undo":
      case "handoff": {
        return Chat.crew_op(chat, id, msg.$, String(msg.name ?? ""), asker);
      }
      case "did": {
        return Chat.did(chat, device, msg);
      }
      case "fetch": {
        if (Tools.opened(chat.tools).length === 0) {
          return { error: "No device is up to read the inbox: open a terminal (legion), or run legion device (legion device --install keeps one running)." };
        }
        Chat.all(chat, { $: "fetch" });
        return {};
      }
      case "consent": {
        return Chat.consented(chat, Number(msg.n), msg.yes === true);
      }
      case "plan": {
        return Chat.verdict(chat, id, msg.yes === true, msg.mode, msg.text === undefined || msg.text === null ? "" : String(msg.text).trim());
      }
      case "answer": {
        return Chat.reply(chat, id, Number(msg.q), msg.text === undefined || msg.text === null ? "" : String(msg.text).trim());
      }
      case "bang": {
        return Chat.bang(chat, id, String(msg.command ?? "").trim(), device, says, msg.device, msg.dir);
      }
      case "tell": {
        // the person's message to an agent, as Unii's tell; refused as a
        // post is, short of credit
        const text = String(msg.text ?? "").trim();
        if (text === "") {
          return { error: "No message." };
        }
        const refused = await Chat.afford(chat);
        if (refused !== null) {
          return refused;
        }
        const told = await Tools.tell(chat.tools, "main", String(msg.name), text);
        return told.fail ? { error: told.text } : {};
      }
      case "approve": {
        // the person's yes (refused as a post is, short of credit: its
        // report takes a turn) or no to a Claude Code worker asking
        const yes = msg.yes === true;
        const refused = yes ? await Chat.afford(chat) : null;
        if (refused !== null) {
          return refused;
        }
        const said = Tools.approve(chat.tools, String(msg.name), yes);
        Chat.note(chat, said);
        return said.startsWith("No ") ? { error: said } : {};
      }
      case "dismiss": {
        const agent = chat.tools.agents.get(String(msg.name));
        if (agent === undefined || Tools.working(chat.tools).includes(agent)) {
          return { error: "No agent " + msg.name + " done to dismiss." };
        }
        agent.hidden = true;
        // its track goes with it: the user's pins on it pruned
        if (agent.parent === "main" && agent.name in chat.mem.tracks) {
          delete chat.mem.tracks[agent.name];
          Memory.save(chat.mem);
        }
        Chat.change(chat);
        return {};
      }
      case "pin": {
        return Chat.pin(chat, asker, msg);
      }
      case "note": {
        return Chat.noted(chat, asker, msg);
      }
      case "assignment": {
        return Chat.assignment(chat, id, asker, msg);
      }
      case "explain": {
        return Chat.explain(chat, asker, msg);
      }
      case "track": {
        return Chat.track(chat, asker, msg);
      }
      case "decision": {
        return Chat.decision(chat, id, asker, msg);
      }
    }
    return { error: "No act " + msg.$ + "." };
  }

  // RED ZONE (access control; DRAFT awaiting the user's sign-off): the
  // user's Done or Drop of a todo an agent filed (Tools.assign). A view's
  // act only: a device's socket is within an agent's reach, and an agent
  // must not tick its own todos done (refused, as Chat.pin refuses it).
  // The todo leaves the list at once, so a resent act finds none and the
  // filer is told once. Done: Legion's todo, a message quoting it and a
  // turn (as an answer; refused short of credit, the todo kept); an agent
  // at work, told as a tell; else Legion's note. Drop: a note, no turn
  export async function assignment(chat: Chat, id: string, device: string, msg: any): Promise<Answer> {
    if (device !== "") {
      return { error: "Todos are the user's: tick them in a view (the web, or the terminal's Todo page)." };
    }
    const a = Number.isInteger(msg.n) && typeof msg.done === "boolean" ? chat.mem.assigned.find((x) => x.n === msg.n) : undefined;
    if (a === undefined) {
      return { error: "No todo " + JSON.stringify(msg.n)?.slice(0, 40) + "." };
    }
    const refused = msg.done && a.by === "main" ? await Chat.afford(chat) : null;
    if (refused !== null) {
      return refused;
    }
    chat.mem.assigned = chat.mem.assigned.filter((x) => x !== a);
    Memory.save(chat.mem);
    Chat.change(chat);
    const whose = a.by === "main" ? "your" : a.by + "'s";
    const said = "todo " + a.n + " (" + a.text + ")";
    if (!msg.done) {
      Chat.note(chat, "The user dropped " + whose + " " + said + ".");
      return {};
    }
    if (a.by === "main") {
      await Chat.said(chat, id, "Done: your " + said + ".");
      return {};
    }
    const agent = chat.tools.agents.get(a.by);
    const told = agent !== undefined && Tools.working(chat.tools).includes(agent) ? await Tools.tell(chat.tools, "main", a.by, "The user did your " + said + ".") : null;
    if (told === null || told.fail) {
      Chat.note(chat, "The user did " + whose + " " + said + ".");
    }
    return {};
  }

  // the user's pin of a chat message, or unpin (Memory.pin): a view's act
  // only, as no agent may pin (a device's socket is within an agent's
  // reach: refused); i an index, on a boolean; past a cap, refused with why.
  // State, as a pick is: not recorded
  export function pin(chat: Chat, device: string, msg: any): Answer {
    if (device !== "") {
      return { error: "Pins are the user's: pin from the web." };
    }
    if (!Number.isInteger(msg.i) || typeof msg.on !== "boolean") {
      return { error: "No pin " + JSON.stringify(msg.i)?.slice(0, 40) + "." };
    }
    const why = Memory.pin(chat.mem, msg.i, msg.on);
    if (why !== null) {
      return { error: why };
    }
    Chat.change(chat);
    return {};
  }

  // the user's edit or drop of one of Unii's notes (Notes.ts): a view's
  // act only, as Chat.pin's (N6); an edit with no line keeps the old one
  export function noted(chat: Chat, device: string, msg: any): Answer {
    if (device !== "") {
      return { error: "Notes are the user's to edit: edit them on the web." };
    }
    const dir = chat.mem.dir;
    const name = String(msg.name ?? "");
    if (msg.drop === true) {
      const out = Notes.notes_drop(dir, name);
      if (out !== true) {
        return { error: out };
      }
    } else {
      if (typeof msg.text !== "string") {
        return { error: "Give the note's text." };
      }
      // only Unii makes notes (Tools.notes): a view edits one that is
      const had = Notes.notes_read(dir, name);
      if (typeof had === "string") {
        return { error: had };
      }
      const out = Notes.notes_write(dir, name, typeof msg.line === "string" ? msg.line : null, msg.text);
      if (typeof out === "string") {
        return { error: out };
      }
    }
    Chat.change(chat);
    return {};
  }

  // a socket's search (Memory.find), its hits sent to it; a newer one
  // of the socket's, or the socket gone, ends it
  const searches = new WeakMap<Sock, string>();
  export async function search(chat: Chat, sock: Sock, q: string): Promise<void> {
    const key = crypto.randomUUID();
    searches.set(sock, key);
    const on = () => searches.get(sock) === key && chat.socks.has(sock);
    const found = await Memory.find(chat.mem, q, on).catch(Chat.fail);
    if (on() && "hits" in found) {
      Chat.send(sock, { $: "recalled", q, ...found });
    }
  }

  // why the user can't start work now (no credit, a balance read first:
  // a top-up lands there); null: they can
  export async function afford(chat: Chat): Promise<Answer | null> {
    const billing = Chat.cloud.billing;
    if (billing.refuse(chat.acct.user, 0) !== null) {
      await billing.balance(chat.acct.user);
    }
    return billing.refuse(chat.acct.user, 0);
  }

  // a post (msg.req) refused before a byte of its body is read, so a chat
  // without credit stores none: under SPARE free, 507; refused by the
  // billing, asked again after a balance read (a top-up lands there). Else
  // its body goes to a file unlinked once open, then its act is done
  export async function post(chat: Chat, id: string, msg: any, says = false): Promise<Answer> {
    const disk = fs.statfsSync(config.DIR);
    if (disk.bavail * disk.bsize < SPARE) {
      return { error: FULL, status: 507 };
    }
    const billing = Chat.cloud.billing;
    if (billing.refuse(chat.acct.user, 0) !== null) {
      await billing.balance(chat.acct.user);
    }
    const refused = billing.refuse(chat.acct.user, 0);
    if (refused !== null) {
      return refused;
    }
    const file = chat.mem.dir + "/up/" + crypto.randomUUID();
    fs.mkdirSync(chat.mem.dir + "/up", { recursive: true });
    const body = { fh: await fs.promises.open(file, "w+"), size: 0 };
    fs.rmSync(file);
    try {
      for await (const data of msg.req.body ?? []) {
        await body.fh.write(data);
        body.size += data.length;
      }
      switch (msg.$) {
        case "say": {
          return await Chat.say(chat, id, msg.sizes.split(",").filter(Boolean).map(Number), body, says);
        }
        case "import": {
          return await Chat.writing(chat, () => Chat.ingest(chat, id, body));
        }
        case "voice": {
          return await Chat.voice(chat, id, String(msg.type), body);
        }
      }
      return { error: "No act " + msg.$ + "." };
    } finally {
      await body.fh.close();
    }
  }

  // the person's answer to an open question (Tools.question): logged as
  // their message quoting it, which Unii answers in a turn (refused as a
  // post is, short of credit); no text dismisses it, a note, no turn (a
  // note of Unii's, notify, dismissed silently)
  export async function reply(chat: Chat, id: string, n: number, text: string): Promise<Answer> {
    const q = chat.mem.questions.find((x) => x.id === n);
    if (q === undefined) {
      return { error: "No open question " + n + "." };
    }
    const refused = text === "" ? null : await Chat.afford(chat);
    if (refused !== null) {
      return refused;
    }
    chat.mem.questions = chat.mem.questions.filter((x) => x !== q);
    Memory.save(chat.mem);
    Chat.change(chat);
    if (text === "") {
      if (!q.fyi) {
        Chat.note(chat, "The user dismissed your question " + n + " (" + q.text + ").");
      }
      return {};
    }
    Chat.tally(chat, q, text);
    await Chat.said(chat, id, (q.fyi ? "Reply to your note " : "Answer to your question ") + n + " (" + q.text + "):\n" + text);
    return {};
  }

  // RED ZONE (who decides, DRAFT awaiting the user's sign-off): super
  // auto's record of the user's answer to a question with a kind and a
  // pick (Modes.counted: took it or not); one not the pick learned as a
  // preference (Chat.like). Saved
  export function tally(chat: Chat, q: Question, text: string): void {
    const pick = q.pick === undefined ? undefined : q.options?.[q.pick];
    if (q.fyi || q.kind === undefined || pick === undefined) {
      return;
    }
    const took = Modes.took(q, text);
    chat.mem.tallies = { ...chat.mem.tallies, [q.kind]: Modes.counted(chat.mem.tallies[q.kind], took) };
    if (!took) {
      Chat.like(chat, q.kind, text, pick, q.text);
    }
    Memory.save(chat.mem);
  }

  // what the user chose over Legion's pick, a line in its preferences
  // (Tools.likes): new ones last, the same one once, at most LIKES
  export function like(chat: Chat, kind: string, chose: string, pick: string, question: string): void {
    const cut = (x: string, most: number) => {
      const flat = x.replace(/\s+/g, " ").trim();
      return flat.length > most ? flat.slice(0, most - 1) + "…" : flat;
    };
    const line = "On " + kind + ": user chose '" + cut(chose, 120) + "' over '" + cut(pick, 120) + "' (" + cut(question.split("\n")[0]!, 80) + ")";
    chat.mem.likes = [...chat.mem.likes.filter((l) => l !== line), line].slice(-LIKES);
  }

  // RED ZONE (access control and who decides; DRAFT awaiting the user's
  // sign-off): the user's Undo or Dismiss of a decision super auto took
  // for them (Tools.decide). A view's act only: a device's socket is
  // within an agent's reach, and an agent must not undo or clear its own
  // decisions (refused, as Chat.pin refuses it). Shown DECIDED_MS. It
  // leaves the list at once, so a resent act finds none and Legion is told
  // once. Undo: Legion hears "The user reversed decision N (...): <their
  // answer>" (none given: not to do it, and to ask) and takes a turn
  // (refused short of credit, the decision kept); an override in its
  // kind's record (Modes.undone: 2 of its last 10 relock it), and a typed
  // answer a preference. Dismiss: gone, no turn
  export async function decision(chat: Chat, id: string, device: string, msg: any): Promise<Answer> {
    if (device !== "") {
      return { error: "Decisions are the user's: undo them in a view (the web, or the terminal's Questions page)." };
    }
    const fresh = (d: Decided) => Date.now() - Date.parse(d.date) < DECIDED_MS;
    const d = Number.isInteger(msg.n) && typeof msg.undo === "boolean" ? chat.mem.decided.find((x) => x.id === msg.n && fresh(x)) : undefined;
    if (d === undefined) {
      return { error: "No decision " + JSON.stringify(msg.n)?.slice(0, 40) + " to undo." };
    }
    const refused = msg.undo ? await Chat.afford(chat) : null;
    if (refused !== null) {
      return refused;
    }
    chat.mem.decided = chat.mem.decided.filter((x) => x !== d);
    if (msg.undo) {
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 2000) : "";
      chat.mem.tallies = { ...chat.mem.tallies, [d.kind]: Modes.undone(chat.mem.tallies[d.kind], d.id) };
      if (text !== "") {
        Chat.like(chat, d.kind, text, d.answer, d.question);
      }
      Memory.save(chat.mem);
      Chat.change(chat);
      await Chat.said(chat, id, "The user reversed decision " + d.id + " (" + d.question + "): " + (text === "" ? "do not do this, ask me" : text));
      return {};
    }
    Memory.save(chat.mem);
    Chat.change(chat);
    return {};
  }

  // a message logged as the user's, which Unii answers in a turn (the
  // user is here: timers may be set again, Tools.timer)
  export function said(chat: Chat, id: string, text: string): Promise<void> {
    chat.tools.rung = false;
    return Chat.writing(chat, async () => {
      const at = chat.mem.count;
      Chat.push(chat, null, "user", text, [], false, id);
      Chat.take(chat, { id: at, end: chat.mem.count });
    });
  }

  // a device's report for the status line (Device.device_status), only
  // a device's (a terminal or `legion device`), its fields checked; kept
  // as the latest, told every view when it changes
  export function reported(chat: Chat, device: string, msg: any): Answer {
    const text = (x: unknown) => typeof x === "string" && x.length <= 200;
    const usd = (x: unknown) => x === null || Number.isFinite(x);
    const ok = text(msg.dir) && (msg.branch === null || text(msg.branch)) && usd(msg.spend) && typeof msg.stale === "boolean" && (msg.week === undefined || usd(msg.week));
    if (device === "" || !ok) {
      return { error: device === "" ? "Only a device reports its status." : "A status needs dir, branch, spend and stale." };
    }
    const status: DeviceStatus = { device, dir: msg.dir, branch: msg.branch, spend: msg.spend, stale: msg.stale, ...(msg.week === undefined ? {} : { week: msg.week }) };
    if (JSON.stringify(status) !== JSON.stringify(chat.status ?? null)) {
      chat.status = status;
      Chat.change(chat);
    }
    return {};
  }

  // a device's inbox (Device.device_inbox), only a device's, checked
  // (Inbox.inbox_check: what a view is shown); kept, told every view
  // the files pane and git tab (K4): a view's look, its shape checked, to
  // the devices (each checks it against its own roots: Device.device_look)
  // under the act's id; at most LOOKS waiting (the oldest let go)
  // device: who asks ("": a view); a save only a view's (RED ZONE: the
  // user's edit, never a device's nor an agent's)
  export function look(chat: Chat, id: string, raw: any, device = ""): Answer {
    const str = (x: unknown) => typeof x === "string" && x.length > 0 && x.length <= LOOK_TEXT;
    const what: Look | null =
      raw?.kind === "file" && str(raw.path) && (raw.agent === undefined || str(raw.agent)) ? { kind: "file", path: raw.path, ...(raw.agent === undefined ? {} : { agent: raw.agent }) }
      : raw?.kind === "git" && str(raw.repo) && str(raw.op) && (raw.rev === undefined || str(raw.rev)) ? { kind: "git", repo: raw.repo, op: raw.op, ...(raw.rev === undefined ? {} : { rev: raw.rev }) }
      : (raw?.kind === "dir" || raw?.kind === "open") && str(raw.path) ? { kind: raw.kind, path: raw.path }
      : (raw?.kind === "find" || raw?.kind === "grep") && str(raw.path) && str(raw.q) && raw.q.length <= LOOK_Q ? { kind: raw.kind, path: raw.path, q: raw.q }
      : raw?.kind === "save" && device === "" && str(raw.path) && typeof raw.text === "string" && raw.text.length <= LOOK_SHOWN && typeof raw.base === "string" && /^[0-9a-f]{64}$/.test(raw.base) ? { kind: "save", path: raw.path, text: raw.text, base: raw.base }
      : null;
    if (what === null) {
      return { error: "Ask to see a file or a folder (path), open a file (path), or a repo's git (repo, op)." };
    }
    if (Tools.opened(chat.tools).length === 0) {
      return { error: "No device is up to show it: open a terminal (legion), or run legion device." };
    }
    // a file opened in an editor: by one device (each would open a window)
    const link = what.kind === "open" || what.kind === "save" ? Tools.opened(chat.tools).flatMap(([, d]) => [...d.terms.values()]).find((l) => l.live?.() !== false) : null;
    if (link === undefined) {
      return { error: "No device is up to open it: open a terminal (legion), or run legion device." };
    }
    const looks = (chat.looks ??= new Map());
    if (looks.size >= LOOKS) {
      looks.delete(looks.keys().next().value!);
    }
    looks.set(id, link === null ? Tools.opened(chat.tools).reduce((n, [, d]) => n + d.terms.size, 0) : 1);
    if (link === null) {
      Chat.all(chat, { $: "look", id, what });
    } else {
      link.send({ $: "look", id, what });
    }
    return {};
  }

  // the timesheet (K5, RED ZONE): the user's Submit of drafts (only those
  // not sent nor sending), checked again, sent to ONE device's terminal
  // (each that got them would post them: billed twice), marked sending;
  // or their drop (unsent ones only)
  export function timesheet(chat: Chat, id: string, msg: any): Answer {
    const ns = new Set((Array.isArray(msg?.ns) ? msg.ns : []).filter((n: unknown) => Number.isInteger(n)));
    const mem = chat.mem;
    if (msg?.op === "drop") {
      mem.drafts = mem.drafts.filter((d) => !ns.has(d.n) || d.state === "sent" || d.state === "sending");
      Memory.save(mem);
      Chat.change(chat);
      return {};
    }
    if (msg?.op !== "submit") {
      return { error: "Submit or drop drafts." };
    }
    const asked = mem.drafts.filter((d) => ns.has(d.n) && (d.state === "draft" || d.state === "failed") && typeof Harvest.entry_check(d) !== "string");
    if (asked.length === 0) {
      return { error: "No draft of those waits to be submitted." };
    }
    const link = Tools.opened(chat.tools).flatMap(([, d]) => [...d.terms.values()]).find((l) => l.live?.() !== false);
    if (link === undefined) {
      return { error: "No device is up to submit to Harvest: open a terminal (legion), or run legion device." };
    }
    for (const d of asked) {
      d.state = "sending";
      delete d.error;
    }
    (chat.harvests ??= new Map()).set(id, asked.map((d) => d.n));
    link.send({ $: "harvest", id, entries: asked.map((d) => ({ n: d.n, project_id: d.project_id, task_id: d.task_id, date: d.date, hours: d.hours, notes: d.notes })) });
    Memory.save(mem);
    Chat.change(chat);
    return {};
  }

  // a device's answer to a submit: each of its drafts sent (Harvest's id)
  // or failed (why); only a device's, once
  export function harvested(chat: Chat, device: string, msg: any): Answer {
    const id = String(msg?.id ?? "");
    const ns = chat.harvests?.get(id);
    if (device === "" || ns === undefined) {
      return { error: "No submit " + id.slice(0, 40) + " waits for a device's answer." };
    }
    chat.harvests!.delete(id);
    const results: any[] = Array.isArray(msg?.results) ? msg.results : [];
    for (const d of chat.mem.drafts.filter((x) => ns.includes(x.n) && x.state === "sending")) {
      const r = results.find((x) => x?.n === d.n);
      if (r !== undefined && Number.isInteger(r.id)) {
        d.state = "sent";
        d.harvest = r.id;
      } else {
        d.state = "failed";
        d.error = String(r?.error ?? "no answer for it").slice(0, 300);
      }
    }
    Memory.save(chat.mem);
    Chat.change(chat);
    const sent = chat.mem.drafts.filter((d) => ns.includes(d.n) && d.state === "sent").length;
    Chat.note(chat, "Timesheet: " + sent + " of " + ns.length + " entries submitted to Harvest" + (sent < ns.length ? "; the rest failed (the Timesheet page says why)." : "."));
    return {};
  }

  // the Crew view's Undo last turn (an agent not at work) and Open in
  // Claude Code (its brief: Tools.handoff), the user's acts (no agent has
  // a tool for them), to ONE live terminal of the agent's device (each
  // would undo again, or open a window); none known: any device's, for a
  // handoff. The device checks its own roots (Device.device_undo, _handoff).
  // A view's act only, as pin is (a device's socket is within an agent's
  // reach: refused). An undo is recorded (Chat.mark) before it is sent: the
  // device drops the snapshot it restores, so one done again, its answer
  // lost, would undo the turn before
  export function crew_op(chat: Chat, id: string, op: "undo" | "handoff", name: string, device = ""): Answer {
    if (device !== "") {
      return { error: op === "undo" ? "Undo is the user's: undo from the web." : "Open in Claude Code is the user's: open it from the web." };
    }
    const agent = chat.tools.agents.get(name);
    if (agent === undefined) {
      return { error: "No agent " + name.slice(0, 64) + "." };
    }
    if (op === "undo" && Tools.working(chat.tools).includes(agent)) {
      return { error: name + " is at work: stop it first, then undo its last turn." };
    }
    if (op === "undo" && agent.device === undefined) {
      return { error: name + " changed nothing on a device: nothing to undo." };
    }
    const devices = Tools.opened(chat.tools).filter(([d]) => agent.device === undefined || d === agent.device);
    const link = devices.flatMap(([, d]) => [...d.terms.values()]).find((l) => l.live?.() !== false);
    if (link === undefined) {
      return { error: agent.device === undefined ? "No device is up: open a terminal (legion), or run legion device." : agent.device + " is gone: open a terminal (legion) there, or run legion device." };
    }
    (chat.dids ??= new Set()).add(id);
    if (op === "undo") {
      Chat.mark(chat, id, {});
    }
    link.send(op === "undo" ? { $: "undo", id, agent: name } : { $: "handoff", id, agent: name, brief: Tools.handoff(agent) });
    return {};
  }

  // a device's answer to an undo or a handoff sent it: only a device's,
  // once, a note in the chat (so Unii knows the user undid an agent)
  export function did(chat: Chat, device: string, msg: any): Answer {
    const id = String(msg?.id ?? "");
    if (device === "" || !chat.dids?.delete(id)) {
      return { error: "No undo or handoff " + id.slice(0, 40) + " waits for a device's answer." };
    }
    const text = typeof msg.text === "string" ? msg.text : "Not done: " + String(msg.error ?? "no answer").slice(0, 300);
    Chat.note(chat, text.slice(0, 600));
    return {};
  }

  // the gateway's report (Gateway.ts) to every chat's views: its budget,
  // read anew past GATEWAY_READ and only through a gateway (never
  // Anthropic's own API), and when a model last answered busy
  export const GATEWAY_TICK = 60e3;      // the report to the views, this often
  const GATEWAY_READ = 10 * 60e3;        // the budget read anew past this
  export const budget: { at: number; read: Budget | null } = { at: -Infinity, read: null };
  export async function gateway(now: number, read = gateway_budget): Promise<void> {
    if (now - budget.at > GATEWAY_READ && config.ANTHROPIC_URL !== "https://api.anthropic.com" && config.KEYS.anthropic) {
      budget.at = now;
      budget.read = await read(config.ANTHROPIC_URL, config.KEYS.anthropic);
    }
    for (const chat of Chat.chats.values()) {
      Chat.all(chat, { $: "gateway", budget: budget.read, busy: Agent.health.busy });
    }
  }

  // a device's answer to a look asked, once, its fields cut, to the views;
  // a refusal waits while another device may still show it (one with
  // other roots, an old terminal), the last one told
  export function looked(chat: Chat, device: string, msg: any): Answer {
    const id = String(msg?.id ?? "");
    const left = chat.looks?.get(id);
    if (device === "" || left === undefined) {
      return { error: "No look " + id.slice(0, 40) + " waits for a device's answer." };
    }
    if (msg.error !== undefined && left > 1) {
      chat.looks!.set(id, left - 1);
      return {};
    }
    chat.looks!.delete(id);
    const s = (x: unknown, most: number) => (typeof x === "string" ? x.slice(0, most) : undefined);
    const out: Looked = { $: "looked", id, kind: LOOK_KINDS.find((k) => k === msg.kind) ?? "file" };
    for (const [k, most] of [["path", LOOK_TEXT], ["op", 20], ["q", LOOK_Q], ["hash", 64], ["text", LOOK_SHOWN], ["error", 300]] as const) {
      const v = s(msg[k], most);
      if (v !== undefined) {
        out[k] = v;
      }
    }
    Chat.all(chat, out);
    return {};
  }

  export function inboxed(chat: Chat, device: string, raw: unknown): Answer {
    const inbox = device === "" ? "Only a device reports its inbox." : Inbox.inbox_check(raw);
    if (typeof inbox === "string") {
      return { error: inbox };
    }
    chat.inbox = inbox;
    Chat.all(chat, { $: "inbox", inbox });
    Chat.automate(chat, inbox);
    return {};
  }

  // the digest's themes: what the compactor is told, how long it may
  // take, the most lines an author gets and characters a line
  const THEMES = "You group a team's merged pull requests into themes. For each author, write 1 to 6 short lines, each a theme in a few plain words followed by its PR numbers in parentheses, like: \"Explainers generator, read-only runner (#776, #777)\". Use only the PRs given, and only their authors. Answer with JSON only: {\"<author>\": [\"<line>\", ...], ...}.";
  const THEMES_MS = 90_000;
  const THEME_LINES = 8;
  const THEME_TEXT = 200;

  // the digest's merged PRs in themes per author, by one compactor call
  // the user asks for (Summarize by theme): its JSON kept only for the
  // digest's authors, lines capped and cut; the same digest isn't asked
  // again; told every view
  export async function themes(chat: Chat): Promise<Answer> {
    const merged = chat.inbox?.digest?.merged ?? [];
    if (merged.length === 0) {
      return { error: "Nothing merged to summarize yet." };
    }
    const key = merged.map((p) => p.url).sort().join(" ");
    if (chat.themes?.key === key) {
      return {};
    }
    const text = merged.map((p) => p.author + ": #" + p.number + " " + p.title + " (" + p.repo + ")").join("\n");
    let end: { ok: boolean; text: string } | null;
    try {
      const call = AskAI.ask({ ...Pick.ask(config.COMPACTOR), system: THEMES, blocks: [{ text, mark: false }], searches: 0, server: "", bill: chat.mem.pay?.("chat", "themes") }, () => {});
      const late = new Promise<null>((done) => setTimeout(() => done(null), THEMES_MS).unref?.());
      end = await Promise.race([call.done.catch(() => null), late]);
      if (end === null) {
        call.stop();
      }
    } catch {
      end = null;
    }
    const authors = new Set(merged.map((p) => p.author));
    const by: Record<string, string[]> = {};
    try {
      const json = JSON.parse(/\{[\s\S]*\}/.exec(end?.ok ? end.text : "")?.[0] ?? "");
      for (const [who, lines] of Object.entries(json ?? {})) {
        if (authors.has(who) && Array.isArray(lines)) {
          by[who] = lines.filter((l): l is string => typeof l === "string").slice(0, THEME_LINES).map((l) => l.trim().slice(0, THEME_TEXT));
        }
      }
    } catch {
      return { error: "The summary didn't come back right" + (end?.ok === false ? ": " + end.text.slice(0, 200) : "") + "." };
    }
    chat.themes = { key, by };
    Chat.all(chat, { $: "themes", themes: chat.themes });
    return {};
  }

  // Meeting transcripts (RED ZONE draft, Google.ts)
  // -----------------------------------------------
  // A view asks for a Doc the inbox lists to be summarized; the devices
  // are asked to read it (only they hold the Google grant); only an
  // asked-for Doc's text is taken, only from a device; the compactor
  // summarizes it; the summary is kept with the chat (never the text) and
  // told every view. The user chose (2026-11-12) to let meeting text go to
  // the LiteLLM gateway for this.

  const SUMMARY = "Summarize this meeting transcript for its attendee: one sentence on what the meeting settled, then short sections (a heading each) of bullets with the decisions and the context behind them, then a 'Next steps' section of bullets with each owner's name in parentheses first. Plain Markdown, under 400 words. Only what the transcript says.";
  const SUMMARY_TEXT = 6000;
  // the files pane's looks (Chat.look): waiting at most, a path's length at
// most, what a device's answer may show at most (Device.LOOK_BYTES)
const LOOKS = 50;
const LOOK_TEXT = 1000;
const LOOK_SHOWN = 512 * 1024;
const LOOK_Q = 200; // a find's or a search's text, at most
// the user's !command, stopped after (Chat.bang_ms): 10 minutes
const BANG_MS = 10 * 60_000;
const SUMMARIES_KEPT = 50; // not SUMMARIES: View's wait (Chat.waits)
// what the user chose over Legion's picks, kept at most (Chat.like)
const LIKES = 30;

  export async function transcript(chat: Chat, device: string, msg: any): Promise<Answer> {
    const id = typeof msg.id === "string" ? msg.id : "";
    const doc = chat.inbox?.google?.docs.find((d) => d.id === id);
    if (doc === undefined) {
      return { error: "No such transcript in the inbox." };
    }
    chat.reading ??= new Set();
    if (device === "") {
      if (msg.text !== undefined || msg.error !== undefined) {
        return { error: "Only a device reads a transcript." };
      }
      if (chat.mem.summaries[id] === undefined && !chat.reading.has(id)) {
        chat.reading.add(id);
        Chat.all(chat, { $: "read", id });
      }
      return {};
    }
    if (!chat.reading.delete(id)) {
      return { error: "That transcript wasn't asked for." };
    }
    if (typeof msg.text !== "string") {
      Chat.note(chat, "Couldn't read " + JSON.stringify(doc.title) + ": " + String(msg.error ?? "no text").slice(0, 200));
      return {};
    }
    void Chat.summarize(chat, doc, msg.text.slice(0, 200_000));
    return {};
  }

  // a transcript's text summarized by the compactor, the summary kept
  export async function summarize(chat: Chat, doc: { id: string; title: string }, text: string): Promise<void> {
    let end: { ok: boolean; text: string } | null = null;
    try {
      const call = AskAI.ask({ ...Pick.ask(config.COMPACTOR), system: SUMMARY, blocks: [{ text: doc.title + "\n\n" + text, mark: false }], searches: 0, server: "", bill: chat.mem.pay?.("chat", "transcript") }, () => {});
      end = await call.done.catch(() => null);
    } catch {
      end = null;
    }
    if (end === null || !end.ok || end.text.trim() === "") {
      Chat.note(chat, "The summary of " + JSON.stringify(doc.title) + " didn't come" + (end?.ok === false ? ": " + end.text.slice(0, 200) : "") + ".");
      return;
    }
    const summary = { title: doc.title, text: end.text.trim().slice(0, SUMMARY_TEXT), at: Date.now() };
    const kept = Object.entries({ ...chat.mem.summaries, [doc.id]: summary }).sort((a, b) => b[1].at - a[1].at).slice(0, SUMMARIES_KEPT);
    chat.mem.summaries = Object.fromEntries(kept);
    Memory.save(chat.mem);
    Chat.all(chat, { $: "summary", id: doc.id, summary });
  }

  // Explain
  // -------
  // The Tracks page's cards (Explain.ts): the observer (config.OBSERVER) writes
  // it from the chat's snapshot on the routines' tick, again only once
  // that changed and at most once an Explain.EVERY; the user's questions
  // are answered on the page. Neither ever reaches the chat: no message,
  // no turn, no agent told; the observer gets no tools (no server, no web
  // search: it reads only what it is given). Told every view

  // how long an observer's call may take
  const OBSERVE_MS = 90_000;

  // what the observer reads: the goal and plan, the crew with each one's
  // last words, the tracks (counts only: no checklist text), the
  // questions and todos open, the routines on, the user's open PRs
  export function snapshot(chat: Chat): string {
    const agents = chat.tools.agents;
    const crew = Tools.crew(chat.tools);
    const tracks = Explain.track_names(crew).map((name) => ({ name, items: agents.get(name)?.todo?.length ?? 0, pins: chat.mem.tracks[name]?.pins.length ?? 0 }));
    return Explain.explain_snapshot({
      goal: chat.mem.goal, plan: chat.mem.plan?.text ?? null, busy: chat.busy, said: lately(chat), tracks,
      crew: crew.map((c) => ({ ...c, last: agents.get(c.name)?.replies.at(-1) ?? "" })),
      questions: chat.mem.questions.map((q) => q.text), todos: chat.mem.assigned.map((a) => a.text),
      routines: chat.mem.routines.filter((r) => r.on).map((r) => r.name), prs: chat.inbox?.mine ?? [],
    });
  }

  // the user's latest messages to Legion (at most SAID, of its last BACK), oldest first
  function lately(chat: Chat): string[] {
    const out: string[] = [];
    for (let i = chat.mem.count - 1; i >= Math.max(0, chat.mem.count - Explain.BACK) && out.length < Explain.SAID; i--) {
      const m = Memory.message(chat.mem, i);
      if (m?.kind === "user" && m.text !== "") {
        out.unshift(m.text);
      }
    }
    return out;
  }

  // one observer call, with no tools: its end, or null (it threw, or took
  // past OBSERVE_MS: stopped)
  async function observer(chat: Chat, system: string, text: string): Promise<End | null> {
    try {
      const call = AskAI.ask({ ...Pick.ask(config.OBSERVER), system, blocks: [{ text, mark: false }], searches: 0, server: "", bill: chat.mem.pay?.("chat", "explain") }, () => {});
      const late = new Promise<null>((done) => setTimeout(() => done(null), OBSERVE_MS).unref?.());
      const end = await Promise.race([call.done.catch(() => null), late]);
      if (end === null) {
        call.stop();
      }
      return end;
    } catch {
      return null;
    }
  }

  export function explained(chat: Chat): void {
    Chat.all(chat, { $: "explain", explain: chat.mem.explain });
  }

  // the page written again, if due (Explain.explain_due) and the credit
  // pays: nothing going on or no track, no cards and no call; one card
  // per track (the crew's names, never the observer's); failed, why, the cards
  // kept and tried again an EVERY on. Only while a view shows it (a socket
  // with no device): the call is billed, and no device reads the page
  export async function observe(chat: Chat, now: number): Promise<void> {
    if (![...chat.socks].some((s) => s.data.host === null)) {
      return;
    }
    const ex = chat.mem.explain;
    const text = Chat.snapshot(chat);
    const hash = Explain.explain_hash(text);
    if (!Explain.explain_due(ex, hash, now)) {
      return;
    }
    const names = Explain.track_names(Tools.crew(chat.tools));
    if (text === "" || names.length === 0) {
      Object.assign(ex, { cards: [], hash, at: now, error: null });
      Memory.save(chat.mem);
      Chat.explained(chat);
      return;
    }
    ex.tried = now;
    if (await Chat.afford(chat) !== null) {
      return;
    }
    ex.writing = true;
    Chat.explained(chat);
    const end = await observer(chat, Explain.OBSERVE, "<snapshot>\n" + text + "\n</snapshot>");
    const cards = end?.ok ? Explain.explain_cards(end.text, names) : null;
    ex.writing = false;
    Object.assign(ex, cards === null ? { error: "The page couldn't be written" + (end?.ok === false ? ": " + end.text.slice(0, 200) : "") + "." } : { cards, hash, at: Date.now(), error: null });
    Memory.save(chat.mem);
    Chat.explained(chat);
  }

  // RED ZONE (access control, DRAFT awaiting the user's sign-off): the
  // user's question about the Tracks page, a view's act only (a device's
  // socket is within an agent's reach: an agent must not spend the
  // user's credit on it nor write in their thread). One at a time, the
  // credit checked; its answer goes on the page only (Explain.explain_asked):
  // no chat message, no turn, no agent told
  export async function explain(chat: Chat, device: string, msg: any): Promise<Answer> {
    if (device !== "") {
      return { error: "Ask about the Tracks page in a view (the web, or the terminal's /tracks)." };
    }
    const q = typeof msg.q === "string" ? msg.q.replace(/\s+/g, " ").trim().slice(0, Explain.Q) : "";
    if (q === "") {
      return { error: "Ask a question." };
    }
    const ex = chat.mem.explain;
    if (ex.asking !== null) {
      return { error: "Still answering your last question." };
    }
    const refused = await Chat.afford(chat);
    if (refused !== null) {
      return refused;
    }
    ex.asking = q;
    Chat.explained(chat);
    const end = await observer(chat, Explain.ASK, Explain.explain_question(ex, Chat.snapshot(chat), q));
    ex.asking = null;
    const a = end?.ok ? end.text.trim().slice(0, Explain.A) : "";
    if (a === "") {
      Chat.explained(chat);
      return { error: "No answer came" + (end?.ok === false ? ": " + end.text.slice(0, 200) : "") + "." };
    }
    Explain.explain_asked(ex, q, a, Date.now());
    Memory.save(chat.mem);
    Chat.explained(chat);
    return {};
  }

  // Tracks
  // ------
  // The Tracks page's checklists (Explain.ts): a track is a live top
  // agent; its pins are the user's, beside the agent's own list

  // RED ZONE (user authority over agents, view-only act gating; DRAFT
  // awaiting the user's sign-off): the user's edit of a track's pins, a
  // view's act only (a device's socket is within an agent's reach: an
  // agent must not forge the user's items). Checks, first failing wins:
  // the asker, EDITS a minute, an orphaned track (only a pin's drop), a
  // live top "sub" agent's, an agent item as the user saw it (was), the
  // pin caps. Only this and Chat.pinned (status only) write mem.tracks
  export function track(chat: Chat, device: string, msg: any): Answer {
    if (device !== "") {
      return { error: "Tracks are the user's: edit them in a view (the web, or the terminal's Tracks page)." };
    }
    const now = Date.now();
    const edits = (chat.edits ?? []).filter((t) => now - t < 60_000);
    if (edits.length >= Explain.EDITS) {
      return { error: "At most " + Explain.EDITS + " edits a minute: wait a moment." };
    }
    const name = String(msg.name);
    const op = ["add", "edit", "move", "drop"].includes(msg.op) ? msg.op as "add" | "edit" | "move" | "drop" : null;
    const n = Number.isInteger(msg.n) ? msg.n as number : null;
    const i = Number.isInteger(msg.i) && msg.i >= 1 ? msg.i as number : null;
    const agent = chat.tools.agents.get(name);
    const top = agent !== undefined && agent.parent === "main" && agent.hidden !== true ? agent : null;
    const had = Object.hasOwn(chat.mem.tracks, name) ? chat.mem.tracks[name] : undefined;
    if (op === null || (op !== "add" && n === null && i === null)) {
      return { error: "No track edit " + JSON.stringify(msg.op)?.slice(0, 40) + "." };
    }
    if (top === null && had !== undefined && !(op === "drop" && n !== null)) {
      return { error: name + "'s agent is gone: its track is read-only (drop its pins to clear it)." };
    }
    if (top === null && had === undefined) {
      return { error: "No track " + name.slice(0, 80) + "." };
    }
    if (top !== null && top.role.$ !== "sub") {
      return { error: name + "'s track is read-only: Claude Code and computer agents keep their own lists." };
    }
    const was = i === null ? null : top?.todo?.[i - 1]?.text;
    if (i !== null && (was === undefined || was !== msg.was)) {
      return { error: "That item changed: look again." };
    }
    const t = had ?? Explain.track_new();
    const text = String(msg.text ?? "");
    const next = op === "add" ? Explain.track_add(t, text, now)
      : op === "edit" ? (n !== null ? Explain.track_edit(t, n, text, now) : Explain.track_copy(t, was!, text, now))
      : op === "move" ? (n !== null && Number.isInteger(msg.to) ? Explain.track_move(t, n, msg.to) : "Move a pinned item: #n and a place.")
      : n !== null ? Explain.track_drop(t, n) : { ...t, dropped: [...t.dropped.filter((d) => d !== was), was!] };
    if (typeof next === "string") {
      return { error: next };
    }
    if (top === null && next.pins.length === 0) {
      delete chat.mem.tracks[name];
    } else {
      chat.mem.tracks[name] = next;
    }
    chat.edits = [...edits, now];
    Memory.save(chat.mem);
    Chat.change(chat);
    if (top !== null) {
      const at = (k: number) => next.pins.find((p) => p.n === k);
      const edit: Explain.Edit = op === "add" ? { op, n: next.next, text: at(next.next)!.text }
        : op === "edit" ? (n !== null ? { op, n, text: at(n)!.text } : { op: "copy", n: next.next, text: at(next.next)!.text, was: was! })
        : op === "move" ? { op, n: n!, to: next.pins.findIndex((p) => p.n === n) + 1 }
        : n !== null ? { op, n } : { op: "unlist", was: was! };
      Chat.tracked(chat, name, Explain.track_note(edit));
    }
    return {};
  }

  // RED ZONE (user authority over agents; DRAFT awaiting the user's
  // sign-off): a track's notes (Explain.track_note templates only) sent to
  // its agent together, NOTE_GAP after the first: at work, read between its
  // calls; idle, kept in its log for its next turn (no Tools.run: no turn
  // started), the track shown queued till then
  export function tracked(chat: Chat, name: string, text: string): void {
    const jots = chat.jots ??= new Map();
    const waiting = jots.get(name);
    if (waiting !== undefined) {
      waiting.push(text);
      return;
    }
    jots.set(name, [text]);
    setTimeout(() => {
      const texts = jots.get(name) ?? [];
      jots.delete(name);
      const agent = chat.tools.agents.get(name);
      if (agent === undefined || agent.hidden === true || texts.length === 0) {
        return;
      }
      const joined = texts.join(" ");
      chat.tools.hooks.push(agent, "note", joined);
      if (agent.call !== null || agent.runs === true) {
        agent.call?.send({ text: "note: " + joined, imgs: [] });
      } else if (Object.hasOwn(chat.mem.tracks, name)) {
        chat.mem.tracks[name] = { ...chat.mem.tracks[name]!, queued: Date.now() };
        Memory.save(chat.mem);
      }
      Chat.change(chat);
    }, Explain.NOTE_GAP).unref?.();
  }

  // RED ZONE (who may start unattended work; DRAFT awaiting the user's
  // sign-off): each track's items doing STALL with no change reminded once
  // (Explain.track_remind: a number only), at most REMINDS an agent an
  // hour, and only to an agent at work: the gate sits here because
  // Tools.remind starts an idle agent's turn. The agent's items go by
  // place, the user's pins by n
  export function stalls(chat: Chat, now: number): number {
    const nudged = chat.nudged ??= new Map<string, number[]>();
    let sent = 0;
    let pinned = false;
    for (const agent of chat.tools.agents.values()) {
      if (agent.parent !== "main" || agent.hidden === true || agent.role.$ !== "sub" || (agent.call === null && agent.runs !== true)) {
        continue;
      }
      const hour = (nudged.get(agent.name) ?? []).filter((t) => now - t < 3_600_000);
      const items = agent.todo ?? [];
      const t = Object.hasOwn(chat.mem.tracks, agent.name) ? chat.mem.tracks[agent.name] : undefined;
      const due = [
        ...Explain.track_stalls(items.map((x, i) => ({ ...x, n: i + 1 })), now).map((n) => ({ n, mark: () => (items[n - 1]!.reminded = true) })),
        ...Explain.track_stalls(t?.pins ?? [], now).map((n) => ({ n, mark: () => ((t!.pins.find((p) => p.n === n)!.reminded = true), (pinned = true)) })),
      ];
      for (const d of due) {
        if (hour.length >= Explain.REMINDS) {
          break;
        }
        if (!Tools.remind(chat.tools, agent.name, Explain.track_remind(d.n)).fail) {
          d.mark();
          hour.push(now);
          sent += 1;
        }
      }
      nudged.set(agent.name, hour);
    }
    if (pinned) {
      Memory.save(chat.mem);
    }
    return sent;
  }

  // RED ZONE (user authority over agents; DRAFT awaiting the user's
  // sign-off): an agent's marks on its own track's pins (Tools.todo's
  // pinned, through hooks.pinned: Tools.ts never touches mem.tracks):
  // status only, by an existing n (Explain.track_status); the pins after.
  // texts: the agent's list as todo sets it, so the user's "dropped by
  // you" marks for items no longer on it go (Explain.track_seen)
  export function pinned(chat: Chat, who: string, marks: Array<{ n: number; status: Todo["status"] }>, texts: string[]): Mine[] {
    const t = Object.hasOwn(chat.mem.tracks, who) ? chat.mem.tracks[who] : undefined;
    if (t === undefined) {
      return [];
    }
    const next = Explain.track_status(Explain.track_seen(t, texts), marks, Date.now());
    if (JSON.stringify(next) !== JSON.stringify(t)) {
      chat.mem.tracks[who] = next;
      Memory.save(chat.mem);
    }
    return next.pins;
  }

  // GChat bridge
  // ------------
  // The questions pane in a Google Chat space, for the user away (Gchat.ts;
  // on with config gchat_space and GCHAT_WEBHOOK_URL). Every Gchat.EVERY
  // while the chat is open: each open item not yet posted is posted (at
  // most Gchat.POSTS a pass; one that fails, again on the next), the
  // posted ones closed since forgotten; then, while one is open and
  // there is a token (gchat_token), the space's replies read and acted on.

  // RED ZONE (security review U2, widened: signed off by the user
  // 2026-11-18, option A): the user's Google access token for the poll,
  // with the bridge on, read by this server from the guarded grant as a
  // device reads it (Google.store: one prompt a process, held in memory;
  // a refused read held, so the bridge posts but reads no reply until a
  // restart); off, null: no poll, never a read
  export let gchat_token: (() => Promise<string>) | null = Gchat.gchat_on(config.GCHAT_SPACE, config.KEYS.gchat ?? "") ? () => Google.token(Google.store()) : null;

  // the chat let go with the bridge on: the space told, in a thread of its
  // own, that replies aren't read until a view or device opens it again
  export function unbridge(chat: Chat, now: number): void {
    clearInterval(chat.bridging?.timer);
    const url = config.KEYS.gchat ?? "";
    if (chat.bridging === undefined || !Gchat.gchat_on(config.GCHAT_SPACE, url)) {
      return;
    }
    void Gchat.gchat_post(url, "legion-bye-" + now, "Legion stopped listening: no view or device is open, so replies here aren't read. Start `legion device` to resume.").then((sent) => {
      if ("error" in sent) {
        console.error("chat " + chat.acct.user + ": gchat: " + sent.error);
      }
    });
  }

  // RED ZONE (R8, signed off by the user 2026-11-19): whether the bridge
  // is on for a user's chat: it posts to one space and acts on its
  // replies, so one owner's chat only, the user config gchat_user names
  // (none named: no one's, fail closed)
  export function gchat_for(user: string, url: string): boolean {
    return user === config.GCHAT_USER && Gchat.gchat_on(config.GCHAT_SPACE, url);
  }

  export async function bridge(chat: Chat, now: number): Promise<void> {
    const g = chat.mem.gchat;
    const url = config.KEYS.gchat ?? "";
    if (!Chat.gchat_for(chat.acct.user, url) || chat.bridging?.busy || Chat.chats.get(chat.acct.user) !== chat) {
      return;
    }
    const b = (chat.bridging ??= { busy: false, me: null });
    b.busy = true;
    try {
      const items = Gchat.gchat_items(chat.mem, now);
      const open = (p: Gchat.Posted) => items.some((x) => x.key === p.key);
      if (!g.posted.every(open)) {
        g.posted = g.posted.filter(open);
        Memory.save(chat.mem);
      }
      for (const item of items.filter((x) => !g.posted.some((p) => p.key === x.key)).slice(0, Gchat.POSTS)) {
        const tk = "legion-" + item.key + "-" + now;
        const sent = await Gchat.gchat_post(url, tk, item.text);
        if ("error" in sent) {
          console.error("chat " + chat.acct.user + ": gchat: " + sent.error);
          continue;
        }
        g.posted.push({ key: item.key, tk, ...sent });
        Memory.save(chat.mem);
      }
      if (g.posted.length > 0 && Chat.gchat_token !== null) {
        await Chat.bridged(chat, url, Gchat.gchat_items(chat.mem, Date.now()));
      }
    } catch (err: any) {
      console.error("chat " + chat.acct.user + ": gchat: " + String(err?.message ?? err).split("\n")[0]!.slice(0, 200));
    } finally {
      b.busy = false;
    }
  }

  // RED ZONE (access control: who may answer; signed off by the user
  // 2026-11-18): the space's replies since the oldest open item, those
  // Gchat.gchat_replies lets through (the signed-in user's, in an open
  // item's thread, newer than it, not acted on), each kept as acted on
  // before it acts (once, even if it fails), then sent as a view's act
  // (device ""): the bridge is the user's view, the sender checked here,
  // so Chat.act's own checks (an open question, credit) apply as for the
  // web; what it refuses, or a reply not understood, said in the thread
  export async function bridged(chat: Chat, url: string, items: Gchat.Item[]): Promise<void> {
    const g = chat.mem.gchat;
    const token = await Chat.gchat_token!();
    const b = chat.bridging!;
    b.me ??= await Google.me(token);
    const since = Math.min(...g.posted.map((p) => p.at));
    const replies = Gchat.gchat_replies(await Google.replies(token, config.GCHAT_SPACE, since), b.me, config.GCHAT_SPACE, g, items);
    for (const r of replies) {
      Gchat.gchat_acted(g, r.name);
      Memory.save(chat.mem);
      const act = Gchat.gchat_act(r);
      const done = act === null ? { error: "Not understood: " + (r.item.kind === "todo" ? "reply done or drop." : "reply undo (and what instead), or keep.") } : await Chat.act(chat, "gchat-" + r.name.split("/").at(-1), act, "");
      if (done.error !== undefined) {
        const tk = g.posted.find((p) => p.key === r.item.key)?.tk;
        const said = tk === undefined ? null : await Gchat.gchat_post(url, tk, done.error);
        if (said !== null && "error" in said) {
          console.error("chat " + chat.acct.user + ": gchat: " + said.error);
        }
      }
    }
  }

  // Routines
  // --------
  // The user's (Routines.ts), kept with the chat: each starts a native
  // agent, the user's (its report takes no turn). The tick runs those due
  // while the chat is open: a view or a device connected, or with none, a
  // routine on by the clock (Chat.free keeps it, Chat.wake opens it after
  // a restart). One missed while the Mac slept runs once on waking; a review
  // routine, on each inbox, a review of each new review request of the
  // user's, AUTOS at most at once (the first inbox it sees only seeds it)

  export const TICKS = 60_000;
  export const AUTOS = 3;

  // a routine run: its agent started, a note, when it ran kept
  export function run_routine(chat: Chat, r: Routines.Routine, now: number): void {
    const name = Tools.start(chat.tools, "main", { $: "sub", tier: r.tier, effort: null, model: null }, r.task, true, { title: "routine: " + r.name });
    r.last = now;
    Chat.note(chat, "Routine " + JSON.stringify(r.name) + " started " + name + ".");
  }

  // the routines due now run, and the timers due fire; how many routines
  export function ticked(chat: Chat, now: number): number {
    const due = chat.mem.routines.filter((r) => Routines.routine_due(r, now));
    due.forEach((r) => Chat.run_routine(chat, r, now));
    Chat.stalls(chat, now);
    const rung = Chat.rang(chat, now);
    // RED ZONE (R4, DRAFT awaiting the user's sign-off): a shown record no
    // live wait holds has no timer of its own: past its time, expired (P6)
    let lapsed = false;
    for (const p of chat.mem.pending) {
      if (p.kind === "consent" && p.state === "open" && p.until <= now && chat.tools.consents?.has(p.id) !== true) {
        p.state = "expired";
        lapsed = true;
      }
    }
    if (due.length > 0 || rung || lapsed) {
      Memory.save(chat.mem);
      Chat.change(chat);
    }
    return due.length;
  }

  // the agents' timers due (Routines.ts), gone from the list, each a
  // message "[Timer n] note" to whoever set it: Unii's a turn of its own,
  // as a report is (Chat.report); an agent's, its own reminder (Tools.remind:
  // a note, read between calls, or an idle one goes on). Whether any fired.
  // RED ZONE (who may start unattended work; security review R4): signed
  // off by the user 2026-11-19. One fired with no view open marks the
  // chat (tools.rung): no new timer till a view is open or the user speaks
  export function rang(chat: Chat, now: number): boolean {
    const due = Routines.timers_due(chat.mem.timers, now);
    if (due.length === 0) {
      return false;
    }
    chat.mem.timers = chat.mem.timers.filter((t) => !due.includes(t));
    if (!Chat.viewed(chat)) {
      chat.tools.rung = true;
    }
    for (const t of due) {
      const text = "[Timer " + t.id + "] " + t.note;
      if (t.who !== "main") {
        const out = Tools.remind(chat.tools, t.who, text);
        if (out.fail) {
          console.error("chat " + chat.acct.user + ": timer " + t.id + " of " + t.who + ": " + out.text);
        }
        continue;
      }
      Chat.hold(chat, () => {
        chat.posts += 1;
        const msg = Chat.chats.get(chat.acct.user) !== chat ? null : Chat.push(chat, null, "work", text);
        if (msg !== null && Chat.cloud.billing.refuse(chat.acct.user, 0) === null) {
          Chat.take(chat, msg);
        }
        chat.posts -= 1;
        Chat.change(chat);
        Chat.free(chat);
      });
    }
    return true;
  }

  // review routines on an inbox: each new review request of the user's
  export function automate(chat: Chat, inbox: Inbox.Inbox): void {
    const mine = inbox.reviews.filter((p) => p.you);
    let changed = false;
    for (const r of chat.mem.routines.filter((x) => x.on && x.when.$ === "review")) {
      const seen = r.seen;
      r.seen = [...new Set([...(seen ?? []), ...mine.map((p) => p.url)])].slice(-200);
      changed = true;
      if (seen === undefined) {
        continue;
      }
      for (const p of mine.filter((x) => !seen.includes(x.url)).slice(0, Chat.AUTOS)) {
        const label = Chat.pr_label(p, "review");
        const task = Chat.review_task(p, "review", false, true) + (r.task === "" ? "" : "\n\nAlso: " + r.task);
        const name = Tools.start(chat.tools, "main", { $: "sub", tier: r.tier, effort: null, model: null }, task, true, label, true);
        Chat.note(chat, "Routine " + JSON.stringify(r.name) + " started " + name + ": " + label.title + ".");
        r.last = Date.now();
      }
    }
    if (changed) {
      Memory.save(chat.mem);
      Chat.change(chat);
    }
  }

  // the user's routine acts: add one (checked; at most Routines.MOST),
  // turn one on or off, drop one, run one now
  // A view's only (RED ZONE): a device's socket is within an agent's reach
  // (its shell), and an agent may only propose one, off (Tools.propose)
  export async function routine(chat: Chat, id: string, msg: any, device: string): Promise<Answer> {
    if (device !== "") {
      return { error: "Routines are the user's: add or change them in a view (the web's Routines page, or the terminal's /routine)." };
    }
    const list = chat.mem.routines;
    if (msg.op === "add") {
      const given = Routines.routine_check(msg.routine);
      if (typeof given === "string") {
        return { error: given };
      }
      if (list.length >= Routines.MOST) {
        return { error: "At most " + Routines.MOST + " routines: drop one first." };
      }
      chat.mem.routined += 1;
      list.push({ id: chat.mem.routined, ...given, on: true, last: null, made: Date.now() });
    } else {
      const r = list.find((x) => x.id === msg.n);
      if (r === undefined) {
        return { error: "No routine " + String(msg.n).slice(0, 20) + "." };
      }
      if (msg.op === "toggle") {
        r.on = msg.on === true;
      } else if (msg.op === "drop") {
        chat.mem.routines = list.filter((x) => x !== r);
      } else if (msg.op === "run" && r.when.$ !== "review") {
        const refused = await Chat.afford(chat);
        if (refused !== null) {
          return refused;
        }
        Chat.mark(chat, id, {});
        Chat.run_routine(chat, r, Date.now());
      } else {
        return { error: msg.op === "run" ? "A review routine runs on new review requests." : "No routine act " + String(msg.op).slice(0, 20) + "." };
      }
    }
    Memory.save(chat.mem);
    Chat.change(chat);
    return {};
  }

  // the user's close of an agent's pending timer (any agent's), told in a
  // note. RED ZONE (who may start unattended work; security review R4):
  // signed off by the user 2026-11-19. A view's only, as Chat.routine: a
  // device's socket is within an agent's reach (its shell)
  export function untimed(chat: Chat, device: string, msg: any): Answer {
    if (device !== "") {
      return { error: "Timers are the user's to close: close one in a view (the web's Routines page), or Stop all work." };
    }
    const t = chat.mem.timers.find((x) => x.id === msg.n);
    if (t === undefined) {
      return { error: "No timer " + String(msg.n).slice(0, 20) + "." };
    }
    chat.mem.timers = chat.mem.timers.filter((x) => x !== t);
    Memory.save(chat.mem);
    Chat.note(chat, "The user closed timer " + t.id + " (" + (t.who === "main" ? "Unii" : t.who) + "'s: " + t.note.slice(0, 200) + ").");
    Chat.change(chat);
    return {};
  }

  // whether a view of the user's (the web) is open: a socket naming no
  // device (a terminal's and `legion device`'s do: Chat.join)
  export function viewed(chat: Chat): boolean {
    return [...chat.socks].some((sock) => sock.data.device === null);
  }

  // the most inbox PRs one Review starts agents for
  export const REVIEWS = 10;

  // what an agent is told for a PR it reviews or fixes (claude: it's a
  // manager, to run a Claude Code worker for it); nothing goes to GitHub.
  // unattended (a routine started it, on anyone's PR, no one watching):
  // it only reads, as a PR's code may be an attacker's (security review
  // H4; forcing it plan mode waits on an agent's own mode in Tools.ts)
  export function review_task(p: Inbox.Pr, how: "review" | "fix", claude: boolean, unattended = false): string {
    const it = p.repo + "#" + p.number + " " + JSON.stringify(p.title) + " (" + p.url + "), branch " + p.branch;
    const why = p.state === "failing" ? "failing checks: " + p.failing.join(", ") : p.state === "conflicts" ? "conflicts with its base" : "changes requested in review";
    const run = unattended ? ". Run nothing from it (no tests, builds or scripts): only read" : ", and run its tests if you can";
    const task = how === "review"
      ? "Review " + it + ". Read it with `gh pr view` and `gh pr diff` in a checkout of " + p.repo + run + ". Report: approve, or the blocking findings, each with file:line and why. Post nothing to GitHub: the user posts."
      : "Fix " + it + ": " + why + ". Work in its own worktree of " + p.repo + " on that branch; make the checks pass, or resolve the conflicts, or answer the review, with tests. Commit there. Don't push or comment on GitHub: report what you changed and the command to push.";
    return claude ? "Start one Claude Code worker (spawn as: \"claude\") on the user's device to do this, in a checkout of " + p.repo + ", and report what it did: " + task : task;
  }

  // a PR agent's label: "review o/r#5", its repo
  export function pr_label(p: Inbox.Pr, how: "review" | "fix"): { title: string; repos: string[] } {
    return { title: how + " " + p.repo + "#" + p.number, repos: [p.repo.split("/").pop()!] };
  }

  // the cockpit's Review / Fix: each PR the inbox holds to its own agent
  // (a native worker; a manager running a Claude Code worker if asked),
  // started by the user; any PR not in the inbox refuses them all
  export async function review(chat: Chat, id: string, msg: any): Promise<Answer> {
    const prs: unknown = msg.prs;
    if (msg.how !== "review" && msg.how !== "fix") {
      return { error: "A review or a fix." };
    }
    if (!Array.isArray(prs) || prs.length === 0 || prs.length > Chat.REVIEWS) {
      return { error: "Give 1 to " + Chat.REVIEWS + " PRs." };
    }
    const held = [...(chat.inbox?.reviews ?? []), ...(chat.inbox?.mine ?? [])];
    const found = prs.map((url) => held.find((p) => p.url === url));
    const missing = prs.find((_, k) => found[k] === undefined);
    if (missing !== undefined) {
      return { error: "Not in the inbox: " + String(missing).slice(0, 200) + "." };
    }
    const refused = await Chat.afford(chat);
    if (refused !== null) {
      return refused;
    }
    Chat.mark(chat, id, {});
    const claude = msg.claude === true;
    // a PR's task stands alone: no brief of the chat (whose view would
    // wait on its latest lines' summaries), so none waits
    const tier = claude ? "manager" : "worker";
    for (const p of found as Inbox.Pr[]) {
      const label = Chat.pr_label(p, msg.how);
      const name = Tools.start(chat.tools, "main", { $: "sub", tier, effort: null, model: null }, Chat.review_task(p, msg.how, claude), true, label);
      Chat.note(chat, "Started " + name + " (by the user): " + label.title);
    }
    return {};
  }

  // the user sets the chat's mode (Modes.ts): a note Unii reads, no turn
  export function remode(chat: Chat, to: unknown): Answer {
    if (!MODES.includes(to as Mode)) {
      return { error: "No mode " + String(to) + "; one of " + MODES.join(", ") + "." };
    }
    const mode = to as Mode;
    if (mode !== chat.mem.mode) {
      chat.mem.mode = mode;
      chat.mem.plan = mode === "plan" ? chat.mem.plan : null;
      Memory.save(chat.mem);
      Chat.change(chat);
      Chat.note(chat, "The user switched to " + ABOUT[mode] + ".");
    }
    return {};
  }

  // the user's answer to the plan waiting (Tools.plan): approved, the
  // mode they picked (by default auto); sent back, still plan mode, their
  // feedback; either way a message Unii answers in a turn (refused as a
  // post is, short of credit)
  export async function verdict(chat: Chat, id: string, yes: boolean, to: unknown, text: string): Promise<Answer> {
    const plan = chat.mem.plan;
    if (plan === null) {
      return { error: "No plan is waiting for approval." };
    }
    const mode: Mode = yes ? (to === "full" || to === "auto" ? to : "super") : "plan";
    const refused = await Chat.afford(chat);
    if (refused !== null) {
      return refused;
    }
    chat.mem.plan = null;
    chat.mem.mode = mode;
    Memory.save(chat.mem);
    Chat.change(chat);
    const said = yes
      ? "The user approved your plan; now in " + ABOUT[mode] + ". Go ahead with it." + (text === "" ? "" : "\nThey add: " + text)
      : "The user didn't approve your plan: " + (text || "no reason given") + "\nStill in plan mode: revise it and file it again with plan.";
    await Chat.said(chat, id, said);
    return {};
  }

  // RED ZONE (DRAFT awaiting the user's sign-off): the user's Ctrl+B or
  // Stop on a shell command running (B2: an agent's call, Unii's, their
  // own !command): sent to the background (op "bg": Tools.background,
  // within its caps) or stopped ("stop": Tools.halt_shells); job: that
  // one, none: each in the foreground. Only from what speaks for the
  // user (says: a view, or the terminal's own key, Cloud.speaks; never a
  // device's key, which an agent's shell can read, nor an act posted with
  // neither): so no agent sends another's command away or stops it, or
  // the user's
  export function shell(chat: Chat, op: unknown, job: unknown, says: boolean): Answer {
    if (!says) {
      return { error: "Only you send a command to the background or stop it: from the web, or legion signed in with its own key (legion login). A device's key is within an agent's reach, so it can't speak for you." };
    }
    const one = job === undefined || job === null ? null : String(job);
    if (op === "bg") {
      const out = Tools.background(chat.tools, one, Date.now());
      return out.fail ? { error: out.text } : { text: out.text };
    }
    if (op === "stop") {
      const n = Tools.halt_shells(chat.tools, one, false);
      return n === 0 ? { error: "No such command is running." } : {};
    }
    return { error: "No such op: bg or stop." };
  }

  // how long the user's !command may run before it is stopped (ms); a
  // test's shorter
  export let bang_ms = BANG_MS;

  // RED ZONE (DRAFT awaiting the user's sign-off): the user's own
  // !command, from what speaks for them only (says: a view, or the
  // terminal's own key, Cloud.speaks; never a device's key, an act posted
  // with neither, an agent's tool call, a routine, a timer or the GChat
  // bridge, whose acts are answers, assignments and decisions), run as
  // they would in their own shell: a user_shell job, past the hooks, the
  // reviewer and Legion's gating (Machine.ts), never through an agent's
  // tool path; in the chat's dir (Unii's: the home repo, else its work
  // dir) on the device named (!@name), else the one it came from, else
  // the only one open; in a folder if given (the Files page's box: cd
  // there first). Told to the views as it starts; stopped after bang_ms;
  // its command and output (CAP, head and tail) a note the AI reads,
  // starting no turn. Answered at once; the note comes when it ends
  export function bang(chat: Chat, id: string, command: string, from: string, says: boolean, named?: unknown, dir?: unknown): Answer {
    if (!says) {
      return { error: "Only you run a !command: from the web, or legion signed in with its own key (legion login). A device's key is within an agent's reach, so it can't speak for you." };
    }
    if (command === "") {
      return { error: "No command." };
    }
    if (dir !== undefined && (typeof dir !== "string" || dir === "" || dir.length > LOOK_TEXT)) {
      return { error: "Not a folder to run it in." };
    }
    const open = Tools.opened(chat.tools).map(([name]) => name);
    if (named !== undefined && !open.includes(String(named))) {
      return { error: "No device " + String(named).slice(0, 64) + " is open: " + (open.join(", ") || "none") + "." };
    }
    const device = named !== undefined ? String(named) : open.includes(from) ? from : open.length === 1 ? open[0]! : null;
    if (device === null) {
      return { error: open.length === 0 ? "No device is open: run legion (or legion device) on one." : "Several devices are open (" + open.join(", ") + "): name one, as !@" + open[0] + " <command>." };
    }
    Chat.mark(chat, id, {});
    const quoted = dir === undefined ? null : "'" + dir.replace(/'/g, "'\\''") + "'";
    const job = { name: USER_SHELL, input: { command: quoted === null ? command : "cd " + quoted + " && " + command }, cwd: "main" };
    const late = AbortSignal.timeout(Chat.bang_ms);
    Chat.all(chat, { $: "note", text: "Running on " + device + ": $ " + command });
    Tools.job(chat.tools, device, job, late, "bang-" + id).then((out) => {
      const said = clip();
      said.add(late.aborted ? "timed out after " + Chat.bang_ms / 1000 + " s: stopped." : out.text);
      Chat.note(chat, "The user ran on " + device + (dir === undefined ? "" : " in " + dir) + ":\n$ " + command + "\n" + (out.fail || late.aborted ? "error: " : "") + said.text());
    });
    return {};
  }

  // an act's record, a line of its own (Memory.ts)
  export function mark(chat: Chat, id: string, rec: object): void {
    Memory.log(chat.mem, "main", [{ act: id, ...rec }]);
  }

  export function eye(mem: Memory, from: number): Eye {
    const parts = Memory.before(mem.view.parts, from).map((part): Part => [Memory.span(part)[0], 2 ** part.l]);
    return { parts, from };
  }

  // what the agent saw: the eye's parts, then each message after them;
  // a running import's messages, wherever they are, as the fewest blocks
  // of the tree that hold them, built or not (a summary not built comes
  // once built: Chat.made), so no view ever gets the raw history; a block
  // opened gets its halves (zoom); they start where the tree's root
  // holding the import's first message starts, so the oldest blocks are
  // the largest, as in the tree, not grown from an unaligned start
  export function show(chat: Chat, sock: Sock): void {
    const [from, count] = [chat.eye.from, chat.mem.count];
    const [a, hi] = chat.batch === null ? [0, 0] : [chat.batch.a, chat.batch.b];
    const root = Memory.roots(count).find((part) => Memory.span(part)[1] >= a);
    const lo = root === undefined ? a : Memory.span(root)[0];
    const near = chat.eye.parts.filter(([id, n]) => id < hi && id + n > lo);
    const cover: [number, number] = [Math.min(lo, ...near.map(([id]) => id)), Math.max(hi, ...near.map(([id, n]) => id + n))];
    const eye = chat.eye.parts.filter(([id, n]) => id + n <= cover[0] || id >= cover[1]);
    const tree = Memory.roots(count).flatMap((part) => Chat.blocks(part, cover));
    const ids = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k): Part => [a + k, 1]);
    const raw = [...ids(from, cover[0]), ...ids(Math.max(from, cover[1]), count)];
    const parts = [...eye, ...tree, ...raw].sort((x, y) => x[0] - y[0]);
    Chat.teach(chat, sock, parts);
    Chat.send(sock, { $: "view", parts, turn: from });
  }

  // the fewest blocks under a tree part that tile messages [a, b)
  export function blocks(part: { l: number; i: number }, [a, b]: [number, number]): Part[] {
    const [first, last] = Memory.span(part);
    if (last < a || first >= b) {
      return [];
    }
    if (first >= a && last < b) {
      return [[first, 2 ** part.l]];
    }
    return Memory.halves(part).flatMap((half) => Chat.blocks(half, [a, b]));
  }

  // what a view lacks of parts, before the parts themselves: each
  // message or summary a message of its own (Views); a summary not built
  // yet, once built (Chat.made)
  export function teach(chat: Chat, sock: Sock, parts: Part[]): void {
    for (const [id, n] of parts.filter(([id, n]) => !sock.data.seen.has(id + "+" + n))) {
      sock.data.seen.add(id + "+" + n);
      if (n === 1) {
        const m = Memory.message(chat.mem, id)!;
        Chat.send(sock, { $: "know", whole: { [id]: { kind: m.kind, text: m.text, date: m.date, images: m.images } } });
      }
      Chat.know(chat, sock, id, n);
    }
  }

  // a summary, if built, to a view shown its block
  export function know(chat: Chat, sock: Sock, id: number, n: number): void {
    const text = Memory.node(chat.mem, { l: Math.log2(n), i: id / n });
    if (text !== null) {
      Chat.send(sock, { $: "know", nodes: { [id + "+" + n]: { text, to: Memory.message(chat.mem, id + n - 1)!.date } } });
    }
  }

}

// Main
// ====

export namespace Main {

  // whether the supervisor ends; its workers, which this is; mails the
  // supervisor sends for it, by id, awaiting answers
  export let leaving = false;
  export let count   = 1;
  export let index   = 0;
  export const mails = new Map<string, (err: string | null) => void>();

  // a worker: its port and server; the process it took its chats from,
  // its address, and the users whose chats that one has yet to give
  // (Main.here), once it said which; the one it gives its chats to, and
  // whether it does
  export let port    = 0;
  export let server  : Bun.Server<Sock["data"]>;
  export let back    : Peer | null = null;
  export let before  = "";
  export const coming = new Map<string, PromiseWithResolvers<void>>();
  export let listed  = Promise.withResolvers<void>();
  export let next    : Peer | null = null;
  export let given   = false;
  export let onward  = "";

  // the security review's (SC) limits: what a socket may hold unsent,
  // twice the largest message (a FRAME, JSON-escaped), past which it's
  // closed (its client opens again and catches up), so no slow reader
  // holds the worker's memory; the most a request's body may be, an
  // import's (streamed to disk: Chat.post), the largest a person sends
  export const BUFFER = 2 * FRAME;
  export const BODY   = 2 ** 32;

  // the headers every answer goes with, and an HTML one's policy: its
  // scripts and styles the site's own (a page's style attributes too),
  // images and recordings its own or made in the page, no frame of it
  export const HEADERS: Record<string, string> = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
  export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
  // the sockets open here, by user (SOCKETS; Bun opens one inside
  // server.upgrade, so none is opened past it)
  export const sockets = new Map<string, number>();

  // this process's address (Main.listen); every line to another, and those
  // it opened to calls' origins, by address; the calls it feeds to where
  // their chats went (Main.away) and those its relays still pass on to it
  // (Main.far), by ref; each call's ref here, if fed from elsewhere
  export let addr    = "";
  export const peers  = new Set<Peer>();
  export const links  = new Map<string, Peer>();
  export const aways  = new Map<string, Away>();
  export const gates  = new Map<string, Gate>();
  export const refs   = new WeakMap<Call, string>();

  // a unix socket one process at a time listens on, which tells one that
  // connects who holds it: one a crash left refuses connections and is
  // taken; one held is waited on (HELD), then this process ends. Each try
  // is made holding TAKE (Main.taking), so no other start removes the
  // socket between this one's look and its listen
  export async function lock(port: number): Promise<void> {
    fs.mkdirSync(config.DIR, { recursive: true });
    fs.mkdirSync(LOCK.slice(0, LOCK.lastIndexOf("/")), { recursive: true, mode: 0o700 });
    const me = "pid " + process.pid + ", port " + port + ", dir " + config.DIR;
    const until = Date.now() + HELD;
    const listen = () => {
      try {
        Bun.listen({ unix: LOCK, socket: { open: (sock) => void sock.write(me), data() {} } });
        return true;
      } catch (err: any) {
        if (err.code !== "EADDRINUSE") {
          throw err;
        }
        return false;
      }
    };
    while (true) {
      if (!Main.taking()) {
        await Bun.sleep(50);
        continue;
      }
      let held: string | null;
      try {
        if (listen()) {
          return;
        }
        // what the holder says (one before this says nothing: "" once it
        // stays quiet a second); null: nothing holds it (refused, or gone).
        // Any other failure (a reset) is a holder's, never taken
        held = await new Promise<string | null>((done) => {
          const sock = net.connect(LOCK);
          const end = (said: string | null) => (sock.destroy(), done(said));
          sock.on("connect", () => setTimeout(() => end(""), 1000));
          sock.on("data", (piece) => end(String(piece)));
          sock.on("error", (err: any) => end(err.code === "ECONNREFUSED" || err.code === "ENOENT" ? null : ""));
        });
        if (held === null) {
          fs.rmSync(LOCK, { force: true });
          if (listen()) {
            return;
          }
          held = "";
        }
      } finally {
        fs.rmSync(TAKE, { force: true });
      }
      if (Date.now() > until) {
        console.error("unii: a Legion server already runs (" + (held || "an older one, or not a server") + "), holding " + LOCK + ". Stop it first, or set UNII_ANOTHER=1 to run another beside it.");
        process.exit(1);
      }
      await Bun.sleep(500);
    }
  }

  // whether this process now holds TAKE: made here, or there and its
  // maker gone (removed, then tried again on the next call)
  export function taking(): boolean {
    try {
      const fd = fs.openSync(TAKE, "wx", 0o600);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err: any) {
      if (err.code !== "EEXIST") {
        throw err;
      }
    }
    const alive = (pid: number) => {
      try {
        return process.kill(pid, 0);
      } catch (err: any) {
        return err.code === "EPERM";
      }
    };
    try {
      const pid = Number(fs.readFileSync(TAKE, "utf8").trim());
      const old = Date.now() - fs.statSync(TAKE).mtimeMs > TAKING;
      if (Number.isInteger(pid) && pid > 0 ? !alive(pid) : old) {
        fs.rmSync(TAKE, { force: true });
      }
    } catch {}
    return false;
  }

  // RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
  // devices' socket at path made ready to listen on. Any process may take
  // 127.0.0.1:<port>, so devices and terminals send their session only
  // here: its dir is this user's, 0700, so only this user's processes bind
  // or open what's in it. A socket of this user nothing answers on (a
  // crash left it) is removed; anything else there (a file, a link,
  // another's, one that answers) is refused: the server ends (Main.lock:
  // one server per dir, so nothing else should hold it)
  export async function unix(path: string): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf("/"));
    const uid = process.getuid?.();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    const d = fs.statSync(dir);
    if (!d.isDirectory() || d.uid !== uid || (d.mode & 0o077) !== 0) {
      throw new Error(dir + ": must be a directory of this user, mode 0700");
    }
    const st = fs.lstatSync(path, { throwIfNoEntry: false });
    if (st === undefined) {
      return;
    }
    if (!st.isSocket() || st.uid !== uid) {
      throw new Error(path + ": not a socket of this user: remove it");
    }
    const live = await new Promise<boolean>((done) => {
      const sock = net.connect(path);
      sock.on("connect", () => (sock.destroy(), done(true)));
      sock.on("error", () => done(false));
    });
    if (live) {
      throw new Error(path + ": another process answers on it");
    }
    fs.rmSync(path);
  }

  // a site's file
  export function file(pathname: string): Response {
    const file = WEB[pathname];
    return file === undefined ? new Response("not found", { status: 404 }) : new Response(Bun.file(file));
  }


  // deletes the account of the user signed in, if they typed its name,
  // where their chat is: one the worker before still gives (a deploy) is
  // waited for, so it ends before its files go
  export async function close(req: Request): Promise<Response> {
    const cloud = Chat.cloud;
    const user = Cloud.who(cloud, req);
    const text = await Cloud.small(req);
    if (text === null) {
      return Response.json({ error: "Too big." }, { status: 413 });
    }
    const confirm = String(Cloud.json(text).confirm ?? "").trim().toLowerCase();
    if (user === null || confirm !== user.name.toLowerCase()) {
      const name = user === null ? "you are signed out." : "type \"" + user.name + "\".";
      const error = "Deleting your account erases your chat and Unii's memory for good" + cloud.billing.closes + ". To confirm, " + name;
      return Response.json({ error }, { status: 400 });
    }
    await Main.here(user.id);
    const owed = await cloud.billing.owing(user.id);
    if (owed !== null) {
      return Response.json({ error: owed }, { status: 409 });
    }
    Cloud.leave(cloud, user);
    const chat = Chat.chats.get(user.id);
    await (chat === undefined ? Promise.resolve() : Chat.end(chat));
    const why = await Cloud.close(cloud, user, req);
    if (why !== null) {
      return Response.json({ error: why }, { status: 409 });
    }
    fs.rmSync(config.DIR + "/users/" + user.id, { recursive: true, force: true });
    return Cloud.out();
  }

  // a long answer, sent as made, a PIECE at a time, the event loop
  // running between
  export async function* stream(lines: Iterable<string>): AsyncGenerator<string> {
    let piece = "";
    for (const line of lines) {
      piece += line;
      if (piece.length >= PIECE) {
        yield piece;
        piece = "";
        await new Promise((ok) => setImmediate(ok));
      }
    }
    yield piece;
  }

  // a page or post of the user's chat (/api/act: an act with a body, its
  // fields in the query; a POST only, since a GET is what another site
  // may send with the user's cookie, by sending their browser here, from
  // a browser that doesn't say where it comes from: Main.http)
  export async function page(chat: Chat, user: User, p: string, req: Request): Promise<Response> {
    const mem = chat.mem;
    switch (p) {
      case "/tree": {
        return new Response(Main.stream(Memory.page(mem)), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      case "/export": {
        const name = "unii-memory-" + new Date().toISOString().slice(0, 10) + ".json";
        const json = { "content-type": "application/json", "content-disposition": 'attachment; filename="' + name + '"' };
        return new Response(Main.stream(Memory.dump(mem, await Cloud.data(Chat.cloud, user))), { headers: json });
      }
      case "/api/act": {
        if (req.method !== "POST") {
          return new Response("an act is a POST", { status: 405 });
        }
        if (!Main.spend(USERS, user.id)) {
          return Response.json({ error: "Too many requests: wait a moment." }, { status: 429 });
        }
        const msg = { ...Object.fromEntries(new URL(req.url).searchParams), req };
        const out = await Chat.apply(chat, msg, Cloud.browser(Chat.cloud, req) ? "" : POSTED, Cloud.speaks(Chat.cloud, req));
        return Response.json(out, { status: out.status ?? (out.error === undefined ? 200 : 400) });
      }
      case "/api/imported": {
        return Response.json(Chat.done(chat));
      }
    }
    const file = Memory.image_file(mem, p.slice("/image/".length));
    const keep = { "cache-control": "private, max-age=31536000, immutable" };
    return file === null ? new Response("not found", { status: 404 }) : new Response(Bun.file(file), { headers: keep });
  }

  // a request; one for a chat this process gave away goes there. Another
  // site's page (its browser says so: Sec-Fetch-Site) only links here: it
  // posts nothing, reaches no /api/ and opens no socket, so no site acts
  // for its visitors, signed in or not (sends a message, signs them out,
  // asks sign-in mail from their networks)
  // an answer of a process giving its chats away closes its connection,
  // so no client (Caddy, another worker's Main.pass) keeps one to reuse as
  // the process ends
  export async function reply(req: Request, server: Bun.Server<Sock["data"]>): Promise<Response | undefined> {
    const res = await Main.http(req, server);
    if (res === undefined) {
      return res;
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(Main.HEADERS)) {
      headers.set(k, v);
    }
    if ((headers.get("content-type") ?? "").startsWith("text/html")) {
      headers.set("content-security-policy", Main.CSP);
    }
    if (Main.given) {
      headers.set("connection", "close");
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  // RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
  // request this server should answer: its Host one it is (the site's,
  // or loopback on its port: no other name rebound to 127.0.0.1 reaches
  // it), and a post's or socket's Origin, if said, the site's (a terminal
  // or device says none: its Bearer token is no cookie a page can send)
  export function ours(req: Request, p: string): boolean {
    const site = new URL(config.SITE);
    const loop = ["127.0.0.1:" + Main.port, "localhost:" + Main.port];
    const host = req.headers.get("host") ?? "";
    if (host !== site.host && !loop.includes(host)) {
      return false;
    }
    const origin = req.headers.get("origin");
    const acts = (req.method !== "GET" && req.method !== "HEAD") || p === "/ws";
    return !acts || origin === null || origin === site.origin || loop.some((h) => origin === "http://" + h);
  }

  export async function http(req: Request, server: Bun.Server<Sock["data"]>): Promise<Response | undefined> {
    const p = new URL(req.url).pathname;
    const cloud = Chat.cloud;
    const away = /^(cross|same)-site$/.test(req.headers.get("sec-fetch-site") ?? "");
    if (away && (req.method !== "GET" || p.startsWith("/api/") || p === "/ws")) {
      return new Response("not from another site", { status: 403 });
    }
    if (!Main.ours(req, p)) {
      return new Response("not this site", { status: 403 });
    }
    try {
      const user = Cloud.who(cloud, req);
      if (user !== null && Main.shard(user.id) !== Main.index) {
        return new Response("this user's worker is another", { status: 421 });
      }
      const api = await Cloud.http(cloud, req, server.requestIP?.(req)?.address ?? null);
      if (api !== null) {
        return api;
      }
      if (p === "/api/hello") {
        return Response.json({ hello: HELLO, bills: cloud.billing.bills, github: cloud.billing.github !== null });
      }
      if (p === "/api/delete") {
        return await Main.close(req);
      }
      if (!OWN.includes(p) && !p.startsWith("/image/") && !p.startsWith("/api/")) {
        return Main.file(p);
      }
      if (user === null) {
        return new Response("sign in first", { status: 401 });
      }
      await Main.here(user.id);
      if (p === "/ws") {
        if ((Main.sockets.get(user.id) ?? 0) >= SOCKETS || !Main.spend(USERS, user.id)) {
          return new Response("too many requests", { status: 429 });
        }
        // RED ZONE (R1, signed off by the user 2026-11-19): a view is a
        // browser's socket only (Cloud.browser); a terminal's or device's
        // (a Bearer session, its token within an agent shell's reach)
        // names its device, or is refused: it is never a view
        const q    = new URL(req.url).searchParams;
        const host = q.get("device") || null;
        if (host === null && !Cloud.browser(cloud, req)) {
          return new Response("a terminal or device names itself: ?device=", { status: 400 });
        }
        const who  = Cloud.hash(Cloud.token(req));
        const work = q.get("work") ?? "~/.unii/work";
        const home = q.get("home") || null;
        const data = { user, who, tab: q.get("tab") ?? "", wire: q.get("wire"), host, computer: q.get("computer") === "1", work, home, device: null, seen: new Set<string>(), watch: new Set<string>(), says: Cloud.speaks(cloud, req) };
        return server.upgrade(req, { data }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      const chat = Chat.open(user);
      if (chat === null) {
        return await Main.pass(req);
      }
      chat.posts += 1;
      const res = await Main.page(chat, user, p, req).finally(() => (chat.posts -= 1));
      Chat.free(chat);
      return res;
    } catch (err: any) {
      return Response.json(Chat.fail(err), { status: 500 });
    }
  }

  // work one user or peer asks (a socket opened or closed, a chat woken,
  // a message of the process before or after): one that throws (a chat
  // that fails to load or show) fails alone, logged, then `fail`, never
  // the worker, which serves other users too, nor the work that came
  // with it (a view's message fails alone too: Chat.answer)
  export function event(what: string, run: () => void, fail: () => void = () => {}): void {
    try {
      run();
    } catch (err: any) {
      console.error("unii: " + what + " failed: " + (err?.stack ?? err));
      fail();
    }
  }

  // whether `key` may spend n more of its limit; one refused spends
  // nothing
  export function spend(limit: Limit, key: string, n = 1): boolean {
    const now = performance.now();
    const q = limit.keys.get(key) ?? { n: limit.most, at: now };
    q.n = Math.min(limit.most, q.n + ((now - q.at) * limit.rate) / 1000);
    q.at = now;
    limit.keys.set(key, q);
    if (q.n < n) {
      return false;
    }
    q.n -= n;
    return true;
  }

  // a key whose quota grew full again is as one never seen: dropped, so
  // a limit holds only the keys near it, not every one it ever saw
  export function forget(limit: Limit): void {
    const full = (limit.most / limit.rate) * 1000;
    setInterval(() => limit.keys.forEach((q, key) => performance.now() - q.at > full && limit.keys.delete(key)), full);
  }

  // a user's sockets here, n more (n < 0: fewer); none: dropped
  export function opened(user: string, n: number): void {
    const open = (Main.sockets.get(user) ?? 0) + n;
    if (open === 0) {
      Main.sockets.delete(user);
    } else {
      Main.sockets.set(user, open);
    }
  }

  // the worker of a user (signed out: of a token)
  export function shard(key: string): number {
    return Bun.hash.crc32(key) % Main.count;
  }

  // a worker, alone or of a supervisor (whose word, over IPC, wakes a
  // terminal signed in elsewhere, and answers a mail it sent): it takes
  // the chats of the one it follows, if any, then serves beside it on
  // the same port
  export async function start(port: number): Promise<void> {
    const send = process.send?.bind(process);
    const change = (user: string) => {
      const chat = Chat.chats.get(user);
      if (chat !== undefined) {
        Chat.change(chat);
      }
    };
    const signed = (session: string) => (send === undefined ? Cloud.wake(Chat.cloud, session) : send({ $: "signed", session }));
    const post = (mail: object) => (send === undefined ? Mail.send(config.KEYS.resend, mail) : Main.mail(send, mail));
    const hand = HAND + Main.index;
    Mcp.sweep(config.DIR + "/children." + Main.index + ".pids");
    Main.port = port;
    // RED ZONE (security review U1, DRAFT awaiting the user's sign-off):
    // alone (no supervisor: no handover, Main.lock holds the dir), the
    // devices' socket is made ready first, or the server ends
    const alone = process.env.UNII_WORKER === undefined;
    if (alone) {
      await Main.unix(SOCK);
    }
    Chat.cloud = Cloud.open(change, signed, post);
    Main.back = await Main.dial(hand);
    if (Main.back === null) {
      Main.listed.resolve();
      Chat.wake();
    }
    Tools.coming(Main.arrived());
    Chat.cloud.billing.start(Main.index, (user) => Main.shard(user) === Main.index, Chat.chats);
    Main.forget(USERS);
    process.on("message", Main.heard);
    process.on("disconnect", () => process.exit(0));
    process.on("unhandledRejection", Main.unowned);
    // the TCP port's handlers (the browser, the iOS app) and the devices'
    // socket's, the same; alone, the port is held by this process only
    // (no SO_REUSEPORT: none other binds it beside this one), workers share
    // theirs with their successor (a handover)
    const serves = {
      idleTimeout        : 0,
      maxRequestBodySize : Main.BODY,
      fetch              : Main.reply,
      websocket          : {
        maxPayloadLength         : FRAME,
        backpressureLimit        : Main.BUFFER,
        closeOnBackpressureLimit : true,
        idleTimeout              : PING / 1000,
        open(ws: Sock) {
          Main.opened(ws.data.user.id, 1);
          Main.event("a socket of user " + ws.data.user.id, () => {
            if (ws.data.wire !== String(WIRE)) {
              ws.send(JSON.stringify({ $: "error", text: "This page or unii is older than the server: reload or reopen it (`legion update` for the latest)." }));
              return;
            }
            const chat = Chat.open(ws.data.user);
            if (chat === null) {
              ws.close(MOVE);
            } else {
              Chat.join(chat, ws);
            }
          }, () => ws.close(1011));
        },
        message(ws: Sock, data) {
          const chat = Chat.chats.get(ws.data.user.id);
          if (chat === undefined || !chat.socks.has(ws)) {
            return;
          }
          if (Main.spend(USERS, chat.acct.user, 1 + data.length / UNIT)) {
            Chat.answer(chat, ws, String(data));
          } else {
            ws.close(FLOOD);
          }
        },
        close(ws: Sock, code) {
          Main.opened(ws.data.user.id, -1);
          Main.event("a socket of user " + ws.data.user.id, () => {
            const chat = Chat.chats.get(ws.data.user.id);
            if (chat !== undefined) {
              Chat.leave(chat, ws, code === QUIT);
            }
          });
        },
      },
    };
    Main.server = Bun.serve<Sock["data"]>({ ...serves, port, hostname: "127.0.0.1", reusePort: !alone });
    if (alone) {
      Bun.serve<Sock["data"]>({ ...serves, unix: SOCK });
      fs.chmodSync(SOCK, 0o600);
    }
    setInterval(() => {
      for (const chat of Chat.chats.values()) {
        chat.socks.forEach((sock) => sock.send(TICK));
      }
    }, PING / 2);
    setInterval(() => void Chat.gateway(Date.now()), Chat.GATEWAY_TICK);
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      process.on(sig, () => process.exit(0));
    }
    process.on("exit", () => {
      fs.rmSync(Main.addr, { force: true });
      if (alone) {
        fs.rmSync(SOCK, { force: true });
      }
      Mcp.end();
      Chat.quit();
    });
    console.log("unii: " + config.SITE + ", users in " + config.DIR + "/users, worker " + Main.index + " of " + Main.count + " on 127.0.0.1:" + port);
    // the bridge on: the grant read now, while the user who started this
    // is here for its one prompt, not first when they're away
    Chat.gchat_token?.().catch((err: any) => console.error("gchat: replies won't be read: " + String(err?.message ?? err).split("\n")[0]!.slice(0, 200)));
    send?.({ $: "ready" });
    Main.back?.send({ $: "go", tools: Tools.base() });
    Main.listen(hand);
  }

  // a mail, sent by the supervisor: its answer
  export function mail(send: (msg: object) => void, mail: object): Promise<string | null> {
    const id = crypto.randomUUID();
    send({ $: "mail", id, mail });
    return new Promise((done) => Main.mails.set(id, done));
  }

  // a failure no owner took: every background promise has one that ends
  // it (a chat's note, a log line), so this is a bug, logged, never the
  // end of the worker and every chat it holds
  export function unowned(err: unknown): void {
    console.error("unii: a failure no one owned: " + ((err as any)?.stack ?? err));
  }

  // a worker hears its supervisor
  export function heard(msg: any): void {
    switch (msg.$) {
      case "signed": {
        Cloud.wake(Chat.cloud, String(msg.session));
        return;
      }
      case "mailed": {
        Main.mails.get(msg.id)?.(msg.err);
        Main.mails.delete(msg.id);
        return;
      }
    }
  }

  // Handover
  // --------
  // Worker k's successor reaches it at HAND + k (which leads to the
  // newest's own address: Main.listen), says go (its tools' URL), then
  // listens for its own (a successor that dies before that leaves this
  // one serving, reachable again). This one stops serving (its watch
  // too), says its address, which chats it holds and which still come to
  // it (a deploy during a deploy: the one before gives a chat only at
  // rest, after a long post), and gives each on as it can (Chat.give),
  // those coming once they come. A call goes on in the process that
  // started it, fed straight to its chat's process (Main.away, Main.far),
  // so one that passed calls on ends once their origins feed the next.
  // A process ends once nothing is left to come, run, pass
  // on or pay (Main.done).

  // the worker before this one, if one listens at `hand`
  export function dial(hand: string): Promise<Peer | null> {
    return new Promise((done) => {
      const sock = net.connect(hand);
      sock.once("connect", () => done(Main.peer(sock)));
      sock.once("error", () => done(null));
    });
  }

  // this process's address, `hand` and its pid, which any process may
  // reach (a call's new process: Main.far); once it listens, `hand`
  // leads to it, so the next worker k reaches this one
  export function listen(hand: string): void {
    const temp = hand + ".link";
    Main.addr = hand + "." + process.pid;
    fs.rmSync(Main.addr, { force: true });
    net.createServer((sock) => Main.peer(sock)).listen(Main.addr, () => {
      fs.rmSync(temp, { force: true });
      fs.symlinkSync(Main.addr, temp);
      fs.renameSync(temp, hand);
    });
  }

  // a peer over a socket, a line of JSON a message, each heard alone
  // (Main.event): one that fails (a chat moved here that won't open) is
  // logged, and the rest of the read (the chats moved after it) goes on
  export function peer(sock: net.Socket): Peer {
    const peer: Peer = { send: (msg) => sock.write(JSON.stringify(msg) + "\n"), end: (then) => (sock.destroyed ? then() : sock.end(then)), asks: new Map(), feeds: new Map(), grants: new Map() };
    let rest = "";
    Main.peers.add(peer);
    sock.setEncoding("utf8");
    sock.on("data", (data: string) => {
      const lines = (rest + data).split("\n");
      rest = lines.pop()!;
      lines.forEach((line) => Main.event("a message of another worker", () => Main.told(peer, JSON.parse(line))));
    });
    sock.on("error", () => {});
    sock.on("close", () => Main.lost(peer));
    return peer;
  }

  // the process at `addr` (a call's origin: Main.far), by one line
  export function link(addr: string): Peer {
    const known = Main.links.get(addr);
    if (known !== undefined) {
      return known;
    }
    const peer = Main.peer(net.connect(addr));
    Main.links.set(addr, peer);
    return peer;
  }

  // a peer's message; a chat moved here frees its user's requests first,
  // so one that won't open is opened by them anew, as after a restart
  // (Chat.open: it was never kept half open). What a call's origin sends
  // while its relay still passes on is held (Main.far)
  export function told(peer: Peer, msg: any): void {
    const gate = Main.gates.get(msg.call);
    if (gate?.origin === peer) {
      gate.held.push(msg);
      return;
    }
    switch (msg.$) {
      case "go": {
        if (Main.next !== null) {
          return peer.end(() => {});
        }
        Main.next = peer;
        Main.server.stop();
        Main.given = true;
        Main.onward = msg.tools;
        Main.listed.promise.then(() => {
          peer.send({ $: "users", addr: Main.addr, users: [...Chat.chats.keys(), ...Main.coming.keys()] });
          [...Chat.chats.values()].forEach((chat) => Chat.give(chat, peer, msg.tools));
          Main.done();
        }).catch((err) => console.error("unii: giving the chats failed: " + (err?.stack ?? err)));
        return;
      }
      case "users": {
        Main.before = msg.addr ?? "";
        (msg.users as string[]).forEach((user) => Main.coming.set(user, Promise.withResolvers()));
        Main.listed.resolve();
        return;
      }
      case "chat": {
        const moved: Moved = msg.moved;
        Main.coming.get(moved.user)?.resolve();
        Main.coming.delete(moved.user);
        if (moved.credit !== undefined) {
          Chat.cloud.billing.credit.set(moved.user, moved.credit);
        }
        const chat = Chat.open({ id: moved.user, name: "" }, moved, peer);
        if (chat !== null && Main.given) {
          Chat.give(chat, Main.next!, Main.onward);
        }
        Main.done();
        return;
      }
      case "ev": {
        peer.feeds.get(msg.call)?.on(msg.ev);
        return;
      }
      case "end": {
        peer.feeds.get(msg.call)?.end(msg.end);
        peer.feeds.delete(msg.call);
        gate?.origin.feeds.delete(msg.call);
        Main.gates.delete(msg.call);
        return;
      }
      case "take": {
        Tools.went(msg.key, msg.tools);
        const away = Main.aways.get(msg.call);
        if (away !== undefined) {
          away.link.send({ $: "gone", call: msg.call });
          away.link = peer;
        }
        return;
      }
      case "gone": {
        if (gate !== undefined) {
          return Main.open(msg.call, gate);
        }
        peer.feeds.delete(msg.call);
        Main.aways.get(msg.call)?.link.send(msg);
        Main.aways.delete(msg.call);
        Main.done();
        return;
      }
      case "send": {
        Main.aways.get(msg.call)?.call.send(msg.say);
        return;
      }
      case "stop": {
        Main.aways.get(msg.call)?.call.stop();
        return;
      }
      case "book": {
        const bill = peer.feeds.get(msg.call)?.bill ?? (async () => "its call ended");
        bill({ input: msg.input, token: msg.token, exact: null }, msg.cap).then((grant) => {
          if (typeof grant !== "string") {
            peer.grants.set(msg.req, grant);
          }
          peer.send(typeof grant === "string" ? { $: "grant", req: msg.req, why: grant } : { $: "grant", req: msg.req, max: grant.max, cut: grant.cut });
        }).catch((err) => console.error("book " + msg.req + ": " + (err?.message ?? err)));
        return;
      }
      case "grant": {
        const end = (used: object | null) => peer.send({ $: "paid", req: msg.req, used });
        peer.asks.get(msg.req)?.(msg.why ?? { max: msg.max, cut: msg.cut, end });
        peer.asks.delete(msg.req);
        Main.done();
        return;
      }
      case "paid": {
        peer.grants.get(msg.req)?.end(msg.used);
        peer.grants.delete(msg.req);
        Main.done();
        return;
      }
    }
  }

  // a call moved with its chat to `peer`'s process: what it sends, pays
  // and ends goes where the chat is, by its ref: this process's address
  // and an id, or, fed here from further back, its own, passed on till
  // its origin feeds the chat's process itself (gone); a request it books
  // there goes with its input exact (Cost: a count can't go)
  export function away(peer: Peer, call: Call): string {
    const ref = Main.refs.get(call) ?? Main.addr + "#" + crypto.randomUUID();
    const away: Away = { call, link: peer };
    const bill: Bill = async (cost, cap) => {
      const { input, token } = cost.exact === null ? cost : await cost.exact();
      const req = crypto.randomUUID();
      const link = away.link;
      link.send({ $: "book", call: ref, req, input, token, cap });
      return new Promise((done) => link.asks.set(req, done));
    };
    const end = (end: End) => {
      Main.aways.delete(ref);
      away.link.send({ $: "end", call: ref, end });
      Main.done();
    };
    Main.aways.set(ref, away);
    call.move({ on: (ev) => away.link.send({ $: "ev", call: ref, ev }), bill, end });
    return ref;
  }

  // the call `ref` running elsewhere for a chat moved here from `back`: fed by
  // `back` if it runs there, else by its origin, asked to (take; its MCP
  // requests for the chat `key` then come straight here: Tools.went), what that
  // sends held till `back` passed on all that reached it (gone)
  export function far(back: Peer, ref: string, key: string, on: (ev: Event) => void, bill?: Bill): Call {
    const at = ref.slice(0, Math.max(0, ref.lastIndexOf("#")));
    const origin = at === Main.before ? back : Main.link(at);
    const send = (say: Say) => origin.send({ $: "send", call: ref, say });
    const [call, feed] = AskAI.tie(on, bill, send, () => origin.send({ $: "stop", call: ref }));
    back.feeds.set(ref, feed);
    origin.feeds.set(ref, feed);
    if (origin !== back) {
      Main.gates.set(ref, { relay: back, origin, held: [], lost: false });
      origin.send({ $: "take", call: ref, key, tools: Tools.base() });
    }
    Main.refs.set(call, ref);
    return call;
  }

  // a call's relay passed on all that reached it: what its origin sent
  // since goes on, then the end its lost line meant
  export function open(ref: string, gate: Gate): void {
    Main.gates.delete(ref);
    gate.relay.feeds.delete(ref);
    gate.held.forEach((msg) => Main.told(gate.origin, msg));
    if (gate.lost) {
      gate.origin.feeds.get(ref)?.end(AskAI.end(ENDED));
      gate.origin.feeds.delete(ref);
    }
  }

  // once it gave all its chats and nothing it runs, passes on or pays for
  // them is left, this process ends, its last requests answered
  // (Main.leave)
  export function done(): void {
    const paying = [...Main.peers].some((peer) => peer.asks.size > 0 || peer.grants.size > 0);
    if (Main.given && Chat.chats.size === 0 && Main.coming.size === 0 && Main.aways.size === 0 && !paying) {
      Main.leave();
    }
  }

  // ends once no request is under way, to it or from it (a model's answer
  // read on to be billed: Agent.READING), and all told to other processes
  // is out (an exit drops what a socket still holds: a call's end, its
  // payment; on macOS all past 8 KB); Bun's server.stop() promise would
  // say so of the first, but never resolves once a WebSocket was open
  // (Bun 1.3.14), so the counts are read again each LEAVE ms
  export function leave(): void {
    if (Main.server.pendingRequests === 0 && READING.n === 0) {
      Promise.all([...Main.peers].map((peer) => new Promise<void>((ok) => peer.end(ok)))).then(() => process.exit(0));
      return;
    }
    setTimeout(Main.leave, LEAVE);
  }

  // a line lost: if calls were fed over it from here, or it was the next
  // one's with chats still given it, that process crashed, and this one
  // ends too (the next start resumes all). Else the calls fed over it end
  // (a call's origin crashed; one its relay still passes on ends as that
  // says), and what it asked or let through for payment; the one before
  // frees what waits on it, and this one ends as it was to (Main.leave)
  export function lost(peer: Peer): void {
    Main.peers.delete(peer);
    Main.links.forEach((link, at) => link === peer && Main.links.delete(at));
    const fed = [...Main.aways.values()].some((away) => away.link === peer);
    if (fed || (peer === Main.next && (Chat.chats.size > 0 || Main.coming.size > 0))) {
      process.exit(1);
    }
    if (peer === Main.back) {
      Main.listed.resolve();
      Main.coming.forEach((c) => c.resolve());
      Main.coming.clear();
    }
    for (const [ref, feed] of peer.feeds) {
      const gate = Main.gates.get(ref);
      if (gate?.origin === peer) {
        gate.lost = true;
        continue;
      }
      gate?.origin.feeds.delete(ref);
      Main.gates.delete(ref);
      feed.end(AskAI.end(ENDED));
    }
    peer.asks.forEach((ask) => ask(ENDED));
    peer.grants.forEach((grant) => grant.end(null));
    Main.done();
  }

  // a request for a chat this process gave away, sent where it went
  // (the only one on this port since)
  export function pass(req: Request): Promise<Response> {
    const url = new URL(req.url);
    return fetch("http://127.0.0.1:" + Main.port + url.pathname + url.search, { method: req.method, headers: req.headers, body: req.body, redirect: "manual" });
  }

  // once the chat of `user` the worker before gives is here
  export async function here(user: string): Promise<void> {
    await Main.listed.promise;
    await Main.coming.get(user)?.promise;
  }

  // once all it gives are
  export async function arrived(): Promise<void> {
    await Main.listed.promise;
    await Promise.all([...Main.coming.values()].map((c) => c.promise));
  }

  // the workers' supervisor (run: what starts one, on port+1+k,
  // UNII_WORKER=k): holds the lock, starts again a worker that dies,
  // answers each request with its worker's address (`x-unii-worker`:
  // README; past its network's limit, NETS, 429), relays a worker's word
  // to all, sends their mail. A deploy (SIGHUP) starts each worker anew,
  // which takes the chats of the one before (Main.start); one that fails
  // to start leaves that one serving. Its own code changes only on a
  // restart
  export function supervise(port: number, run: string[]): void {
    const cloud = Cloud.open(() => {}, () => {}, async () => null);
    const workers: Bun.Subprocess[] = [];
    const all = new Set<Bun.Subprocess>();
    const hear = (k: number, proc: Bun.Subprocess, msg: any) => {
      switch (msg.$) {
        case "ready": {
          workers[k] = proc;
          return;
        }
        case "signed": {
          all.forEach((w) => w.send(msg));
          return;
        }
        case "mail": {
          Mail.send(config.KEYS.resend, msg.mail).then((err) => proc.send({ $: "mailed", id: msg.id, err })).catch(() => {});
          return;
        }
      }
    };
    const start = (k: number) => {
      const env = { ...config.config_env(), UNII_WORKER: String(k), BUN_CONFIG_MAX_HTTP_REQUESTS: String(FETCHES) };
      const ipc = (msg: any, proc: Bun.Subprocess) => hear(k, proc, msg);
      const proc = Bun.spawn([...run, String(port + 1 + k)], { env, ipc, stdio: ["ignore", "inherit", "inherit"] });
      all.add(proc);
      proc.exited.then((code) => {
        all.delete(proc);
        Main.died(k, code, workers[k], proc, () => start(k));
      });
    };
    Array.from({ length: config.WORKERS }, (_, k) => start(k));
    Main.forget(NETS);
    Bun.serve({
      port     : port,
      hostname : "127.0.0.1",
      fetch    : (req, srv) => {
        if (!Main.spend(NETS, Cloud.net(Cloud.ip(req, srv.requestIP(req)?.address ?? null) ?? ""))) {
          return new Response("too many requests", { status: 429 });
        }
        const user = Cloud.who(cloud, req);
        const k = Main.shard(user?.id ?? Cloud.token(req));
        return new Response(null, { headers: { "x-unii-worker": "127.0.0.1:" + (port + 1 + k) } });
      },
    });
    const stop = () => {
      Main.leaving = true;
      all.forEach((w) => w.kill());
      Promise.all([...all].map((w) => w.exited)).then(() => process.exit(0));
    };
    for (const sig of ["SIGTERM", "SIGINT"]) {
      process.on(sig, stop);
    }
    process.on("SIGHUP", () => workers.forEach((_, k) => start(k)));
    console.log("unii: " + config.SITE + ", " + config.WORKERS + " workers on 127.0.0.1:" + (port + 1) + "-" + (port + config.WORKERS) + ", routes on " + port);
    console.log("unii: no device socket with workers: devices and terminals on this computer connect only over " + SOCK + ", which a lone server (workers 0) opens");
  }

  // a worker ended (`now`: worker k's, the last that started): as the
  // server ends, nothing; one after a deploy (another is now) too; worker
  // k's again; one that never started (none is), the server ends
  export function died(k: number, code: number | null, now: Bun.Subprocess | undefined, proc: Bun.Subprocess, again: () => void): void {
    if (code !== 0) {
      console.error("unii: worker " + k + " ended (" + code + ")");
    }
    if (Main.leaving || (now !== undefined && now !== proc)) {
      return;
    }
    if (now === undefined) {
      process.exit(1);
    }
    again();
  }

}

// run: the command that starts this server again, to start a worker
// (null: the server is one process: no workers, or `unii serve`)
export async function serve(port: number, run: string[] | null): Promise<void> {
  const worker = process.env.UNII_WORKER;
  Main.count = run === null ? 1 : config.WORKERS;
  Main.index = Number(worker ?? 0);
  if (worker === undefined) {
    await Main.lock(port);
  }
  if (worker === undefined && run !== null) {
    Main.supervise(port, run);
  } else {
    await Main.start(port);
  }
}

if (import.meta.main) {
  await serve(Number(process.argv[2] ?? 8788), config.WORKERS > 0 ? [process.execPath, import.meta.path] : null);
}
