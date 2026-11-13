// What the code card shows: from the inspector's state (one file's highlighted lines, its functions and what is
// selected), the rows on screen. The card shows the selected function with 3 lines of context each side (the whole
// file only when a selected line lies outside every function). scrollTop counts lines from the top of what is shown.
// A line too long for the card is cut with an ellipsis, except the selected lines, which wrap onto continuation rows:
// what the user or the agent picked is always readable to its end.

/** One run of source text with an optional token class (tok-keyword, tok-string, ...). */
export interface Segment {
  text: string;
  cls?: string;
}
/** Source lines, 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}
export interface CodeRegion extends LineRange {
  name: string;
}
export interface CodeView {
  file: string;
  lines: Segment[][];
  regions: CodeRegion[];
  selectedRegion: number | null;
  selectedRange: LineRange | null;
  hoveredRange: LineRange | null;
}
export interface CodeRow {
  number: number;
  segments: Segment[];
  highlight: 'none' | 'selected' | 'hovered';
  truncated: boolean;
  /** A wrapped line's second and later rows: no line number. */
  continuation?: boolean;
}

/** Characters across the code card. */
export const CODE_COLUMNS = 56;

export const CONTEXT_LINES = 3;

/** The lines the card shows: the selected function plus context, otherwise the whole file. */
export function shownRange(view: CodeView): LineRange {
  const total = view.lines.length;
  const region = view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
  if (!region) return { start: 1, end: total };
  return { start: Math.max(1, region.start - CONTEXT_LINES), end: Math.min(total, region.end + CONTEXT_LINES) };
}

/** The largest scrollTop for `rows` visible rows; the selected lines' continuation rows count. */
export function maxScrollTop(view: CodeView, rows: number, columns = CODE_COLUMNS): number {
  const range = shownRange(view);
  let extra = 0;
  const sel = view.selectedRange;
  if (sel) for (let n = Math.max(sel.start, range.start); n <= Math.min(sel.end, range.end); n++) extra += wrapLine(view.lines[n - 1] ?? [], columns).length - 1;
  return Math.max(0, range.end - range.start + 1 + extra - rows);
}

/** Whether the card has something to show: a selected function or a selected range. */
export function hasSelection(view: CodeView | null): boolean {
  return !!view && view.lines.length > 0 && (view.selectedRegion != null || view.selectedRange != null);
}

const inRange = (n: number, r: LineRange | null) => !!r && n >= r.start && n <= r.end;

/** Tabs are drawn two columns wide. */
export const TAB = '  ';

function cut(segments: Segment[], columns: number): { segments: Segment[]; truncated: boolean } {
  const out: Segment[] = [];
  let used = 0;
  for (const raw of segments) {
    const s = raw.text.includes('\t') ? { ...raw, text: raw.text.replace(/\t/g, TAB) } : raw;
    if (used + s.text.length <= columns) {
      out.push(s);
      used += s.text.length;
      continue;
    }
    const room = columns - used;
    if (room > 0) out.push(s.cls ? { text: s.text.slice(0, room), cls: s.cls } : { text: s.text.slice(0, room) });
    return { segments: out, truncated: true };
  }
  return { segments: out, truncated: false };
}

/** How far a continuation row is indented past the line's own indent, and the most a row is indented. */
const HANG = 4,
  MAX_HANG = 24;

/** A line as rows of at most `columns` characters: broken at a space where one is near, later rows indented. */
export function wrapLine(segments: Segment[], columns: number): Segment[][] {
  const chars: { ch: string; cls?: string }[] = [];
  for (const s of segments) for (const ch of s.text.replace(/\t/g, TAB)) chars.push({ ch, cls: s.cls });
  if (chars.length <= columns) return [cut(segments, columns).segments];
  let indent = 0;
  while (indent < chars.length && chars[indent].ch === ' ') indent++;
  const hang = Math.min(indent + HANG, MAX_HANG, Math.max(0, columns - 16));
  const rows: Segment[][] = [];
  let at = 0;
  while (at < chars.length) {
    const room = rows.length ? columns - hang : columns;
    let end = Math.min(chars.length, at + room);
    if (end < chars.length) {
      // Back to the last space in the final third of the row, if there is one.
      let space = end;
      while (space > at + Math.floor((room * 2) / 3) && chars[space - 1].ch !== ' ') space--;
      if (space > at + Math.floor((room * 2) / 3)) end = space;
    }
    const row: Segment[] = rows.length && hang ? [{ text: ' '.repeat(hang) }] : [];
    for (let k = at; k < end; k++) {
      const last = row[row.length - 1],
        c = chars[k];
      if (last && last.cls === c.cls && (k > at || !rows.length)) last.text += c.ch;
      else row.push(c.cls ? { text: c.ch, cls: c.cls } : { text: c.ch });
    }
    rows.push(row);
    at = end;
  }
  return rows;
}

export function visibleLines(
  view: CodeView,
  options: { rows: number; columns: number; scrollTop: number },
): CodeRow[] {
  if (!view.lines.length) return [];
  const range = shownRange(view);
  const top = Math.max(0, Math.min(Math.floor(options.scrollTop), maxScrollTop(view, options.rows, options.columns)));
  const rows: CodeRow[] = [];
  for (let n = range.start + top; n <= range.end && rows.length < options.rows; n++) {
    const highlight = inRange(n, view.selectedRange) ? 'selected' : inRange(n, view.hoveredRange) ? 'hovered' : 'none';
    if (highlight === 'selected') {
      // Selected lines are shown whole, on as many rows as they need.
      const wrapped = wrapLine(view.lines[n - 1] ?? [], options.columns);
      for (let k = 0; k < wrapped.length && rows.length < options.rows; k++)
        rows.push({ number: n, segments: wrapped[k], highlight, truncated: false, ...(k ? { continuation: true } : {}) });
      continue;
    }
    const { segments, truncated } = cut(view.lines[n - 1] ?? [], options.columns);
    rows.push({ number: n, segments, highlight, truncated });
  }
  return rows;
}

/** The scrollTop that puts the range's first line a third of the way down the card, clamped. */
export function scrollToRange(view: CodeView, range: LineRange, rows: number): number {
  const shown = shownRange(view);
  const wanted = range.start - shown.start - Math.floor(rows / 3);
  return Math.max(0, Math.min(wanted, maxScrollTop(view, rows)));
}
