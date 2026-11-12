// The code card (docs/visual-style.md): a function's code in the bundled monospace font, about 12 lines, with line
// numbers and token colours (keywords `line`, identifiers `white`, literals `ok`, comments `lineDim`). Selected lines
// carry a `glow` band with a solid left edge, hovered lines a fainter one. Every row is a hit region (line:<n>), so a
// pinch on a line can select its statement on the globe. The footer has `More`, which lengthens the card to 24 lines,
// `Flow`, which lists the function's statements in place of its code (each row selects its building), and `Ships`,
// when the function has routes: a list above the code of the files its ships fly to, each with Preview
// (`ship:preview:<i>`) and Travel (`ship:travel:<i>`), the flight's status, and Cancel (`ship:cancel`) during a flight.
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
  /** How many routes leave the selected function (0 hides the Ships button), and whether the list is open. */
  shipCount?: number;
  /** The open ships list: up to four routes, the flight's status, and whether a flight is under way. */
  ships?: { routes: { path: string; canFly: boolean }[]; status: string; busy: boolean } | null;
  /** While landed on a file with several towns: which one the globe shows ("Function 3 of 11"), with ‹ and › to step. */
  towns?: { position: string } | null;
  /** Whether the function has statements to list (shows the Flow button). */
  hasFlow?: boolean;
  /** While Flow is on: its rows in place of the code, one per statement (`flow:<index>`). */
  flow?: FlowCardRow[] | null;
}

/** A Flow row: the statement's kind (glyph, label, colour), its first line and the start of its source. */
export interface FlowCardRow {
  index: number;
  line: number;
  glyph: string;
  label: string;
  color: string;
  text: string;
  selected: boolean;
}

