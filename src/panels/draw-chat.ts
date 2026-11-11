// The chat window's transcript drawn from its layout (src/core/chat/layout.ts) in the look of docs/visual-style.md,
// "The chat window": user messages as right-aligned outlined bubbles, agent text as plain sentences, action groups and
// rows with an icon, verb, target and counts, plan cards, diffs, question and approval cards as small glass panels
// inside the window, the working line with the rotating ✳ in `work`. The transcript scrolls inside a clip rectangle;
// the regions it returns are in canvas pixels and only those in view.
import type { Box, ChatLayout, ChatMetrics, FontKey, Line, Measure, Tone } from '../core/chat/layout.ts';
import type { HitRegion } from '../core/panel-hit.ts';
import { FONTS } from '../core/theme.ts';
import { drawIcon } from './icons.ts';
import { THEME, band, button, font, glassPanel, glowStroke, stateOf } from './paint.ts';

/** Letter spacing for code text: any non-zero value disables ligatures. */
export const MONO_SPACING = '0.01px';

export const TONE: Record<Tone, string> = {
  text: THEME.white,
  dim: THEME.lineDim,
  line: THEME.line,
  added: THEME.ok,
  removed: THEME.alert,
  failed: THEME.alert,
  ok: THEME.ok,
  hunk: THEME.lineDim,
  work: THEME.work,
  amber: THEME.amber,
};

/** The CSS font for a layout font key at the metrics' sizes. */
export function cssFont(key: FontKey, m: ChatMetrics) {
  switch (key) {
    case 'bold':
      return font('body', m.body).replace(/^\d+/, '600');
    case 'mono':
      return font('mono', m.mono);
    case 'small':
      return font('body', m.small);
    case 'label':
      return font('label', m.label);
    default:
      return font('body', m.body);
  }
}

function setFont(ctx: CanvasRenderingContext2D, key: FontKey, m: ChatMetrics) {
  ctx.font = cssFont(key, m);
  // A hair of spacing on code turns off the monospace face's ligatures, so `>=` and `===` read as typed.
  ctx.letterSpacing = key === 'label' ? `${(m.label * FONTS.label.letterSpacingEm).toFixed(1)}px` : key === 'mono' ? MONO_SPACING : '0px';
}

/** Measures text the way drawTranscript draws it. */
export function canvasMeasure(ctx: CanvasRenderingContext2D, m: ChatMetrics): Measure {
  const cache = new Map<string, number>();
  return (text, key) => {
    const k = key + '\u0000' + text;
    let w = cache.get(k);
    if (w == null) {
      ctx.save();
      setFont(ctx, key, m);
      w = ctx.measureText(text).width;
      ctx.restore();
      cache.set(k, w);
    }
    return w;
  };
}

export type TranscriptState = {
  scrollTop: number;
  /** Seconds, for the working glyph and spinning plan rings. */
  clock: number;
  hovered: string | null;
  reduceMotion?: boolean;
};

function roundedOutline(x: number, y: number, w: number, h: number, r: number, squareTopRight = false) {
  const p = new Path2D();
  p.roundRect(x, y, w, h, squareTopRight ? [r, 0, r, r] : r);
  return p;
}

