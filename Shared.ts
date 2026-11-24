// Shared
// ======
// Legion's own checkout of OnCorps/oncorps-shared-skills, in
// $UNII_DIR/shared-skills (default ~/.unii), at the tip of the ref
// local/shared.json names (0.x): the OnCorps plugins the agents' skills
// index lists (local/skills.ts) and the gate's hooks.json (Hooks.ts) come
// from it, not from Claude Code's install, which lags the branch. The
// launcher syncs it at each start (`bun Shared.ts`): a fresh clone, else
// a fetch, a forced detached checkout of the tip (edits wiped), stray
// files cleaned, origin put back to the configured repo. A failed fetch
// keeps the last copy; no checkout at all leaves Claude Code's OnCorps
// plugins in use.
// RED ZONE (PLP-2945, DRAFT awaiting the user's sign-off): following the
// tip, a commit merged to the branch runs as gate code at the next start.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Types
// =====

// the repo, the branch followed, and the plugins listed (by name)
export type Conf = { repo: string; ref: string; plugins: string[] };

// a plugin in the checkout: its name, its key (name@marketplace), its root
export type Plugin = { name: string; key: string; root: string };

// Constants
// =========

// the marketplace's name, as Claude Code keys its plugins (name@market)
export const MARKET = "oncorps-shared-skills";

// the config, in this checkout (Machine.gating refuses an agent's edit)
export const CONF = import.meta.dir + "/local/shared.json";

// Shared
// ======

export namespace Shared {

  export function conf(file = CONF): Conf {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    return { repo: String(c.repo), ref: String(c.ref), plugins: Array.isArray(c.plugins) ? c.plugins.map(String) : [] };
  }

  // the checkout, in Legion's dir, read at each call
  export function dir(): string {
    return (process.env.UNII_DIR ?? "~/.unii").replace(/^~(?=\/|$)/, os.homedir()) + "/shared-skills";
  }

  // the checkout's marketplace plugins, or null when it has none readable
  function market(dir: string): { name: string; source: unknown }[] | null {
    try {
      const m = JSON.parse(fs.readFileSync(dir + "/.claude-plugin/marketplace.json", "utf8"));
      return Array.isArray(m?.plugins) ? m.plugins : null;
    } catch {
      return null;
    }
  }

  // whether there is a checkout to use: one with a readable marketplace
  export function ready(dir = Shared.dir()): boolean {
    return market(dir) !== null;
  }

  // the named plugins in the checkout's marketplace, in its order: each
  // with a local source (a path); a root out of the checkout is left out
  export function plugins(names: string[], dir = Shared.dir()): Plugin[] {
    return (market(dir) ?? []).flatMap((p) => {
      const root = typeof p?.source === "string" ? path.resolve(dir, p.source) : null;
      return root !== null && names.includes(p.name) && Shared.inside(root, dir) ? [{ name: p.name, key: p.name + "@" + MARKET, root }] : [];
    });
  }

  // where the checkout's marketplace says a plugin is, out of it or not
  // (Hooks.ts checks it is in), else null: not listed with a local source
  export function root(name: string, dir = Shared.dir()): string | null {
    const p = (market(dir) ?? []).find((q) => q?.name === name);
    return typeof p?.source === "string" ? path.resolve(dir, p.source) : null;
  }

  // whether a path really is in a dir, both by their real paths (no link
  // or ".." out of it)
  export function inside(p: string, dir: string): boolean {
    try {
      return fs.realpathSync(p).startsWith(fs.realpathSync(dir) + path.sep);
    } catch {
      return false;
    }
  }

  // syncs the checkout to the tip of c.ref; says what it did
  export function sync(c: Conf, dir = Shared.dir()): string {
    const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    const head = () => git("-C", dir, "rev-parse", "--short=7", "HEAD").stdout.toString().trim();
    if (!fs.existsSync(dir + "/.git")) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      const tmp = fs.mkdtempSync(dir + ".clone-");
      const r = git("clone", "-q", "--filter=blob:none", "--single-branch", "--branch", c.ref, c.repo, tmp);
      if (r.exitCode !== 0) {
        fs.rmSync(tmp, { recursive: true, force: true });
        return "shared-skills: no checkout: can't clone " + c.repo + " " + c.ref + ": " + r.stderr.toString().trim();
      }
      fs.rmSync(dir, { recursive: true, force: true });
      fs.renameSync(tmp, dir);
      return "shared-skills: cloned " + c.ref + " at " + head();
    }
    const was = head();
    git("-C", dir, "remote", "set-url", "origin", c.repo);
    const f = git("-C", dir, "fetch", "-q", "origin", c.ref);
    if (f.exitCode !== 0) {
      return "shared-skills: kept " + was + ": can't fetch " + c.ref + ": " + f.stderr.toString().trim();
    }
    for (const a of [["checkout", "-q", "--detach", "--force", "FETCH_HEAD"], ["clean", "-qfdx"]]) {
      const r = git("-C", dir, ...a);
      if (r.exitCode !== 0) {
        return "shared-skills: at " + head() + ": git " + a[0] + " failed: " + r.stderr.toString().trim();
      }
    }
    const now = head();
    return "shared-skills: " + c.ref + " " + (was === now ? "at " + now : was + " -> " + now);
  }
}

if (import.meta.main) {
  console.log(Shared.sync(Shared.conf()));
}
