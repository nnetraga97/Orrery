// What the UI shows, as signals. Systems and the bridge publish here; panels read; commands (commands.ts) change it.
import { signal } from '@iwsdk/core';
import type { CodeView } from '../core/code-view.ts';
import type { TutorialStep } from '../core/tutorial.ts';
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
/** A line the app asked to show (commands.showCode), until the code card has selected it. */
export const codeRequest = signal<{ path: string; line: number } | null>(null);
/** Lines scrolled from the top of what the code card shows. */
export const codeScroll = signal(0);
/** Whether the code card is open: set when the user picks a function or a statement, or by showCode; cleared by
 * its close mark and by a new landing (whose start town the copied code picks by itself). */
export const codeCardOpen = signal(false);
/** Rows the code card shows: 12, or 24 after `More`. */
export const codeCardRows = signal(12);
/** Whether the chat window is shown (closed from its close mark, brought back by the Chat tab). */
export const agentOpen = signal(true);
/** Bumped to restart the tutorial (commands.restartTutorial). */
export const tutorialRestarts = signal(0);
/** Counts orbit gestures (a pinch-drag that turned the model). */
export const orbits = signal(0);
/** The tutorial's step. */
export const tutorialStep = signal<TutorialStep>('done');
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
  codeCardOpen,
  codeCardRows,
  codeRequest,
  agentOpen,
  tutorialRestarts,
  orbits,
  tutorialStep,
  inspectorExtras,
};
export type AppState = typeof appState;