function drawBox(ctx: CanvasRenderingContext2D, box: Box, u: number, hovered: string | null) {
  switch (box.kind) {
    case 'bubble':
      glowStroke(ctx, roundedOutline(box.x, box.y, box.w, box.h, 14, true), THEME.line, 1.5, 0.5);
      break;
    case 'card':
      glassPanel(ctx, box.x, box.y, box.w, box.h, u * 0.7, { hue: box.tone === 'failed' ? THEME.alert : THEME.line });
      break;
    case 'code':
    case 'terminal':
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = THEME.night;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = THEME.grid;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x + 0.75, box.y + 0.75, box.w - 1.5, box.h - 1.5);
      ctx.restore();
      break;
    case 'band':
      band(ctx, box.x, box.y, box.w, box.h, u, TONE[box.tone ?? 'line']);
      break;
    case 'errorBar':
      band(ctx, box.x, box.y, box.w, box.h, u, THEME.alert, 0.14);
      break;
    case 'field': {
      const tone = box.tone === 'failed' ? THEME.alert : box.tone === 'line' ? THEME.line : THEME.lineDim;
      glowStroke(ctx, roundedOutline(box.x, box.y, box.w, box.h, Math.min(box.h / 2, 34)), tone, 1.5, box.tone ? 1 : 0.5);
      break;
    }
    case 'mic': {
      const lit = box.tone === 'line' || hovered === box.id,
        r = box.w / 2,
        ring = new Path2D();
      ring.arc(box.x + r, box.y + r, r - 1, 0, Math.PI * 2);
      if (lit) {
        ctx.save();
        ctx.globalAlpha = box.tone === 'line' ? 0.42 : 0.2;
        ctx.fillStyle = THEME.glow;
        ctx.fill(ring);
        ctx.restore();
      }
      glowStroke(ctx, ring, box.tone === 'amber' ? THEME.amber : lit ? THEME.line : THEME.lineDim, 2, lit ? 1.4 : 0.6);
      break;
    }
    case 'chip':
    case 'option': {
      const lit = (!!box.id && hovered === box.id) || box.tone === 'line';
      const path = roundedOutline(box.x, box.y, box.w, box.h, box.kind === 'chip' ? box.h / 2 : 10);
      if (lit) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = THEME.glow;
        ctx.fill(path);
        ctx.restore();
      }
      glowStroke(ctx, path, lit ? THEME.line : THEME.lineDim, 1.5, lit ? 1.2 : 0.4);
      break;
    }
  }
}

