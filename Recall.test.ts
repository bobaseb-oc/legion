// Recall test
// ===========
// `bun test Recall.test.ts`. The Memory page (web/src/Pages.ts
// memory_html) and the acts behind it (View.ts): the tree's map, opened a
// line at a time by the server's zoom, its messages a jump to the chat;
// the search box and its hits; the pins, and the pin on a chat message.
// Every text escaped.

import { expect, test } from "bun:test";
import * as View from "./View.ts";
import * as Html from "./web/src/Html.ts";
import * as Pages from "./web/src/Pages.ts";

const act = (a: object) => JSON.stringify(a).replace(/"/g, "&quot;");
const DATE = "2026-11-13T10:20:00.000Z";

test("the Memory page is a cockpit page, in the sidebar", () => {
  expect(View.PAGES).toContain("memory");
  expect(View.view_route("#memory").mode).toBe("memory");
  expect(Pages.side_html(View.view_new(), "memory", 0).join("")).toContain('<a href="#memory" class="here">Memory');
});

test("the map: the tree's roots asked; a line opens into its two by the server's zoom, folds again; a message's line only jumps", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Roots" })).toEqual([{ $: "root" }]);
  View.view_hear(v, { $: "root", parts: [[0, 4], [4, 1]] });
  expect(v.roots).toEqual([[0, 4], [4, 1]]);
  expect(v.fold).toBeNull(); // the chat's own fold untouched
  View.view_hear(v, { $: "know", nodes: { "0+4": { text: "top <script>x</script>", to: DATE } }, whole: { 4: { kind: "user", text: "last <b>one</b>", date: DATE } } });
  let html = Pages.memory_html(v).join("");
  expect(html).toContain(act({ $: "Map", id: 0, n: 4 }));
  expect(html).toContain("top &lt;script&gt;x&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("last &lt;b&gt;one&lt;/b&gt;");
  expect(html).toContain(act({ $: "Seek", id: 4 }));
  expect(html).not.toContain(act({ $: "Map", id: 0, n: 2 })); // folded

  expect(View.view_act(v, { $: "Map", id: 0, n: 4 })).toEqual([{ $: "zoom", part: [0, 4] }]);
  View.view_hear(v, { $: "know", nodes: { "0+2": { text: "left half", to: DATE }, "2+2": { text: "right half", to: DATE } } });
  html = Pages.memory_html(v).join("");
  expect(html).toContain("left half");
  expect(html).toContain(act({ $: "Map", id: 2, n: 2 }));
  View.view_act(v, { $: "Map", id: 2, n: 2 });
  html = Pages.memory_html(v).join("");
  expect(html).toContain(act({ $: "Seek", id: 2 }));
  expect(html).toContain(act({ $: "Seek", id: 3 }));
  // folded again: no zoom asked, its lines gone
  expect(View.view_act(v, { $: "Map", id: 0, n: 4 })).toEqual([]);
  expect(Pages.memory_html(v).join("")).not.toContain("left half");
  // a message's line is no zoom; a bad part asks nothing
  expect(View.view_act(v, { $: "Map", id: 4, n: 1 })).toEqual([]);
  expect(View.view_act(v, { $: "Map", id: 1, n: 3 })).toEqual([]);
  expect(View.view_act(v, { $: "Map", id: -2, n: 2 })).toEqual([]);
});

test("a jump to a message opens the chat's blocks over it, down to it, and marks it to scroll to", () => {
  const v = View.view_new();
  View.view_hear(v, { $: "view", parts: [[0, 8], [8, 1], [9, 1]], turn: 9 });
  v.fold = [];
  expect(View.view_act(v, { $: "Seek", id: 5 })).toEqual([{ $: "zoom", part: [0, 8] }, { $: "zoom", part: [4, 4] }, { $: "zoom", part: [4, 2] }]);
  expect([...v.open.entries()].filter(([, on]) => on).map(([k]) => k)).toEqual(["0+8", "4+4", "4+2", "5+1"]);
  expect(v.seek).toBe(5);
  expect(v.fold).toBeNull();
  // past the turn: shown whole, nothing to open
  expect(View.view_act(v, { $: "Seek", id: 9 })).toEqual([]);
  expect(v.seek).toBe(9);
  // no such message
  expect(View.view_act(v, { $: "Seek", id: 40 })).toEqual([]);
  expect(v.seek).toBe(9);
});

test("search: the query trimmed and capped, asked of the server; its hits drawn escaped, the match marked, each a jump", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Search", q: "  " })).toEqual([]);
  expect(v.recall).toBeNull();
  expect(View.view_act(v, { $: "Search", q: " Needle " + "x".repeat(300) })).toEqual([{ $: "search", q: ("Needle " + "x".repeat(300)).slice(0, View.FIND) }]);
  expect(Pages.memory_html(v).join("")).toContain("Searching");
  View.view_act(v, { $: "Search", q: "needle" });
  View.view_hear(v, { $: "recalled", q: "other", hits: [{ i: 1, kind: "user", date: DATE, text: "stale" }], more: false });
  expect(v.recall?.hits).toBeNull(); // an older search's answer
  View.view_hear(v, { $: "recalled", q: "needle", hits: [{ i: 7, kind: "unii", date: DATE, text: "…a <img src=x onerror=alert(1)> NEEDLE & more…" }], more: true });
  const html = Pages.memory_html(v).join("");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; <mark>NEEDLE</mark> &amp; more");
  expect(html).not.toContain("<img");
  expect(html).toContain(act({ $: "Seek", id: 7 }));
  expect(html).toContain("#7");
  expect(html).toContain("2026-11-13 10:20");
  expect(html).toMatch(/newest 50 shown/);
  expect(html).toContain('value="needle"');
  View.view_hear(v, { $: "recalled", q: "needle", hits: [], more: false });
  expect(Pages.memory_html(v).join("")).toContain("No message has");
});

test("pins: a chat message's pin toggles by the state's pins; the page lists them escaped, each a jump and an unpin", () => {
  const v = View.view_new();
  expect(View.view_act(v, { $: "Pin", i: 3 })).toEqual([{ $: "pin", i: 3, on: true }]);
  View.view_hear(v, { $: "state", ...v, pins: [{ i: 3, kind: "user", date: DATE, text: "keep <this>", size: 20 }] });
  expect(View.view_act(v, { $: "Pin", i: 3 })).toEqual([{ $: "pin", i: 3, on: false }]);
  const html = Pages.memory_html(v).join("");
  expect(html).toContain("keep &lt;this&gt;");
  expect(html).toContain(act({ $: "Seek", id: 3 }));
  expect(html).toContain(act({ $: "Pin", i: 3 }));
  expect(html).toContain("1 of " + View.PINS);
  expect(Pages.memory_html(View.view_new()).join("")).toContain("Nothing pinned");
  // a chat message has a pin; an agent's page's (no id) has none
  expect(Html.row_html({ $: "Msg", id: 3, kind: "user", who: "", text: "hi", body: [], call: null, images: [] })).toContain(act({ $: "Pin", i: 3 }));
  expect(Html.row_html({ $: "Msg", id: null, kind: "user", who: "", text: "hi", body: [], call: null, images: [] })).not.toContain("Pin");
});
