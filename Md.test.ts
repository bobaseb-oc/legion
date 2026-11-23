// Md test
// =======
// `bun test Md.test.ts`. How the little markdown of a message reads.

import { expect, test } from "bun:test";
import * as Md from "./Md.ts";

const kinds = (src: string) => Md.md_parse(src).map((b) => (b.$ === "List" ? "List:" + (b.k ? "1." : "-") + b.x.length : b.$));

// a list is of one kind: numbered items after bullets start a list of
// their own, and bullets after numbered ones
test("a list holds items of one kind", () => {
  expect(kinds("- a\n  more\n- b\n1. c\n2. d\n- e")).toEqual(["List:-2", "List:1.2", "List:-1"]);
});

// a rule ends the paragraph above it, as a heading or a list does
test("a rule right under a paragraph is a rule", () => {
  expect(kinds("para\n---\nnext")).toEqual(["Para", "Rule", "Para"]);
  expect(kinds("a\n|x|y|\n|-|-|\n|1|2|")).toEqual(["Para", "Tabl"]);
  expect(kinds("a\n| not a table |\nb")).toEqual(["Para"]);
});

// a link goes to a page of this site (/x) or an http(s) one, never one
// that only looks like a path: /\host is another site to a browser
test("a link to /\\host or //host is text, not a link", () => {
  const links = (s: string) => Md.span_parse(s).filter((x: any) => x.$ === "Link").length;
  expect(links("[ok](/inbox)")).toBe(1);
  expect(links("[ok](https://a.b/c)")).toBe(1);
  expect(links("[x](//evil.com/login)")).toBe(0);
  expect(links("[x](/\\evil.com/login)")).toBe(0);
  expect(links("[x](/a\\b)")).toBe(0);
});

// a list's text to copy (PLP-2918): a line per item, its marker first, a
// link as its full URL ("label (URL)" if the label is not the URL), the
// item's other text kept, its marks dropped
test("md_list_text: a line per item, each link its full URL", () => {
  const list = (src: string) => Md.md_parse(src)[0] as Extract<Md.Block, { $: "List" }>;
  const nudges = list("- https://github.com/a/b/pull/1 - Fix **auth** - ask @ana - `ci` red\n- [PR 2](https://github.com/a/b/pull/2) - Docs");
  expect(Md.md_list_text(nudges)).toBe("- https://github.com/a/b/pull/1 - Fix auth - ask @ana - ci red\n- PR 2 (https://github.com/a/b/pull/2) - Docs");
  expect(Md.md_list_text(list("1. [x](/inbox)\n2. y"))).toBe("1. x (/inbox)\n2. y");
  expect(Md.md_list_links(nudges)).toBe(true);
  expect(Md.md_list_links(list("- a\n- **b**"))).toBe(false);
});
