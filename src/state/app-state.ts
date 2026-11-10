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

export const appState = { dataset, phase, selectedPath, landedPath, pinned, hovered, loading, error };
export type AppState = typeof appState;
