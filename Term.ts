#!/usr/bin/env bun
// Term
// ====
// `legion` (`unii` too): a terminal view of the agent (Server.ts) and, while open, a
// device its tools reach (DEVICE). It feeds a View the server's messages
// and the person's acts, and prints what it says (Paint.ts, Screen.ts)
// into the terminal's own scrollback. Every act of the site is a command
// here (COMMANDS, /help). The agent's jobs run here (Machine.ts) until
// done or halted; all they left running dies as this unii quits. From a
// pipe, each line is a message.
//
// One executable per platform (upstream releases it; this build runs
// from its source, asks no one for updates and sends no telemetry).
// `legion serve` runs the server it carries. The server:
// the url given, else $UNII_URL, else http://127.0.0.1:8788 (this build;
// upstream's is uniichat.com); each server's session is a file of its own
// (TOKEN).
//
// Usage: USAGE (`legion help` prints it).

import * as child from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { Kind } from "./AskAI.ts";
import { Auth } from "./Auth.ts";
import * as Cockpit from "./Cockpit.ts";
import * as Cost from "./Cost.ts";
import * as Deck from "./Deck.ts";
import * as Device from "./Device.ts";
import * as Import from "./Import.ts";
import { Machine } from "./Machine.ts";
import * as Notify from "./Notify.ts";
import * as Paint from "./Paint.ts";
import { type Move, Pick } from "./Pick.ts";
import * as Screen from "./Screen.ts";
import * as View from "./View.ts";

// Types
// =====

// the terminal: jobs running here; ended: input's; pending: commands at
// work; last: Legion's message printed last (-1: none); wait: parts up
// to it not printed (term_settle); out: lines to print; wipe: first;
// due: a paint; settle: the page's print at a new size; imgs: for the
// next message; flow: how much of each message streaming is printed
// (Infinity: logged); logs: of each agent's page, the messages printed
type Term = {
  v       : View.View;
  scr     : Screen.Screen;
  url     : string;
  jobs    : Map<string, Run>;
  ended   : boolean;
  pending : number;
  last    : number;
  wait    : View.Part[];
  out     : Paint.Line[];
  wipe    : boolean;
  due     : boolean;
  settle  : Timer | undefined;
  imgs    : Blob[];
  flow    : Map<View.Live, number>;
  logs    : Map<string, number>;
  crew?   : boolean; // the crew panel hidden (/crew)
  deck?   : Deck.Deck; // the deck shown full screen (Deck.ts): /crew full, /home, /inbox...
  away?   : boolean; // the terminal not in front (it told FocusOut): alerts notify
  focused?: boolean; // the terminal ever told its focus; one that never does is taken as away
  seen?   : Cockpit.Seen; // the look the user left at FocusOut: back AWAY later, what happened since
  editing?: string; // /edit's file, asked of a device: its editor runs once it comes
  looking?: string; // /look's file, asked of a device: the deck's file page shows it once it comes (a terminal)
  chord?  : boolean; // Ctrl+G pressed: the next key a page's letter (term_chord)
  toast?  : { text: string; until: number }; // a word over the input till then (term_toast)
  menu?   : { text: string; sel: number }; // the / menu's item picked, for that text (term_menu)
  shut?   : string;  // the text whose / menu Esc closed
  stamps? : Record<string, string>; // the inbox's rows as /inbox last showed them (Cockpit.inbox_seen)
  goto?   : string | null; // the last alert's agent, shown as the terminal comes back
  branch? : string | null; // the branch of the folder Unii works in (term_status)
  spend?  : Cost.Spend;    // today's LiteLLM spend (term_status)
  reported?: string;       // the status last sent as this device's (term_status)
  reads?  : (msg: View.Server) => void; // the cockpit's reads, as legion device's (Device.device_reads)
};

// a job running here: its stop, its send to the background (a shell's)
type Run = Device.Run;

// a line of /help: how it is typed ("": keys only), its keys, what it
// does; it runs on its argument, or by a key on "" (or the key's name)
type Cmd = [use: string, keys: string, text: string, run: (t: Term, arg: string) => void | Promise<void>];

// Constants
// =========

// this unii's version: each release ships one, a new one for every
// change to Term.ts or what it imports
const VERSION = "1.0.145";

const ARGS   = process.argv.slice(2);
const LOGIN  = ARGS.includes("login");
const HELP   = ARGS.some((a) => ["help", "--help", "-h"].includes(a));
const ASKVER = ARGS.includes("version");
const UPDATE = ARGS.includes("update");
const SERVE  = ARGS.includes("serve");
const DEVICED = ARGS.includes("device");
const WEBIN  = ARGS.includes("web");
const PORT   = SERVE ? ARGS.find((a) => /^\d+$/.test(a)) : undefined;
const WORDS  = ["login", "help", "--help", "-h", "version", "update", "serve", "web", "device"];
const WEB    = /^https?:\/\//;
const ODD    = ARGS.find((a) => !WORDS.includes(a) && !WEB.test(a) && a !== PORT);
const HOME   = process.env.UNII_HOME || os.homedir() + "/.unii";
const OURS   = "http://127.0.0.1:8788";
const SERVER = (ARGS.find((a) => WEB.test(a)) ?? process.env.UNII_URL ?? OURS).replace(/\/$/, "");
const TOKEN  = HOME + "/" + new URL(SERVER).host + "/token";
// RED ZONE (K1, K2, DRAFT awaiting the user's sign-off): the terminal
// key: signed in with the device key (TOKEN, a file: jobs, `legion
// device`, launchd's) by the one code, its session speaks for the user
// (Cloud.speaks: /mode, /plan, /allow, /approve, /answer, routines,
// timers, todos...). Kept only in the Keychain, as the generic password
// of service "legion-terminal-<host>" (Auth.asking: every read the user
// allows, the value on security's stdin), never in a file, the
// environment, an argument nor anything sent to a job. The full-screen
// terminal reads it once as it starts (TERMKEY: in this process only);
// none (signed in before it) or refused, it runs on the device key
const KEYCHAIN = "legion-terminal";
let TERMKEY: string | null = null;
// RED ZONE (S1b, DRAFT awaiting the user's sign-off): a local Legion's
// sign-in secret, the Keychain's "legion-signin-<host>" (login_local)
const SIGNIN = "legion-signin";
// RED ZONE (security review U1, DRAFT awaiting the user's sign-off): the
// server's own dir, as Config.DIR reads it ($UNII_DIR, default ~/.unii),
// where its socket is; every request and socket to the server goes over
// it only (Device.device_wire), never TCP. This build talks to a server
// on this computer only (upstream's may be any, by default the hosted
// one): a job it is sent runs here
const SOCKDIR = (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=\/|$)/, os.homedir());
try {
  Device.device_wire(SERVER, SOCKDIR);
} catch (err: any) {
  console.error("legion: refused: " + err.message + " (this build opens servers on this computer only, over their socket)");
  process.exit(1);
}

// the wire to the server at url (its socket in SOCKDIR)
function term_wire(url: string): Device.Wire {
  return Device.device_wire(url, SOCKDIR);
}

const USAGE = `Usage: legion [url]         the chat (url: $UNII_URL, else http://127.0.0.1:8788)
       legion login [url]   sign in
       legion web [url]     open the site in your browser, signed in as this terminal
       legion device [url]  this computer runs the agents' jobs, with no screen
                            (as a terminal does; the newest one open runs them)
       legion update [url]  disabled in this build (it ran curl | sh)
       legion version       this legion's version
       legion serve [port]  your own Legion server, at http://127.0.0.1:8788
                            (another port: set UNII_SITE to its address too),
                            on your ANTHROPIC_API_KEY and OPENAI_API_KEY;
                            chat with it: legion http://127.0.0.1:8788
       legion help          this
UNII_WORK: where the agent works on this computer (default
~/.unii/work). UNII_COMPUTER=1: it may use the screen. UNII_HOME: where
it keeps its sign-in (default ~/.unii).
This build sends no telemetry and opens no server but this computer's.
In the chat, /help lists every command and key.`;

// this device's name, as the agent sees it: on macOS its local host name
// (Bonjour's, unique on its network), else the host's
const LOCAL  = process.platform === "darwin" ? child.spawnSync("scutil", ["--get", "LocalHostName"]).stdout?.toString().trim() : "";
const DEVICE = LOCAL || os.hostname();

// where the agent's tools work on this device: in WORK/main (the agent)
// and WORK/<name> (each subagent)
const WORK = process.env.UNII_WORK || "~/.unii/work";
// the home repo: where Unii's own jobs run, its AGENTS.md pointing to the
// other repos (none: <work>/main)
const HOME_REPO = process.env.UNII_HOME_REPO || "";

// whether the agent may use this device's screen, mouse and keyboard
const COMPUTER = process.env.UNII_COMPUTER === "1";

// how this device runs the server's jobs (Device.ts), a terminal or not
const RULES: Device.Rules = { work: WORK, home: HOME_REPO || undefined, computer: COMPUTER };

// the margin left of each line
const MARGIN = 2;

// a paint's frame: a stream's pieces come faster than a screen shows
// them (ms)
const FRAME = 16;

// a size held this long is settled: a drag's sizes come faster, and each
// would print the whole page again (ms)
const SETTLE = 100;

// where Claude Code and Codex keep their sessions (Import.import_dirs)
const IMPORTS = Import.import_dirs(process.env, os.homedir());

// what /import takes: its day; a site's export (its zip, or its
// conversations.json)
const SINCE  = /\bsince +(\d{4}-\d\d-\d\d)\b/;
const EXPORT = /\.(zip|json)$/i;
const HOW = "Pick with /import [claude] [chatgpt] [since 2026-06-01] [tools] [sessions] [-#n] [<export>.zip] [go] (-#n: not session n; go: import); /import pause or resume: the import running. Exports, on each website: " + Object.entries(Import.EXPORTS).map(([app, how]) => app + ": " + how).join("; ") + "; it emails you a zip.";

// how a terminal adds credit, said when a request is refused for want
// of it
const TOPUP = "Add credit with /topup <dollars> ($5 to $500).";

// the input's hint on an agent's page
const OFF = "Commands only: /help";
// the crew panel's most lines (Paint.crew_lines)
const CREW_ROWS = 8;
// how often the status line reads the branch and today's spend
const STATUS = 30e3;

// the pick's moves by Shift and an arrow
const ARROWS: Record<string, Move> = { "Shift+Left": "prev", "Shift+Right": "next", "Shift+Up": "up", "Shift+Down": "down" };