function drawLine(ctx: CanvasRenderingContext2D, line: Line, m: ChatMetrics, u: number, state: TranscriptState) {
  const mid = line.y + line.height / 2;
  if (line.icon) {
    if (line.icon.name === 'working') {
      // The rotating working glyph, one turn every 2.2 s.
      ctx.save();
      ctx.translate(line.icon.x + m.icon / 2, mid);
      if (!state.reduceMotion) ctx.rotate(((state.clock % 2.2) / 2.2) * Math.PI * 2);
      ctx.font = font('body', m.icon * 1.2);
      ctx.fillStyle = THEME.work;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✳', 0, 0);
      ctx.restore();
    } else drawIcon(ctx, line.icon.name, line.icon.x, mid, m.icon, TONE[line.icon.tone]);
  }
  if (line.marker) {
    const { x, status } = line.marker,
      r = m.icon * 0.36,
      cx = x + m.icon / 2;
    if (status === 'completed') drawIcon(ctx, 'check', x, mid, m.icon, THEME.ok);
    else {
      const ring = new Path2D();
      ring.arc(cx, mid, r, 0, Math.PI * 2);
      glowStroke(ctx, ring, THEME.lineDim, 1.5, 0.4);
      if (status === 'inProgress') {
        const arc = new Path2D(),
          a = state.reduceMotion ? 0 : state.clock * Math.PI * 2;
        arc.arc(cx, mid, r, a, a + Math.PI * 0.6);
        glowStroke(ctx, arc, THEME.line, 2, 1);
      }
    }
  }
  if (line.choice) {
    const { x, chosen } = line.choice,
      r = m.icon * 0.38,
      cx = x + m.icon / 2,
      ring = new Path2D();
    ring.arc(cx, mid, r, 0, Math.PI * 2);
    glowStroke(ctx, ring, chosen ? THEME.line : THEME.lineDim, 1.5, chosen ? 1 : 0.4);
    if (chosen) {
      ctx.save();
      ctx.fillStyle = THEME.line;
      ctx.beginPath();
      ctx.arc(cx, mid, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  if (line.chevron) drawIcon(ctx, 'chevron', line.chevron.x, mid, m.icon * 0.8, THEME.lineDim, { rotate: line.chevron.open ? Math.PI / 2 : 0 });
  for (const s of line.spans) {
    ctx.save();
    setFont(ctx, s.font, m);
    ctx.fillStyle = TONE[s.tone];
    ctx.textBaseline = 'middle';
    // Live verbs are lit; finished ones are plain.
    if (line.live && s === line.spans[0]) ctx.fillStyle = THEME.line;
    ctx.fillText(s.text, s.x, mid + 1);
    ctx.restore();
  }
  for (const b of line.buttons ?? []) {
    const hue = b.tone === 'ok' ? THEME.ok : b.tone === 'alert' ? THEME.alert : THEME.line;
    button(ctx, b.id, b.label, b.x, line.y + 4, b.w, line.height - 8, u, {
      state: stateOf(state.hovered, b.id, b.disabled),
      hue,
      px: m.label / u,
    });
  }
}

/**
 * Draws the visible part of a transcript in the rectangle (x, y, w, h) of the canvas, scrolled by state.scrollTop.
 * The layout's coordinates start at its own top left; returns the regions in view, in canvas pixels.
 */
export function drawTranscript(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  layout: ChatLayout,
  m: ChatMetrics,
  u: number,
  state: TranscriptState,
): HitRegion[] {
  const top = state.scrollTop,
    bottom = top + h,
    inView = (ly: number, lh: number) => ly + lh > top && ly < bottom;
  ctx.save();
  ctx.beginPath();
  // Nothing is drawn past the transcript's right margin (long code and diff lines are clipped there).
  ctx.rect(x, y, w - m.pad + 6, h);
  ctx.clip();
  ctx.translate(x, y - top);
  for (const box of layout.boxes) if (inView(box.y, box.h)) drawBox(ctx, box, u, state.hovered);
  for (const line of layout.lines) if (inView(line.y, line.height)) drawLine(ctx, line, m, u, state);
  ctx.restore();
  // A thin scroll mark when the transcript is taller than its view.
  if (layout.height > h) {
    const frac = h / layout.height,
      markH = Math.max(40, h * frac),
      markY = y + (top / (layout.height - h)) * (h - markH);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = THEME.lineDim;
    ctx.fillRect(x + w - 4, markY, 3, markH);
    ctx.restore();
  }
  const regions: HitRegion[] = [];
  for (const r of layout.regions) {
    const ry = r.y - top;
    const y0 = Math.max(ry, 0),
      y1 = Math.min(ry + r.h, h);
    if (y1 > y0) regions.push({ id: r.id, x: x + r.x, y: y + y0, w: r.w, h: y1 - y0 });
  }
  return regions;
}

/** True while anything in the layout moves (a live row, the working glyph, a spinning plan ring). */
export const isAnimated = (layout: ChatLayout) =>
  layout.lines.some(l => l.live || l.icon?.name === 'working' || l.marker?.status === 'inProgress');

/** The transcript's rectangle in the chat window: below the title bar, above the composer. */
export function chatView(w: number, h: number, u: number, composerHeight = 0) {
  const y = Math.round(46 * u);
  return { x: 0, y, w, h: h - y - composerHeight };
}

/** The chat window's body: the transcript (or the chat list) scrolling above, the composer against the bottom edge. */
export function drawChatWindow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  body: ChatLayout,
  composer: ChatLayout,
  m: ChatMetrics,
  state: TranscriptState,
): HitRegion[] {
  const view = chatView(w, h, u, composer.height);
  const regions = drawTranscript(ctx, view.x, view.y, view.w, view.h, body, m, u, state);
  ctx.save();
  ctx.fillStyle = THEME.grid;
  ctx.fillRect(m.pad / 2, view.y + view.h, w - m.pad, Math.max(1, u * 0.5));
  ctx.restore();
  regions.push(...drawTranscript(ctx, 0, view.y + view.h, w, composer.height, composer, m, u, { ...state, scrollTop: 0 }));
  return regions;
}
