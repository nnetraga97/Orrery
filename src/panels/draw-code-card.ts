// The code card (docs/visual-style.md): a function's code in the bundled monospace font, about 12 lines, with line
// numbers and token colours (keywords `line`, identifiers `white`, literals `ok`, comments `lineDim`). Selected lines
// carry a `glow` band with a solid left edge, hovered lines a fainter one. Every row is a hit region (line:<n>), so a
// pinch on a line can select its statement on the globe. The footer has `More`, which lengthens the card to 24 lines.
// The window frame, its title ("file · function"), the close mark and the grab bar come from CanvasPanel.
import type { CodeRow } from '../core/code-view.ts';
import type { HitRegion } from '../core/panel-hit.ts';
import { codeColor } from '../core/theme.ts';
import { THEME, band, button, fit, font, microLabel, rule, stateOf } from './paint.ts';

export const CODE_CARD = { widthPx: 1380, heightPx: 1020, widthM: 0.46, heightM: 0.34 };
export const CODE_LAYOUT = {
  rows: 12,
  moreRows: 24,
  columns: 56,
  fontPx: 26,
  header: 120,
  footer: 150,
  gutter: 120,
  pad: 30,
  /** Exact (62.5 px), so 12 rows fill the card and More, then Less, restores its size. */
  get lineHeight() {
    return (CODE_CARD.heightPx - this.header - this.footer) / this.rows;
  },
};

/** The card's glass height for a number of code rows (and replay lines above them), in pixels and metres. */
export function codeCardSize(rows: number, replayLines = 0) {
  const heightPx = Math.round(CODE_LAYOUT.header + CODE_LAYOUT.footer + (rows + replayLines) * CODE_LAYOUT.lineHeight);
  return { heightPx, heightM: (heightPx / CODE_CARD.heightPx) * CODE_CARD.heightM };
}

export interface CodeCardMeta {
  /** First and last line shown, and the file's length, for the position note. */
  shown: { first: number; last: number; total: number };
  /** Whether the card shows 24 rows. */
  more: boolean;
  hovered: string | null;
  /** During a replay: the step's note, up to four values, the position ("3 / 7") and whether it plays. */
  replay?: { note: string | null; variables: { name: string; value: string }[]; position: string; playing: boolean; failed: boolean } | null;
}

/** Lines a replay adds above the code: its note, then up to four `name = value` lines. */
export const replayLines = (r: CodeCardMeta['replay']) => (r ? (r.note ? 1 : 0) + Math.min(4, r.variables.length) : 0);

export function drawCodeCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  rows: CodeRow[],
  meta: CodeCardMeta,
): HitRegion[] {
  const L = CODE_LAYOUT,
    lineHeight = L.lineHeight;
  const regions: HitRegion[] = [];
  rule(ctx, 1, L.header - 18, w - 2, u);
  let top = L.header;
  // A replay's note and values sit under the header and push the code down.
  if (meta.replay) {
    const r = meta.replay;
    ctx.save();
    if (r.note) {
      ctx.font = font('body', L.fontPx);
      ctx.fillStyle = r.failed ? THEME.alert : THEME.line;
      ctx.fillText(fit(ctx, r.note, w - L.pad * 2), L.pad, top + lineHeight / 2 + L.fontPx * 0.36);
      top += lineHeight;
    }
    ctx.font = font('mono', L.fontPx * 0.92);
    ctx.letterSpacing = '0.01px';
    for (const v of r.variables.slice(0, 4)) {
      ctx.fillStyle = THEME.lineDim;
      const name = `${v.name} = `;
      ctx.fillText(name, L.gutter, top + lineHeight / 2 + L.fontPx * 0.36);
      ctx.fillStyle = THEME.ok;
      ctx.fillText(fit(ctx, v.value, w - L.gutter - L.pad - ctx.measureText(name).width), L.gutter + ctx.measureText(name).width, top + lineHeight / 2 + L.fontPx * 0.36);
      top += lineHeight;
    }
    ctx.restore();
    rule(ctx, 1, top - 2, w - 2, u);
  }
  ctx.font = font('mono', L.fontPx);
  const charW = ctx.measureText('M').width;
  const baseline = (y: number) => y + lineHeight / 2 + L.fontPx * 0.36;
  rows.forEach((row, k) => {
    const y = top + k * lineHeight;
    if (row.highlight === 'selected') band(ctx, 1, y, w - 2, lineHeight, u, THEME.glow);
    else if (row.highlight === 'hovered' || meta.hovered === `line:${row.number}`)
      band(ctx, 1, y, w - 2, lineHeight, 0, THEME.glow, 0.08);
    ctx.font = font('mono', L.fontPx);
    ctx.textAlign = 'right';
    ctx.fillStyle = row.highlight === 'selected' ? THEME.line : THEME.lineDim;
    ctx.fillText(String(row.number), L.gutter - 24, baseline(y));
    ctx.textAlign = 'left';
    let x = L.gutter;
    for (const s of row.segments) {
      ctx.fillStyle = codeColor(s.cls);
      // One character at a time on the fixed grid: the font's ligatures (<= as one glyph) would misrepresent code.
      // Tabs were expanded by visibleLines.
      for (const ch of s.text) {
        if (ch !== ' ') ctx.fillText(ch, x, baseline(y));
        x += charW;
      }
    }
    if (row.truncated) {
      ctx.fillStyle = THEME.line;
      ctx.fillText('…', x + 6, baseline(y));
    }
    regions.push({ id: `line:${row.number}`, x: 0, y, w, h: lineHeight });
  });
  // Footer: the position note and More.
  const fy = h - L.footer;
  rule(ctx, 1, fy, w - 2, u);
  const bh = 32 * u,
    by = fy + (L.footer - bh) / 2,
    bw = 84 * u;
  if (meta.replay) {
    // During a replay: Back, Step, Play and the position, in place of the lines note.
    const sw = 70 * u;
    let x = L.pad;
    for (const [id, label] of [
      ['replay:back', 'Back'],
      ['replay:step', 'Step'],
      ['replay:play', meta.replay.playing ? 'Pause' : 'Play'],
    ] as const) {
      const r = button(ctx, id, label, x, by, sw, bh, u, { state: stateOf(meta.hovered, id) });
      if (r) regions.push(r);
      x += sw + 10 * u;
    }
    microLabel(ctx, meta.replay.position, x + 8 * u, by + bh / 2 + 5 * u, 13 * u, THEME.white);
  } else
    microLabel(
      ctx,
      rows.length ? `Lines ${meta.shown.first}–${meta.shown.last} of ${meta.shown.total}` : 'No code to show',
      L.pad,
      by + bh / 2 + 5 * u,
      12 * u,
      THEME.lineDim,
    );
  const more = button(ctx, 'more', meta.more ? 'Less' : 'More', w - L.pad - bw, by, bw, bh, u, {
    state: stateOf(meta.hovered, 'more'),
  });
  if (more) regions.push(more);
  return regions;
}
