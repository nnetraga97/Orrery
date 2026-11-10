// What the UI shows, as signals. Systems and the bridge publish here; panels read; commands (commands.ts) change it.
import { signal } from '@iwsdk/core';
import type { CodeView } from '../core/code-view.ts';
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

export type { CodeRegion, CodeView, LineRange, Segment } from '../core/code-view.ts';
export const codeView = signal<CodeView | null>(null);
/** Inspector calls kept for the next plan (debugger tabs, transport, stack, evidence). */
/** A line the app asked to show (commands.showCode), until the code page has selected it. */
export const codeRequest = signal<{ path: string; line: number } | null>(null);
/** Lines scrolled from the top of what the code page shows. */
export const codeScroll = signal(0);
/** Whether the code page is shown when there is code to show (the dock's Code button). */
export const codePageOpen = signal(true);
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
  codeScroll,
  codePageOpen,
  codeRequest,
  inspectorExtras,
};
export type AppState = typeof appState;
