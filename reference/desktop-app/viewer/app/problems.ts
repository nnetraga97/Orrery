import { activeFolder, showGalaxy, workbenchStore } from './workbench.ts';
import { filesStore, openFile } from './workspace-files.ts';
import { actions, state } from './state.ts';
import { settingsBridge } from './settings.ts';
export type Diagnostic = {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source: string;
  code?: string;
};
export type ProblemServer = {
  id: 'typescript' | 'pyright' | 'jdtls';
  label: string;
  status: 'idle' | 'starting' | 'ready' | 'missing' | 'disabled' | 'error';
  reason?: string;
  installable?: boolean;
  version?: string;
};
export type ProblemsSnapshot = {
  projectId: string;
  diagnostics: Diagnostic[];
  servers: ProblemServer[];
  updatedAt: number;
};
const bridge = window.galaxyDesktop as unknown as {
  problemsGet(projectId: string, files?: string[]): Promise<ProblemsSnapshot>;
  problemsInstall(id: 'typescript' | 'pyright'): Promise<ProblemServer>;
  onProblemsEvent(fn: (value: ProblemsSnapshot) => void): () => void;
};
let snapshot = {
  projectId: '',
  diagnostics: [] as Diagnostic[],
  servers: [] as ProblemServer[],
  updatedAt: 0,
  loading: false,
  error: '',
  actionError: '',
  reveal: null as (Diagnostic & { projectId: string }) | null,
};
const listeners = new Set<() => void>();
const update = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  for (const fn of listeners) fn();
};
export const problemsStore = {
  get: () => snapshot,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
let started = false,
  generation = 0,
  request = 0;
function receive(value: ProblemsSnapshot) {
  if (value.projectId !== snapshot.projectId || value.updatedAt < snapshot.updatedAt) return;
  update({ ...value, loading: false, error: '' });
}
export async function refreshProblems(files?: string[]) {
  const projectId = snapshot.projectId,
    current = generation,
    call = ++request;
  if (!projectId) return;
  update({ loading: true });
  try {
    const value = await bridge.problemsGet(projectId, files);
    if (current === generation && call === request) receive(value);
  } catch (error) {
    if (current === generation && call === request)
      update({ loading: false, diagnostics: [], servers: [], error: `Problems unavailable: ${String(error)}` });
  }
}
export function startProblems() {
  if (started) return;
  started = true;
  bridge.onProblemsEvent(receive);
  const switchProject = () => {
    const id = activeFolder()?.project.id || '';
    if (id === snapshot.projectId) return;
    ++generation;
    update({
      projectId: id,
      diagnostics: [],
      servers: [],
      updatedAt: 0,
      error: '',
      actionError: '',
      reveal: null,
      loading: false,
    });
    void refreshProblems();
  };
  workbenchStore.subscribe(switchProject);
  settingsBridge.onSettingsEvent(() => void refreshProblems());
  switchProject();
}
export async function installProblemServer(id: 'typescript' | 'pyright') {
  await bridge.problemsInstall(id);
  await refreshProblems();
}
export async function navigateProblem(problem: Diagnostic, galaxy = false) {
  const projectId = snapshot.projectId;
  update({ actionError: '' });
  try {
    if (galaxy) {
      if (state.dataset !== projectId) throw new Error('Wait for this project to finish loading');
      const index = state.nodes.findIndex(n => n.path === problem.file);
      if (index < 0) throw new Error('This file is not in the analyzed project');
      showGalaxy();
      actions.enterPlanet(index, { line: problem.line });
    } else {
      await openFile(projectId, problem.file, true);
      if (snapshot.projectId !== projectId) return;
      const files = filesStore.get();
      if (!files.documents.some(d => d.id === files.active && d.projectId === projectId && d.path === problem.file))
        throw new Error(files.error || 'Could not open this diagnostic');
      update({ reveal: { ...problem, projectId } });
    }
  } catch (error) {
    if (snapshot.projectId === projectId) update({ actionError: String(error) });
  }
}
