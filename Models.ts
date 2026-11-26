// Models
// ======
// The model catalog: each vendor's models with tier, label (as shown and
// saved), id (as the vendor names it), speeds and list prices (USD per
// million tokens; `long` past a long prompt, Price.ts). Claude's are
// strongest first, as a tier runs its model or one below (Tools.child).
// From the checked-in local/models.json, so a model's release or
// retirement is a data change, not a code change; config.json's `catalog`
// key (or LEGION_CATALOG, JSON) changes an entry by vendor and label, or
// adds one. Read once, at import: a catalog that isn't one stops the
// process, never a model guessed. The web app is built from this module
// too (View.ts through Pick.ts): models.json is imported, so the bundle
// carries it, and a browser, with no files, takes no config.json catalog

import * as fs from "node:fs";
import * as os from "node:os";
import type { Vendor } from "./AskAI.ts";
import MODELS from "./local/models.json" with { type: "json" };

// Types
// =====

export type Rate = { input: number; write: number; read: number; output: number };

export type Entry = { tier?: string; label: string; id: string; speeds: string[]; rate: Rate; long?: Rate };

export type Catalog = Record<Vendor, Entry[]>;

// Constants
// =========

const VENDORS: Vendor[] = ["claude-api", "openai-api"];

const PARTS = ["input", "write", "read", "output"] as const;

// Models
// ======

// the base catalog with the override's entries merged in by label (a new
// label added last), each checked
export function catalog_read(base: unknown, over: unknown): Catalog {
  const out = Object.fromEntries(VENDORS.map((v) => [v, catalog_list(base, v)])) as Catalog;
  for (const [vendor, list] of Object.entries(catalog_object(over ?? {}, "override"))) {
    if (!VENDORS.includes(vendor as Vendor) || !Array.isArray(list)) {
      throw new Error("catalog: " + vendor + " is no vendor with a list of models");
    }
    const models = out[vendor as Vendor];
    for (const raw of list) {
      const at = models.findIndex((m) => m.label === raw?.label);
      const entry = catalog_entry(vendor, at < 0 ? raw : { ...models[at], ...raw });
      at < 0 ? models.push(entry) : (models[at] = entry);
    }
  }
  return out;
}

function catalog_list(base: unknown, vendor: Vendor): Entry[] {
  const list = catalog_object(base, "base")[vendor];
  if (!Array.isArray(list)) {
    throw new Error("catalog: " + vendor + " has no list of models");
  }
  return list.map((raw) => catalog_entry(vendor, raw));
}

function catalog_object(x: unknown, what: string): Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    throw new Error("catalog: the " + what + " is no object");
  }
  return x as Record<string, unknown>;
}

// one model, checked: a label, an id, speeds, prices; else it throws
function catalog_entry(vendor: string, raw: any): Entry {
  const name = "catalog: " + vendor + " " + String(raw?.label ?? "?");
  const text = (x: unknown) => typeof x === "string" && x !== "";
  if (!text(raw?.label) || !text(raw?.id) || (raw.tier !== undefined && !text(raw.tier))) {
    throw new Error(name + ": a model needs a label and an id (a tier, if any, is text)");
  }
  if (!Array.isArray(raw.speeds) || raw.speeds.length === 0 || !raw.speeds.every(text)) {
    throw new Error(name + ": speeds is no list of speeds");
  }
  const rate = (x: any): x is Rate => PARTS.every((p) => typeof x?.[p] === "number" && Number.isFinite(x[p]) && x[p] >= 0);
  if (!rate(raw.rate) || (raw.long !== undefined && !rate(raw.long))) {
    throw new Error(name + ": a rate is input, write, read and output, each a price");
  }
  return { ...(raw.tier === undefined ? {} : { tier: raw.tier }), label: raw.label, id: raw.id, speeds: [...raw.speeds], rate: { ...raw.rate }, ...(raw.long === undefined ? {} : { long: { ...raw.long } }) };
}

// config.json's catalog (Config.ts reads the same file): LEGION_CATALOG first;
// in a browser none
function catalog_over(): unknown {
  if (typeof window !== "undefined") {
    return undefined;
  }
  if (process.env.LEGION_CATALOG !== undefined) {
    return JSON.parse(process.env.LEGION_CATALOG);
  }
  const dir = (process.env.LEGION_DIR ?? "~/.legion").replace(/^~(?=\/)/, os.homedir());
  const file = dir + "/config.json";
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).catalog : undefined;
}

export const CATALOG: Catalog = catalog_read(MODELS, catalog_over());
