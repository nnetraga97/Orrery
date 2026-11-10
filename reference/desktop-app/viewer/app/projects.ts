import { initAgentShow } from './agent-show.ts';
// Projects in Electron: folders opened through the workbench, Codex chats in the side panel, and each project's
// stream of workspace activity (file changes and agent events) for the cannon, Activity and live rebuilds.
import { AgentActivity } from './activity.ts';
import { CodexChat } from './panels/CodexChat.tsx';
import { mountWorkbench } from './panels/Workbench.tsx';
import { initPanelResize } from './panel-resize.ts';
import {
  addProject,
  api,
  desktop,
  history,
  ingestEvent,
  loadPreferences,
  projectBase,
  projectStore,
  remember,
  remembered,
  resetEvents,
  setErrorSink,
  setPanelOpen,
  setProjects,
  type Project,
} from './project-store.ts';
import { actions, projects, state, update } from './state.ts';
import type { DatasetGraph, DatasetSymbols } from './types.ts';
import { WELCOME, command } from './workbench.ts';

const get = projectStore.get;
let revision = 0,
  stream: EventSource | null = null;

function paint() {
  const p = get().project,
    empty = !p || !p.fileCount;
  update({
    emptyWorkspace: empty,
    emptyPrompt: empty
      ? {
          name: p?.name || 'Your codebase, in motion',
          hint: p
            ? 'Describe what you want to build in a Codex chat. Source files become planets as your project grows.'
            : 'Open a folder on your laptop, or create an empty project. Your files stay where they are.',
          action: p
            ? {
                label: 'Start a chat',
                run: () => {
                  setPanelOpen(true);
                  CodexChat.focus();
                },
              }
            : { label: 'Open folder', run: () => command('openFolder') },
        }
      : null,
  });
}

async function changed(name: string) {
  const rev = ++revision;
  stream?.close();
  stream = null;
  const project = (projects.get(name) as Project | undefined) || null;
  resetEvents();
  setProjects({ project });
  paint();
  void CodexChat.switchProject(project);
  if (!project) return;
  remember('galaxyProject', project.id);
  const source = (stream = new EventSource(`${projectBase(project)}/stream`));
  source.onmessage = async ({ data }) => {
    if (rev !== revision) return;
    try {
      const m = JSON.parse(data);
      if (m.type === 'snapshot') {
        resetEvents();
        m.events.forEach((e: never) => ingestEvent(e));
        setProjects({ project: m.project });
        addProject(m.project);
        // On every (re)connect: catch up if analyses finished while disconnected or the service restarted.
        await actions.reloadDataset(project.id, m.revision, m.generation);
        (state.view?.cannon as { setSession?(name: string, key: null): void } | undefined)?.setSession?.(
          'Workspace activity',
          null,
        );
        // Restore current drones without replaying saved tool shots or completed work.
        for (const e of m.agentState?.state?.agents || [])
          if (e.type !== 'agent.finished')
            (state.view?.cannon as { ingest?(e: unknown): void } | undefined)?.ingest?.(e);
      } else if (m.type === 'event') ingestEvent(m.event, true);
      else if (m.type === 'rebuild') {
        setProjects({ project: m.project });
        addProject(m.project);
        await actions.reloadDataset(project.id, m.revision, m.generation);
      } else if (m.type === 'error') CodexChat.reportError(m.error);
      if (rev === revision) paint();
    } catch (error) {
      if (rev === revision) CodexChat.reportError((error as Error).message);
    }
  };
}

/** Restores preferences, builds the Chats panel and the workbench; resolves to the dataset to open first. */
async function init(): Promise<string> {
  setErrorSink(CodexChat.reportError);
  AgentActivity.setSource({ session: () => null, read: history, paged: () => !!projectStore.get().project });
  try {
    await loadPreferences();
  } catch (error) {
    CodexChat.reportError(`Could not restore preferences: ${(error as Error).message}`);
  }
  document.body.classList.add('desktop');
  setProjects({ panelOpen: remembered('galaxyChat') === 'open' });
  initPanelResize(440);
  // The welcome dataset is an empty map shown behind the Welcome page.
  const datasets = document.getElementById('dataset') as HTMLSelectElement;
  datasets.replaceChildren(new Option('Open a codebase', WELCOME));
  (window.DATASETS ||= {})[WELCOME] = { f: [], e: [] } as unknown as DatasetGraph;
  (window.SYMBOLS ||= {})[WELCOME] = {} as DatasetSymbols;
  document.getElementById('chatBtn')!.onclick = () => setPanelOpen(!get().panelOpen);
  CodexChat.init({
    desktop: desktop as never,
    panel: document.getElementById('agentPanel')!,
    remembered,
    remember,
    close: () => setPanelOpen(false),
    openProject: () => command('openFolder'),
  });
  try {
    const data = await api<{ projects: Project[] }>('/api/projects');
    data.projects.forEach(addProject);
  } catch (error) {
    setProjects({ panelOpen: true });
    CodexChat.reportError((error as Error).message);
  }
  const initial = await mountWorkbench({ bridge: desktop as never, useDataset: actions.useDataset, addProject });
  initAgentShow();
  paint();
  return initial;
}

/** The shell calls init once, changed whenever the dataset changes, and paint after each render. */
export const projectUI = { init, changed, paint };
