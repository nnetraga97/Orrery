import { projectStore, remember, remembered, setPanelOpen } from './project-store.ts';
import {
  activateFile,
  closeFile,
  saveAllFiles,
  saveFile,
  startFileWorkspace,
  syncFileWorkspace,
} from './workspace-files.ts';
// The Electron workbench: which folder or workspace is open, recent entries, and the commands that change them.
// Native paths and workspace files are owned by main; panels/Workbench.tsx renders this state.

export const WELCOME = '__desktop-welcome__';

export type WorkspaceProject = { id: string; name: string; fileCount: number; version: number };
export type WorkspaceFolder = { name: string; path: string; project: WorkspaceProject };
export type Workspace = {
  name: string;
  kind: 'folder' | 'workspace';
  /** The .code-workspace file; absent for an unsaved workspace. */
  path?: string;
  folders: WorkspaceFolder[];
  activeProjectId?: string;
};
export type RecentEntry = { id: string; name: string; path: string; kind: 'folder' | 'workspace' };
export type WorkspaceState = { current: Workspace | null; recent: RecentEntry[] };

/** The workspace methods of the Electron preload bridge (desktop/preload.cjs). */
type WorkspaceBridge = {
  platform: string;
  workspaceState(): Promise<WorkspaceState>;
  openFolder(): Promise<WorkspaceState | null>;
  createFolder(): Promise<WorkspaceState | null>;
  openWorkspace(): Promise<WorkspaceState | null>;
  addWorkspaceFolder(): Promise<WorkspaceState | null>;
  saveWorkspace(): Promise<WorkspaceState | null>;
  closeWorkspace(): Promise<WorkspaceState | null>;
  openRecent(id: string): Promise<WorkspaceState | null>;
  removeRecent(id: string): Promise<WorkspaceState | null>;
  selectWorkspaceFolder(id: string): Promise<WorkspaceState | null>;
  onWorkspaceCommand(callback: (command: string) => void): () => void;
};
export type WorkbenchOptions = {
  bridge: WorkspaceBridge;
  useDataset: (name: string) => Promise<void>;
  addProject: (project: WorkspaceProject) => void;
};

export type Workbench = {
  workspace: WorkspaceState;
  /** Welcome was chosen; it also shows whenever no folder is active (see showsWelcome). */
  welcome: boolean;
  /** What the status bar says while a command runs. */
  busy: string | null;
  error: string;
  explorerHidden: boolean;
  picker: boolean;
  problemsOpen: boolean;
  settingsOpen: boolean;
  /** Increments when the Welcome command runs, so the page focuses its title once shown. */
  welcomeFocus: number;
};

let wb: Workbench = {
  workspace: { current: null, recent: [] },
  welcome: true,
  busy: null,
  error: '',
  explorerHidden: false,
  picker: false,
  problemsOpen: false,
  settingsOpen: false,
  welcomeFocus: 0,
};
const listeners = new Set<() => void>();
let options: WorkbenchOptions;

export const workbenchStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get: () => wb,
};
function set(patch: Partial<Workbench>) {
  wb = { ...wb, ...patch };
  for (const fn of listeners) fn();
}

export const showsWelcome = (w = wb) => w.welcome || !w.workspace.current?.activeProjectId;
export const activeFolder = (w = wb) =>
  w.workspace.current?.folders.find(f => f.project.id === w.workspace.current?.activeProjectId);

export const actionList = [
  ['openFolder', 'folder', 'Open Folder…'],
  ['openWorkspace', 'layers', 'Open Workspace from File…'],
  ['createFolder', 'folderPlus', 'New Folder…'],
] as const;
const bridgeMethods = {
  openFolder: 'openFolder',
  createFolder: 'createFolder',
  openWorkspace: 'openWorkspace',
  addFolder: 'addWorkspaceFolder',
  saveWorkspace: 'saveWorkspace',
  closeWorkspace: 'closeWorkspace',
  openRecent: 'openRecent',
  removeRecent: 'removeRecent',
  selectFolder: 'selectWorkspaceFolder',
} as const;
export type WorkbenchCommand = keyof typeof bridgeMethods | 'recent' | 'welcome';

