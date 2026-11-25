// Modes
// =====
// The chat's permission mode, as Claude Code's: plan (only reading, until
// the user approves a plan), auto (a reviewer model allows or refuses each
// call that can change things), full (every call, Claude Code's hooks
// only). Pure: Tools.ts asks it what a call may do, on the server, before
// a job goes to a device.
// Plan mode's shell is a read-only allowlist (readonly): commands known to
// only read, joined by pipes and && || ;, with no redirect (but 2>/dev/null
// and 2>&1), substitution, background job, newline, variable assignment
// or path to a program; per command, the flags that would write or run
// other code refused (find -exec, rg --pre, git's writing subcommands...),
// in any form git and GNU take them (abbreviated, =value, run together);
// no word the shell would expand itself (zsh: glob, brace, paren, =cmd).
// RED ZONE (security review SA, DRAFT awaiting the user's sign-off)

// Types
// =====

export type Mode = "plan" | "auto" | "super" | "full";

// what a question of the orchestrator's is about (Tools.question's kind)
export type AskKind = "push" | "scope" | "retry" | "merge" | "access" | "redzone" | "money" | "outward" | "other";

// a kind's record (super auto): its questions the user answered with a
// pick offered, those they took it, whether the counts were imported
// from the log (Modes.imported), its last LAST auto-decisions (undone?)
export type Tally = { n: number; took: number; est?: boolean; auto?: Array<{ id: number; undone: boolean }> };

// Constants
// =========

export const MODES: Mode[] = ["plan", "auto", "super", "full"];

export const ASK_KINDS: AskKind[] = ["push", "scope", "retry", "merge", "access", "redzone", "money", "outward", "other"];

// what a mode says of itself, to the user and the agents
export const ABOUT: Record<Mode, string> = {
  plan: "plan mode: agents only read, until you approve a plan",
  auto: "auto mode: a reviewer allows or refuses each change",
  super: "super auto mode: as auto, and Legion takes its own pick on questions of a kind where you always have",
  full: "full mode: every call runs (hooks only)",
};

// super auto: a kind unlocks at UNLOCK answered with a pick and TAKEN of
// them taken; RELOCK undone of its LAST auto-decisions relock it
const UNLOCK = 20;
const TAKEN = 85; // percent
const RELOCK = 2;
const LAST = 10;

