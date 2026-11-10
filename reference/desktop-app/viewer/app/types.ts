// Data contracts between the analyzer, the hosts and the viewer.

// <name>.js, written by engine/analyzer/dataset-file.cjs: files as [path, lines, in-degree, content hash, detail hash,
// region count] and imports as [from, to, runtime refs, type refs, re-exports] (bare [from, to] when the importer has
// no reference index). The path is a file's identity; its index is its position in this snapshot only.
export interface DatasetGraph {
  f: [
    path: string,
    lines: number,
    inDegree?: number,
    content?: string,
    detail?: string | null,
    regions?: number | null,
    callables?: number | null,
  ][];
  e: [from: number, to: number, runtime?: number, types?: number, reexports?: number][];
  analysis?: Record<string, unknown>;
}

// <name>.symbols.js: per-file declarations, calls and references, keyed by path.
export interface FileSymbols {
  lines?: number;
  decls?: unknown[];
  calls?: unknown[];
  // Imported path -> [runtime references, type references, re-exports].
  refs?: Record<string, [runtime?: number, types?: number, reexports?: number]>;
}
export type DatasetSymbols = Record<string, FileSymbols>;

// One source file in the loaded import graph.
export interface FileNode {
  i: number;
  path: string;
  rloc: number;
  name: string;
  folder: string;
  // The path the file had when it first appeared: what its orbit, rotation and look are hashed from, so a rename
  // keeps them (galaxy-memory.ts identitySeed).
  seed: string;
  // From the analyzer's overview: the symbols' hash (null: no symbols) and the planet's region count.
  detail?: string | null;
  regions?: number | null;
  // Functions and methods in the file (0: none, e.g. only types or constants; null: not analyzed yet).
  callables?: number | null;
  cluster?: string;
  // Set by the constellation.
  kind?: 'planet' | 'asteroid' | 'comet';
}

export interface ImportLink {
  s: number;
  t: number;
  // [runtime refs, type refs, re-exports]; absent when the importer has no reference index.
  use?: [number, number, number];
}
