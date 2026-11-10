// Open documents are independent of the galaxy and chat views. A preview becomes permanent as soon as it is edited.
export type FileEntry = { name: string; path: string; directory: boolean; link: boolean; blocked: boolean };
export type FileChange = { projectId: string; path: string };
export type FileDocument = {
  id: string;
  projectId: string;
  path: string;
  name: string;
  text: string;
  savedText: string;
  version: string;
  pinned: boolean;
  saving: boolean;
  error: string;
};
type FilesBridge = {
  createFile(id: string, path: string, text: string): Promise<{ text: string; version: string }>;
  listFiles(id: string, path: string): Promise<FileEntry[]>;
  readFile(id: string, path: string): Promise<{ text: string; version: string }>;
  saveFile(id: string, path: string, text: string, version: string): Promise<{ version: string }>;
  confirmCloseFile(name: string): Promise<'save' | 'discard' | 'cancel'>;
  setDirtyFiles(names: string[]): Promise<void>;
  onSaveAllFiles(fn: () => Promise<boolean>): () => void;
  onFilesChanged(fn: (change: FileChange) => void): () => void;
};
export const filesBridge = window.galaxyDesktop as unknown as FilesBridge;
let state = { documents: [] as FileDocument[], active: null as string | null, loading: '', error: '' };
const listeners = new Set<() => void>();
export const filesStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export const documentKey = (projectId: string, path: string) => `${projectId}:${path}`;
export const isDirty = (doc: FileDocument) => doc.text !== doc.savedText;
export const activeDocument = () => state.documents.find(d => d.id === state.active);
export const fileError = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );
let dirtySignature = '',
  openRequest = 0;
