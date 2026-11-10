import { state } from './state.ts';
import { activeFolder, showGalaxy } from './workbench.ts';
import { filesStore, openFile } from './workspace-files.ts';

export type SourcePoint = { file: string; text: string; line: number; column: number };
type Context = { file: string; text: string; revision: number | null };
type Result = { status: string; message: string; original?: SourcePoint; generated?: SourcePoint; mapping?: string };
const bridge = window.galaxyDesktop as unknown as {
  navigateSource(
    id: string,
    request: SourcePoint & { direction: 'original' | 'generated'; original?: SourcePoint },
  ): Promise<Result>;
};
let snapshot = {
  projectId: '',
  file: '',
  message: '',
  reveal: null as SourcePoint | null,
  origin: null as { generated: SourcePoint; original: SourcePoint; revision: number | null } | null,
};
const listeners = new Set<() => void>();
const update = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(f => f());
};
export const sourceNavigationStore = {
  get: () => snapshot,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
let requestVersion = 0;
export async function openPlanetSource(point: SourcePoint, revision: number | null) {
  const request = ++requestVersion,
    projectId = activeFolder()?.project.id;
  const initialDocument = filesStore.get().active;
  const view = state.view;
  const current = () =>
    request === requestVersion &&
    activeFolder()?.project.id === projectId &&
    state.dataset === projectId &&
    state.view === view &&
    state.revision === revision;
  try {
    if (!projectId || !current()) throw new Error('This planet source is stale.');
    update({ projectId, file: point.file, message: '', reveal: null, origin: null });
    const result = await bridge.navigateSource(projectId, { ...point, direction: 'original' });
    if (!current()) throw new Error('Project or source revision changed during navigation.');
    if (filesStore.get().active !== initialDocument) throw new Error('Editor changed during navigation.');
    if (result.status !== 'exact' || !result.original || !result.generated) throw new Error(result.message);
    const target = result.original;
    await openFile(projectId, target.file, true);
    if (!current()) throw new Error('Project or source revision changed during navigation.');
    const doc = filesStore.get().documents.find(d => d.projectId === projectId && d.path === target.file);
    if (doc?.text !== target.text || filesStore.get().active !== doc?.id)
      throw new Error('Editor source differs from the mapped revision. No location selected.');
    update({
      projectId,
      file: target.file,
      message: result.message,
      reveal: target,
      origin: { generated: result.generated, original: target, revision },
    });
    return result.message;
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    if (request === requestVersion)
      update({ projectId: projectId || '', file: point.file, message, reveal: null, origin: null });
    return message;
  }
}

export async function revealEditorSource(point: SourcePoint, projectId: string) {
  const request = ++requestVersion,
    view = state.view,
    revision = state.revision;
  const documentCurrent = () => {
    const files = filesStore.get(),
      doc = files.documents.find(d => d.id === files.active);
    return doc?.projectId === projectId && doc.path === point.file && doc.text === point.text;
  };
  const current = () =>
    request === requestVersion &&
    activeFolder()?.project.id === projectId &&
    state.dataset === projectId &&
    state.view === view &&
    state.revision === revision &&
    documentCurrent();
  try {
    if (!current()) throw new Error('Wait for this project to finish loading.');
    const context: Context | null | undefined = await view?.sourceContext?.();
    if (!context || context.revision !== revision)
      throw new Error('Open a current planet before revealing source in its world.');
    let generated = point;
    if (context.file !== point.file) {
      const origin = snapshot.projectId === projectId ? snapshot.origin : null;
      // A round trip retains the particular generated building the user chose,
      // even when a compiler maps several generated points to one authored point.
      const sameOrigin =
        origin &&
        origin.revision === revision &&
        origin.generated.file === context.file &&
        origin.generated.text === context.text &&
        origin.original.file === point.file &&
        origin.original.text === point.text &&
        origin.original.line === point.line &&
        origin.original.column === point.column;
      const result = await bridge.navigateSource(
        projectId,
        sameOrigin
          ? { ...origin.generated, direction: 'original' }
          : { file: context.file, text: context.text, line: 1, column: 1, direction: 'generated', original: point },
      );
      if (result.status !== 'exact' || !result.generated || !result.original) throw new Error(result.message);
      if (
        result.original.text !== point.text ||
        result.original.file !== point.file ||
        result.original.line !== point.line ||
        result.original.column !== point.column
      )
        throw new Error('Source map changed since navigation. No building selected.');
      generated = result.generated;
    }
    if (!current()) throw new Error('Project or source revision changed during navigation.');
    const result = await view?.revealSource?.(generated, current);
    if (!current()) return;
    if (result?.status !== 'exact')
      throw new Error(`Building mapping: ${result?.status || 'unavailable'}. No approximate building selected.`);
    showGalaxy();
    update({ projectId, file: point.file, message: 'Exact source revealed in world' });
  } catch (error) {
    if (request === requestVersion)
      update({ projectId, file: point.file, message: String(error instanceof Error ? error.message : error) });
  }
}
