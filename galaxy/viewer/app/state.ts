// The viewer's shared state. Modules read state.x directly and change it with update(), which notifies the
// subscribers of the keys that changed. The shell (app/main.ts) registers the actions other modules call.
import { scaleOrdinal, type ScaleOrdinal } from 'd3';
import type { PerspectiveCamera, Vector3 } from 'three';
import type { FileNode, ImportLink } from './types.ts';

export type ViewName = 'board' | 'constellation' | 'graph';
export type Grouping = 'cluster' | 'folder';

// The running view, built by app/views.js or constellation.js. The shell relies on these members.
export interface View {
  stop(): void;
  select(i: number | null, options?: { fly?: boolean }): void;
  resize?(): void;
  anchorOf?(i: number): { x: number; y: number } | null;
  readonly pinned?: number | null;
  // The circuit board only: what a file is on the board (its reference designator and package).
  partOf?(i: number): string | null;
  // The constellation only.
  land?(i: number, options: { line: number | null; arrival: unknown; townId?: string | null }): void;
  leave?(): void;
  runtimeTrace?(point: unknown, follow?: boolean): Promise<unknown>;
  runtimeBreakpoints?(points: unknown[]): Promise<unknown>;
  debugSelection?(): Promise<{
    file: string;
    line: number;
    column: number;
    end: number;
    endColumn: number;
    text: string;
  } | null>;
  debugFrameAtSelection?(frames: unknown[]): Promise<number | undefined>;
  debugFile?(): string;
  agentShow?(line: number, current: () => boolean): Promise<void | undefined>;
  sourceContext?(): Promise<{ file: string; text: string; revision: number | null } | null>;
  revealSource?(
    point: { file: string; text: string; line: number; column: number },
    current?: () => boolean,
  ): Promise<{ status: string } | undefined>;
  runtimeStack?(
    frames: unknown[],
    selected: number | null,
    exception?: string | null,
    reason?: string | null,
  ): Promise<{ n: number; status: string }[] | undefined>;
  runtimeArguments?(index: number, lines: string[]): Promise<void>;
  executionAt?(
    place: {
      file: string;
      line?: number;
      label: string;
      paused: boolean;
      stack?: { file: string | null; label: string; index: number }[];
    } | null,
  ): Promise<void>;
  followExecution?(file: string): Promise<void>;
  readonly landed?: boolean;
  camera?: PerspectiveCamera;
  controls?: { target: Vector3 };
  clearControlMotion?(): void;
  overview?(): { target: Vector3; position: Vector3 };
  cannon?: { stop(): void; frameWorkspace(): void; focusCannon?(): void; settle?(limit?: number): Promise<void> };
  cameraPreset?(kind: string): void;
  // The constellation and the board: take a new snapshot of the same project in place (paths in refresh changed content).
  update?(changes: { refresh?: Set<string> }): void;
}

// What the empty-workspace overlay says (desktop-projects.ts).
export type EmptyPrompt = { name: string; hint: string; action?: { label: string; run: () => void } };

export interface State {
  dataset: string;
  // The loaded snapshot of the dataset: the analysis service's run and its revision (null for built-in data).
  generation: string | null;
  revision: number | null;
  current: ViewName;
  grouping: Grouping;
  view: View | null;
  selected: number | null; // file index
  // A project with no source files yet: only the constellation and the agent apply.
  emptyWorkspace: boolean;
  // Shown over the constellation while the workspace is empty; null otherwise.
  emptyPrompt: EmptyPrompt | null;
  // Why the dataset or view could not be shown, in place of the file counts.
  loadError: string | null;
  // The loaded dataset's import graph (app/graph.ts).
  nodes: FileNode[];
  links: ImportLink[];
  out: number[][];
  inc: number[][];
  groups: string[];
  color: ScaleOrdinal<string, string>;
  groupIndex: Map<string, number>;
  cache: Record<string, unknown>;
}

const store: State = {
  dataset: '',
  generation: null,
  revision: null,
  current: 'board',
  grouping: 'folder',
  view: null,
  selected: null,
  emptyWorkspace: false,
  emptyPrompt: null,
  loadError: null,
  nodes: [],
  links: [],
  out: [],
  inc: [],
  groups: [],
  color: scaleOrdinal<string, string>(),
  groupIndex: new Map(),
  cache: {},
};
export const state: Readonly<State> = store;

type Key = keyof State;
type Listener = { keys: ReadonlySet<Key> | null; notify: (changed: ReadonlySet<Key>) => void };
const listeners = new Set<Listener>();

export function update(patch: Partial<State>): void {
  const changed = new Set<Key>();
  for (const key of Object.keys(patch) as Key[]) {
    if (store[key] === patch[key]) continue;
    (store as unknown as Record<Key, unknown>)[key] = patch[key];
    changed.add(key);
  }
  if (!changed.size) return;
  for (const listener of [...listeners])
    if (!listener.keys || [...changed].some(key => listener.keys!.has(key))) listener.notify(changed);
}

// Calls notify after an update changes any of keys (every update when keys is null). Returns an unsubscribe.
export function subscribe(keys: Key[] | null, notify: (changed: ReadonlySet<Key>) => void): () => void {
  const listener = { keys: keys && new Set(keys), notify };
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The group a file belongs to under the current grouping.
export const G = (n: FileNode): string => n[state.grouping] ?? '';

export interface Actions {
  selectFile(i: number | null, options?: { fly?: boolean }): void;
  enterPlanet(i: number, options?: { line?: number | null; arrival?: unknown; townId?: string | null }): void;
  exitPlanet(): void;
  renderSelected(): void;
  showHover(n?: FileNode | null): void;
  render(): void;
  useDataset(name: string): Promise<void>;
  reloadDataset(name: string, revision?: number | null, generation?: string | null): Promise<void>;
  invalidateDataset(name: string): void;
}
// Filled in by app/main.ts before any view runs.
export const actions = {} as Actions;

// Projects served by the workspace service's project API, by dataset id.
export const projects = new Map<string, { version: number }>();
