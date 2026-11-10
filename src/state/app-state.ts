// What the UI shows, as signals. Systems and the bridge publish here; panels read; commands (commands.ts) change it.
import { signal } from '@iwsdk/core';
import type { ContextItem } from '../ports/host.ts';

export type Phase = 'idle' | 'loading' | 'overview' | 'landed';
export interface Loading {
  title: string;
  detail: string;
}

export const dataset = signal<string | null>(null);
export const phase = signal<Phase>('idle');
export const selectedPath = signal<string | null>(null);
export const landedPath = signal<string | null>(null);
export const pinned = signal<ContextItem | null>(null);
export const hovered = signal<ContextItem | null>(null);
export const loading = signal<Loading | null>(null);
export const error = signal<string | null>(null);

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
/** What the code page shows: one file's highlighted lines and what is selected in it. */
export interface CodeView {
  file: string;
  lines: Segment[][];
  regions: CodeRegion[];
  selectedRegion: number | null;
  selectedRange: LineRange | null;
  hoveredRange: LineRange | null;
  mode: 'function' | 'file';
}
export const codeView = signal<CodeView | null>(null);
/** Inspector calls kept for the next plan (debugger tabs, transport, stack, evidence). */
export const inspectorExtras = signal<Record<string, unknown[]>>({});

export const appState = {
  dataset,
  phase,
  selectedPath,
  landedPath,
  pinned,
  hovered,
  loading,
  error,
  codeView,
  inspectorExtras,
};
export type AppState = typeof appState;
