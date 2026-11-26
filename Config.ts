// Config
// ======
// The server's settings. Its DIR ($LEGION_DIR, default ~/.legion) holds
// config.json, the lock and users/<id>. Each key of config.json (README)
// may be set as LEGION_<KEY> instead; a path may start with "~/". The keys
// are read from the environment and removed from it, so no program an
// agent runs inherits them, and put back for the workers. Behind a reverse
// proxy set LEGION_PROXY=1 (PROXY), else X-Forwarded-For is ignored.

import * as fs from "node:fs";
import * as os from "node:os";
import type { Vendor } from "./AskAI.ts";
import { Auth } from "./Auth.ts";
import { CATALOG } from "./Models.ts";
import { LABELS, VENDORS, Pick, type Offer } from "./Pick.ts";

// Constants
// =========

export const DIR = config_path(process.env.LEGION_DIR ?? "~/.legion");

const PATH = DIR + "/config.json";
const FILE: Record<string, string> = fs.existsSync(PATH) ? JSON.parse(fs.readFileSync(PATH, "utf8")) : {};

export const SITE    = config_get("site", "http://127.0.0.1:8788").replace(/\/$/, "");

// RED ZONE (security review SC, DRAFT awaiting the user's sign-off): a
// reverse proxy in front (LEGION_PROXY=1), whose X-Forwarded-For entry is
// the client's address the sign-in limits count (Cloud.ip); off, the
// default, the socket's, as a client reaching the server itself may
// write the header
export const PROXY   = config_get("proxy", "") === "1";

// the Claude API's origin: Anthropic's, or a proxy of it (e.g. LiteLLM);
// https, or http on this computer only (the key goes to it)
export const ANTHROPIC_URL = config_origin("anthropic_url", config_get("anthropic_url", "https://api.anthropic.com").replace(/\/$/, ""));

export const OFFER: Offer = {
  vendors : config_vendors(config_get("vendors", "claude-api")),
  models  : config_get("models", LABELS.join()).split(",").map((m) => m.trim()),
};

export const WORK       = config_path(config_get("work", DIR + "/work"));
export const RULES      = config_path(config_get("rules", ""));
export const AFTER      = config_get("after", "");
export const PICK       = config_run("pick", config_get("pick", "claude-api:opus:medium:slow"));

// what every compaction runs on, a chat's and an import's alike, whatever
// the chat's pick
export const COMPACTOR  = config_run("compactor", config_get("compactor", "claude-api:haiku:high:slow"));
// what writes the Tracks page's cards and answers questions about them (Explain.ts)
export const OBSERVER   = config_run("observer", config_get("observer", "claude-api:haiku:high:slow"));
// what checks each reply against Legion's standing directives (Directives.ts)
export const CHECKER    = config_run("checker", config_get("checker", "claude-api:haiku:high:slow"));
// what Legion's workers run on, below the chat's pick (Tools.ts); `agents`
// is its older name. A `manager` set from before managers went is ignored
export const WORKER     = config_run("worker", config_get("worker", config_get("agents", "claude-api:sonnet:medium:slow")))
// what a Claude Code worker runs (Machine.claude): a full model id, sonnet
// or haiku, never opus; never an alias, which gateway discovery re-resolves
export const CLAUDE_WORKER = config_claude("claude_worker", config_get("claude_worker", "sonnet"));;
export const WORKERS    = Number(config_get("workers", "0"));

// a call's input past which it rolls over (Agent.ts): its request's
// tokens in, as the API tells them (input, cache writes and reads)
export const ROLL       = Number(config_get("roll", "150000"));

// the most web searches a request of a turn or a subagent runs (0: no web
// tool, as on a proxy whose backend has none, e.g. LiteLLM on Bedrock)
export const SEARCHES   = Number(config_get("searches", "10"));

// a SearXNG on this computer, for the `search` tool (Search.ts; "": none)
export const SEARXNG    = config_get("searxng_url", "");

// the `fetch` tool, a public web page read as text on this computer
// (Fetch.ts; 0: none)
export const FETCHES    = Number(config_get("fetches", "1"));

// the MCP servers the agents may use (Mcp.ts; "": none)
export const MCP        = config_path(config_get("mcp", ""));

