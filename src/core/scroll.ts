// Scrolling the code page: dragging moves the text with the hand; page buttons move a page less 3 lines of overlap.

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

/** Dragging down by dyPixels shows earlier lines. The result may be fractional, so slow drags accumulate. */
export function dragScroll(scrollTop: number, dyPixels: number, lineHeight: number, maxTop: number): number {
  return clamp(scrollTop - dyPixels / lineHeight, maxTop);
}

/** One page down (direction 1) or up (-1): rows - 3 lines. */
export function pageScroll(scrollTop: number, direction: 1 | -1, rows: number, maxTop: number): number {
  return clamp(Math.round(scrollTop) + direction * (rows - 3), maxTop);
}
