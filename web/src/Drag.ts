// Drag
// ====
// A selection dragged in the chat. The header and the footer stick over
// the page's top and bottom, where a browser scrolls a drag itself, so
// the chat's own edges get a band that scrolls it (main.ts); and the
// chat's rows wait to be drawn anew while a selection is in them, as a
// row drawn anew drops what of it was selected.

// the band at the chat's edges where a drag scrolls, in px; the most a
// frame scrolls
export const BAND = 40;
export const MOST = 60;

// how far a frame scrolls, the pointer at y and the chat seen from top
// to bottom: up (< 0) or down, the faster the nearer the edge or the
// further past it; out of the bands, 0
export function drag_step(y: number, top: number, bottom: number): number {
  const up = top + BAND - y;
  const down = y - (bottom - BAND);
  const deep = Math.max(up, down);
  if (deep <= 0) {
    return 0;
  }
  const px = Math.min(MOST, Math.ceil(deep / 4));
  return up > down ? -px : px;
}

// whether the chat's draw waits: down, a press in it held; collapsed,
// the selection a caret; inside, the selection in the chat
export function drag_held(down: boolean, collapsed: boolean, inside: boolean): boolean {
  return down || (inside && !collapsed);
}