// RED ZONE (security review U3, DRAFT awaiting the user's sign-off): the
// MCP tools auto mode lets by unreviewed besides Modes.MCP_READS, each by
// its whole name, mcp__<server>__<tool>, comma-separated; else no start
export const MCP_READS  = config_reads(config_get("mcp_reads", ""));

// the iOS app (ios/, Cloud.ts): its App ID, the team's then the bundle's
// ("TEAM.com.example.legion"), whose app sign-in links open; and
// the id of the key its pushes are signed with (APNS_KEY holds the key)
// phones at all (LEGION_PHONE=1): off, as phones aren't allowed at work;
// then no pushes, push tokens or AASA, whatever APPLE and APNS say
export const PHONE      = config_get("phone", "") === "1";
export const APPLE      = config_get("apple", "");
export const APNS       = config_get("apns", "");

// the keys, by name, and the variable each is read from
const VARS: Record<string, string> = {
  anthropic       : "ANTHROPIC_API_KEY",
  openai          : "OPENAI_API_KEY",
  resend          : "RESEND_API_KEY",
  apns            : "APNS_KEY",
  gchat           : "GCHAT_WEBHOOK_URL",
};

// the GChat bridge's space (Gchat.ts: on only with KEYS.gchat, its webhook)
export const GCHAT_SPACE = config_get("gchat_space", "");

// RED ZONE (security review R6, signed off by the user 2026-11-19): the
// GChat webhook's URL (a key: who has it posts to the space) read by this
// server from the login Keychain itself (service GCHAT_WEBHOOK_URL, the
// README's), never from its environment, which any process of this user
// reads (`ps -wwE`; deleting it from process.env hides it from JS only).
// On with LEGION_GCHAT_KEYCHAIN=1 (the launcher's server_exec sets it; the
// environment's only, never config.json, so no test reads the user's
// item) and a gchat_space; then a GCHAT_WEBHOOK_URL in the environment
// is not used. Off (tests, a server run by hand), GCHAT_WEBHOOK_URL is
// read like the other keys. None kept, or refused: "" (the bridge off),
// said without a key
const GCHAT_KEYCHAIN = process.env.LEGION_GCHAT_KEYCHAIN === "1";

// RED ZONE (R8, signed off by the user 2026-11-19): the one user whose
// chat it bridges (their id, as in users/<id>); none: no one's
export const GCHAT_USER  = config_get("gchat_user", "");
// RED ZONE (security review 3 G1, DRAFT awaiting the user's sign-off):
// the gateway's key (KEYS.anthropic) read once, here, from the file
// descriptor LEGION_ANTHROPIC_KEY_FD names (3-9; the launcher's server_exec
// sets 3, a pipe its printf builtin writes the key into), then the fd
// closed, so it is in neither this server's environment nor its arguments
// (`ps -wwE` shows both to any process of this user). Then an
// ANTHROPIC_API_KEY in the environment is not used, and no worker can be
// given the key (config_env would put it in their environment): workers
// refuse to start. Unset (tests, `bun Server.ts` by hand), ANTHROPIC_API_KEY
// is read like the other keys. No key on it, or no such fd: no start,
// said without a key
const KEY_FD = process.env.LEGION_ANTHROPIC_KEY_FD;
delete process.env.LEGION_ANTHROPIC_KEY_FD;

export const KEYS: Record<string, string> = Object.fromEntries(Object.entries(VARS).map(([name, v]) => [name, config_key(v)]));
if (GCHAT_KEYCHAIN && GCHAT_SPACE !== "") {
  KEYS.gchat = await config_keychain(VARS.gchat!);
}
if (KEY_FD !== undefined) {
  KEYS.anthropic = config_fd(KEY_FD);
  if (WORKERS > 0) {
    throw new Error("config: workers get the keys in their environment, and the gateway's key came on a file descriptor (LEGION_ANTHROPIC_KEY_FD): run with no workers");
  }
}

// Config
// ======

export function config_get(key: string, def: string): string {
  return process.env["LEGION_" + key.toUpperCase()] ?? FILE[key] ?? def;
}

function config_path(path: string): string {
  return path.startsWith("~/") ? os.homedir() + path.slice(1) : path;
}