/** Routes the ships list shows at most. */
export const MAX_SHIPS = 4;
/** Lines the ships list adds above the code: a status line, then two lines per route (room for its buttons). */
export const shipLines = (s: CodeCardMeta['ships']) => (s ? 1 + 2 * Math.min(MAX_SHIPS, s.routes.length) : 0);

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
  if (meta.ships) {
    const s = meta.ships;
    const bh = Math.min(32 * u, lineHeight * 2 - 16),
      bw = 100 * u;
    ctx.save();
    ctx.font = font('body', L.fontPx * 0.9);
    ctx.fillStyle = THEME.lineDim;
    ctx.fillText(fit(ctx, s.status, w - L.pad * 2 - (s.busy ? bw + 12 * u : 0)), L.pad, top + lineHeight / 2 + L.fontPx * 0.32);
    ctx.restore();
    if (s.busy) {
      const r = button(ctx, 'ship:cancel', 'Cancel', w - L.pad - bw, top + (lineHeight - Math.min(bh, lineHeight - 6)) / 2, bw, Math.min(bh, lineHeight - 6), u, { state: stateOf(meta.hovered, 'ship:cancel') });
      if (r) regions.push(r);
    }
    top += lineHeight;
    s.routes.slice(0, MAX_SHIPS).forEach((route, i) => {
      const rowH = lineHeight * 2,
        by = top + (rowH - bh) / 2,
        off = s.busy || !route.canFly;
      const travel = button(ctx, `ship:travel:${i}`, 'Travel', w - L.pad - bw, by, bw, bh, u, { state: off ? 'disabled' : stateOf(meta.hovered, `ship:travel:${i}`) });
      const preview = button(ctx, `ship:preview:${i}`, 'Preview', w - L.pad - 2 * bw - 10 * u, by, bw, bh, u, { state: off ? 'disabled' : stateOf(meta.hovered, `ship:preview:${i}`) });
      for (const r of [preview, travel]) if (r) regions.push(r);
      ctx.save();
      ctx.font = font('mono', L.fontPx * 0.92);
      ctx.letterSpacing = '0.01px';
      ctx.fillStyle = route.canFly ? THEME.white : THEME.lineDim;
      const label = route.canFly ? route.path : `${route.path} · no ship`;
      ctx.fillText(fit(ctx, label, w - L.pad * 2 - 2 * bw - 24 * u), L.pad, top + rowH / 2 + L.fontPx * 0.32);
      ctx.restore();
      top += rowH;
    });
    rule(ctx, 1, top - 2, w - 2, u);
  }
  ctx.font = font('mono', L.fontPx);
  const charW = ctx.measureText('M').width;
  const baseline = (y: number) => y + lineHeight / 2 + L.fontPx * 0.36;
  if (meta.flow) {
    // Flow: one row per statement, in line order: glyph and kind in the statement's colour, the line, its source.
    meta.flow.forEach((row, k) => {
      const y = top + k * lineHeight;
      if (row.selected) band(ctx, 1, y, w - 2, lineHeight, u, THEME.glow);
      else if (meta.hovered === `flow:${row.index}`) band(ctx, 1, y, w - 2, lineHeight, 0, THEME.glow, 0.08);
      ctx.save();
      ctx.font = font('body', L.fontPx);
      ctx.fillStyle = row.color;
      ctx.fillText(row.glyph, L.pad + 6, baseline(y));
      ctx.fillText(row.label, L.pad + 46, baseline(y));
      ctx.font = font('mono', L.fontPx * 0.9);
      ctx.letterSpacing = '0.01px';
      ctx.fillStyle = THEME.lineDim;
      const lx = L.pad + 260;
      ctx.fillText(`L${row.line}`, lx, baseline(y));
      ctx.fillStyle = row.selected ? THEME.white : THEME.line;
      ctx.fillText(fit(ctx, row.text, w - lx - 120 - L.pad), lx + 110, baseline(y));
      ctx.restore();
      regions.push({ id: `flow:${row.index}`, x: 0, y, w, h: lineHeight });
    });
    if (!meta.flow.length) microLabel(ctx, 'No statements in this function', L.pad, baseline(top), 13 * u, THEME.lineDim);
  } else rows.forEach((row, k) => {
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
  } else if (meta.towns) {
    // One function per globe: ‹ and › show the file's previous and next function on the globe.
    const sw = 44 * u;
    let x = L.pad;
    for (const [id, label] of [
      ['town:prev', '‹'],
      ['town:next', '›'],
    ] as const) {
      const r = button(ctx, id, label, x, by, sw, bh, u, { state: stateOf(meta.hovered, id) });
      if (r) regions.push(r);
      x += sw + 10 * u;
    }
    microLabel(ctx, meta.towns.position, x + 6 * u, by + bh / 2 + 5 * u, 12 * u, THEME.lineDim);
  } else
    microLabel(
      ctx,
      meta.flow ? 'Statements' : rows.length ? `${meta.shown.first}–${meta.shown.last} of ${meta.shown.total}` : 'No code to show',
      L.pad,
      by + bh / 2 + 5 * u,
      12 * u,
      THEME.lineDim,
    );
  const more = button(ctx, 'more', meta.more ? 'Less' : 'More', w - L.pad - bw, by, bw, bh, u, {
    state: stateOf(meta.hovered, 'more'),
  });
  if (more) regions.push(more);
  // Right to left after More: Ships (when the function has routes), then Flow.
  let right = w - L.pad - bw - 10 * u;
  if (meta.shipCount && !meta.replay) {
    const sw = 96 * u;
    const ships = button(ctx, 'ships', `Ships ${meta.shipCount}`, right - sw, by, sw, bh, u, {
      state: meta.ships ? 'pressed' : stateOf(meta.hovered, 'ships'),
    });
    if (ships) regions.push(ships);
    right -= sw + 10 * u;
  }
  if (meta.hasFlow && !meta.replay) {
    const fw = 70 * u;
    const flow = button(ctx, 'flow', meta.flow ? 'Code' : 'Flow', right - fw, by, fw, bh, u, {
      state: stateOf(meta.hovered, 'flow'),
    });
    if (flow) regions.push(flow);
  }
  return regions;
}
