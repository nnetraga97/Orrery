import { useSyncExternalStore } from 'react';
import { actions, projects, state, subscribe } from './state.ts';

export type AtlasEntry = {
  id: string;
  file: string;
  name: string;
  line: number;
  summary: string;
  role: string;
  risk: string;
};
export type AtlasHit = AtlasEntry & { reason: string };
export type AtlasState = {
  projectId: string;
  built: boolean;
  stale: boolean;
  building: boolean;
  done: number;
  total: number;
  failed: number;
  count: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
  error: string | null;
  entries: AtlasEntry[];
};
const bridge = window.galaxyDesktop as unknown as {
  atlasState(id: string): Promise<AtlasState>;
  atlasBuild(id: string): Promise<AtlasState>;
  atlasCancel(id: string): Promise<AtlasState>;
  atlasSearch(id: string, query: string): Promise<{ results: AtlasHit[]; reranked: boolean }>;
  onAtlasEvent(fn: (value: AtlasState) => void): () => void;
};
let current: AtlasState | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};
const accept = (value: AtlasState) => {
  if (value.projectId !== state.dataset) return;
  current = value;
  notify();
};
let initialized = false;
export function initAtlas() {
  if (initialized) return;
  initialized = true;
  bridge.onAtlasEvent(accept);
  const refresh = () => {
    current = null;
    notify();
    if (projects.has(state.dataset))
      void bridge
        .atlasState(state.dataset)
        .then(accept)
        .catch(() => {});
  };
  subscribe(['dataset'], refresh);
  refresh();
}
export function useAtlas() {
  return useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
export function atlasSummary(id: string, file: string) {
  return current?.entries.find(e => e.id === id && e.file === file);
}
export async function buildAtlas(cancel = false) {
  const id = state.dataset;
  accept(await (cancel ? bridge.atlasCancel(id) : bridge.atlasBuild(id)));
}
export const searchAtlas = (id: string, query: string) => bridge.atlasSearch(id, query);
export function navigateAtlas(hit: AtlasHit) {
  const i = state.nodes.findIndex(n => n.path === hit.file);
  if (i >= 0) actions.enterPlanet(i, { line: hit.line, townId: hit.id });
}