async function apply(next: WorkspaceState, { navigate = true, resetFiles = false } = {}) {
  syncFileWorkspace(resetFiles ? [] : next.current?.folders.map(f => f.project.id) || []);
  for (const folder of next.current?.folders || []) options.addProject(folder.project);
  set({ workspace: next, ...(navigate && { welcome: !next.current?.activeProjectId }) });
  if (navigate) await options.useDataset(next.current?.activeProjectId || WELCOME);
}
const cleanError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

export async function command(action: string, id?: string) {
  if (action === 'problems') return set({ problemsOpen: !wb.problemsOpen });
  if (action === 'settings') return set({ settingsOpen: true });
  if (action === 'closeSettings') return set({ settingsOpen: false });
  if (action === 'closeProblems') return set({ problemsOpen: false });
  if (action === 'toggleExplorer') return toggleExplorer();
  if (action === 'toggleChats') return toggleChats();
  if (action === 'saveFile') return saveFile();
  if (action === 'saveAllFiles') return saveAllFiles();
  if (action === 'closeEditor') return closeFile();
  if (action === 'recent') return openPicker();
  if (action === 'welcome') {
    activateFile(null);
    set({ welcome: true, welcomeFocus: wb.welcomeFocus + 1 });
    return;
  }
  if (wb.busy || !(action in bridgeMethods)) return;
  const method = bridgeMethods[action as keyof typeof bridgeMethods];
  set({ busy: action === 'saveWorkspace' ? 'Saving workspace…' : 'Opening…', error: '' });
  try {
    const next = await options.bridge[method](id as string);
    if (next) {
      if (action === 'selectFolder') activateFile(null);
      await apply(next, {
        navigate: !['saveWorkspace', 'removeRecent'].includes(action),
        resetFiles: ['openFolder', 'createFolder', 'openWorkspace', 'openRecent', 'closeWorkspace'].includes(action),
      });
    }
  } catch (error) {
    // Saving an untitled workspace can succeed even if the following open fails.
    try {
      await apply(await options.bridge.workspaceState(), { navigate: false });
    } catch {}
    set({ error: cleanError(error) });
  } finally {
    set({ busy: null });
  }
}

let lastFocus: Element | null = null;
export function openPicker() {
  lastFocus = document.activeElement;
  set({ picker: true });
}
export const closePicker = () => set({ picker: false });
/** The picker dialog closed (Close, Escape, a backdrop click or a chosen entry): focus returns to where it was. */
export function pickerClosed() {
  set({ picker: false });
  if (lastFocus instanceof HTMLElement) lastFocus.focus();
}
export const showGalaxy = () => {
  activateFile(null);
  set({ welcome: false });
};
export const toggleExplorer = () => {
  remember('galaxyExplorer', wb.explorerHidden ? 'open' : 'closed');
  set({ explorerHidden: !wb.explorerHidden });
};
export const toggleChats = () => setPanelOpen(!projectStore.get().panelOpen);
export const dismissError = () => set({ error: '' });

/** Loads the workspace state; resolves to the dataset to show first. */
export async function startWorkbench(next: WorkbenchOptions) {
  options = next;
  startFileWorkspace();
  set({ explorerHidden: remembered('galaxyExplorer') === 'closed' });
  next.bridge.onWorkspaceCommand(command);
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && (e.code === 'KeyB' || e.key.toLowerCase() === 'b') && !e.shiftKey) {
      e.preventDefault();
      e.altKey ? toggleChats() : toggleExplorer();
    }
  });
  const state = await next.bridge.workspaceState();
  for (const folder of state.current?.folders || []) next.addProject(folder.project);
  set({ workspace: state, welcome: !state.current?.activeProjectId });
  return state.current?.activeProjectId || WELCOME;
}
