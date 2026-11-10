import { actions, state, subscribe } from './state.ts';
import { remembered } from './project-store.ts';
import { activeFolder, showGalaxy, workbenchStore } from './workbench.ts';
import { filesStore, openFile } from './workspace-files.ts';

export type AgentShow = {
  projectId: string;
  file: string;
  line?: number;
  message: string;
  provider: 'nemotron' | 'codex' | 'claude';
  time: number;
};
type Snapshot = { payload: AgentShow | null; offered: boolean; detail: string; reveal: AgentShow | null };
let snapshot: Snapshot = { payload: null, offered: false, detail: '', reveal: null };
const listeners = new Set<() => void>();
function publish(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(fn => fn());
}
export const agentShowStore = {
  get: () => snapshot,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
let pending: AgentShow | null = null;
let version = 0;
let readyProject: string | null = null;
let initialized = false;
export function agentShowDatasetReady(projectId: string | null) {
  readyProject = projectId;
  schedule();
}
export function dismissAgentShow() {
  ++version;
  pending = null;
  publish({ payload: null, offered: false, detail: '', reveal: null });
}
function current(payload: AgentShow, request: number) {
  return request === version && activeFolder()?.project.id === payload.projectId && state.dataset === payload.projectId;
}
async function reveal(payload: AgentShow, request: number) {
  if (!current(payload, request)) return;
  const i = state.nodes.findIndex(n => n.path === payload.file);
  publish({ offered: false, detail: '', reveal: null });
  try {
    if (i < 0) {
      await openFile(payload.projectId, payload.file, true);
      if (!current(payload, request)) return;
      const files = filesStore.get();
      const doc = files.documents.find(d => d.id === files.active);
      if (doc?.path !== payload.file || doc.projectId !== payload.projectId)
        throw new Error(files.error || 'Could not open the requested file.');
      publish({ detail: 'Outside the analyzed galaxy · opened in editor', reveal: payload });
      return;
    }
    showGalaxy();
    actions.enterPlanet(i, { line: payload.line });
    const view = state.view;
    // The detail proxy waits for its source and towns before invoking the existing highlight hooks.
    await view?.agentShow?.(payload.line ?? 1, () => current(payload, request) && state.view === view);
  } catch (error) {
    if (current(payload, request)) publish({ detail: String(error instanceof Error ? error.message : error) });
  }
}
export function acceptAgentShow(payload: AgentShow) {
  if (
    !payload ||
    payload.projectId !== activeFolder()?.project.id ||
    typeof payload.file !== 'string' ||
    !payload.file ||
    !['nemotron', 'codex', 'claude'].includes(payload.provider) ||
    typeof payload.message !== 'string' ||
    !payload.message.trim() ||
    payload.message.length > 280 ||
    (payload.line !== undefined && (!Number.isInteger(payload.line) || payload.line < 1))
  )
    return;
  ++version;
  pending = payload;
  // Clear the old callout immediately, even while a dataset is still loading.
  publish({ payload: null, offered: false, detail: '', reveal: null });
  schedule();
}
let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const payload = pending;
    if (!payload || readyProject !== payload.projectId || state.dataset !== payload.projectId || !state.view) return;
    if (activeFolder()?.project.id !== payload.projectId) {
      pending = null;
      return;
    }
    pending = null;
    const offered = remembered('galaxyFollow') !== 'on';
    publish({ payload, offered, detail: '', reveal: null });
    if (!offered) void reveal(payload, version);
  }, 100);
}
export function followAgentShow() {
  if (snapshot.payload) void reveal(snapshot.payload, version);
}
export function initAgentShow() {
  if (initialized) return;
  initialized = true;
  const bridge = window.galaxyDesktop as unknown as { onAgentShow(cb: (payload: AgentShow) => void): () => void };
  bridge.onAgentShow(acceptAgentShow);
  // Like the existing check surface, this hook only exercises renderer behavior; it grants no native access.
  Object.assign(window, { __galaxyAgentShow: acceptAgentShow });
  subscribe(['view'], schedule);
  workbenchStore.subscribe(() => {
    const projectId = activeFolder()?.project.id;
    if ((pending && pending.projectId !== projectId) || (snapshot.payload && snapshot.payload.projectId !== projectId))
      dismissAgentShow();
  });
}
