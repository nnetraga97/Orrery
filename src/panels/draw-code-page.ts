// The code page: a file's code, function by function, in a monospace font with syntax colours. Selected lines have a
// soft band behind them, hovered lines a fainter one. Every row is a hit region (line:<n>), so a pinch on a line can
// light up its building; the footer switches between the function and the whole file and pages up and down.
import type { CodeRow } from '../core/code-view.ts';
import type { HitRegion } from '../core/panel-hit.ts';
import { CODE_FONT } from './code-font.ts';
import { COLORS, UI_FONT, button, fit, panelBackground } from './paint.ts';

export const CODE_PAGE = { widthPx: 2048, heightPx: 1840, widthM: 0.86, heightM: 0.77 };
export const CODE_LAYOUT = {
  rows: 32,
  columns: 88,
  fontPx: 34,
  lineHeight: 50,
  header: 80,
  footer: 160,
  gutter: 150,
  pad: 40,
};

export const TOKEN_COLORS: Record<string, string> = {
  'tok-keyword': '#c792ea',
  'tok-string': '#c3e88d',
  'tok-number': '#f78c6c',
  'tok-comment': '#6f7fa3',
  'tok-type': '#ffcb6b',
  'tok-function': '#82aaff',
  'tok-property': '#89ddff',
  'tok-operator': '#89ddff',
  'tok-punctuation': '#a6accd',
};
const TEXT = '#d6deeb';

export interface CodePageMeta {
  file: string;
  functionName: string | null;
  mode: 'function' | 'file';
  /** First and last line shown, and the file's length, for the position note. */
  shown: { first: number; last: number; total: number };
  hovered: string | null;
}

export function drawCodePage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rows: CodeRow[],
  meta: CodePageMeta,
): HitRegion[] {
  const L = CODE_LAYOUT;
  panelBackground(ctx, w, h);
  const regions: HitRegion[] = [];
  // Header: file path and function name.
  ctx.textBaseline = 'middle';
  ctx.font = `600 34px ${UI_FONT}`;
  ctx.fillStyle = COLORS.dim;
  const path = fit(ctx, meta.file, w * 0.55);
  ctx.fillText(path, L.pad, L.header / 2 + 6);
  if (meta.functionName) {
    ctx.font = `700 36px ${CODE_FONT}`;
    ctx.fillStyle = COLORS.text;
    const x = L.pad + ctx.measureText(path).width + 60;
    ctx.fillText(fit(ctx, meta.functionName, w - x - L.pad), x, L.header / 2 + 6);
  }
  ctx.fillStyle = 'rgba(150, 175, 230, 0.2)';
  ctx.fillRect(L.pad, L.header, w - L.pad * 2, 2);
  // Rows.
  const top = L.header + 10,
    charW = (() => {
      ctx.font = `400 ${L.fontPx}px ${CODE_FONT}`;
      return ctx.measureText('M').width;
    })();
  rows.forEach((row, k) => {
    const y = top + k * L.lineHeight;
    if (row.highlight !== 'none') {
      ctx.fillStyle = row.highlight === 'selected' ? 'rgba(124, 196, 255, 0.22)' : 'rgba(124, 196, 255, 0.1)';
      ctx.fillRect(8, y, w - 16, L.lineHeight);
      if (row.highlight === 'selected') {
        ctx.fillStyle = '#7cc4ff';
        ctx.fillRect(8, y, 8, L.lineHeight);
      }
    }
    if (meta.hovered === `line:${row.number}`) {
      ctx.strokeStyle = 'rgba(124, 196, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, y + 1, w - 20, L.lineHeight - 2);
    }
    ctx.font = `400 ${L.fontPx}px ${CODE_FONT}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = row.highlight === 'selected' ? '#a9d6ff' : '#55617f';
    ctx.fillText(String(row.number), L.gutter - 24, y + L.lineHeight / 2 + 2);
    ctx.textAlign = 'left';
    let x = L.gutter;
    for (const s of row.segments) {
      ctx.fillStyle = (s.cls && TOKEN_COLORS[s.cls]) || TEXT;
      // One character at a time on the fixed grid: the font's ligatures (<= as one glyph) would misrepresent code.
      const text = s.text.replace(/\t/g, '  ');
      for (const ch of text) {
        if (ch !== ' ') ctx.fillText(ch, x, y + L.lineHeight / 2 + 2);
        x += charW;
      }
    }
    if (row.truncated) {
      ctx.fillStyle = COLORS.accent;
      ctx.fillText('…', x + 6, y + L.lineHeight / 2 + 2);
    }
    regions.push({ id: `line:${row.number}`, x: 0, y, w, h: L.lineHeight });
  });
  // Footer: position note and buttons.
  const fy = h - L.footer;
  ctx.fillStyle = 'rgba(150, 175, 230, 0.2)';
  ctx.fillRect(L.pad, fy, w - L.pad * 2, 2);
  ctx.font = `500 30px ${UI_FONT}`;
  ctx.fillStyle = COLORS.dim;
  ctx.textBaseline = 'middle';
  ctx.fillText(
    rows.length ? `Lines ${meta.shown.first}–${meta.shown.last} of ${meta.shown.total}` : 'No code to show',
    L.pad,
    fy + L.footer / 2,
  );
  const bh = 100,
    by = fy + (L.footer - bh) / 2,
    bw = 330,
    gap = 24;
  let bx = w - L.pad - bw * 3 - gap * 2;
  const opts = (id: string, primary = false) => ({ hovered: meta.hovered === id, primary, size: 36 });
  regions.push(button(ctx, 'mode', meta.mode === 'function' ? 'Whole file' : 'Function', bx, by, bw, bh, opts('mode', true)));
  bx += bw + gap;
  regions.push(button(ctx, 'pageUp', 'Page up', bx, by, bw, bh, opts('pageUp')));
  bx += bw + gap;
  regions.push(button(ctx, 'pageDown', 'Page down', bx, by, bw, bh, opts('pageDown')));
  ctx.textBaseline = 'alphabetic';
  return regions;
}
