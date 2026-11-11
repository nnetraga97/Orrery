// Shared drawing for canvas panels, in the look of docs/visual-style.md ("light on glass"): glowing strokes, glass
// panels with corner brackets, micro labels, buttons, chips and bands. Adapted from docs/style/mock.html. Every size is
// in "style pixels" (the reference sheet's units) times `u`, the canvas pixels per style pixel of the panel drawn.
import type { HitRegion } from '../core/panel-hit.ts';
import { FONTS, THEME, font } from '../core/theme.ts';

export { THEME, font };

/** Light, not paint: a stroke drawn twice, a wide faint pass then a thin bright one, with additive blending. */
export function glowStroke(ctx: CanvasRenderingContext2D, path: Path2D, color: string, width: number, strength = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.globalAlpha = Math.min(1, 0.18 * strength);
  ctx.lineWidth = width * 6;
  ctx.stroke(path);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/** Small capitals with wide spacing, for every title, label and button. */
export function microLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  color: string = THEME.line,
  align: CanvasTextAlign = 'left',
) {
  ctx.save();
  ctx.font = font('label', px);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = `${(px * FONTS.label.letterSpacingEm).toFixed(1)}px`;
  ctx.fillText(text.toUpperCase(), x, y);
  ctx.restore();
}

/** A micro label's text shortened with an ellipsis to fit maxWidth. */
export function fitMicroLabel(ctx: CanvasRenderingContext2D, text: string, px: number, maxWidth: number): string {
  if (microLabelWidth(ctx, text, px) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && microLabelWidth(ctx, t + '…', px) > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** The width of a micro label. */
export function microLabelWidth(ctx: CanvasRenderingContext2D, text: string, px: number) {
  ctx.save();
  ctx.font = font('label', px);
  ctx.letterSpacing = `${(px * FONTS.label.letterSpacingEm).toFixed(1)}px`;
  const w = ctx.measureText(text.toUpperCase()).width;
  ctx.restore();
  return w;
}

/** A glass panel: a dark backing dense enough to read on, a hairline frame and four glowing corner brackets. */
export function glassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  u: number,
  {
    title,
    hue = THEME.line,
    titlePx = 14,
    titleRoom = w - 28 * u,
  }: { title?: string; hue?: string; titlePx?: number; titleRoom?: number } = {},
) {
  ctx.save();
  ctx.globalAlpha = THEME.inkAlpha;
  ctx.fillStyle = THEME.ink;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = hue === THEME.line ? THEME.lineDim : hue;
  ctx.lineWidth = Math.max(1, u);
  ctx.strokeRect(x + 0.5 * u, y + 0.5 * u, w - u, h - u);
  ctx.globalAlpha = 1;
  const k = 14 * u,
    i = u,
    corners = new Path2D();
  for (const [cx, cy, sx, sy] of [
    [x + i, y + i, 1, 1],
    [x + w - i, y + i, -1, 1],
    [x + i, y + h - i, 1, -1],
    [x + w - i, y + h - i, -1, -1],
  ]) {
    corners.moveTo(cx + sx * k, cy);
    corners.lineTo(cx, cy);
    corners.lineTo(cx, cy + sy * k);
  }
  glowStroke(ctx, corners, hue, 2 * u);
  ctx.restore();
  if (title) microLabel(ctx, fitMicroLabel(ctx, title, titlePx * u, titleRoom), x + 14 * u, y + 24 * u, titlePx * u, hue);
}

/** The close mark at a window's top right; returns its region. */
export function closeMark(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, u: number, hovered = false): HitRegion {
  const path = new Path2D(),
    cx = x + w - 19 * u,
    cy = y + 18 * u,
    r = 5 * u;
  path.moveTo(cx - r, cy - r);
  path.lineTo(cx + r, cy + r);
  path.moveTo(cx + r, cy - r);
  path.lineTo(cx - r, cy + r);
  glowStroke(ctx, path, hovered ? THEME.line : THEME.lineDim, 1.5 * u, hovered ? 1.4 : 0.6);
  // A generous target: 36 style pixels square.
  return { id: 'close', x: cx - 18 * u, y: cy - 18 * u, w: 36 * u, h: 36 * u };
}

/** The short grab bar centred under a window. */
export function grabBar(ctx: CanvasRenderingContext2D, cx: number, y: number, u: number, active = false) {
  ctx.save();
  const bar = new Path2D();
  bar.roundRect(cx - 34 * u, y, 68 * u, 7 * u, 3.5 * u);
  ctx.globalAlpha = active ? 0.95 : 0.55;
  ctx.fillStyle = active ? THEME.white : THEME.line;
  ctx.fill(bar);
  ctx.restore();
}

export type ButtonState = 'idle' | 'hover' | 'pressed' | 'disabled';

/** A button: an outline until pointed at, then it fills with light. Returns its region (none when disabled). */
export function button(
  ctx: CanvasRenderingContext2D,
  id: string,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  u: number,
  { state = 'idle', hue = THEME.line, px = 14 }: { state?: ButtonState; hue?: string; px?: number } = {},
): HitRegion | null {
  ctx.save();
  const path = new Path2D();
  path.rect(x + 0.5 * u, y + 0.5 * u, w - u, h - u);
  if (state === 'hover' || state === 'pressed') {
    ctx.globalAlpha = state === 'pressed' ? 0.42 : 0.2;
    ctx.fillStyle = hue === THEME.line ? THEME.glow : hue;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }
  const lit = state === 'hover' || state === 'pressed';
  const idleHue = hue === THEME.line ? THEME.lineDim : hue;
  if (state === 'disabled') ctx.globalAlpha = 0.4;
  glowStroke(ctx, path, lit ? hue : idleHue, 1.5 * u, lit ? 1.4 : 0.4);
  const label = fitMicroLabel(ctx, text, px * u, w - 12 * u);
  microLabel(ctx, label, x + w / 2, y + h / 2 + px * 0.36 * u, px * u, lit ? THEME.white : hue, 'center');
  ctx.restore();
  return state === 'disabled' ? null : { id, x, y, w, h };
}

/** A band: a full-width strip at 17% with a 3-pixel solid edge on the left. */
export function band(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, u: number, color: string, alpha = 0.17) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillRect(x, y, 3 * u, h);
  ctx.restore();
}

/** A thin divider in the grid colour. */
export function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, u: number) {
  ctx.save();
  ctx.fillStyle = THEME.grid;
  ctx.fillRect(x, y, w, Math.max(1, u));
  ctx.restore();
}

/** Splits a word wider than maxWidth into pieces that fit. */
function breakWord(ctx: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const ch of word) {
    if (piece && ctx.measureText(piece + ch).width > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else piece += ch;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Splits text into lines no wider than maxWidth with the context's current font; a word too long for a line is
 * broken across lines. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    const words = paragraph
      .split(/\s+/)
      .filter(Boolean)
      .flatMap(word => (ctx.measureText(word).width > maxWidth ? breakWord(ctx, word, maxWidth) : [word]));
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Shortens text with an ellipsis to fit maxWidth. */
export function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** The state of a button from the panel's hovered region. */
export const stateOf = (hovered: string | null, id: string, disabled = false): ButtonState =>
  disabled ? 'disabled' : hovered === id ? 'hover' : 'idle';
