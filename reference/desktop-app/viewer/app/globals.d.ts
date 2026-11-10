// Values the viewer reads from window: dataset scripts (engine/analyzer/dataset-file.cjs), the Electron bridge and the
// TypeScript compiler loaded on demand (towns.js).
import type { DatasetGraph, DatasetSymbols } from './app/types';

declare global {
  interface Window {
    DATASETS?: Record<string, DatasetGraph>;
    SYMBOLS?: Record<string, DatasetSymbols>;
    // Exposed by the Electron preload (desktop/preload.cjs).
    galaxyDesktop?: Record<string, unknown>;
    ts?: unknown;
  }
}

export {};