// the bootstrap's matchers (Modes.imported): an answer in the log, the
// pick marked in it or in the question, an answer's letter
const ANSWERED = /^Answer to your question (\d+) \(([\s\S]*)\):\n([\s\S]*)$/;
const REC = /\(rec(?:ommended)?\)/i;
const MARK = /my pick|\(rec(?:ommended)?\)|recommended/i;
const LETTER = /(?:^|[\s(\[])([A-F])[).:]/g;

// the floor's words (Modes.guess; security review R5): red zone (a
// migration, prod data, permissions, data deleted), money (a payment, an
// amount, a budget), outward (sent, posted or published to someone).
// Broad on purpose: a word too many only asks.
// RED ZONE (who decides): signed off by the user 2026-11-19
const REDZONE = /\bred[- ]?zone|\bmigrat(e|es|ed|ing|ion|ions)\b|\bschema change|\bprod(uction)?\b[^.?!]{0,30}\b(db|database|data|table)s?\b|\b(db|database)\b[^.?!]{0,30}\bprod(uction)?\b|\bpermission|\b(delet|drop|truncat|wip|purg|eras)\w*\b[^.?!]{0,40}\b(data|table|tables|database|db|rows|records|bucket|backups?)\b/i;
const MONEY = /\bpay(s|ing|ment|ments)?\b|\bpaid\b|\binvoic|\bpurchas|\bcharg(e|es|ed|ing)\b|\brefund|\bbilling\b|\bsubscri(be|ption)|\bbudget|\bspend(s|ing)?\b|[$€£]\s?\d|\d\s?(usd|eur|gbp|dollars?|euros?)\b/i;
const OUTWARD = /\bsend(s|ing)?\b|\bsent\b|\be-?mail|\bpost(s|ed|ing)?\b(?!-)|\bpublish|\btweet|\bannounce|\bmessage\s+(him|her|them|someone|the (client|customer|team|channel))|\bDM\b|\bslack\b|\bshare\s+(it\s+|the\s+\w+\s+)?with|\bexternal|\breply to (the )?(client|customer|thread|email)/i;

// what an agent refused in plan mode does instead
const AFTER = "Say what you would change instead: in your report, or, for Unii, in the plan it files (plan).";

// the tools that only read, in every mode
const READS = ["read", "glob", "grep", "google", "harvest"];

// the tools auto mode's reviewer checks (fetch: its URL can carry data
// off the computer, so plan mode, with no reviewer, refuses it as curl)
const REVIEWED = ["shell", "write", "edit", "computer", "fetch"];

// RED ZONE (risk-adjusted reviewer, DRAFT awaiting the user's sign-off):
// a reviewed call's risk, least first (Modes.floor, Modes.risk); a shell
// command's words that make it high (no boss may overrule) or medium
export type Risk = "low" | "medium" | "high";
const RISKS: Risk[] = ["low", "medium", "high"];
const PUSH = String.raw`\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*`;
const HIGH = [
  new RegExp(PUSH + String.raw`(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+\S)`),
  new RegExp(PUSH + String.raw`\s(\S+:)?(main|master|release)\b`),
  /\bdeploy\b/,
  /(^|[\s=_\/-])prod([\s_\/-]|$)/i,
  /\b(npm|pnpm|bun|yarn|cargo)\s+publish\b|\btwine\s+upload\b/,
  /\bgh\s+pr\s+merge\b/,
  /\|\s*(sudo\s+)?(ba|z|da)?sh\b/,
];
const MEDIUM = [
  new RegExp(PUSH),
  /\brm\b/,
  /\bbranch\s+(-[a-zA-Z]*D\b|--delete\s+--force\b)/,
  /\bworktree\s+remove\b/,
  /\b(kill|pkill|killall)\b/,
  /\breset\s+--hard\b|\bclean\s+-[a-zA-Z]*f/,
  /\bgh\s+(pr|issue|release|repo)\s+(create|comment|edit|close|reopen|review|ready|delete)\b/,
  /\bgh\s+api\b[^;&|\n]*(-X\s*(POST|PUT|PATCH|DELETE)|--method\s+(POST|PUT|PATCH|DELETE)|\s-[fF]\s|--(raw-)?field\b|\bgraphql\b)/,
];

// RED ZONE (security review 4 G1, Q2, G4, signed off by the user 2026-11-25): what runs the code it is given (a shell, an interpreter),
// as a command's name (its -c payload) or piped into (medium at least);
// git config keys git runs a command from (high); a repo's files that
// steer or gate every later agent there (high to write or edit)
const INTERPRETERS = /^((ba|z|da|k|fi)?sh|python[\d.]*|node|bun|deno|perl|ruby|php|osascript)$/;
const INTERPRETED = /\|\s*(sudo\s+)?(env\s+)?(\S*\/)?((ba|z|da|k|fi)?sh|python[\d.]*|node|bun|deno|perl|ruby|php|osascript)\b/;
const GIT_RUNS = /\b(core\.(sshcommand|gitproxy|fsmonitor|hookspath|pager|editor|askpass)|[\w.:-]*\.(uploadpack|receivepack|textconv)|credential\.(\S*\.)?helper|filter\.[\w.-]+|diff\.external|protocol\.[\w.-]+|url\.\S+\.insteadof|alias\.[\w-]+|sequence\.editor)\b/i;
const STEERS = /(^|\/)(claude|agents)(\.local)?\.md$|(^|\/)\.claude\/(rules|hooks)(\/|$)/i;

// RED ZONE (security review follow-up, DRAFT awaiting the user's
// sign-off): the one list of where a secret may be, in any case (macOS's
// disk is case-insensitive). A file's name (a key, credentials, a token,
// .env, a login's dotfile, a service account's JSON), a dir it is in
// (~/.ssh, ~/.aws, ~/.kube...) or a repo's .git/config: Machine's read,
// grep and glob refuse them (Machine.secret), so does Device's files pane
const DOTS = String.raw`\.netrc|\.npmrc|\.pypirc|\.git-credentials|\.pgpass|\.claude\.json`;
const DIRS = String.raw`\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.config\/(gh|gcloud)|Library\/Keychains`;
export const SECRET = new RegExp(String.raw`^(\.env.*|.*\.(pem|key|p12|pfx|keychain)|id_[a-z0-9]+|${DOTS}|credentials.*|\.credentials.*|secrets?(\..*)?|tokens?|.*(credential|service[-_]?account|secret|token).*\.json|(.*[-_.])?keys?([-_.].*)?\.json)$`, "i");
export const SECRET_AT = new RegExp(String.raw`(^|\/)(${DIRS})(\/|$)|\/\.git\/config$`, "i");

// RED ZONE (S1c, DRAFT awaiting the user's sign-off): Legion's own trust
// state, by its path in Legion's dir (~/.unii, $UNII_DIR; a terminal's
// $UNII_HOME): its sessions (cloud.db and its -wal, -shm, -journal), the
// sign-in secret's hash (Cloud.ts SIGNIN), the server's log, a terminal's
// device key (<host>/token). Machine.trust refuses them to agents' tools.
// TRUST_WORDS: the same, or the dir, named in a shell command (SECRETS)
// RED ZONE (security review 4 F2, signed off by the user 2026-11-25):
// and its bin dir (the built key helper, legion-key, and its .sha256)
export const TRUST = /^\/(cloud\.db(-wal|-shm|-journal)?|signin-hash|server\.log|[^/]+\/token|bin\/.+)$/i;
const TRUST_WORDS = String.raw`\.unii\b|\bUNII_(DIR|HOME)\b|cloud\.db|server\.log|signin-hash`;

// a read-only command that may read secrets: still reviewed in auto mode
// (the list above, in the line or its words; not a bare key: too common.
// not set, which flagged git push --set-upstream (K10); env stays: jq -n env
// prints the environment); Legion's trust state too (TRUST_WORDS)
const SECRETS = new RegExp(String.raw`printenv|environ|\benv\b|\.env|(${DIRS})\b|${DOTS}|\.git\/config|secret|credential|token|passw|keychain|\.pem\b|\bid_[a-z0-9]+|${TRUST_WORDS}`, "i");

// commands that only read, whatever their arguments
// (not env, which runs its arguments; nor tree -o, uniq's output file,
// file -C: checked below)
const PLAIN = new Set(["ls", "cat", "head", "tail", "wc", "pwd", "echo", "stat", "du", "df", "which", "diff", "cut", "jq", "basename", "dirname", "realpath", "true", "grep", "egrep", "fgrep", "nl", "whoami", "printenv", "tr", "column", "comm"]);

// git's subcommands that only read
const GIT = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files", "blame", "grep", "describe", "shortlog", "ls-tree", "cat-file", "reflog", "tag"]);

// git branch/tag flags that write: long ones, and short ones' letters
const GIT_WRITES = ["--delete", "--move", "--copy", "--force", "--set-upstream-to", "--unset-upstream", "--edit-description", "--annotate", "--sign"];
const GIT_SHORTS = /^-[A-Za-z]*[dDmMcCfuas]/;

// gh's subcommands that only read (an unattended PR review reads its PR
// with them), the flags they may take (none opens a browser or waits),
// and gh api's: a GET of a path on GitHub, no field (that makes it a POST)
// (K10's nouns: the network reads the user chose; auth status takes no
// flag, as its -t prints the token)
const GH: Record<string, string[]> = {
  pr: ["view", "list", "diff", "checks", "status"], issue: ["view", "list", "status"], repo: ["view", "list"],
  run: ["view", "list"], workflow: ["view", "list"], release: ["view", "list"],
  search: ["prs", "issues", "repos", "code", "commits"], auth: ["status"],
};
// a search over the whole home or disk, which holds the logins (a grep -r ~)
const HOME_WIDE = /^(~\/?|\$HOME\/?|\$\{HOME\}\/?|\/|\/Users(\/[^\/]+)?\/?)$/;
// gh -R: OWNER/REPO on GitHub, never HOST/OWNER/REPO
const GH_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const GH_FLAGS = new Set(["--repo", "-R", "--json", "--jq", "-q", "--template", "-t", "--comments", "-c", "--name-only", "--patch", "--color", "--limit", "-L", "--state", "-s", "--author", "-A", "--label", "-l", "--base", "-B", "--head", "-H", "--search", "-S", "--assignee", "-a", "--branch", "-b", "--required", "--draft", "-d", "--app", "--mention", "--milestone", "-m",
  "--log", "--log-failed", "--job", "-j", "--exit-status", "--attempt", "--verbose", "--workflow", "--event", "--status", "--user", "--commit", "--created",
  "--owner", "--language", "--sort", "--order", "--match", "--updated", "--visibility", "--topic", "--archived", "--no-archived", "--fork", "--source", "--exclude-drafts", "--exclude-pre-releases", "--all", "--yaml", "--ref"]);
const GH_API = new Set(["--paginate", "--jq", "-q", "--template", "-t", "--include", "-i", "--silent", "--slurp", "--verbose"]);

// a branch a plain push may go to without the reviewer: not a default,
// shared or release branch (K10)
const PROTECTED = /^(main|master|develop|trunk|HEAD|gh-pages|release(\/.*)?|\d+(\.\d+)*\.x)$/;
const PUSH_FLAGS = new Set(["-u", "--set-upstream", "-q", "--quiet", "-v", "--verbose"]);
// a Jira ticket key, as PLP-123 (Modes.unkeyed)
const KEY = /(^|[^A-Za-z0-9])[A-Z][A-Z0-9]+-\d+(?![0-9])/;

// find's actions that write or run
const FIND_WRITES = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"]);

// Modes
// =====

export namespace Modes {

  // a saved or sent mode; one unread or unknown, auto (fail closed: super
  // answers for the user, security review R5). A new chat's is super, set
  // as such (Memory.load)
  export function read(x: unknown): Mode {
    return MODES.includes(x as Mode) ? (x as Mode) : "auto";
  }

  // the mode after it (Shift+Tab)
  export function next(mode: Mode): Mode {
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
  }

  // why a mode refuses a device tool call; null: it may run (auto's
  // reviewer may still refuse it: reviews)
  // (an MCP tool: only the reads auto mode lets by unreviewed, reviews;
  // reads: config's mcp_reads)
  export function allows(mode: Mode, tool: string, input: any, reads: readonly string[] = []): string | null {
    if (mode !== "plan" || READS.includes(tool) || (tool.startsWith("mcp__") && !Modes.reviews("auto", tool, input, reads))) {
      return null;
    }
    const why = "In plan mode only reading is allowed, until the user approves a plan";
    if (tool === "shell") {
      const not = Modes.readonly(String(input?.command ?? ""));
      return not === null ? null : why + ": " + not + ". " + AFTER;
    }
    return why + ": " + (tool === "fetch" ? "fetch sends its URL to a site, and data with it" : tool + " can change things") + ". " + AFTER;
  }

  // RED ZONE (security review U3, DRAFT awaiting the user's sign-off):
  // the MCP tools auto mode lets by unreviewed, by whole name, of the
  // servers local/mcp.ts sets up: plainly reads (no fetch, navigate,
  // evaluate, execute*, nor a screenshot written to a path). Config's
  // mcp_reads adds more (Tools.ts passes them); any other is reviewed
  // an argument naming a file or dir: an MCP read given one may write there
  const MCP_FILE = /file|path|dir/i;
  export const MCP_READS: readonly string[] = [
    ...["getJiraIssue", "searchJiraIssuesUsingJql", "listJiraIssueComments", "getConfluenceContent", "searchConfluence", "search", "getAccessibleAtlassianResources", "atlassianUserInfo"].map((t) => "mcp__atlassian__" + t),
    ...["browser_snapshot", "browser_console_messages", "browser_network_requests"].map((t) => "mcp__playwright__" + t),
    ...["list_pages", "take_snapshot", "list_console_messages", "get_console_message", "list_network_requests", "get_network_request"].map((t) => "mcp__chrome-devtools__" + t),
  ];

  // whether auto mode's reviewer checks a tool's call: not a plainly
  // read-only shell command (as Claude Code), network reads included, nor
  // a feature branch's plain push (K10), unless it reads secrets (in its
  // line or its words, quotes off), nor an MCP tool whose exact name is on
  // MCP_READS or reads (one cut with a hash, Mcp.name, never is)
  export function reviews(mode: Mode, tool: string, input?: any, reads: readonly string[] = []): boolean {
    if (mode !== "auto" && mode !== "super") {
      return false;
    }
    if (tool.startsWith("mcp__")) {
      // a file or path argument: the "read" may write it (playwright filename, devtools filePath)
      return /_[0-9a-f]{8}$/.test(tool) || Object.keys(input ?? {}).some((k) => MCP_FILE.test(k)) || !(MCP_READS.includes(tool) || reads.includes(tool));
    }
    if (!REVIEWED.includes(tool)) {
      return false;
    }
    const command = tool === "shell" && typeof input?.command === "string" ? input.command : null;
    // not plain ASCII: the Mac folds lookalikes (a long s is s), so a name may hide
    if (command === null || /[^\x00-\x7f]/.test(command) || SECRETS.test(command) || (Modes.readonly(command) !== null && !Modes.feature_push(command))) {
      return true;
    }
    const lexed = lex(command);
    return typeof lexed === "string" || lexed.flat().some((w) => SECRETS.test(w) || HOME_WIDE.test(w));
  }

  // Risk
  // ----
  // RED ZONE (risk-adjusted reviewer, DRAFT awaiting the user's sign-off):
  // the reviewer labels a call's risk, this code decides (Modes.decide);
  // the floor, from the call's words alone, is the least risk it carries:
  // the reviewer may raise it, never lower it (Modes.risk)

  // the least risk a reviewed call carries: high, the floor no boss may
  // overrule; medium, hard to undo here or a write off the computer
  // RED ZONE (security review 4 G1, G4, N1, Q2, signed off by the user 2026-11-25): at: the path as it resolves (the caller's: absolute and
  // real), floored as it is written too; a shell command with its quotes
  // off as well
  export function floor(tool: string, input?: any, at: readonly string[] = []): Risk {
    if (tool === "write" || tool === "edit") {
      const p = String(input?.path ?? input?.file_path ?? "");
      if ([p, ...at].some((q) => SECRETS.test(q) || STEERS.test(q))) {
        return "high";
      }
      return /(^|\/)\.\.(\/|$)/.test(p) ? "medium" : "low";
    }
    if (tool !== "shell") {
      return "medium";
    }
    return floor_shell(typeof input?.command === "string" ? input.command : "");
  }

  function floor_shell(c: string): Risk {
    // the line with every quote and backslash taken off: a word quoted in
    // parts reads whole ("r"m, pu""sh), a -c payload's words too; only
    // ever raises what matches
    const bare = c.replace(/["'\\]/g, "");
    const texts = [c, bare];
    if (/[^\x00-\x7f]/.test(c) || texts.some((t) => SECRETS.test(t) || HIGH.some((r) => r.test(t)) || git_runs(t))) {
      return "high";
    }
    const lexed = lex(c);
    const built = typeof lexed === "string" || lexed.some(runs_code) || /[$`]/.test(c) || /(^|[;&|(]\s*)(builtin\s+)?eval\b/.test(bare) || INTERPRETED.test(bare);
    return built || texts.some((t) => MEDIUM.some((r) => r.test(t))) ? "medium" : "low";
  }

  // whether a command runs the code it is given: a shell's or an
  // interpreter's -c or -e (python -c, node -e, perl -e...)
  function runs_code(words: string[]): boolean {
    const name = (words[0] ?? "").split("/").at(-1) ?? "";
    return INTERPRETERS.test(name) && words.slice(1).some((w) => /^-[a-zA-Z]*[ce]$|^--eval$/.test(w));
  }

  // whether a line's git config (or git -c) sets a key git runs a command
  // from; a --get or --list of one only reads it
  function git_runs(t: string): boolean {
    return t.split(/[;&|\n]/).some((seg) => /\bgit\b/.test(seg) && (/\bconfig\b/.test(seg) && !/\s--(get|list)\b|\s-l\b/.test(seg) || /\s-c\s/.test(seg)) && GIT_RUNS.test(seg));
  }

  // a call's risk: the higher of its floor and the reviewer's label; no
  // label or one not known is high (fail closed)
  export function risk(floor: Risk, label: unknown): Risk {
    const at = RISKS.indexOf(label as Risk);
    return at < 0 ? "high" : RISKS[Math.max(at, RISKS.indexOf(floor))]!;
  }

  // what a reviewed call comes to: the reviewer's allow runs it; its
  // refusal stands but of a low risk (runs), or of a sub-agent's medium
  // one in super mode (waits for the boss that wrote its task: appeal)
  export function decide(mode: Mode, risk: Risk, allow: boolean, sub: boolean): "run" | "refuse" | "appeal" {
    if (allow || risk === "low") {
      return "run";
    }
    return mode === "super" && sub && risk === "medium" ? "appeal" : "refuse";
  }

  // Super auto
  // ----------
  // RED ZONE (who decides: access-control policy, DRAFT awaiting the
  // user's sign-off): whether Legion answers a question with its own pick
  // instead of asking. Fail closed: anything not plainly earned asks.

  // the kinds never answered for the user, whatever their record
  export const FLOOR: readonly AskKind[] = ["access", "redzone", "money", "outward"];

  // whether a kind has earned super auto: known, not the floor, UNLOCK
  // answered with a pick and TAKEN of them taken
  export function unlocked(kind: unknown, t: Tally | undefined): boolean {
    if (!ASK_KINDS.includes(kind as AskKind) || FLOOR.includes(kind as AskKind) || t === undefined) {
      return false;
    }
    return t.n >= UNLOCK && t.took * 100 >= TAKEN * t.n;
  }

  // whether super auto answers a question with its pick: super mode, a
  // pick among its options, its kind unlocked; a merge only if marked
  // not to touch prod (prod: false; unset asks); never a floor kind (no
  // floor kind unlocks), nor one whose text or an option is worded as one
  // (guess), whatever kind it says: the model's label is not trusted
  // (security review R5; RED ZONE: signed off by the user 2026-11-19)
  export function decides(mode: Mode, q: { kind?: unknown; pick?: unknown; options?: string[]; prod?: unknown; text?: string }, tallies: Partial<Record<AskKind, Tally>>): boolean {
    const n = q.options?.length ?? 0;
    if (mode !== "super" || !Number.isInteger(q.pick) || (q.pick as number) < 0 || (q.pick as number) >= n) {
      return false;
    }
    const worded = [q.text ?? "", ...(q.options ?? [])].some((x) => FLOOR.includes(Modes.guess(x)));
    if ((q.kind === "merge" && q.prod !== false) || worded) {
      return false;
    }
    return Object.hasOwn(tallies, q.kind as string) && Modes.unlocked(q.kind, tallies[q.kind as AskKind]);
  }

  // whether an answer took the pick: its option's text (spaces, case
  // aside), or its letter (A for the first) alone or before ) . : or a word
  export function took(q: { options?: string[]; pick?: number }, answer: string): boolean {
    const pick = q.pick === undefined ? undefined : q.options?.[q.pick];
    if (pick === undefined) {
      return false;
    }
    const flat = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
    return flat(answer) === flat(pick) || Modes.letter(answer) === q.pick;
  }

  // an answer's leading option letter, as an index (A: 0); null: none
  // (a lowercase one only alone or before ) . :, so "a fix" is no A)
  export function letter(answer: string): number | null {
    const m = /^\s*(?:([A-F])\b|([a-f])(?:$|[).:]))/.exec(answer);
    const l = m?.[1] ?? m?.[2]?.toUpperCase();
    return l === undefined ? null : l.charCodeAt(0) - 65;
  }

  // a kind's record after the user's answer (took: their pick)
  export function counted(t: Tally | undefined, took: boolean): Tally {
    return { ...t, n: (t?.n ?? 0) + 1, took: (t?.took ?? 0) + (took ? 1 : 0), auto: t?.auto ?? [] };
  }

  // a kind's record after an auto-decision (its number): its last LAST kept
  export function decided(t: Tally | undefined, id: number): Tally {
    return { ...t, n: t?.n ?? 0, took: t?.took ?? 0, auto: [...(t?.auto ?? []), { id, undone: false }].slice(-LAST) };
  }

  // a kind's record after the user undid an auto-decision: an override
  // (answered, not taken); RELOCK undone of its last LAST: back to nothing
  export function undone(t: Tally | undefined, id: number): Tally {
    const after = { ...Modes.counted(t, false), auto: (t?.auto ?? []).map((a) => (a.id === id ? { id, undone: true } : a)) };
    return Modes.relocks(after) ? { n: 0, took: 0, auto: [] } : after;
  }

  // whether a kind's last LAST auto-decisions hold RELOCK undone
  export function relocks(t: Tally): boolean {
    return (t.auto ?? []).slice(-LAST).filter((a) => a.undone).length >= RELOCK;
  }

  // a question's kind guessed from its words, the floor first (a merge of
  // a credentials or migration PR asks) (the bootstrap: past questions had
  // none; Modes.decides: the model's own kind is not trusted)
  export function guess(question: string): AskKind {
    return /\bgrant|credential|secret|\btoken|\blog ?in\b|\bauth|\baccess/i.test(question) ? "access"
      : REDZONE.test(question) ? "redzone"
      : MONEY.test(question) ? "money"
      : OUTWARD.test(question) ? "outward"
      : /\bmerg|\bPRs?\b|\bapprov/i.test(question) ? "merge"
      : /\bpush|\bbranch|\brebase/i.test(question) ? "push"
      : /\bretr(y|ies)|\bfail|\bflaky|\btime(d)? ?out/i.test(question) ? "retry"
      : /\bticket|\bjira\b|\bAO-\d|\bPLP-\d/i.test(question) ? "scope"
      : "other";
  }

  // the bootstrap: past answers in the user's messages (as Chat.reply
  // logs them), each question once, counted per guessed kind where the
  // pick is readable: a (rec) in the answer (taken), else the option
  // letter before "my pick", "(rec)" or "recommended" in the question,
  // matched by the answer's letter; one guessed as a floor kind dropped.
  // Estimated: the counts say so
  export function imported(texts: string[]): Partial<Record<AskKind, Tally>> {
    const out: Partial<Record<AskKind, Tally>> = {};
    const seen = new Set<string>();
    for (const text of texts) {
      const m = ANSWERED.exec(text);
      if (m === null || seen.has(m[1]!)) {
        continue;
      }
      seen.add(m[1]!);
      const [question, answer] = [m[2]!, m[3]!];
      let took: boolean | null = REC.test(answer) ? true : null;
      if (took === null) {
        const mark = MARK.exec(question);
        const pick = mark === null ? undefined : [...question.slice(0, mark.index).matchAll(LETTER)].at(-1)?.[1];
        const said = Modes.letter(answer);
        took = pick === undefined || said === null ? null : said === pick.charCodeAt(0) - 65;
      }
      const kind = Modes.guess(question);
      // worded as the floor: never counted, toward its kind or another (R5)
      if (took !== null && !FLOOR.includes(kind)) {
        out[kind] = { ...Modes.counted(out[kind], took), est: true };
      }
    }
    return out;
  }

  // why a shell command is not plainly read-only; null: it is
  export function readonly(command: string): string | null {
    const lexed = lex(command);
    if (typeof lexed === "string") {
      return lexed;
    }
    if (lexed.length === 0) {
      return "no command";
    }
    for (const words of lexed) {
      const why = words.length === 0 ? "an empty command" : check(words);
      if (why !== null) {
        return why;
      }
    }
    return null;
  }

  // a command line as its commands' words (split at | || && ;), quotes
  // taken off; a string: why it can't be read as plainly read-only
  function lex(line: string): string[][] | string {
    const cmds: string[][] = [[]];
    let word: string | null = null;
    const end = () => {
      if (word !== null) {
        cmds.at(-1)!.push(word);
        word = null;
      }
    };
    for (let k = 0; k < line.length; k++) {
      const c = line[k]!;
      if (c === "'") {
        const close = line.indexOf("'", k + 1);
        if (close < 0) {
          return "an unclosed quote";
        }
        word = (word ?? "") + line.slice(k + 1, close);
        k = close;
      } else if (c === '"') {
        const q = dquote(line, k);
        if (typeof q === "string") {
          return q;
        }
        word = (word ?? "") + q[0];
        k = q[1];
      } else if (c === "\\") {
        if (line[k + 1] === "\n") {
          return "a newline";
        }
        word = (word ?? "") + (line[k + 1] ?? "");
        k += 1;
      } else if (c === " " || c === "\t") {
        end();
      } else if (c === "\n" || c === "\r") {
        return "a newline (one command line only)";
      } else if (c === "`" || (c === "$" && line[k + 1] === "(")) {
        return "a command substitution";
      } else if (c === "<") {
        return "a redirect or process substitution (<)";
      } else if ("{}()*?[]".includes(c) || (c === "=" && word === null) || (c === "$" && "~=^{[".includes(line[k + 1] ?? " "))) {
        return "an unquoted " + c + " (the shell expands it: glob, brace, paren or =cmd)";
      } else if (c === ">") {
        const to = stderr(line, k, word);
        if (typeof to === "string") {
          return to;
        }
        word = null;
        k = to;
      } else if (c === "|" || c === ";" || c === "&") {
        const two = line.slice(k, k + 2);
        if (c === "&" && two !== "&&") {
          return "a background job (&)";
        }
        end();
        if (cmds.at(-1)!.length === 0) {
          return "an empty command";
        }
        cmds.push([]);
        if (two === "&&" || two === "||") {
          k += 1;
        }
      } else {
        word = (word ?? "") + c;
      }
    }
    end();
    return cmds.at(-1)!.length === 0 && cmds.length > 1 ? "an empty command" : cmds.filter((w) => w.length > 0);
  }

  // a redirect at k after the word before it: only stderr thrown away or
  // joined to stdout (2>/dev/null, 2>&1), so where it ends; a string: why not
  function stderr(line: string, k: number, before: string | null): number | string {
    const rest = line.slice(k + 1);
    const tail = /^&1(?=\s|$|[|;&])/.exec(rest) ?? /^\/dev\/null(?=\s|$|[|;&])/.exec(rest);
    return before !== "2" || tail === null ? "a redirect (>)" : k + tail[0].length;
  }

  // a double-quoted word from the quote at k: its text and where it ends
  // (the closing quote); a string: why not (a substitution expands even
  // in double quotes)
  function dquote(line: string, k: number): [string, number] | string {
    let w = "";
    for (k += 1; k < line.length && line[k] !== '"'; k++) {
      if (line[k] === "`" || (line[k] === "$" && line[k + 1] === "(")) {
        return "a command substitution";
      }
      if (line[k] === "$" && (line[k + 1] === "{" || line[k + 1] === "[")) {
        return "a ${...} or $[...] (zsh's flags can run code)";
      }
      if (line[k] === "\\") {
        k += 1;
      }
      w += line[k] ?? "";
    }
    return k >= line.length ? "an unclosed quote" : [w, k];
  }

  // whether an argument is one of the long options named, as git and GNU
  // take them: abbreviated, with or without =value
  function long(a: string, names: string[]): boolean {
    const name = a.split("=")[0]!;
    return name.startsWith("--") && name.length > 2 && names.some((n) => n.startsWith(name));
  }

  // why a gh command is not read-only (GH, GH_FLAGS, GH_API); null: it is
  function gh(args: string[]): string | null {
    const [group = "", sub = "", ...rest] = args;
    if (group === "api") {
      for (let k = 1; k < args.length; k++) {
        const a = args[k]!;
        // a header only to say what it accepts (K10's -H 'Accept: ...'): any
        // other may change the method (X-HTTP-Method-Override)
        const header = a === "-H" || a === "--header" ? args[++k] ?? "" : /^(?:-H|--header=)(.+)$/.exec(a)?.[1];
        if (header !== undefined) {
          if (!/^\s*accept\s*:/i.test(header)) {
            return "gh api -H other than Accept (" + header + ")";
          }
          continue;
        }
        const method = a === "-X" || a === "--method" ? args[++k] : /^(-X|--method=)(.*)$/.exec(a)?.[2];
        if (method !== undefined ? method.toUpperCase() !== "GET" : a.startsWith("-") ? !GH_API.has(a.split("=")[0]!) : a.includes("://")) {
          return "gh api other than a GET of a path on GitHub (" + a + ")";
        }
      }
      return null;
    }
    if (!Object.hasOwn(GH, group) || !GH[group]!.includes(sub)) {
      return "gh " + [group, sub].join(" ").trim() + " is not one that only reads";
    }
    if (group === "auth" && rest.length > 0) {
      return "gh auth status takes no flag here (-t prints the token)";
    }
    const bad = rest.find((a) => a.startsWith("-") && !GH_FLAGS.has(a.split("=")[0]!));
    if (bad !== undefined) {
      return "gh " + group + " " + sub + " " + bad + " (not a flag that only reads)";
    }
    for (let k = 0; k < rest.length; k++) {
      const a = rest[k]!;
      const repo = a === "-R" || a === "--repo" ? rest[++k] ?? "" : /^(?:-R|--repo)=(.*)$/.exec(a)?.[1];
      if (repo !== undefined && !GH_REPO.test(repo)) {
        return "gh -R takes OWNER/REPO on GitHub, not " + repo;
      }
    }
    return null;
  }

  // a plain push of a feature branch to origin (K10): one command, git
  // push, only PUSH_FLAGS, origin and one branch (or HEAD:branch), not
  // forced (+), not deleting (:x), not a PROTECTED one
  export function feature_push(command: string): boolean {
    const lexed = lex(command);
    if (typeof lexed === "string" || lexed.length !== 1) {
      return false;
    }
    const [git, push, ...rest] = lexed[0]!;
    if (git !== "git" || push !== "push") {
      return false;
    }
    const flags = rest.filter((a) => a.startsWith("-"));
    const places = rest.filter((a) => !a.startsWith("-"));
    if (flags.some((f) => !PUSH_FLAGS.has(f)) || places.length !== 2 || places[0] !== "origin") {
      return false;
    }
    const branch = /^(?:HEAD:)?([\w./-]+)$/.exec(places[1]!)?.[1];
    return branch !== undefined && !PROTECTED.test(branch) && !branch.startsWith("-") && !branch.includes("..");
  }

  // why an agent's command is refused for a missing ticket key (user's
  // call 2026-11-20: oc-coding-assistant's pr-body.md asks for it, no gate
  // made it so): a gh pr create or edit's title, a git push's named
  // branch, each must hold a KEY (PLP-123); no --title on create is
  // refused (its title would come from commits, unchecked). Ticket-less
  // work: the user's call, asked for and run as their !command (ungated).
  // null: nothing to refuse (a command not lexed: other gates judge it)
  export function unkeyed(command: string): string | null {
    const lexed = lex(command);
    if (typeof lexed === "string") {
      return null;
    }
    return lexed.map(unkeyed_one).find((why) => why !== null) ?? null;
  }

  function unkeyed_one([cmd, sub, verb, ...rest]: string[]): string | null {
    const need = (what: string, text: string) => (KEY.test(text) ? null : what + " has no ticket key (" + text + "): name the Jira ticket, as PLP-123. No ticket: ask the user; ticket-less work is theirs to run.");
    if (cmd === "gh" && sub === "pr" && (verb === "create" || verb === "edit")) {
      const at = rest.findIndex((w) => w === "--title" || w === "-t");
      const title = at >= 0 ? rest[at + 1] : rest.find((w) => w.startsWith("--title="))?.slice("--title=".length);
      if (title === undefined) {
        return verb === "create" ? "A PR needs --title with its ticket key (as PLP-123: …), not one from commits." : null;
      }
      return need("The PR title", title);
    }
    if (cmd === "git" && sub === "push") {
      const places = [verb, ...rest].filter((w): w is string => w !== undefined && !w.startsWith("-"));
      const branches = places.slice(1).map((ref) => ref.slice(ref.indexOf(":") + 1)).filter((b) => b !== "HEAD" && b !== "");
      return branches.map((b) => need("The branch", b)).find((why) => why !== null) ?? null;
    }
    return null;
  }

  // why one command is not read-only; null: it is
  function check(words: string[]): string | null {
    const [cmd, ...args] = words as [string, ...string[]];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd)) {
      return "a variable set before a command";
    }
    if (cmd.includes("/")) {
      return "a program by its path (" + cmd + ")";
    }
    if (PLAIN.has(cmd)) {
      return null;
    }
    switch (cmd) {
      case "sort": {
        return args.some((a) => long(a, ["--output", "--compress-program"]) || /^-[a-zA-Z]*o/.test(a)) ? "sort -o or --compress-program writes or runs" : null;
      }
      case "tree": {
        return args.some((a) => long(a, ["--output"]) || /^-[^-]*o/.test(a)) ? "tree -o writes a file" : null;
      }
      case "file": {
        return args.some((a) => long(a, ["--compile"]) || /^-[a-zA-Z]*C/.test(a)) ? "file -C writes a magic file" : null;
      }
      case "uniq": {
        return args.filter((a) => !a.startsWith("-")).length > 1 ? "uniq with an output file" : null;
      }
      case "rg": {
        return args.some((a) => a === "--pre" || a.startsWith("--pre=") || a === "--pre-glob" || a.startsWith("--pre-glob=")) ? "rg --pre runs another program" : null;
      }
      case "gh": {
        return gh(args);
      }
      case "find": {
        const act = args.find((a) => FIND_WRITES.has(a));
        return act === undefined ? null : "find " + act + " writes or runs";
      }
      case "git": {
        const sub = args[0];
        if (sub === undefined || sub.startsWith("-")) {
          return "git with options before its subcommand";
        }
        if (sub === "fetch") {
          return args.some((a) => long(a, ["--upload-pack"])) ? "git fetch --upload-pack runs another program" : null;
        }
        if (!GIT.has(sub)) {
          return "git " + sub + " is not one that only reads";
        }
        const rest = args.slice(1);
        if (rest.some((a) => long(a, ["--output", "--ext-diff", "--exec", "--open-files-in-pager"]) || (sub === "grep" && /^-[a-zA-Z]*O/.test(a)))) {
          return "git " + sub + " with an option that writes or runs";
        }
        if (sub === "reflog" && rest[0] !== undefined && rest[0] !== "show" && !rest[0].startsWith("-")) {
          return "git reflog " + rest[0] + " (only show reads)";
        }
        if ((sub === "branch" || sub === "tag") && rest.some((a) => long(a, GIT_WRITES) || GIT_SHORTS.test(a) || !a.startsWith("-"))) {
          return "git " + sub + " that makes, moves or deletes one";
        }
        return null;
      }
      default: {
        return cmd + " is not on plan mode's read-only list";
      }
    }
  }
}