// a URL a key is sent to, if https or (a local gateway) http on
// 127.0.0.1, localhost or [::1]; else the server doesn't start
function config_origin(key: string, text: string): string {
  let url: URL | null = null;
  try {
    url = new URL(text);
  } catch {}
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url?.hostname ?? "");
  if (url?.protocol !== "https:" && !(url?.protocol === "http:" && local)) {
    throw new Error("config: " + key + " is no https URL (http only on 127.0.0.1, localhost or [::1]): " + (url?.origin ?? "not a URL"));
  }
  return text;
}

// a role's pick; its model a tier ("sonnet") or a label ("sonnet-5.5")
// of the catalog (Models.ts)
function config_run(key: string, text: string): Pick {
  const [vendor, name, effort, speed] = text.split(":");
  const model = VENDORS.includes(vendor as Vendor) ? Pick.tier(vendor as Vendor, String(name)) ?? name : name;
  const pick = Pick.read({ vendor, model, effort, speed }, OFFER);
  if (pick === null) {
    throw new Error("config: " + key + " is no vendor:model:effort:speed offered here: " + text);
  }
  return pick;
}

// a Claude Code worker's model id: a sonnet or haiku tier or label of
// the catalog's Claude models; opus, or none of them, refuses to start
function config_claude(key: string, text: string): string {
  const label = Pick.tier("claude-api", text);
  const model = CATALOG["claude-api"].find((m) => m.label === label);
  if (model === undefined || !["sonnet", "haiku"].includes(model.tier ?? "")) {
    throw new Error("config: " + key + " is no sonnet or haiku model of the catalog (local/models.json): " + text);
  }
  return model.id;
}

function config_vendors(text: string): Vendor[] {
  const list = text.split(",").map((v) => v.trim()) as Vendor[];
  const bad = list.find((v) => !VENDORS.includes(v));
  if (bad !== undefined) {
    throw new Error("config: vendors can't offer " + bad);
  }
  return list;
}

function config_reads(text: string): string[] {
  const list = String(text).split(",").map((t) => t.trim()).filter((t) => t !== "");
  const bad = list.find((t) => !/^mcp__[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+$/.test(t));
  if (bad !== undefined) {
    throw new Error("config: mcp_reads has no exact mcp__<server>__<tool> name: " + bad);
  }
  return list;
}

function config_key(name: string): string {
  const key = (process.env[name] ?? "").trim();
  delete process.env[name];
  return key;
}

// a key read whole from the file descriptor named (3-9), which is then
// closed; refused (thrown, never with the key) if none is on it
function config_fd(text: string): string {
  if (!/^[3-9]$/.test(text)) {
    throw new Error("config: LEGION_ANTHROPIC_KEY_FD is no file descriptor 3-9");
  }
  const fd = Number(text);
  let key = "";
  try {
    key = fs.readFileSync(fd, "utf8").trim();
  } catch {
    throw new Error("config: can't read the gateway's key on file descriptor " + fd);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
  if (key === "") {
    throw new Error("config: no gateway key on file descriptor " + fd);
  }
  return key;
}

// a key kept in the login Keychain as the generic password of service
// name (the README's `security add-generic-password`); "" if none or
// refused, said without it (Auth.security: the value never in an argument
// or a log)
async function config_keychain(name: string): Promise<string> {
  const r = await Auth.security(["find-generic-password", "-s", name, "-w"]).catch(() => ({ code: 1, out: "" }));
  if (r.code !== 0) {
    console.error("config: the GChat webhook is not in the Keychain (service " + name + (r.code === 44 ? ")" : ", refused)") + ": the GChat bridge is off.");
    return "";
  }
  return r.out.trim();
}

// the environment a worker of this server starts with: this one, with
// the keys back (the GChat webhook not, read from the Keychain: a worker
// reads it again, with LEGION_GCHAT_KEYCHAIN; nor the gateway's, if it came
// on a file descriptor: no workers then)
export function config_env(): Record<string, string | undefined> {
  const keys = Object.entries(VARS).filter(([name]) => !(GCHAT_KEYCHAIN && name === "gchat") && !(KEY_FD !== undefined && name === "anthropic")).map(([name, v]) => [v, KEYS[name]]);
  return { ...process.env, ...Object.fromEntries(keys) };
}
