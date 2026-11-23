// Drag test
// =========
// `bun run test Drag.test.ts`. A selection dragged in the chat
// (web/src/Drag.ts): how far a frame scrolls, the pointer near or past
// the chat's top or bottom; when the chat's draw waits for a selection.

import { expect, test } from "bun:test";
import * as Drag from "./web/src/Drag.ts";

// the chat seen from 57 (under the header) to 700 (over the footer)
const TOP = 57;
const BOTTOM = 700;
const step = (y: number) => Drag.drag_step(y, TOP, BOTTOM);

test("out of the edges' bands, a drag scrolls nothing", () => {
  expect(step(400)).toBe(0);
  expect(step(TOP + Drag.BAND)).toBe(0);
  expect(step(BOTTOM - Drag.BAND)).toBe(0);
});

test("in the top band it scrolls up, in the bottom one down", () => {
  expect(step(TOP + Drag.BAND - 1)).toBeLessThan(0);
  expect(step(BOTTOM - Drag.BAND + 1)).toBeGreaterThan(0);
});

test("faster nearer the edge, faster still past it, up to the most", () => {
  const down = [BOTTOM - 30, BOTTOM - 10, BOTTOM, BOTTOM + 40].map(step);
  for (let k = 1; k < down.length; k++) {
    expect(down[k]).toBeGreaterThan(down[k - 1]);
  }
  const up = [TOP + 30, TOP + 10, TOP, TOP - 40].map(step);
  for (let k = 1; k < up.length; k++) {
    expect(up[k]).toBeLessThan(up[k - 1]);
  }
  expect(step(BOTTOM + 5000)).toBe(Drag.MOST);
  expect(step(TOP - 5000)).toBe(-Drag.MOST);
});

test("the chat's draw waits while a press in it is held, or a selection in it shows", () => {
  expect(Drag.drag_held(false, true, false)).toBe(false);
  expect(Drag.drag_held(false, true, true)).toBe(false);
  expect(Drag.drag_held(false, false, false)).toBe(false);
  expect(Drag.drag_held(false, false, true)).toBe(true);
  expect(Drag.drag_held(true, true, false)).toBe(true);
});
