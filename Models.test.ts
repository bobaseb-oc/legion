// Models test
// ===========
// The model catalog (Models.ts): local/models.json, strongest first,
// overridden by config.json's `catalog` per vendor and label; a catalog
// that isn't one throws, never a model guessed

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { CATALOG, catalog_read } from "./Models.ts";
import { Pick } from "./Pick.ts";
import { Price } from "./Price.ts";

const BASE = JSON.parse(fs.readFileSync(import.meta.dir + "/local/models.json", "utf8"));
const RATE = { input: 1, write: 1, read: 1, output: 1 };

test("the checked-in catalog: Claude strongest first, each with a tier, id, speeds and prices", () => {
  const claude = CATALOG["claude-api"];
  expect(claude.map((m) => m.tier)).toEqual(["opus", "sonnet", "haiku"]);
  for (const m of [...claude, ...CATALOG["openai-api"]]) {
    expect(m.id).not.toBe("");
    expect(m.speeds.length).toBeGreaterThan(0);
    expect(Price.rate(m.id)).toEqual(m.rate);
  }
});

test("Pick and Price hold no model ids: they read the catalog", () => {
  for (const file of ["Pick.ts", "Price.ts"]) {
    expect(fs.readFileSync(import.meta.dir + "/" + file, "utf8")).not.toMatch(/claude-(opus|sonnet|haiku)-\d|gpt-6/);
  }
});

test("an override by label changes that entry; a new label is added last", () => {
  const sonnet = BASE["claude-api"].find((m: any) => m.tier === "sonnet");
  const out = catalog_read(BASE, { "claude-api": [{ label: sonnet.label, id: "claude-sonnet-9-9", rate: RATE }, { tier: "haiku", label: "haiku-9", id: "claude-haiku-9-9", speeds: ["slow"], rate: RATE }] });
  const got = out["claude-api"].find((m) => m.label === sonnet.label);
  expect(got?.id).toBe("claude-sonnet-9-9");
  expect(got?.rate).toEqual(RATE);
  expect(got?.speeds).toEqual(sonnet.speeds);
  expect(out["claude-api"].at(-1)?.id).toBe("claude-haiku-9-9");
  expect(catalog_read(BASE, undefined)).toEqual(catalog_read(BASE, {}));
});

test("a catalog that isn't one throws, naming what is wrong", () => {
  expect(() => catalog_read({ "claude-api": [{ label: "x", speeds: ["slow"], rate: RATE }], "openai-api": [] }, {})).toThrow(/catalog: claude-api x/);
  expect(() => catalog_read({ "claude-api": [{ label: "x", id: "y", speeds: [], rate: RATE }], "openai-api": [] }, {})).toThrow(/catalog: claude-api x/);
  expect(() => catalog_read({ "claude-api": [{ label: "x", id: "y", speeds: ["slow"], rate: { input: "1" } }], "openai-api": [] }, {})).toThrow(/catalog: claude-api x/);
  expect(() => catalog_read(BASE, { "claude-api": "not a list" })).toThrow(/catalog: claude-api/);
  expect(() => catalog_read(BASE, { "nope-api": [] })).toThrow(/catalog: nope-api/);
});

test("a tier names its vendor's model of that tier; a label stays itself; neither: undefined", () => {
  const sonnet = CATALOG["claude-api"].find((m) => m.tier === "sonnet")!;
  expect(Pick.tier("claude-api", "sonnet")).toBe(sonnet.label);
  expect(Pick.tier("claude-api", sonnet.label)).toBe(sonnet.label);
  expect(Pick.tier("claude-api", "gpt-9")).toBeUndefined();
});
