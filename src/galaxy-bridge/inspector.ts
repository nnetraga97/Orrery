// The planet inspector contract (host.inspector.create), for the XR app. The desktop mounts a React panel; here the
// inspector turns what the landed planet asks to show into one signal, codeView, which the code page draws. The
// options (callbacks such as onStatement and onMethod, and data such as towns) are kept for the page to call back.
import type { InspectorOptions, InspectorPort } from '../ports/host.ts';
import { codeView, inspectorExtras } from '../state/app-state.ts';
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
    mode: 'function',
  };
  const selectRegion = (k: number | null) => publish({ selectedRegion: k != null && k >= 0 ? k : null });
  return {
    setRegion: k => selectRegion(k),
    openMethod: k => selectRegion(k),
    showStatement(element) {
      const range = rangeOfElement(element);
      const k = (element as TownElement | null)?.k;
      publish({ selectedRange: range, ...(typeof k === 'number' && k >= 0 ? { selectedRegion: k } : {}) });
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
