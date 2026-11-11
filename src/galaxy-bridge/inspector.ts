// The planet inspector contract (host.inspector.create), for the XR app. The desktop mounts a React panel; here the
// inspector turns what the landed planet asks to show into one signal, codeView, which the code card draws. The
// options (callbacks such as onStatement and onMethod, and data such as towns) are kept for the card to call back.
import { maxScrollTop, scrollToRange, shownRange } from '../core/code-view.ts';
import type { InspectorOptions, InspectorPort } from '../ports/host.ts';
import { codeCardOpen, codeCardRows, codeRequest, codeScroll, codeView, inspectorExtras } from '../state/app-state.ts';
import type { CodeRegion, CodeView, LineRange, Segment } from '../state/app-state.ts';

/** A town element (a building, fork or loop): its source item's lines and its region. */
export interface TownElement {
  it: { line: number; end?: number; [member: string]: unknown };
  k?: number;
  [member: string]: unknown;
}

let current: InspectorOptions | null = null;

/** The options of the open inspector (null when no planet is landed). */
export const inspectorOptions = () => current;

const rangeOfElement = (element: unknown): LineRange | null => {
  const it = (element as TownElement | null)?.it;
  if (!it || typeof it.line !== 'number') return null;
  return { start: it.line, end: Math.max(it.line, typeof it.end === 'number' ? it.end : it.line) };
};

const regionsOf = (regions: unknown[]): CodeRegion[] =>
  regions.map(r => {
    const region = r as { name?: string; start?: number; end?: number };
    const start = Number(region.start) || 1;
    return { name: String(region.name ?? ''), start, end: Math.max(start, Number(region.end) || start) };
  });

function publish(patch: Partial<CodeView>) {
  const view = codeView.peek();
  if (view) codeView.value = { ...view, ...patch };
}

/** Scrolls the card so the selected statement (or the selected function) sits a third of the way down. */
function scrollToSelection() {
  const view = codeView.peek();
  if (!view) return;
  const region = view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
  const range = view.selectedRange ?? region ?? null;
  codeScroll.value = range ? scrollToRange(view, range, codeCardRows.peek()) : 0;
}

const keep = (name: string) => (...args: unknown[]) => {
  inspectorExtras.value = { ...inspectorExtras.peek(), [name]: args };
};

export function createInspector(options: InspectorOptions): InspectorPort {
  current = options;
  const source = String(options.source ?? '');
  const colored = Array.isArray(options.colored) ? (options.colored as Segment[][]) : null;
  const lines = colored ?? source.split('\n').map(text => (text ? [{ text }] : []));
  codeView.value = {
    file: options.file.path,
    lines,
    regions: regionsOf(options.regions ?? []),
    selectedRegion: null,
    selectedRange: null,
    hoveredRange: null,
  };
  codeScroll.value = 0;
  // A landing picks its start town by itself: the card waits for the user's pick, unless showCode asked for a line.
  codeCardOpen.value = codeRequest.peek() != null;
  const selectRegion = (k: number | null) => {
    const next = k != null && k >= 0 ? k : null;
    if (next !== codeView.peek()?.selectedRegion) publish({ selectedRegion: next, selectedRange: null });
    // A line asked for by showCode: select what holds it once its function is selected.
    const request = codeRequest.peek(),
      view = codeView.peek();
    if (request && view && request.path === view.file && next != null) {
      const r = view.regions[next];
      if (request.line >= r.start && request.line <= r.end) {
        codeRequest.value = null;
        if (!view.selectedRange || request.line < view.selectedRange.start || request.line > view.selectedRange.end)
          publish({ selectedRange: smallestHolding(next, request.line) ?? { start: request.line, end: request.line } });
      }
    }
    scrollToSelection();
  };
  return {
    setRegion: k => selectRegion(k),
    openMethod: k => {
      codeCardOpen.value = true;
      selectRegion(k);
    },
    showStatement(element) {
      codeCardOpen.value = true;
      const range = rangeOfElement(element);
      const k = (element as TownElement | null)?.k;
      publish({ selectedRange: range, ...(typeof k === 'number' && k >= 0 ? { selectedRegion: k } : {}) });
      scrollToSelection();
    },
    hover(element) {
      publish({ hoveredRange: rangeOfElement(element) });
    },
    windowFor: () => null,
    setTab: keep('setTab'),
    transportStatus: keep('transportStatus'),
    stackChanged: keep('stackChanged'),
    evidenceChanged: keep('evidenceChanged'),
    dispose() {
      if (current === options) {
        current = null;
        codeView.value = null;
      }
    },
  };
}

// ---- the code card's own actions (called by the panel system) ----

interface TownsLike {
  elementsOf(k: number): TownElement[];
}

/** The region (function) whose lines contain `line`, the innermost when they nest. */
function regionOfLine(view: CodeView, line: number): number | null {
  let best: number | null = null;
  view.regions.forEach((r, k) => {
    if (line < r.start || line > r.end) return;
    if (best == null || r.end - r.start < view.regions[best].end - view.regions[best].start) best = k;
  });
  return best;
}

/** The line range of the smallest town element in region k that holds `line`. */
function smallestHolding(k: number, line: number): LineRange | null {
  const towns = current?.towns as TownsLike | undefined;
  const l = (towns?.elementsOf(k) ?? [])
    .filter(e => e.it.line <= line && (e.it.end ?? e.it.line) >= line)
    .sort((a, b) => (a.it.end ?? a.it.line) - a.it.line - ((b.it.end ?? b.it.line) - b.it.line))[0];
  return l ? rangeOfElement(l) : null;
}

/** A pinch on line `n`: select the smallest building holding it, switching function first when needed. */
export function pressLine(n: number) {
  const view = codeView.peek(),
    options = current;
  if (!view || !options) return;
  const k = regionOfLine(view, n);
  if (k == null) {
    publish({ selectedRange: { start: n, end: n } });
    return;
  }
  if (k !== view.selectedRegion) options.onMethod?.(k);
  const towns = options.towns as TownsLike | undefined;
  const holding = (towns?.elementsOf(k) ?? [])
    .filter(l => l.it.line <= n && (l.it.end ?? l.it.line) >= n)
    .sort((a, b) => (a.it.end ?? a.it.line) - a.it.line - ((b.it.end ?? b.it.line) - b.it.line))[0];
  if (holding) options.onStatement?.(holding, true);
  else publish({ selectedRegion: k, selectedRange: { start: n, end: n } });
}

/** Hovering line `n` (or nothing) on the card. */
export function hoverLine(n: number | null) {
  publish({ hoveredRange: n == null ? null : { start: n, end: n } });
}

/** The largest scroll for the card as it is now. */
export const cardMaxScroll = () => {
  const view = codeView.peek();
  return view ? maxScrollTop(view, codeCardRows.peek()) : 0;
};

export { shownRange };
