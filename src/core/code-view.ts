// What the code page shows: from the inspector's state (one file's highlighted lines, its functions and what is
// selected), the rows on screen. Function mode shows the selected function with a little context; file mode the whole
// file. scrollTop counts lines from the top of what is shown.

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
  mode: 'function' | 'file';
}
export interface CodeRow {
  number: number;
  segments: Segment[];
  highlight: 'none' | 'selected' | 'hovered';
  truncated: boolean;
}

export const CONTEXT_LINES = 3;

/** The lines the page shows: the selected function plus context in function mode, otherwise the whole file. */
export function shownRange(view: CodeView): LineRange {
  const total = view.lines.length;
  const region = view.mode === 'function' && view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
  if (!region) return { start: 1, end: total };
  return { start: Math.max(1, region.start - CONTEXT_LINES), end: Math.min(total, region.end + CONTEXT_LINES) };
}

/** The largest scrollTop for `rows` visible rows. */
export function maxScrollTop(view: CodeView, rows: number): number {
  const range = shownRange(view);
  return Math.max(0, range.end - range.start + 1 - rows);
}

const inRange = (n: number, r: LineRange | null) => !!r && n >= r.start && n <= r.end;

function cut(segments: Segment[], columns: number): { segments: Segment[]; truncated: boolean } {
  const out: Segment[] = [];
  let used = 0;
  for (const s of segments) {
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

export function visibleLines(
  view: CodeView,
  options: { rows: number; columns: number; scrollTop: number },
): CodeRow[] {
  if (!view.lines.length) return [];
  const range = shownRange(view);
  const top = Math.max(0, Math.min(Math.floor(options.scrollTop), maxScrollTop(view, options.rows)));
  const rows: CodeRow[] = [];
  for (let n = range.start + top; n <= range.end && rows.length < options.rows; n++) {
    const { segments, truncated } = cut(view.lines[n - 1] ?? [], options.columns);
    const highlight = inRange(n, view.selectedRange) ? 'selected' : inRange(n, view.hoveredRange) ? 'hovered' : 'none';
    rows.push({ number: n, segments, highlight, truncated });
  }
  return rows;
}

/** The scrollTop that puts the range's first line a third of the way down the page, clamped. */
export function scrollToRange(view: CodeView, range: LineRange, rows: number): number {
  const shown = shownRange(view);
  const wanted = range.start - shown.start - Math.floor(rows / 3);
  return Math.max(0, Math.min(wanted, maxScrollTop(view, rows)));
}
