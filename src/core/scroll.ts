// Scrolling the code card: dragging moves the text with the hand.

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

/** Dragging down by dyPixels shows earlier lines. The result may be fractional, so slow drags accumulate. */
export function dragScroll(scrollTop: number, dyPixels: number, lineHeight: number, maxTop: number): number {
  return clamp(scrollTop - dyPixels / lineHeight, maxTop);
}
