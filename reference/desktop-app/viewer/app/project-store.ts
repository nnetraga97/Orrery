// Project state for Electron (desktop-projects.ts): the open project, the Chats panel, saved preferences, the
// workspace service API and the agent event pipeline.
import { createActivityDelivery } from '../agents/activity-delivery.js';
import { createWorkspaceLog } from '../agents/workspace-log.js';
import { trace } from '../scene/diagnostics.js';
import { AgentActivity, type ActivityEvent } from './activity.ts';
import { $ } from './dom.ts';
import { actions, projects, state } from './state.ts';

const workspaceLog = createWorkspaceLog({
  dom: $,
  inspect(path: string, line: number | null) {
    const i = state.nodes.findIndex(n => n.path === path);
    if (i >= 0) actions.enterPlanet(i, { line });
  },
});

export type Project = { id: string; name: string; fileCount: number; version: number };

export type Projects = { project: Project | null; panelOpen: boolean };

let store: Projects = { project: null, panelOpen: false };
const listeners = new Set<() => void>();
export const projectStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => store,
};
export function setProjects(patch: Partial<Projects>) {
  store = { ...store, ...patch };
  for (const fn of listeners) fn();
}

/** The Electron preload bridge (desktop/preload.cjs). */
export const desktop = window.galaxyDesktop as Record<string, (...args: never[]) => Promise<unknown>> & {
  getPreferences(): Promise<Record<string, string | number>>;
  setPreference(key: string, value: string | number): Promise<void>;
};

// Errors go to the Codex chat panel once it exists.
let errorSink = (message: string) => console.error(message);
export const setErrorSink = (sink: (message: string) => void) => {
  errorSink = sink;
};
export const reportError = (message: string) => errorSink(message);

// Preferences live in main; this is the copy read at startup plus later changes.
let preferences: Record<string, string | number> = Object.create(null);
export async function loadPreferences() {
  preferences = await desktop.getPreferences();
}
export const remembered = (key: string): string | null => (preferences[key] == null ? null : String(preferences[key]));
// Main validates each preference's type: the panel width is an integer, the rest are strings.
export function remember(key: string, value: string | number) {
  preferences[key] = value;
  void desktop
    .setPreference(key, value)
    .catch((error: Error) => reportError(`Could not save your preference: ${error.message}`));
}

export async function api<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export const projectBase = (p: Project) => `/api/projects/${p.id}`;

/** Registers a project and lists it under "Your projects" in the dataset menu. */
export function addProject(p: Project) {
  projects.set(p.id, p);
  let group = document.getElementById('myProjects');
  if (!group) {
    group = document.createElement('optgroup');
    group.id = 'myProjects';
    (group as HTMLOptGroupElement).label = 'Your projects';
    $('dataset').prepend(group);
  }
  let option = [...group.children].find(o => (o as HTMLOptionElement).value === p.id) as HTMLOptionElement | undefined;
  if (!option) {
    option = document.createElement('option');
    option.value = p.id;
    group.append(option);
  }
  option.textContent = `${p.name} · ${p.fileCount} file${p.fileCount === 1 ? '' : 's'}`;
}

export function setPanelOpen(open: boolean) {
  remember('galaxyChat', open ? 'open' : 'closed');
  setProjects({ panelOpen: open });
  requestAnimationFrame(() => state.view?.resize?.());
}
// The side panel and its toolbar button follow panelOpen.
projectStore.subscribe(() => {
  const panel = document.getElementById('agentPanel'),
    button = document.getElementById('chatBtn');
  if (!panel || !button) return;
  panel.hidden = !store.panelOpen;
  button.classList.toggle('on', store.panelOpen);
  button.setAttribute('aria-expanded', String(store.panelOpen));
});

// Agent events: history goes to Activity; live events also animate the cannon and the workspace log, through a
// bounded delivery that drops visuals (never history) when it falls behind.
type AgentEvent = ActivityEvent & Record<string, unknown>;
let seen = new Set<string>(),
  delivery: ReturnType<typeof createActivityDelivery> | null = null;
function deliverLive(e: AgentEvent) {
  delivery ||= createActivityDelivery(
    (event: AgentEvent) => {
      const cannon = state.view?.cannon as { ingest?(e: unknown): void } | undefined;
      trace('activity-delivered', {
        eventId: event.id,
        eventType: event.type,
        projectId: state.dataset,
        pending: delivery?.stats().pending || 0,
      });
      if (cannon?.ingest) cannon.ingest(event);
      else
        trace('cannon-skipped', { eventId: event.id, projectId: state.dataset, reason: 'no-cannon-in-current-view' });
      workspaceLog.add(event);
    },
    {
      ingest: (event: AgentEvent) => AgentActivity.ingest(event),
      onOverflow: (dropped: number) => trace('activity-overflow', { projectId: state.dataset, dropped }),
    },
  );
  delivery.push([e]);
}
/** Records an event once; resolves to false for a duplicate. */
export function ingestEvent(e: AgentEvent, live = false) {
  const key = e.id && `${e.provider || 'disk'}:${e.sessionId || ''}:${e.id}`;
  if (key && seen.has(key)) return false;
  if (key) {
    seen.add(key);
    if (seen.size > 8192) seen.delete(seen.values().next().value!);
  }
  if (live) {
    const receivedAt = Date.now();
    trace('activity-received', {
      eventId: e.id,
      eventType: e.type,
      projectId: state.dataset,
      eventAt: e.timestamp || e.t,
      receivedAt,
    });
    deliverLive({ ...e, viewerReceivedAt: receivedAt });
  } else AgentActivity.ingest(e);
  return true;
}
/** Starts the event pipeline over for another project. */
export function resetEvents() {
  delivery?.clear();
  seen = new Set();
  AgentActivity.clear();
  workspaceLog.clear();
}

/** A page of the open project's activity history, newest last. */
export async function history(page: { before?: number; limit?: number } = {}) {
  const p = store.project;
  if (!p) return [];
  const params = new URLSearchParams();
  for (const key of ['before', 'limit'] as const) if (page[key] != null) params.set(key, String(page[key]));
  return (await api<{ events: ActivityEvent[] }>(`${projectBase(p)}/history?${params}`)).events;
}