function publish(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  const dirty = state.documents.filter(isDirty).map(d => d.path);
  const signature = JSON.stringify(dirty);
  if (signature !== dirtySignature) {
    dirtySignature = signature;
    void filesBridge.setDirtyFiles(dirty).catch(error => {
      state = { ...state, error: fileError(error) };
      for (const fn of listeners) fn();
    });
  }
  for (const fn of listeners) fn();
}
function update(id: string, patch: Partial<FileDocument>) {
  publish({ documents: state.documents.map(d => (d.id === id ? { ...d, ...patch } : d)) });
}
export function activateFile(id: string | null) {
  ++openRequest;
  publish({ active: id, loading: '', error: '' });
}
export function pinFile(id: string) {
  update(id, { pinned: true });
}
export function editFile(id: string, text: string) {
  update(id, { text, pinned: true });
}
export function clearFileError() {
  publish({ error: '' });
}
export function syncFileWorkspace(ids: string[]) {
  ++openRequest;
  const documents = state.documents.filter(d => ids.includes(d.projectId));
  publish({
    documents,
    active: documents.some(d => d.id === state.active) ? state.active : null,
    loading: '',
    error: '',
  });
}
export async function openFile(projectId: string, path: string, pinned = false) {
  const id = documentKey(projectId, path);
  const request = ++openRequest;
  const existing = state.documents.find(d => d.id === id);
  if (existing) {
    publish({ active: id, loading: '', error: '' });
    if (pinned) pinFile(id);
    return;
  }
  publish({ loading: path, error: '' });
  try {
    const { text, version } = await filesBridge.readFile(projectId, path);
    if (request !== openRequest) return;
    const documents = state.documents.filter(d => d.pinned || isDirty(d));
    documents.push({
      id,
      projectId,
      path,
      name: path.split('/').pop()!,
      text,
      savedText: text,
      version,
      pinned,
      saving: false,
      error: '',
    });
    publish({ documents, active: id, loading: '' });
  } catch (error) {
    if (request === openRequest) publish({ loading: '', error: fileError(error) });
  }
}
const saves = new Map<string, Promise<boolean>>();
export async function saveFile(id = state.active): Promise<boolean> {
  if (!id) return true;
  if (saves.has(id)) return saves.get(id)!;
  const doc = state.documents.find(d => d.id === id);
  if (!doc || !isDirty(doc)) return true;
  const operation = (async () => {
    update(id, { saving: true, error: '' });
    try {
      const { version } = await filesBridge.saveFile(doc.projectId, doc.path, doc.text, doc.version);
      update(id, { savedText: doc.text, version, saving: false });
      return true;
    } catch (error) {
      update(id, { saving: false, error: fileError(error) });
      return false;
    } finally {
      saves.delete(id);
    }
  })();
  saves.set(id, operation);
  return operation;
}
export async function saveAllFiles() {
  for (const doc of state.documents)
    if (!(await saveFile(doc.id))) {
      activateFile(doc.id);
      return false;
    }
  // Typing can continue during an async save; never close over a newer unsaved edit.
  return !state.documents.some(isDirty);
}
const closing = new Set<string>();
export async function closeFile(id = state.active) {
  if (!id || closing.has(id)) return;
  closing.add(id);
  try {
    let doc = state.documents.find(d => d.id === id);
    if (!doc) return;
    if (doc.saving) await saves.get(id);
    doc = state.documents.find(d => d.id === id)!;
    if (isDirty(doc)) {
      const result = await filesBridge.confirmCloseFile(doc.name);
      if (
        result === 'cancel' ||
        (result === 'save' && (!(await saveFile(id)) || isDirty(state.documents.find(d => d.id === id)!)))
      )
        return;
    }
    const index = state.documents.findIndex(d => d.id === id);
    const documents = state.documents.filter(d => d.id !== id);
    publish({
      documents,
      active: state.active === id ? documents[Math.min(index, documents.length - 1)]?.id || null : state.active,
    });
  } finally {
    closing.delete(id);
  }
}
export async function reloadFile(id: string) {
  const doc = state.documents.find(d => d.id === id);
  if (!doc) return;
  if (isDirty(doc)) {
    const answer = await filesBridge.confirmCloseFile(doc.name);
    if (answer === 'cancel') return;
    if (answer === 'save') {
      if (!(await saveFile(id))) return;
      const latest = state.documents.find(d => d.id === id);
      if (!latest || isDirty(latest)) return;
    }
  }
  const beforeRead = state.documents.find(d => d.id === id)?.text;
  try {
    const result = await filesBridge.readFile(doc.projectId, doc.path);
    if (state.documents.find(d => d.id === id)?.text !== beforeRead) {
      update(id, { error: 'The file was edited while reloading. Your latest edits are kept here.' });
      return;
    }
    update(id, { ...result, savedText: result.text, error: '' });
  } catch (error) {
    update(id, { error: fileError(error) });
  }
}
export async function refreshDocuments(change?: FileChange) {
  for (const doc of state.documents) {
    if (
      change &&
      (doc.projectId !== change.projectId ||
        (doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : '') !== change.path)
    )
      continue;
    if (isDirty(doc) || doc.saving) continue;
    try {
      const result = await filesBridge.readFile(doc.projectId, doc.path);
      const latest = state.documents.find(d => d.id === doc.id);
      if (
        latest &&
        !isDirty(latest) &&
        !latest.saving &&
        latest.version === doc.version &&
        result.version !== doc.version
      )
        update(doc.id, { ...result, savedText: result.text, error: '' });
    } catch (error) {
      if (state.documents.some(d => d.id === doc.id)) update(doc.id, { error: fileError(error) });
    }
  }
}
export function startFileWorkspace() {
  filesBridge.onSaveAllFiles(saveAllFiles);
  filesBridge.onFilesChanged(change => void refreshDocuments(change));
  window.addEventListener('focus', () => void refreshDocuments());
}

export async function openOrCreateFile(projectId: string, path: string, text: string) {
  await filesBridge.createFile(projectId, path, text);
  await openFile(projectId, path, true);
}