// all a person can do here, by group (the editing keys are Screen's);
// credit added only where the server bills
function term_groups(v: View.View): [group: string, cmds: Cmd[]][] {
  const topup: Cmd[] = v.bills ? [["/topup <usd>", "", "add Bend Credits, paid in the browser", term_topup]] : [];
  return [
    ["Chat", [
      ["",                  "Enter",                   "send; on an empty input, interrupt Legion",    term_enter],
      ["",                  "Esc",                     "interrupt Legion's turn and stop the shell command shown running; agents go on", term_esc],
      ["",                  "Ctrl+C, Ctrl+D",          "clear; on an empty input, interrupt, quit",      term_clear],
      ["/goal <message>",   "",                        "send a message as the goal: at each turn's end, Legion asks itself if it is met, and goes on till it is", (t, a) => term_act(t, { $: "Send", text: "/goal " + a })],
      ["/halt",             "",                        "drop the goal; the turn running ends as it would", (t) => term_act(t, { $: "Send", text: "/halt" })],
      ["/attach <path>",    "",                        "attach files: an image goes with the next message, a text file goes in the box (or drop an image here)", term_attach],
      ["/copy",             "Ctrl+Y",                  "copy the last code block Legion wrote (a command to run: ! then paste it) to your clipboard", term_copy],
      ["/open #id",         "",                        "open block #id, as it shows, and keep it open",  (t, a) => term_block(t, a, true)],
      ["/close #id",        "",                        "close block #id and keep it closed",             (t, a) => term_block(t, a, false)],
      ["",                  "Ctrl+G",                  "then a page's letter: that page, full screen, as the web's g (h home, i inbox, o todo, c crew, x explain, q questions, p memory, f file, r d t s); in it, g and a letter", term_chord],
      ["/bg",               "Ctrl+B",                  "send the shell commands shown running to the background: they go on, and their callers (/shells lists them; Ctrl+B eaten? type /bg)", term_bg],
      ["/shells",           "",                        "the commands in the background, running or ended", term_shells],
      ["/kill <n>",         "",                        "stop background command n", term_kill],
      ["/fold",             "Ctrl+F",                  "the chat in the fewest blocks; again: unfold (Ctrl+F eaten? type /fold)", term_fold],
      ["/import [...]",     "",                        "import your Claude and ChatGPT chats (alone: options, costs)", term_import],
      ["/export",           "",                        "save memory and account as ./unii-memory.json",  term_export],
      ["",                  "Ctrl+Z",                  "suspend; fg brings it back",                     (t) => Screen.screen_suspend(t.scr)],
      ["/quit",             "",                        "leave: the chat goes on without this terminal",  term_quit],
      ["/help",             "",                        "this list",                                      term_help],
    ]],
    ["Memory", [
      ["/pin #id",          "",                        "pin a message (again: unpin): every call then sees it whole, however old", term_pin],
      ["/pins",             "",                        "the messages pinned",                           (t) => term_page_cmd(t, "memory", () => View.view_pins_note(t.v))],
      ["/recall <words>",   "",                        "search the whole chat for the words",           (t, a) => term_act(t, { $: "Search", q: a }).length === 0 && term_note(t, "Recall what? /recall <words>")],
      ["/seek #id",         "",                        "show message #id in the chat, its blocks opened", (t, a) => term_answer(t, View.view_id_cmd("/seek", a, (id) => ({ $: "Seek", id })))],
      ["/tree",             "",                        "the whole memory, in the browser (its link prints too)", (t) => term_browse(t, "The memory tree", t.url + "/tree")],
    ]],
    ["Pick", [
      ["",                  "Shift+Left, Shift+Right", "the model before, the next",                     (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Up, Shift+Down",    "more effort, less",                              (t, k) => term_move(t, ARROWS[k])],
      ["",                  "Shift+Tab",               "the next mode: plan, auto, super, full (as Claude Code's), typing or not", (t) => term_act(t, { $: "Mode" })],
      ["/model [name]",     "",                        "the models to pick from; with a name, that one", (t, a) => term_pick(t, "model", a)],
      ["/effort [level]",   "",                        "the efforts; with one, that one",                (t, a) => term_pick(t, "effort", a)],
      ["/speed [speed]",    "",                        "the speeds; with one, that one",                 (t, a) => term_pick(t, "speed", a)],
    ]],
    ["Agents", [
      ["",                  "Tab",                     "the next tab",                                   term_cycle],
      ["/tab [name]",       "",                        "the tabs; with a name, that one",               term_tab],
      ["/agent <task>",     "",                        "start an agent on a task; its report waits in the chat, starting no turn", (t, a) => term_act(t, { $: "Send", text: "/agent " + a })],
      ["/stop [name]",      "",                        "stop all work, agents too; or that agent and those under it", term_stop],
      ["/crew [full]",      "",                        "show or hide the crew: Legion and every agent under its starter; full: the whole screen (Esc goes back)", term_crew],
      ["/dismiss [name]",   "",                        "take a done agent out of the crew; all done ones with no name", term_dismiss],
      ["/home",             "",                        "home: who needs you, the stats, Legion's agents working then done (back after 2h away, what happened shows by itself)", (t) => term_page_cmd(t, "home", () => Cockpit.home_text(t.v, new Date()))],
      ["/archive [name|all]", "",                      "take done agents off home and the crew; alone: all done ones", (t, a) => term_answer(t, Cockpit.archive_cmd(t.v, a, Date.now()))],
      ["/undo [name] [yes]", "",                       "put back the files that agent's last turn changed (on its tab: that one); yes confirms", (t, a) => term_answer(t, View.view_crew_op(t.v, "undo", a))],
      ["/handoff [name]",   "",                        "open that agent's work in Claude Code on its device, with its brief", (t, a) => term_answer(t, View.view_crew_op(t.v, "handoff", a))],
      ["/approve [name]",   "",                        "let a Claude Code worker asking to start run (auto mode, on its device)", (t, a) => term_approve(t, a, true)],
      ["/deny [name]",      "",                        "refuse a Claude Code worker asking to start",     (t, a) => term_approve(t, a, false)],
    ]],
    ["Modes", [
      ["/mode [name]",      "",                        "plan (agents only read till you approve a plan), auto (a reviewer checks each change), super (as auto, and Legion takes its pick on questions where you always have) or full (hooks only); alone: the next", (t, a) => term_answer(t, View.view_mode_cmd(a))],
      ["/plan [yes|no]",    "",                        "the plan waiting for you; yes [auto|full] approves it, no <feedback> sends it back", (t, a) => term_answer(t, View.view_plan_cmd(t.v, a))],
      ["/allow <n>",        "",                        "run call n, waiting as auto mode's reviewer couldn't check it", (t, a) => term_answer(t, View.view_consent_cmd(t.v, a, true))],
      ["/refuse <n>",       "",                        "refuse waiting call n",                          (t, a) => term_answer(t, View.view_consent_cmd(t.v, a, false))],
    ]],
    ["Questions", [
      ["/todos [done|drop <n>]", "",                  "what your agents need you to do (only you can); done n tells its agent, drop n drops it", (t, a) => a.trim() === "" ? term_page_cmd(t, "todo", () => Cockpit.todo_text(t.v)) : term_answer(t, Cockpit.todo_cmd(t.v, a))],
      ["/explain [question]", "",                    "what the crew is building and why, for a manager (an observer writes it); with a question: asked there, answered there, never in the chat", term_explain],
      ["/questions",        "",                        "the questions Legion filed for you, open",       (t) => term_page_cmd(t, "questions", () => View.view_questions_note(t.v))],
      ["/answer <n> <text>", "",                       "answer question n (or with an offered answer's number); Legion takes it up", (t, a) => term_answer(t, View.view_answer(t.v, a))],
      ["/drop <n>",         "",                        "dismiss question n (or super auto's decision n)", (t, a) => term_answer(t, View.view_drop(t.v, a))],
      ["/reverse <n> [answer]", "",                    "undo super auto's decision n, saying what instead (none: don't, ask me)", (t, a) => term_answer(t, View.view_reverse_cmd(t.v, a, Date.now()))],
    ]],
    ["Files", [
      ["/look <path[:line]>", "",                      "a file's lines, from that line (asked of a device; secrets refused)", term_look],
      ["/ls [folder|roots]", "",                       "a folder's entries (here if none); roots: the work dir, home repo, spaces", term_ls],
      ["/find <name>",      "",                        "files by name in the workspace (this folder)",   (t, a) => term_find(t, "find", a)],
      ["/grep <text>",      "",                        "lines holding the text in the workspace",        (t, a) => term_find(t, "grep", a)],
      ["/git <op> [repo]",  "",                        "status, log, diff, changes (the branch's work since main), branches, show <rev>", (t, a) => term_answer(t, View.view_git_cmd(a, process.cwd(), os.homedir()))],
      ["/edit [path]",      "",                        "edit the file shown (or path) in your $EDITOR; saved on exit unless it changed meanwhile", term_edit],
      ["/editor <path>",    "",                        "open a file in your editor on the device",      (t, a) => a.trim() === "" ? term_note(t, "Which file? /editor <path>") : term_act(t, { $: "Look", what: { kind: "open", path: View.path_from(process.cwd(), a, os.homedir()) } })],
    ]],
    ["Inbox", [
      ["/inbox [words]",    "",                        "review requests, your PRs, alerts, tickets, worktrees to clean, numbered; words filter", term_inbox],
      ["/review <n…> [claude]", "",                    "a Legion agent reviews each review request (claude: as Claude Code workers)", (t, a) => term_answer(t, Cockpit.review_cmd(t.v, "review", a, Date.now()))],
      ["/fix <n…> [claude]", "",                       "a Legion agent fixes each of your PRs failing, in conflict or with changes asked", (t, a) => term_answer(t, Cockpit.review_cmd(t.v, "fix", a, Date.now()))],
      ["/refresh",          "",                        "the devices read the inbox anew",               (t) => (term_act(t, { $: "Fetch" }), term_toast(t, "Reading the inbox anew; /inbox in a moment."))],
    ]],
    ["Pages", [
      ["/digest",           "",                        "the team's week: merged by author, then in progress", (t) => term_page_cmd(t, "digest", () => Cockpit.digest_text(t.v))],
      ["/themes",           "",                        "the digest summarized by theme (one call to the compactor's model)", (t) => (term_act(t, { $: "Themes" }), term_toast(t, "Summarizing the digest by theme…"))],
      ["/transcripts",      "",                        "recorded calls, the last 14 days",               (t) => term_page_cmd(t, "transcripts", () => Cockpit.transcripts_text(t.v))],
      ["/transcript <n>",   "",                        "transcript n's summary (made once, by the compactor's model)", term_transcript],
      ["/timesheet [act]",  "",                        "Harvest drafts by day; submit sends the open ones, drop <n>, weekly drafts every Friday", (t, a) => a.trim() === "" ? term_page_cmd(t, "timesheet", () => Cockpit.timesheet_text(t.v)) : term_answer(t, Cockpit.timesheet_cmd(t.v, a))],
      ["/lane",             "",                        "the timeline of the agent on this tab",          (t) => term_note(t, t.v.page === null ? "/lane shows an agent's timeline: /tab to one first." : Cockpit.lane_text(t.v.page.name, View.view_lane(t.v, Date.now())))],
    ]],
    ["Routines", [
      ["/routines",         "",                        "your routines: tasks a Legion agent starts on by the clock or on new review requests", (t) => term_page_cmd(t, "routines", () => View.view_routines_note(t.v))],
      ["/routine <act>",    "",                        "add daily HH:MM | every Nh | on review, then name: task; or run, on, off, drop <n>", (t, a) => term_answer(t, View.view_routine_cmd(t.v, a))],
    ]],
    ["Account", [
      ...topup,
      ["/account",          "",                        "balance, top-ups, charges, calls",               term_account],
      ["/delete <name>",    "",                        "delete your account and chat (its name confirms)", term_delete],
      ["/logout",           "",                        "sign out and quit",                              term_logout],
    ]],
  ];
}

function term_commands(v: View.View): Cmd[] {
  return term_groups(v).flatMap(([, cmds]) => cmds);
}

// Term
// ====

function term_new(url: string): Term {
  const t: Term = {
    v       : View.view_new(),
    scr     : Screen.screen_new((key) => term_press(t, key)),
    url,
    jobs    : new Map(),
    ended   : false,
    pending : 0,
    last    : -1,
    wait    : [],
    out     : [],
    wipe    : false,
    due     : false,
    settle  : undefined,
    imgs    : [],
    flow    : new Map(),
    logs    : new Map(),
  };
  t.scr.pasted = (text) => term_pasted(t, text);
  t.scr.keys = (key) => term_menu_key(t, key);
  term_status(t, false);
  setInterval(() => term_status(t), STATUS).unref();
  // the crew panel's spinner (Paint.SPIN): a paint per frame while one works;
  // a shell command's time ticking while one shows (Paint.shell_lines)
  setInterval(() => {
    const spins = t.scr.tty && t.deck === undefined && (t.crew ?? true) && (t.v.busy || t.v.crew.some((c) => c.status === "working"));
    if (spins || (t.scr.tty && t.deck === undefined && View.view_fore(t.v).length > 0)) {
      term_draw(t);
    }
  }, Paint.SPIN_MS).unref();
  t.reads = Device.device_reads(RULES, (out) => term_send(t, out));
  process.stdin.on("end", () => {
    if (t.scr.ed.text.trim() !== "") {
      term_enter(t);
    }
    t.ended = true;
    term_idle(t);
  });
  process.stdout.on("resize", () => term_resize(t));
  process.on("exit", Machine.end);
  for (const sig of ["SIGHUP", "SIGTERM", "SIGINT"]) {
    process.on(sig, () => term_bye(t));
  }
  return t;
}

// connects, by View's link, naming this device
// this device as the socket names it: its name, whether it does computer
// use, its work dir, its home repo
function term_device(): string {
  return "&device=" + encodeURIComponent(DEVICE) + "&computer=" + (COMPUTER ? 1 : 0) + "&work=" + encodeURIComponent(WORK) + (HOME_REPO ? "&home=" + encodeURIComponent(HOME_REPO) : "");
}

// (RED ZONE U1: over the server's socket only, Device.device_link)
function term_connect(t: Term): void {
  Device.device_link(t.v, term_wire(t.url), term_auth, term_device(), (line) => term_note(t, "Legion: " + line + "."), (msg) => term_hear(t, msg), (up) => term_lost(t, up));
}

// a socket lost (up: it had opened): the footer says offline; one that
// never opened, if the server refuses this terminal's session, quits
async function term_lost(t: Term, up: boolean): Promise<boolean> {
  term_draw(t);
  // a terminal key the server refuses (signed out): the device key's from
  // then on, and approving from here off (K2)
  if (!up && TERMKEY !== null && (await Device.device_fetch(term_wire(t.url), "/api/me", { headers: term_auth() }).catch(() => null))?.status === 401) {
    TERMKEY = null;
    term_note(t, KEYLESS);
  }
  if (!up && !await term_signed(t.url)) {
    term_note(t, "This terminal is signed out: run legion again to sign in.");
    process.exitCode = 1;
    term_quit(t);
    return false;
  }
  return true;
}

// an act to the server (a message shown while it waits offline); a
// message refused goes back in the input
function term_send(t: Term, msg: View.Client, sent?: View.Sent): void {
  const said = sent === undefined ? "" : sent.text.trim();
  View.link_send(t.v, msg, (a) => {
    if (a.error !== undefined) {
      term_note(t, term_refusal(a));
    }
    if (a.error !== undefined && sent !== undefined) {
      term_back(t, sent);
    }
    term_idle(t);
  }, said);
}

// a message of the server: to the view, then to the jobs and the page;
// the import's ask (UNII_IMPORT_ASK) comes under the first view, where
// it is seen
function term_hear(t: Term, msg: View.Server): void {
  const first = msg.$ === "view" && t.v.parts.length === 0;
  const was   = t.v.page;
  for (const out of View.view_hear(t.v, msg)) {
    term_send(t, out);
  }
  term_went(t, was);
  t.reads?.(msg);
  if (msg.$ === "jobs" || msg.$ === "job") {
    Device.device_jobs(t.v, t.jobs, msg, RULES, (out) => term_send(t, out));
    return;
  }
  term_print(t, msg);
  if (first) {
    term_history(t);
    if (process.env.UNII_IMPORT_ASK === "1") {
      void term_import(t, "claude", true);
    }
  }
  term_draw(t);
  if (msg.$ === "state") {
    term_idle(t);
    View.view_alerts(t.v, Date.now()).forEach((alert) => (t.away || !t.focused) && term_notify(t, alert));
  }
}

// the folder Unii's jobs run in: the home repo, else unii's own main dir
function term_dir(): string {
  const dir = HOME_REPO || WORK + "/main";
  return dir.startsWith("~/") ? os.homedir() + dir.slice(1) : dir;
}

// the status line's branch and today's spend, read anew (Device.ts), and
// sent as this device's report when changed (the web's status line)
function term_status(t: Term, draw = true): void {
  const s = Device.device_status(RULES, Date.now()) as View.Client & { $: "status" };
  t.branch = s.branch;
  t.spend = { spend: s.spend, stale: s.stale, due: false };
  const said = JSON.stringify(s);
  if (said !== t.reported) {
    t.reported = said;
    term_send(t, s);
  }
  if (draw) {
    term_draw(t);
  }
}

// the terminal went to the back (alerts notify) or came to the front: to
// the last alert's agent, if one came meanwhile
function term_focus(t: Term, away: boolean): void {
  t.away = away;
  t.focused = true;
  // the web's While you were away card, as a note on coming back
  if (away && t.v.up) {
    t.seen = Cockpit.away_seen(t.v, Date.now());
  } else if (!away && t.seen !== undefined) {
    const a = Cockpit.away(t.v, t.seen, Date.now(), term_inbox_changed(t));
    t.seen = undefined;
    if (a !== null && t.deck !== undefined) {
      t.deck = { ...Deck.deck_new("home"), away: a }; // the deck shown: its home, the card on top
    } else if (a !== null) {
      term_note(t, Cockpit.away_text(a));
    }
  }
  if (!away && t.goto !== undefined) {
    term_act(t, { $: "Goto", name: t.goto });
    t.goto = undefined;
    term_draw(t);
  }
}

// a desktop notification (Notify.ts): by the terminal's escape sequence,
// or osascript on a Mac, its text as arguments
function term_notify(t: Term, alert: View.Alert): void {
  const way = Notify.notify_way(process.env);
  t.goto = alert.name;
  if (way === "osc777" || way === "osc9") {
    process.stdout.write(Notify.notify_osc(way, alert.title, alert.body));
  }
  // on a Mac, its sound, and the box where the terminal draws none
  if (process.platform === "darwin") {
    for (const cmd of Notify.notify_cmds(way, process.env, alert.title, alert.body, (c) => Bun.which(c) !== null)) {
      Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    }
  }
}

// an act of the person: to the view; the messages it sends the server
function term_act(t: Term, act: View.Act): View.Client[] {
  const was = t.v.page;
  const out = View.view_act(t.v, act);
  out.forEach((msg) => term_send(t, msg, act.$ === "Send" ? act : undefined));
  term_went(t, was);
  return out;
}

// a message the server refused, back in the input, unless another is in
// it; from a pipe, the end, failed
function term_back(t: Term, sent: View.Sent): void {
  if (!t.scr.tty) {
    process.exitCode = 1;
    term_quit(t);
    return;
  }
  if (t.scr.ed.text !== "" || t.imgs.length > 0) {
    return;
  }
  Screen.ed_type(t.scr.ed, sent.text);
  t.imgs = sent.images ?? [];
}

// the page shown was `was`: another prints below, after its name and the
// end of what of it printed before, so it shows as it was left, not the
// last page's end (a wipe and whole print took seconds on a long page)
function term_went(t: Term, was: View.Page | null): void {
  const page = t.v.page;
  if (page === was) {
    return;
  }
  const from = page === null ? 0 : t.logs.get(page.name) ?? 0;
  if (page === null) {
    const done = t.v.parts.filter(([id, n]) => id + n - 1 <= t.last && !t.wait.some(([w, m]) => w === id && m === n));
    term_rows(t, [View.Cap(View.MAIN)], false);
    term_recap(t, t.v.fold === null ? View.view_rows(t.v, done).flat() : []);
  } else if (from > 0) {
    const [head, ...seen] = View.page_rows(t.v, { ...page, log: page.log?.slice(0, from) ?? null });
    term_rows(t, [head], false);
    term_recap(t, seen);
  }
  term_show(t);
}

// rows printed again, their last screen's worth (the rest is up the
// scrollback)
function term_recap(t: Term, rows: View.Row[]): void {
  const lines = Paint.rows_lines(rows, term_inner()).slice(1 - (process.stdout.rows || 24));
  t.out = t.out.concat(term_inset(lines.length === 0 ? [] : [[], ...lines]));
  term_draw(t);
}

// the input's history: the user's messages known
function term_history(t: Term): void {
  const sent = [...t.v.whole].sort((a, b) => a[0] - b[0]).flatMap(([, e]) => (e.kind === "user" ? [e.text] : []));
  t.scr.ed.hist = sent;
  t.scr.ed.at   = sent.length;
}

// input's end: quits once all it sent is answered and no work runs
function term_idle(t: Term): void {
  if (t.ended && t.pending <= 0 && t.v.out.length === 0 && !View.view_running(t.v)) {
    term_quit(t);
  }
}

// Keys
// ----

// a key ("": text typed): its line of COMMANDS
function term_press(t: Term, key: string): void {
  if (key === "FocusIn" || key === "FocusOut") {
    return term_focus(t, key === "FocusOut");
  }
  if (t.chord) {
    return term_chord_key(t, key);
  }
  if (t.deck !== undefined) {
    return term_deck_key(t, key);
  }
  const cmd = term_commands(t.v).find((c) => c[1] !== "" && c[1].split(", ").includes(key));
  if (cmd !== undefined) {
    cmd[3](t, cmd[0] === "" ? key : "");
  }
  term_draw(t);
}

// Enter: runs a command, or sends the input; text not sent stays (it
// was lost: an unknown /word)
function term_enter(t: Term): void {
  const text = Screen.ed_take(t.scr.ed);
  if (term_command(t, text)) {
    return;
  }
  if (term_act(t, { $: "Send", text, images: t.imgs }).length > 0) {
    t.imgs = [];
    return;
  }
  Screen.ed_type(t.scr.ed, text);
}

// Ctrl+C or Ctrl+D: clears the input; on an empty one, Ctrl+C interrupts
// Legion's turn (never quits: that kills the jobs here), Ctrl+D quits
function term_clear(t: Term, key: string): void {
  if (t.scr.ed.text !== "") {
    Screen.ed_take(t.scr.ed);
  } else if (key === "Ctrl+D") {
    term_quit(t);
  } else {
    term_esc(t);
  }
}

// the next tab
function term_cycle(t: Term): void {
  const tabs = View.view_tabs(t.v);
  const at   = tabs.findIndex((tab) => tab.here) + 1;
  term_act(t, { $: "Goto", name: tabs[at % tabs.length].name });
}

// The Deck
// --------
// the web's pages full screen (Deck.ts): the alternate screen, every key
// the deck's (Screen grab); Esc, q, g m or Ctrl+C leave, the scrollback
// as it was; Enter on the crew leaves on that agent's page; the mouse
// reported there only (SGR: clicks, the wheel), so the chat keeps the
// terminal's own selection. On a pipe, a
// page's command prints its text instead (term_page_cmd)

const ALT_ON  = "\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h";
const ALT_OFF = "\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l";

// shows the deck at that page (null: leaves it)
function term_deck(t: Term, page: Deck.Page | null, filter = ""): void {
  if (page !== null && !t.scr.tty) {
    return term_note(t, "The full-screen pages need a terminal.");
  }
  const was = t.deck !== undefined;
  t.deck = page === null ? undefined
    : page === "file" ? Deck.deck_file(t.v, Screen.screen_width(), process.stdout.rows || 24, Date.now())
    : { ...Deck.deck_new(page, filter), sel: page === "crew" ? t.v.page?.name ?? null : null };
  t.scr.grab = page !== null;
  if (was !== (page !== null)) {
    process.stdout.write(page !== null ? ALT_ON : ALT_OFF);
  }
  if (page !== null && !was) {
    process.once("exit", () => t.deck !== undefined && process.stdout.write(ALT_OFF));
  }
  term_draw(t);
}

// Ctrl+G from the chat: the next key a page's letter (Deck.deck_chord),
// as g is in the deck; the keys grabbed till it comes
function term_chord(t: Term): void {
  if (!t.scr.tty) {
    return;
  }
  t.chord = true;
  t.scr.grab = true;
  term_toast(t, "Go to: h home · i inbox · o todo · c crew · x explain · q questions · p memory · f file · r routines · d digest · t transcripts · s timesheet · any other key: stay");
}

function term_chord_key(t: Term, key: string): void {
  t.chord = false;
  t.scr.grab = t.deck !== undefined;
  t.toast = undefined;
  const to = Deck.deck_chord(key);
  if (to === "inbox") {
    term_inbox(t, "");
  } else if (to !== null && to !== "chat") {
    term_deck(t, to);
  }
  term_draw(t);
}

// The / menu (Deck.menu_items): the input a / and a word; Up and Down
// pick, Tab completes a command (runs any other item), Enter runs the one
// picked (none picked: Enter as ever), Esc closes it for that text

function term_menu(t: Term): { items: Deck.MenuItem[]; sel: number } {
  const text = t.scr.ed.text;
  const items = t.deck !== undefined || t.chord || t.shut === text ? [] : Deck.menu_items(t.v, term_commands(t.v).map((c) => [c[0], c[2]]), text);
  return { items, sel: t.menu?.text === text ? Math.min(t.menu.sel, items.length - 1) : -1 };
}

function term_menu_key(t: Term, key: string): boolean {
  const { items, sel } = term_menu(t);
  const text = t.scr.ed.text;
  if (items.length === 0 || !["Up", "Down", "Tab", "Enter", "Esc"].includes(key)) {
    return false;
  }
  if (key === "Up" || key === "Down") {
    t.menu = { text, sel: Deck.menu_pick(sel, items.length, key) };
  } else if (key === "Esc") {
    t.shut = text;
  } else if (key === "Enter" && sel < 0) {
    return false;
  } else {
    const it = items[Math.max(0, sel)];
    const going = Deck.menu_go(it);
    Screen.ed_take(t.scr.ed);
    t.menu = undefined;
    key === "Tab" && "run" in it.go ? Screen.ed_type(t.scr.ed, it.go.run.split(" ")[0] + " ") : term_going(t, going);
  }
  term_draw(t);
  return true;
}

// a menu item chosen, done
function term_going(t: Term, g: Deck.Going): void {
  if ("run" in g) {
    term_command(t, g.run);
  } else if ("type" in g) {
    Screen.ed_type(t.scr.ed, g.type);
  } else if ("page" in g) {
    g.page === "inbox" ? term_inbox(t, g.filter ?? "") : term_deck(t, g.page);
  } else if ("goto" in g) {
    term_act(t, { $: "Goto", name: g.goto });
  } else if ("open" in g) {
    browse(g.open);
    term_toast(t, "Opened in the browser: " + g.open);
  } else if ("act" in g) {
    term_act(t, g.act);
  } else if ("chat" in g) {
    term_act(t, { $: "Goto", name: null });
  } else {
    term_toast(t, g.say);
  }
}

// a short word for a while over the input (the web's #toast), not kept
// in the scrollback: what was done, what goes on
const TOAST = 7000;
function term_toast(t: Term, text: string): void {
  t.toast = { text, until: Date.now() + TOAST };
  setTimeout(() => term_draw(t), TOAST + 50);
  term_draw(t);
}

// /copy, Ctrl+Y: the last code block Legion wrote, to the terminal's
// clipboard by the painter's own OSC 52 (Paint.copy_osc: never written
// from content); a terminal without OSC 52 (or tmux without
// set-clipboard) copies nothing, so the toast says so
function term_copy(t: Term): void {
  const code = View.view_code(t.v);
  if (code === null) {
    return term_toast(t, "No code block from Legion to copy yet.");
  }
  const n = code.split("\n").length;
  process.stdout.write(Paint.copy_osc(code));
  term_toast(t, "Copied the last code block (" + n + (n === 1 ? " line" : " lines") + "; needs your terminal's OSC 52).");
}

// a page's command: the deck at it on a terminal, else its text printed
function term_page_cmd(t: Term, page: Deck.Page, text: () => string, filter = ""): void {
  return t.scr.tty ? term_deck(t, page, filter) : term_note(t, text());
}

function term_deck_key(t: Term, key: string): void {
  const out = Deck.deck_key(t.v, t.deck!, key === "Ctrl+C" ? "Esc" : key, Screen.screen_width(), process.stdout.rows || 24, Date.now());
  t.deck = out.deck;
  out.sends.forEach((msg) => View.link_send(t.v, msg));
  out.acts.forEach((act) => term_act(t, act));
  if (out.open !== undefined) {
    browse(out.open);
  }
  if (out.done) {
    term_deck(t, null);
    if (out.focus !== undefined) {
      term_act(t, { $: "Goto", name: out.focus });
    }
    if (out.type !== undefined) {
      Screen.ed_type(t.scr.ed, out.type);
    }
    if (out.run !== undefined) {
      term_command(t, out.run);
    }
  }
  term_draw(t);
}

// the deck drawn whole, from the top
function term_deck_paint(t: Term): void {
  const lines = Deck.deck_lines(t.v, t.deck!, Screen.screen_width(), process.stdout.rows || 24, Date.now());
  process.stdout.write("\x1b[H\x1b[2J" + lines.map(Paint.line_ansi).join("\r\n"));
  t.due = false;
}

// Commands
// --------

// a command typed (`/name arg`): runs it (pending while it works on);
// false if the text is none
function term_command(t: Term, text: string): boolean {
  const word = text.trim().split(/\s+/)[0];
  const cmd = term_commands(t.v).find(([use]) => use !== "" && use.split(" ")[0] === word);
  const run = cmd?.[3](t, text.trim().slice(word.length).trim());
  if (run instanceof Promise) {
    t.pending += 1;
    run.finally(() => {
      t.pending -= 1;
      term_idle(t);
    });
  }
  return cmd !== undefined;
}

// the commands and keys by group, in two columns, then the editing keys
function term_help(t: Term): void {
  const how   = (c: Cmd) => [c[0], c[1]].filter((x) => x !== "").join(", ");
  const left  = Math.max(...term_commands(t.v).map((c) => Paint.text_width(how(c)))) + 2;
  const right = Math.max(20, term_inner() - left);
  const row   = (c: Cmd) => Paint.runs_wrap([Paint.Run(c[2])], right, false).map((l, k) => [Paint.Run((k === 0 ? how(c) : "").padEnd(left)), ...l]);
  const bold  = { ...Paint.INK, b: true };
  const group = ([name, cmds]: [string, Cmd[]]) => [[Paint.Run(name, bold)], ...cmds.flatMap(row)];
  const edit  = Paint.runs_wrap([Paint.Run(Screen.EDITING)], term_inner(), false);
  t.out = t.out.concat(term_inset([[], ...term_groups(t.v).flatMap(group), [Paint.Run("Editing", bold)], ...edit]));
}

// attaches the files at the paths (as typed or dropped: quoted, escaped,
// ~), as the web does a dropped file: an image goes with the next
// message, its bytes as read now (a Bun file inside a Blob adds nothing
// to it, Bun 1.3.14: the server got the text alone and refused the
// message); a text file goes in the box, fenced; a binary is refused
async function term_attach(t: Term, arg: string): Promise<void> {
  const files = View.paths_typed(arg, os.homedir());
  if (files.length === 0) {
    term_note(t, "Attach what? /attach <path>");
  }
  for (const file of files) {
    if (!term_is_file(file)) {
      term_note(t, "No file " + file + ".");
      continue;
    }
    const bytes = await Bun.file(file).bytes();
    const kind  = View.attach_kind(file.split("/").pop()!, bytes);
    if (kind === null) {
      term_note(t, "Not attached: " + file + " is neither text nor an image. " + View.IMAGES);
    } else if (kind.$ === "image") {
      t.imgs.push(new Blob([bytes]));
      term_toast(t, "Attached " + file + "; it goes with the next message (" + t.imgs.length + " waiting).");
    } else {
      Screen.ed_type(t.scr.ed, kind.text);
      term_draw(t);
    }
  }
}

function term_is_file(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

// a paste that is only images' paths (a terminal drops a file as its
// path) attaches them; any other paste, a text file's path too, is typed
function term_pasted(t: Term, text: string): boolean {
  const files = View.paths_typed(text, os.homedir());
  const image = (f: string) => term_is_file(f) && View.image_kind(fs.readFileSync(f).subarray(0, View.HEAD)) !== null;
  if (files.length === 0 || !files.every(image)) {
    return false;
  }
  void term_attach(t, text);
  return true;
}

// /edit [path]: the file shown (else asked for, edited once it comes) in
// the user's $VISUAL or $EDITOR, then saved as the web's Save does: the
// device refuses it if the file changed since it was shown (its hash)
function term_edit(t: Term, arg: string): void {
  const path = arg.trim() === "" ? null : View.path_from(process.cwd(), arg, os.homedir());
  const r = View.view_editable(t.v, path);
  if (r === null) {
    t.editing = path!;
    term_act(t, { $: "Look", what: { kind: "file", path: path! } });
  } else if (typeof r === "string") {
    term_note(t, r);
  } else {
    term_edit_run(t, r);
  }
}

function term_edit_run(t: Term, file: { path: string; text: string }): void {
  if (!t.scr.tty) {
    term_note(t, "/edit needs a terminal to run your editor in.");
    return;
  }
  const dir = fs.mkdtempSync(os.tmpdir() + "/legion-edit-");
  const copy = dir + "/" + (file.path.split("/").pop() || "file");
  try {
    fs.writeFileSync(copy, file.text, { mode: 0o600 });
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    let status: number | null = null;
    Screen.screen_lend(t.scr, () => {
      status = child.spawnSync("/bin/sh", ["-c", editor + ' "$1"', "sh", copy], { stdio: "inherit" }).status;
    });
    const text = fs.readFileSync(copy, "utf8");
    if (status !== 0) {
      term_note(t, "Your editor exited " + status + ": " + file.path + " not saved.");
    } else if (text === file.text) {
      term_note(t, "No change: " + file.path + " not saved.");
    } else {
      term_act(t, { $: "Save", text });
      term_toast(t, "Saving " + file.path + "…");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// /transcript <n>: its summary, or asked for (printed when it comes)
function term_transcript(t: Term, arg: string): void {
  const r = Cockpit.transcript_cmd(t.v, arg);
  if (typeof r !== "string") {
    term_act(t, r);
    term_toast(t, "Reading and summarizing…");
    return;
  }
  term_rows(t, View.entry_rows(null, "note", r), false);
}

// /look <path[:line]>: asked of a device; on a terminal, the deck's file
// page shows it when it comes (else it prints)
function term_look(t: Term, arg: string): void {
  const act = View.view_look_cmd(arg, process.cwd(), os.homedir());
  if (typeof act !== "string" && act.$ === "Look" && act.what.kind === "file" && t.scr.tty) {
    t.looking = act.what.path;
  }
  term_answer(t, act);
}

// /ls [folder|roots]: asked anew each time (View keeps a folder's answer)
function term_ls(t: Term, arg: string): void {
  const path = arg.trim() === "roots" ? "@roots" : View.path_from(process.cwd(), arg.trim() || ".", os.homedir());
  t.v.dirs.delete(path);
  term_act(t, { $: "List", path });
}

// /find, /grep: in the workspaces open, this folder if none
function term_find(t: Term, kind: "find" | "grep", q: string): void {
  if (q.trim() === "") {
    term_note(t, (kind === "find" ? "Find what? /find <name>" : "Grep what? /grep <text>"));
    return;
  }
  if (t.v.workspaces.length === 0) {
    t.v.workspaces = [process.cwd()];
  }
  term_act(t, { $: "Find", kind, q });
}

// the inbox's rows changed since /inbox last showed it (never shown: 0)
function term_inbox_changed(t: Term): number {
  return t.stamps === undefined ? 0 : Cockpit.inbox_changed(Cockpit.inbox_sections(t.v.inbox, t.v.crew, "", Date.now()), t.stamps);
}

// /inbox [words]: the inbox, then its rows kept as seen
function term_inbox(t: Term, filter: string): void {
  const now = Date.now();
  const changed = term_inbox_changed(t);
  term_page_cmd(t, "inbox", () => Cockpit.inbox_text(t.v, filter, now, changed), filter);
  if (t.deck !== undefined) {
    t.deck = { ...t.deck, changed };
  }
  if (t.v.inbox !== null) {
    t.stamps = Cockpit.inbox_seen(Cockpit.inbox_sections(t.v.inbox, t.v.crew, "", now));
  }
}

// pins message #id, or unpins it if pinned (the server says no past PINS)
function term_pin(t: Term, arg: string): void {
  const act = View.view_id_cmd("/pin", arg, (i) => ({ $: "Pin", i }));
  if (typeof act === "string" || act.$ !== "Pin") {
    term_answer(t, act);
    return;
  }
  const on = !(t.v.pins ?? []).some((p) => p.i === act.i);
  term_act(t, act);
  term_note(t, (on ? "Pinning #" : "Unpinning #") + act.i + "; /pins lists them.");
}

// stops all that runs, or the agent named
// an answer or a dismissal (/answer, /drop) sent; else why not, a note
function term_answer(t: Term, act: View.Act | string): void {
  if (typeof act === "string") {
    term_note(t, act);
    return;
  }
  term_act(t, act);
}

// /explain [question]: the Explain page; a question asked first (its
// answer comes on the page, never in the chat)
function term_explain(t: Term, arg: string): void {
  if (arg.trim() !== "") {
    term_answer(t, Cockpit.explain_cmd(t.v, arg));
  }
  term_page_cmd(t, "explain", () => Cockpit.explain_text(t.v, Date.now()));
}

function term_stop(t: Term, arg: string): void {
  const name = term_agent(t, arg);
  if (arg !== "" && !t.v.agents.includes(name)) {
    term_note(t, "No agent " + arg + " at work.");
    return;
  }
  term_send(t, arg === "" ? { $: "stop" } : { $: "stop", name });
}

// an agent of the crew (or at work) whose name starts with arg, else arg
function term_agent(t: Term, arg: string): string {
  return View.view_named(t.v, arg);
}

// shows or hides the crew panel; full: the full-screen Crew
function term_crew(t: Term, arg = ""): void {
  if (arg === "full") {
    return term_deck(t, "crew");
  }
  t.crew = !(t.crew ?? true);
  term_toast(t, t.crew ? "The crew shows below the input." : "The crew is hidden: /crew shows it.");
}

// the person's yes or no to a Claude Code worker asking to start: the
// one named, else the one on the page shown, else the only one asking
function term_approve(t: Term, arg: string, yes: boolean): void {
  const asking = View.view_asking(t.v);
  const named = arg !== "" ? term_agent(t, arg) : t.v.page !== null && asking.includes(t.v.page.name) ? t.v.page.name : asking.length === 1 ? asking[0] : null;
  if (named === null || !asking.includes(named)) {
    return term_note(t, asking.length === 0 ? "No Claude Code worker asks to start." : "Which? Asking: " + asking.join(", ") + ".");
  }
  term_act(t, { $: "Approve", name: named, yes });
}

// a done agent out of the crew, or every one not at work
function term_dismiss(t: Term, arg: string): void {
  const done = t.v.crew.filter((c) => !["working", "waiting", "asking"].includes(c.status)).map((c) => c.name);
  const names = arg === "" ? done : [term_agent(t, arg)].filter((n) => done.includes(n));
  if (names.length === 0) {
    term_note(t, arg === "" ? "No agent done to dismiss." : "No agent " + arg + " done.");
  }
  names.forEach((name) => term_send(t, { $: "dismiss", name }));
}

// the person's choice for block #id or #id+n (its name, View.block_name),
// open or closed, whatever it shows now: it holds until Fold all
function term_block(t: Term, arg: string, open: boolean): void {
  const name = /^#?(\d+)(?:\+(\d+))?$/.exec(arg);
  const id   = Number(name?.[1]);
  const n    = Number(name?.[2] ?? 1);
  if (name === null || block_row(View.view_body(t.v), id, n) === undefined) {
    term_note(t, arg === "" ? "Which block? " + (open ? "/open" : "/close") + " #id, as each block shows it." : "No block " + arg + " here.");
    return;
  }
  term_act(t, { $: open ? "Open" : "Shut", id, n });
  if (!open || n === 1) {
    term_shown(t, id, n, open);
  }
}

// block #id+n as chosen, printed below what is printed, then a note: the
// scrollback is never written over, so the reader keeps their place, and
// an opened block shows where one reads (it may be far above); the page
// shows the choice in place at its next whole print
function term_shown(t: Term, id: number, n: number, open: boolean): void {
  const row = block_row(View.view_body(t.v), id, n);
  term_rows(t, open && row !== undefined ? [row] : [], false);
  term_note(t, (open ? "Opened " : "Closed ") + View.block_name(id, n) + ".");
}

// the row of block #id+n, among rows or inside their boxes
function block_row(rows: View.Row[], id: number, n: number): View.Row | undefined {
  for (const r of rows) {
    if ((r.$ === "Sum" || r.$ === "Box") && r.id === id && r.n === n) {
      return r;
    }
    const inner = r.$ === "Box" ? block_row(r.rows, id, n) : undefined;
    if (inner !== undefined) {
      return inner;
    }
  }
  return undefined;
}

// folds all (printed when the tops come), or unfolds
function term_fold(t: Term): void {
  if (t.v.page !== null) {
    return;
  }
  const on = t.v.fold === null;
  term_act(t, { $: "Fold", on });
  if (!on) {
    term_page(t);
  }
}

// shows an agent's chat, by the start of its name, or Legion's; no
// name lists the tabs
function term_tab(t: Term, arg: string): void {
  const main = arg.toLowerCase() === View.MAIN.toLowerCase();
  if (arg === "") {
    return term_note(t, "Tabs: " + View.view_tabs(t.v).map((tab) => tab.text).join("  "));
  }
  term_act(t, { $: "Goto", name: main ? null : term_agent(t, arg) });
}

// moves the pick one step (a key)
function term_move(t: Term, move: Move): void {
  term_act(t, { $: "Move", move });
}

// a part of the pick: to the value given, or, none, the values it may
// take, the pick's marked
function term_pick(t: Term, move: Move, arg: string): void {
  const knob = View.view_pick(t.v).find((k) => k.move === move);
  if (arg !== "" || knob === undefined || t.v.pick === null) {
    term_act(t, { $: "Move", move, to: arg });
    return;
  }
  const parts = [...new Set(Pick.options(t.v.pick, move, t.v).map(([part]) => part))];
  const list  = parts.map((part) => (part === knob.text ? part + " (now)" : part));
  term_note(t, move[0].toUpperCase() + move.slice(1) + "s: " + list.join(", ") + ". Pick one with /" + move + " <" + move + ">.");
}

async function term_export(t: Term): Promise<void> {
  const res  = await term_get(t, "/export", "export");
  const file = process.cwd() + "/unii-memory.json";
  if (res !== null) {
    await Bun.write(file, res);
    term_note(t, "Your data is in " + file + ".");
  }
}

// this computer's Claude and ChatGPT chats, and the websites' exports
// given (EXPORT), not imported yet, as the words want (claude, chatgpt;
// Import.Want: since a day; tools; -#n: not session n): without go,
// what it finds and costs (sessions: and the list); with go, sent;
// pause, resume: the import running
// ask: as asked at the start (UNII_IMPORT_ASK): it says nothing unless
// there is something new to import
async function term_import(t: Term, arg: string, ask = false): Promise<void> {
  if (/^(pause|resume)$/.test(arg)) {
    return term_send(t, { $: "go", on: arg === "resume" });
  }
  const given = arg.replace(SINCE, "").split(/\s+/).filter((w) => w !== "");
  const files = given.filter((w) => EXPORT.test(w)).map((w) => w.replace(/^~(?=\/)/, os.homedir()));
  const words = given.filter((w) => !EXPORT.test(w)).map((w) => w.toLowerCase());
  const apps  = Import.APPS.filter((app) => words.includes(app.toLowerCase()));
  const want  = { off: [] as string[], since: arg.match(SINCE)?.[1] ?? "", tools: words.includes("tools") };
  if (words.some((w) => !/^(tools|sessions|go|-#\d+)$/.test(w) && !Import.APPS.some((app) => app.toLowerCase() === w))) {
    term_note(t, "Not understood. " + HOW);
    return;
  }
  if (!ask) {
    term_note(t, "Looking for Claude and ChatGPT chats on this computer…");
  }
  const read = await Promise.all([...IMPORTS.map(term_sessions), ...files.map(export_sessions)]).catch((e) => String(e.message ?? e));
  if (typeof read === "string") {
    term_note(t, "Not imported: " + read);
    return;
  }
  const sessions = read.flat().filter((s) => apps.length === 0 || apps.includes(s.app));
  const done  = await term_get(t, "/api/imported", "read what Unii has");
  if (done === null) {
    return;
  }
  const old   = await done.json();
  const shown = Import.import_plan(sessions, want, old, View.view_count(t.v)).sessions;
  want.off    = shown.filter((s, k) => words.includes("-#" + (k + 1))).map(Import.import_id);
  const plan  = Import.import_plan(sessions, want, old, View.view_count(t.v));
  const found = "Found " + Import.import_count(plan.msgs, "new ") + ". ";
  if (plan.msgs === 0) {
    if (!ask) {
      term_note(t, plan.first === "" ? Import.OLD : found + HOW);
    }
    return;
  }
  if (!words.includes("go")) {
    const which = words.includes("sessions") ? shown.map((s, k) => "\n- #" + (k + 1) + " " + s.app + ": " + Import.import_line(s) + (want.off.includes(Import.import_id(s)) ? " (left out)" : "")).join("") + "\n" : "";
    const out   = await new Promise<View.Answer>((ok) => View.link_send(t.v, { $: "guess", body: () => plan.sizes.join(",") }, ok));
    const cost  = out.usd === undefined ? "Not priced: " + term_refusal(out) : "Importing them costs about " + Import.guess_usd(out.usd) + ". To import them, type:\n\n```\n/import " + (arg + " go").trim() + "\n```";
    term_rows(t, View.entry_rows(null, "note", found + which + "\n" + cost + "\n\n" + HOW), false);
    return;
  }
  term_note(t, found + "Sending them…");
  term_send(t, { $: "import", body: () => Import.import_body(plan.picked) });
}

// a dir's sessions (none if it is missing), a file at a time
// a file to import, read whole into memory: a Bun.file streamed ends a
// raw stdin at its next key (Bun 1.3.8), so what was typed was sent and
// the terminal quit
function import_blob(path: string): Blob {
  return new Blob([fs.readFileSync(path)]);
}

async function term_sessions(dir: string): Promise<Import.Session[]> {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map((f) => dir + "/" + f).filter(Import.import_file) : [];
  const found: Import.Session[] = [];
  for (const f of files) {
    found.push(...[await Import.import_session(import_blob(f), "log")].filter((s) => s !== null));
  }
  return found;
}

// a site's export file's sessions
async function export_sessions(path: string): Promise<Import.Session[]> {
  if (!fs.existsSync(path)) {
    throw new Error("no file " + path);
  }
  return Import.import_export(import_blob(path));
}

async function term_topup(t: Term, arg: string): Promise<void> {
  const out = await term_post(t, "/api/topup", { usd: Number(arg) });
  if (typeof out.url !== "string") {
    term_note(t, out.error ?? "Could not top up: no connection.");
    return;
  }
  term_browse(t, "The payment", out.url);
}

async function term_account(t: Term): Promise<void> {
  const a = await account_get(t);
  if (a !== null) {
    term_rows(t, View.entry_rows(null, "note", View.account_md(a)), false);
  }
}

// the account; null: not read (term_get)
async function account_get(t: Term): Promise<View.Account | null> {
  return (await term_get(t, "/api/account", "read the account"))?.json() ?? null;
}

// deletes the account, once its name is typed; the server says what
// deleting does, and the name, when it isn't
async function term_delete(t: Term, arg: string): Promise<void> {
  const out = await term_post(t, "/api/delete", { confirm: arg });
  if (!out.ok) {
    term_note(t, out.error ?? "No connection.");
    return;
  }
  await term_forget(t);
  term_note(t, "Your account and chat are deleted.");
  term_quit(t);
}

// signs this terminal out: both its keys' sessions (RED ZONE K1: the
// terminal key's, held, and the device key's), its Keychain item and
// its file gone
async function term_logout(t: Term): Promise<void> {
  await term_post(t, "/api/logout", {});
  if (TERMKEY !== null) {
    await Device.device_fetch(term_wire(t.url), "/api/logout", { method: "POST", headers: term_file() }).catch(() => null);
  }
  await term_forget(t);
  term_note(t, "Signed out. Run unii to sign in again.");
  term_quit(t);
}

// this terminal's keys gone: the terminal key from the Keychain (and
// memory), the device key's file
async function term_forget(t: Term): Promise<void> {
  TERMKEY = null;
  await Auth.asking(KEYCHAIN).delete(new URL(t.url).host).catch(() => false);
  fs.rmSync(TOKEN, { force: true });
}

// a GET of the server; failing, a note says it could not do `what`
// (RED ZONE U1: over the server's socket only, Device.device_fetch)
async function term_get(t: Term, path: string, what: string): Promise<Response | null> {
  const res = await Device.device_fetch(term_wire(t.url), path, { headers: term_auth() }).catch(() => null);
  if (res === null || !res.ok) {
    term_note(t, "Could not " + what + ": " + (res === null ? "no connection" : "HTTP " + res.status) + ".");
    return null;
  }
  return res;
}

// a JSON POST to the server, answered as View.post's, over its socket
// only (RED ZONE U1, Device.device_fetch; View.post's fetch is TCP's)
async function term_post(t: Term, path: string, body: object): Promise<any> {
  const headers = { ...term_auth(), "content-type": "application/json" };
  const res = await Device.device_fetch(term_wire(t.url), path, { method: "POST", headers, body: JSON.stringify(body) }).catch(() => null);
  const out = res === null ? { error: "Can't reach the server (no socket?): nothing sent." } : await res.json().catch(() => (res.ok ? {} : { error: "HTTP " + res.status }));
  return { ...out, ok: res?.ok === true, status: res?.status ?? 0 };
}

// a refusal's text; one for want of credit (402) says how to add some
function term_refusal(out: View.Answer): string {
  return out.status === 402 ? out.error + " " + TOPUP : out.error ?? "";
}

// quits, telling the server (its jobs here end), once all printed is out
// (a write's callback comes after those before it), with exitCode
function term_quit(t: Term): void {
  t.v.ws?.close(View.QUIT);
  term_paint(t);
  process.stdout.write("", () => process.exit());
}

// quits at a signal (the terminal may be gone: nothing printed)
function term_bye(t: Term): void {
  t.v.ws?.close(View.QUIT);
  process.exit(0);
}

// a page for the browser: its link printed (a terminal reached over ssh
// has no browser of its own), then opened in the browser here, if any
function term_browse(t: Term, what: string, url: string): void {
  term_note(t, what + ": " + url);
  browse(url);
}

// a link opened in the browser here, if any: a Linux with no desktop has
// no xdg-open (spawning one missing throws)
function browse(url: string): void {
  const open = Bun.which(process.platform === "darwin" ? "open" : "xdg-open");
  if (open !== null) {
    child.spawn(open, [url], { detached: true, stdio: "ignore" }).unref();
  }
}

// a note printed above the footer
function term_note(t: Term, text: string): void {
  t.v.notes.push(text);
  term_draw(t);
}

// Printing
// --------

// what a server message prints, as it comes
function term_print(t: Term, msg: View.Server): void {
  const v     = t.v;
  const main  = v.page === null;
  switch (msg.$) {
    case "view": {
      if (main && v.fold === null) {
        term_after(t);
      }
      return;
    }
    case "know": {
      if (main) {
        term_settle(t);
      }
      return;
    }
    case "entry": {
      if (msg.agent !== v.page?.name) {
        return;
      }
      // a page's log comes again at each reconnect
      const text = term_logged(t, msg.kind, msg.text);
      const page = msg.agent ?? "";
      const n    = v.page?.log?.length ?? 0;
      if (main ? msg.id !== undefined && msg.id <= t.last : n <= (t.logs.get(page) ?? 0)) {
        return;
      }
      t.logs.set(page, n);
      t.last = main && msg.id !== undefined ? msg.id : t.last;
      const due  = main && msg.id !== undefined && View.part_due(v, [msg.id, 1], v.parts[v.parts.length - 2]);
      const head = due ? [View.Cap(View.AI)] : [];
      term_rows(t, [...head, ...View.entry_rows(msg.id ?? null, msg.kind, text, msg.images)], false);
      return;
    }
    case "root": {
      if (main && v.fold !== null) {
        term_page(t);
      }
      return;
    }
    case "zoom": {
      if (main) {
        term_shown(t, msg.id, msg.n, true);
      }
      return;
    }
    case "looked": {
      if (msg.kind === "file" && t.editing !== undefined && msg.path === t.editing) {
        t.editing = undefined;
        const r = View.view_editable(v, msg.path);
        typeof r === "string" ? term_note(t, r) : r !== null && term_edit_run(t, r);
        return;
      }
      if (msg.kind === "file" && msg.error === undefined && t.looking !== undefined && msg.path === t.looking) {
        t.looking = undefined;
        term_deck(t, "file");
        return;
      }
      const md = View.looked_md(v, msg);
      if (md !== null) {
        term_rows(t, View.entry_rows(null, "note", md), false);
      }
      return;
    }
    case "recalled": {
      term_note(t, View.view_recall_note(v));
      return;
    }
    case "themes": {
      term_note(t, Cockpit.digest_text(v));
      return;
    }
    case "summary": {
      const k = (v.inbox?.google?.docs ?? []).findIndex((d) => d.id === msg.id);
      if (k >= 0) {
        term_transcript(t, String(k + 1));
      }
      return;
    }
  }
}

// the page shown, whole, alone on the screen and its scrollback (a new
// size, /fold): no other is printed then
function term_page(t: Term): void {
  term_rows(t, [], true);
  [t.last, t.wait, t.logs] = [-1, [], new Map()];
  term_show(t);
}

// what of the page shown was never printed, then its stream again
function term_show(t: Term): void {
  const page = t.v.page;
  t.flow = new Map([...t.flow].filter(([, done]) => done === Infinity));
  if (page !== null) {
    const from = t.logs.get(page.name) ?? 0;
    t.logs.set(page.name, Math.max(from, page.log?.length ?? 0));
    const rows = View.page_rows(t.v, page, from);
    return term_rows(t, from === 0 ? rows : rows.slice(1), false);
  }
  if (t.v.fold === null) {
    return term_after(t);
  }
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, View.view_body(t.v), false);
}

// a new view of the chat: the parts holding a message past the one
// printed last print as they settle, after the AI notice if none is,
// since a terminal's scrollback is never written over; what changed
// above (new summaries) shows at the next whole print (a resize, /fold)
function term_after(t: Term): void {
  const head = t.last < 0 ? [View.Cap(View.AI)] : [];
  t.wait = t.wait.concat(t.v.parts.filter(([id, n]) => id + n - 1 > t.last));
  t.last = Math.max(t.last, View.view_count(t.v) - 1);
  term_rows(t, head, false);
  term_settle(t);
}

// prints the parts not printed, in order, up to one whose summary isn't
// known yet: from it on they show in the footer till it is (an import's
// blocks, the oldest built last)
function term_settle(t: Term): void {
  const rows = View.view_rows(t.v, t.wait);
  const wait = rows.findIndex((r) => View.rows_wait(t.v, r));
  const done = wait < 0 ? rows.length : wait;
  t.wait = t.wait.slice(done);
  term_rows(t, rows.slice(0, done).flat(), false);
}

// prints what streams that no piece to come changes, a message at a
// time: whole once a message after it started, else its settled blocks;
// a message with a part left holds back those after it
function term_flow(t: Term): void {
  const live = View.view_stream(t.v);
  for (const [l, done] of t.flow) {
    if (done === Infinity && !live.includes(l)) {
      t.flow.delete(l);
    }
  }
  for (const [k, l] of live.entries()) {
    const done  = t.flow.get(l) ?? 0;
    const end   = done + View.entry_settled(l.kind, l.text.slice(done), k < live.length - 1);
    const piece = piece_trim(l.text.slice(done, end));
    if (piece !== "") {
      t.flow.set(l, end);
      term_rows(t, View.entry_rows(null, l.kind, piece), false);
    }
    if (piece_trim(l.text.slice(t.flow.get(l) ?? 0)) !== "") {
      return;
    }
  }
}

// the part of a message logged not printed yet: what follows the printed
// head of the first message streaming of its kind that it starts with;
// that one prints no more
function term_logged(t: Term, kind: Kind, text: string): string {
  const fresh = View.view_stream(t.v).filter((l) => !t.flow.has(l)).map((l): [View.Live, number] => [l, 0]);
  const heads = [...t.flow].filter(([, done]) => done < Infinity).concat(fresh);
  const at    = heads.findIndex(([l, done]) => l.kind === kind && text.startsWith(l.text.slice(0, done).trim()));
  if (at < 0) {
    return text;
  }
  for (const [l] of heads.slice(0, at + 1)) {
    t.flow.set(l, Infinity);
  }
  const [l, done] = heads[at];
  return piece_trim(text.slice(l.text.slice(0, done).trim().length));
}

// a piece of a message as printed: no blank lines around it
function piece_trim(text: string): string {
  return text.replace(/^\s*\n/, "").trimEnd();
}

// rows to print above the footer (with wipe: alone on the screen), after
// the notes before them, painted (/account's waited for a key)
function term_rows(t: Term, rows: View.Row[], wipe: boolean): void {
  t.out  = wipe ? [] : t.out;
  t.wipe = t.wipe || wipe;
  t.out  = t.out.concat(term_lines(t.v.notes.splice(0).flatMap(View.note_rows)), term_lines(rows));
  term_draw(t);
}

// rows as lines, after a blank line, in the margin
function term_lines(rows: View.Row[]): Paint.Line[] {
  return term_inset(rows.length === 0 ? [] : [[], ...Paint.rows_lines(rows, term_inner())]);
}

function term_inset(lines: Paint.Line[]): Paint.Line[] {
  const pad = Paint.Run(" ".repeat(MARGIN));
  return lines.map((l) => [pad, ...l]);
}

function term_inner(): number {
  return Screen.screen_width() - 2 * MARGIN;
}

// a new size: the page laid out again, at the new width, once the size
// settles
function term_resize(t: Term): void {
  if (t.deck !== undefined) {
    return term_draw(t);
  }
  clearTimeout(t.settle);
  t.settle = setTimeout(() => term_page(t), SETTLE);
}

// a paint, a frame from now, unless one is due
function term_draw(t: Term): void {
  if (!t.due) {
    t.due = true;
    setTimeout(() => term_paint(t), FRAME);
  }
}

// prints the lines due, the notes and what of the stream settled, then
// the footer: the rest of the stream (its last lines that fit), the rule,
// the input, a rule (offline while the socket is not open), the tabs.
// The screen's top row stays free: an erase from the top left clears
// the screen, which tmux keeps in its scrollback at each paint
function term_paint(t: Term): void {
  if (t.deck !== undefined) {
    return term_deck_paint(t);
  }
  t.out = t.out.concat(term_lines(t.v.notes.splice(0).flatMap(View.note_rows)));
  term_flow(t);
  const w     = Screen.screen_width();
  const iw    = term_inner();
  const room  = (process.stdout.rows || 24) - 1;
  const off   = !View.view_typing(t.v);
  const crew  = Deck.crew_foot(t.v, iw, Date.now(), CREW_ROWS, t.v.crew.length > 0 && (t.crew ?? true));
  const hint  = t.v.page === null ? View.HINT + " · /help" : "Tell " + t.v.page.name + " · Tab to go on";
  const menu  = term_menu(t);
  const over  = [...(menu.items.length === 0 ? [] : Deck.menu_lines(menu.items, menu.sel, iw)), ...(t.toast !== undefined && Date.now() < t.toast.until ? [Paint.toast_line(t.toast.text, iw)] : [])];
  const foot  = [Deck.foot_line(t.v, iw)];
  const shells = Paint.shell_lines(t.v, iw, Date.now());
  const input = Screen.screen_input(t.scr, iw, room - 2 - crew.length - over.length - shells.length - foot.length, off ? OFF : hint, off);
  const status = View.view_status_line(t.v, { dir: term_dir().split("/").pop() || "~", branch: t.branch ?? null, spend: t.spend ?? { spend: null, stale: true } }, Date.now());
  const under = Paint.rule_text(t.v.pick === null && t.v.up ? "" : Paint.status_text(status), iw);
  const own   = term_inset([...over, ...shells, Paint.rule_line(t.v, iw), ...input.lines, under, ...crew, ...foot]);
  const rest  = View.view_stream(t.v).map((l) => ({ kind: l.kind, text: l.text.slice(t.flow.get(l) ?? 0) }));
  const held  = t.v.page === null ? View.view_rows(t.v, t.wait).flat() : [];
  const tail  = term_lines([...held, ...View.view_tail(t.v, rest)]).flatMap((l) => Paint.runs_wrap(l, w, true));
  const above = tail.slice(Math.max(0, tail.length - room + own.length));
  const at    = { row: above.length + over.length + shells.length + 1 + input.at.row, col: input.at.col + MARGIN };
  Screen.screen_paint(t.scr, t.out, t.wipe, [...above, ...own], at);
  t.out  = [];
  t.wipe = false;
  t.due  = false;
}

// Jobs
// ----

// Ctrl+B, /bg (B2): the shell commands in sight sent to the background,
// as the user's act (the server's: on the terminal key, Chat.shell; the
// background list, agents told their numbers); on the device key only,
// the server can't take it as the user's, so the ones running here go
// there as ever (Device.device_away: output to a file the AI is told of)
function term_bg(t: Term): void {
  if (TERMKEY !== null) {
    term_act(t, { $: "Shell", op: "bg" });
    return;
  }
  const n = Device.device_away(t.jobs);
  if (n === 0) {
    return term_note(t, "No shell command is running here.");
  }
  term_toast(t, "Sent " + n + (n === 1 ? " shell command" : " shell commands") + " to the background; each one's output goes to a file the AI is told of.");
}

// Esc (and Ctrl+C on an empty input): Legion's turn interrupted, and the
// shell commands in sight stopped (B2: the user's act, Chat.shell; on the
// device key only, the server says it can't take it)
function term_esc(t: Term): void {
  if (View.view_fore(t.v).length > 0) {
    term_act(t, { $: "Shell", op: "stop" });
  }
  term_act(t, { $: "Send", text: "" });
}

// /shells: the commands sent to the background (B2), running or ended
function term_shells(t: Term): void {
  const lines = View.view_bg_lines(t.v, Date.now());
  term_note(t, lines.length === 0 ? "No command is in the background." : "In the background (/kill <n> stops one):\n" + lines.join("\n"));
}

// /kill <n>: background command n stopped (the user's act: Chat.shell)
function term_kill(t: Term, arg: string): void {
  const s = View.view_bgs(t.v).find((b) => String(b.n) === arg.trim() && b.ended === undefined);
  if (s === undefined) {
    return term_note(t, "No background command " + arg.trim() + " is running: /shells lists them.");
  }
  term_act(t, { $: "Shell", op: "stop", job: s.job });
}

// Login
// =====

// signs in: what is typed (an email, or @ and a GitHub name where the
// server takes one) begins a sign-in for a token made here, kept in TOKEN
// once its link was opened; where the server bills, it accepts its terms.
// A server that says nothing of itself (/api/hello) bills, as one of
// before it did. RED ZONE (K1, DRAFT awaiting the user's sign-off): the
// one code signs in a terminal key too (TERMKEY), kept in the Keychain
// only; one it won't keep is signed out again. The terminal key, if kept
async function login_run(url: string): Promise<string | null> {
  // RED ZONE U1: the new session's key, and the link it opens, over the
  // server's socket only (Device.device_fetch); none: nothing is sent
  const res = await Device.device_fetch(term_wire(url), "/api/hello").catch(() => null);
  if (res === null) {
    login_fail("no server at " + term_wire(url).sock + " (none up): start it with legion");
  }
  const hello = await res.json().catch(() => ({}));
  const { bills = true, github = true } = hello;
  if (bills) {
    console.log("Signing in, you accept the terms (" + url + "/terms.html) and the privacy policy (" + url + "/privacy.html).");
  }
  const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const key = random();
  const term = random();
  const out = await login_ask(url, key, term, github);
  if (out.t !== undefined) {
    await login_local(url, out.t, out.code, out.secret === true);
  } else {
    if (out.url) {
      browse(out.url);
    }
    console.log(out.url ? "Sign in with GitHub in the browser: " + out.url : "A sign-in link is on its way to " + out.who + ". Open it.");
    console.log("On the page it opens, type this code: " + out.code);
  }
  // the link lives on the server, so only it ends the wait: signed in (ok),
  // or the link gone (410); a wait that fails is asked again
  const wait = { headers: { authorization: "Bearer " + key }, timeout: false } as RequestInit;
  while (true) {
    const done = await Device.device_fetch(term_wire(url), "/api/wait", wait).catch(() => null);
    const ans  = await done?.json().catch(() => ({})) ?? {};
    if (done?.status === 410) {
      login_fail("the link expired: run legion again");
    }
    if (done?.ok && ans.ok) {
      break;
    }
    if (done?.status !== 408) {
      await Bun.sleep(View.RETRY);
    }
  }
  fs.writeFileSync(TOKEN, key, { mode: 0o600 });
  console.log("Signed in.");
  const kept = await Auth.asking(KEYCHAIN).set(new URL(url).host, term).then(() => true, () => false);
  if (!kept) {
    await Device.device_fetch(term_wire(url), "/api/logout", { method: "POST", headers: { authorization: "Bearer " + term } }).catch(() => null);
    console.log("The Keychain didn't keep the terminal's key, so approving from the terminal stays off (the web still can).");
    return null;
  }
  console.log("Approving from the terminal is on: its key is in the Keychain, which asks you each time legion starts (Allow, never Always Allow).");
  return term;
}

// asks for an address (a GitHub login too, where the server takes one)
// until the server takes one (it says why it doesn't): the address, and
// the server's answer. key: the device key's; term: the terminal key's
// (K1), both signed in by the one code
async function login_ask(url: string, key: string, term: string, github: boolean): Promise<{ who: string; url?: string; code: string; t?: string; secret?: boolean }> {
  while (true) {
    process.stdout.write(github ? "Email or @github: " : "Email: ");
    const who  = (await login_line()).trim();
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ who, key, term }) };
    const res  = await Device.device_fetch(term_wire(url), "/api/login", init).catch(() => null);
    if (res === null) {
      login_fail("no connection to " + url);
    }
    const out = await res.json().catch(() => ({ error: "HTTP " + res.status }));
    if (out.error === undefined) {
      return { ...out, who };
    }
    console.log(out.error);
  }
}

// RED ZONE (S1b, DRAFT awaiting the user's sign-off): a local Legion (no
// mail: Cloud.ts SIGNIN) gives its ticket t to the terminal that asked,
// which confirms it with the code and the sign-in secret, over the
// server's socket only, in the body (never an argument, the environment,
// a file or a URL). The secret: the Keychain's, of service
// "legion-signin-<host>" (Auth.asking: every read the user allows, one
// here); none registered yet (registered false), made here, kept there
// first, then registered (trust on first use, once). Refused: why, and
// the sign-in ends
async function login_local(url: string, t: string, code: string, registered: boolean): Promise<void> {
  const store = Auth.asking(SIGNIN);
  const host = new URL(url).host;
  const made = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  if (registered) {
    console.log("Confirming with this Legion's sign-in secret: the Keychain asks you (Allow, never Always Allow).");
  } else {
    await store.set(host, made).catch(() => login_fail("the Keychain didn't keep a sign-in secret, so none is registered."));
    console.log("This Legion's sign-in secret is made and kept in the Keychain; each sign-in reads it (Allow, never Always Allow).");
  }
  const secret = registered ? await store.get(host).catch(() => null) : made;
  if (secret === null) {
    login_fail("this Legion's sign-in secret isn't in the Keychain, or reading it was refused. To start over, delete signin-hash in the server's dir (" + SOCKDIR + "), then legion login.");
  }
  const body = new URLSearchParams({ t, code, secret, ...(registered ? {} : { register: "1" }) }).toString();
  const init = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body };
  // signed in: JSON; refused: why (403); the link gone: a redirect, which
  // device_fetch follows nowhere (null)
  const res = await Device.device_fetch(term_wire(url), "/auth", init).catch(() => null);
  if (res === null || !res.ok) {
    login_fail(res === null ? "the sign-in didn't go through (no server at " + url + ", or the link expired): run legion login again" : (await res.text()).slice(0, 300));
  }
}

// the next line typed; stdin is paused after it, till the screen reads it
function login_line(): Promise<string> {
  return new Promise((done) => {
    const end  = () => login_fail("no address typed");
    const take = (chunk: Buffer) => {
      process.stdin.off("data", take).off("end", end).pause();
      done(String(chunk).split("\n")[0]);
    };
    process.stdin.on("data", take).on("end", end).resume();
  });
}

function login_fail(why: string): never {
  console.error("legion: " + why);
  process.exit(1);
}

// Update
// ======

// this build never installs by `curl | sh` (the hosted installer): it
// changes only as its source does
function update_run(url: string): void {
  console.error("legion update is disabled in this build; pull its source instead (not " + url + "/install.sh)");
  process.exitCode = 1;
}

// Main
// ====

// the device key's header (TOKEN), if signed in: `legion device`'s and
// `legion web`'s, and the full-screen terminal's with no terminal key
function term_file(): Record<string, string> {
  if (!fs.existsSync(TOKEN)) {
    return {};
  }
  return { authorization: "Bearer " + fs.readFileSync(TOKEN, "utf8").trim() };
}

// the session's header: the terminal key's while this terminal holds one
// (TERMKEY, RED ZONE K1), else the device key's
function term_auth(): Record<string, string> {
  return TERMKEY === null ? term_file() : { authorization: "Bearer " + TERMKEY };
}

// RED ZONE (K2, DRAFT awaiting the user's sign-off): the terminal key,
// read once as the full-screen terminal starts (one Keychain prompt);
// null: none kept (signed in before it), the read refused, or a session
// the server refuses (one it can't reach is kept: the chat waits for it)
async function term_key(url: string): Promise<string | null> {
  const key = await Auth.asking(KEYCHAIN).get(new URL(url).host).catch(() => null);
  if (key === null || key === "") {
    return null;
  }
  const res = await Device.device_fetch(term_wire(url), "/api/me", { headers: { authorization: "Bearer " + key } }).catch(() => null);
  return res === null || res.ok ? key : null;
}

// the note a terminal with no terminal key shows once (K2)
const KEYLESS = "Approving from this terminal (/mode, /plan, /allow, /approve, /answer, routines, timers, todos) is off: run legion login once to turn it on.";

// whether this terminal is signed in: it holds a session the server
// doesn't refuse (one it can't reach may: the chat waits for it). The
// session goes over the server's socket only (RED ZONE U1); with none
// up it can't tell, as one not reached (the link waits for it)
async function term_signed(url: string): Promise<boolean> {
  if (!fs.existsSync(TOKEN)) {
    return false;
  }
  const res = await Device.device_fetch(term_wire(url), "/api/me", { headers: term_file() }).catch(() => null);
  return res === null || res.status !== 401;
}

// `legion device`: this computer runs the server's jobs with no screen
// (Device.ts), signed in as this terminal is, over the server's socket
// only (RED ZONE U1, Device.device_link); signed out, it stops
async function device_run(url: string): Promise<void> {
  if (!await term_signed(url)) {
    login_fail("sign in first: legion login");
  }
  const lost = async (up: boolean) => {
    if (!up && !await term_signed(url)) {
      login_fail("signed out: legion login, then legion device again");
    }
    console.error("legion device: offline, trying again");
    return true;
  };
  Device.device_open(term_wire(url), term_file(), term_device(), RULES, (line) => console.error("legion device: " + line), lost);
  console.log("legion device: " + DEVICE + " runs the agents' jobs from " + url + " in " + WORK + (COMPUTER ? ", computer use on" : "") + ". Ctrl+C stops.");
}

// `legion web`: a one-use link (a minute) that signs a browser in as this
// terminal, printed and opened (`open` may be refused, e.g. in a sandbox)
async function web_run(url: string): Promise<void> {
  if (!await term_signed(url)) {
    await login_run(url);
  }
  // the terminal's own key (one Keychain prompt): a device key can't
  // open the web as the user (Cloud.web_link)
  const key = await term_key(url);
  if (key === null) {
    login_fail("legion web needs the terminal's own key: run legion login once, then Allow its Keychain prompt.");
  }
  const res = await Device.device_fetch(term_wire(url), "/api/web-link", { method: "POST", headers: { authorization: "Bearer " + key } }).catch(() => null);
  const body = (await res?.json().catch(() => ({})) ?? {}) as { url?: string; error?: string };
  if (res === null || !res.ok || body.url === undefined) {
    login_fail(body.error ?? (res === null ? "no server at " + url + ": start it with unii" : "the server refused (" + res.status + ")"));
  }
  console.log("Open this within a minute (it works once):\n  " + body.url);
  if (process.platform === "darwin") {
    child.spawnSync("open", [body.url as string], { stdio: "ignore" });
  }
}

fs.mkdirSync(TOKEN.slice(0, -"/token".length), { recursive: true, mode: 0o700 });

if (HELP || ODD !== undefined) {
  if (ODD !== undefined) {
    login_fail("no argument " + ODD + ".\n\n" + USAGE);
  }
  console.log(USAGE);
} else if (ASKVER) {
  console.log("legion " + VERSION);
} else if (UPDATE) {
  update_run(SERVER);
} else if (SERVE) {
  await (await import("./Server.ts")).serve(Number(PORT ?? 8788), null);
} else if (LOGIN) {
  await login_run(SERVER);
} else if (WEBIN) {
  await web_run(SERVER);
} else if (DEVICED) {
  await device_run(SERVER);
} else {
  TERMKEY = await term_signed(SERVER) ? await term_key(SERVER) : await login_run(SERVER);
  const t = term_new(SERVER);
  if (TERMKEY === null) {
    term_note(t, KEYLESS);
  }
  term_connect(t);
}
