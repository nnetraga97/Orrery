import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { command, toggleExplorer, workbenchStore, type WorkspaceFolder } from '../workbench.ts';
import { documentKey, fileError, filesBridge, filesStore, openFile, type FileEntry } from '../workspace-files.ts';
import { Icon } from './Icon.tsx';
type Branch = { entries: FileEntry[]; loading: boolean; error: string };
type Row = FileEntry & { id: string; projectId: string; depth: number; parent?: string; root?: WorkspaceFolder };
const empty: WorkspaceFolder[] = [];
export function FileExplorer() {
  const current = useSyncExternalStore(workbenchStore.subscribe, () => workbenchStore.get().workspace.current);
  const active = useSyncExternalStore(filesStore.subscribe, () => filesStore.get().active);
  const folders = current?.folders || empty;
  const rootsKey = folders.map(f => f.project.id).join('|');
  const [branches, setBranches] = useState<Record<string, Branch>>({});
  const [expanded, setExpanded] = useState(new Set<string>());
  const [focused, setFocused] = useState('');
  const tree = useRef<HTMLDivElement>(null);
  const loaded = useRef(new Map<string, { projectId: string; path: string }>());
  const requests = useRef(new Map<string, number>());
  const read = useCallback(async (projectId: string, path: string) => {
    const id = documentKey(projectId, path),
      request = (requests.current.get(id) || 0) + 1;
    requests.current.set(id, request);
    loaded.current.set(id, { projectId, path });
    setBranches(previous => ({
      ...previous,
      [id]: { entries: previous[id]?.entries || [], loading: true, error: '' },
    }));
    try {
      const entries = await filesBridge.listFiles(projectId, path);
      if (requests.current.get(id) === request)
        setBranches(previous => ({ ...previous, [id]: { entries, loading: false, error: '' } }));
    } catch (error) {
      if (requests.current.get(id) === request)
        setBranches(previous => ({
          ...previous,
          [id]: { entries: previous[id]?.entries || [], loading: false, error: fileError(error) },
        }));
    }
  }, []);
  useEffect(() => {
    loaded.current.clear();
    requests.current.clear();
    setBranches({});
    const roots = folders.map(f => documentKey(f.project.id, ''));
    setExpanded(new Set(roots));
    setFocused(roots[0] || '');
    for (const folder of folders) void read(folder.project.id, '');
    return () => {
      for (const [key, value] of requests.current) requests.current.set(key, value + 1);
    };
  }, [rootsKey, read]);
  const refresh = useCallback(() => {
    for (const folder of loaded.current.values()) void read(folder.projectId, folder.path);
  }, [read]);
  useEffect(() => {
    const unsubscribe = filesBridge.onFilesChanged(change => {
      if (loaded.current.has(documentKey(change.projectId, change.path))) void read(change.projectId, change.path);
    });
    window.addEventListener('focus', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, [read, refresh]);
  const rows = useMemo(() => {
    const result: Row[] = [];
    const append = (row: Row) => {
      result.push(row);
      if (row.directory && expanded.has(row.id))
        for (const entry of branches[row.id]?.entries || [])
          append({
            ...entry,
            id: documentKey(row.projectId, entry.path),
            projectId: row.projectId,
            depth: row.depth + 1,
            parent: row.id,
          });
    };
    for (const folder of folders)
      append({
        id: documentKey(folder.project.id, ''),
        projectId: folder.project.id,
        name: folder.name,
        path: '',
        directory: true,
        blocked: false,
        link: false,
        depth: 0,
        root: folder,
      });
    return result;
  }, [folders, branches, expanded]);
  const focusRow = (id: string) => {
    setFocused(id);
    requestAnimationFrame(() =>
      tree.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus(),
    );
  };
  const toggle = (row: Row, force?: boolean) => {
    const open = force ?? !expanded.has(row.id);
    setExpanded(previous => {
      const next = new Set(previous);
      if (open) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
    if (open && (!branches[row.id] || branches[row.id].error)) void read(row.projectId, row.path);
  };
  const typeahead = useRef({ text: '', time: 0 });
  const keyboard = (event: KeyboardEvent, row: Row) => {
    const index = rows.findIndex(r => r.id === row.id);
    if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key))
      event.preventDefault();
    switch (event.key) {
      case 'ArrowDown':
        focusRow(rows[Math.min(index + 1, rows.length - 1)].id);
        break;
      case 'ArrowUp':
        focusRow(rows[Math.max(index - 1, 0)].id);
        break;
      case 'Home':
        focusRow(rows[0].id);
        break;
      case 'End':
        focusRow(rows[rows.length - 1].id);
        break;
      case 'ArrowRight':
        if (row.directory) {
          if (!expanded.has(row.id)) toggle(row, true);
          else if (rows[index + 1]?.parent === row.id) focusRow(rows[index + 1].id);
        }
        break;
      case 'ArrowLeft':
        if (row.directory && expanded.has(row.id)) toggle(row, false);
        else if (row.parent) focusRow(row.parent);
        break;
      case 'Enter':
      case ' ':
        if (!row.blocked) {
          row.directory ? toggle(row) : void openFile(row.projectId, row.path, event.key === 'Enter');
        }
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          typeahead.current.text =
            (Date.now() - typeahead.current.time < 700 ? typeahead.current.text : '') + event.key.toLowerCase();
          typeahead.current.time = Date.now();
          const next = [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find(r =>
            r.name.toLowerCase().startsWith(typeahead.current.text),
          );
          if (next) focusRow(next.id);
        }
    }
  };
  const tabStop = rows.some(row => row.id === focused) ? focused : rows[0]?.id;
  return (
    <aside id="wbExplorer" aria-label="Explorer">
      <div className="wb-explorer-heading">
        <span>Explorer</span>
        <div className="wb-explorer-actions">
          <button title="Refresh Explorer" aria-label="Refresh Explorer" hidden={!current} onClick={refresh}>
            <Icon name="refresh" />
          </button>
          <button
            title="Collapse Folders"
            aria-label="Collapse Folders"
            hidden={!current}
            onClick={() => {
              setExpanded(new Set());
              focusRow(rows[0]?.id || '');
            }}
          >
            <Icon name="collapse" />
          </button>
          <button title="Collapse Explorer (⌘/Ctrl B)" aria-label="Collapse Explorer" onClick={toggleExplorer}>
            <Icon name="sidebarLeft" />
          </button>
        </div>
      </div>
      <div className="wb-root-heading">
        <h2 id="wbExplorerLabel">{current?.name || 'No Folder Opened'}</h2>
        <button
          id="wbAddFolder"
          title="Add Folder to Workspace"
          aria-label="Add Folder to Workspace"
          hidden={!current}
          onClick={() => command('addFolder')}
        >
          <Icon name="folderPlus" />
        </button>
      </div>
      <div id="wbFolderList" role="tree" aria-label="Files" ref={tree}>
        {rows.map(row => (
          <div key={row.id} className="wb-tree-entry">
            <div
              role="treeitem"
              className={`wb-tree-row${row.root ? ' wb-folder' : ''}`}
              tabIndex={row.id === tabStop ? 0 : -1}
              data-tree-id={row.id}
              data-path={row.path}
              data-project={row.projectId}
              data-directory={row.directory}
              aria-level={row.depth + 1}
              aria-expanded={row.directory ? expanded.has(row.id) : undefined}
              aria-selected={active === row.id}
              aria-label={row.name}
              aria-disabled={row.blocked || undefined}
              title={
                row.blocked ? 'This link points outside the workspace or is unavailable.' : row.root?.path || row.path
              }
              style={{ paddingLeft: 8 + row.depth * 14 }}
              onFocus={() => setFocused(row.id)}
              onClick={event => {
                if (row.directory && event.detail > 1) return;
                if (!row.blocked) {
                  setFocused(row.id);
                  row.directory ? toggle(row) : void openFile(row.projectId, row.path);
                }
              }}
              onDoubleClick={() => {
                if (!row.directory && !row.blocked) void openFile(row.projectId, row.path, true);
              }}
              onKeyDown={e => {
                if (e.target === e.currentTarget) keyboard(e, row);
              }}
            >
              <span className={`wb-tree-chevron${expanded.has(row.id) ? ' expanded' : ''}`}>
                {row.directory && <Icon name="chevron" />}
              </span>
              <span className={`wb-tree-icon ${row.directory ? 'directory' : fileColor(row.name)}`}>
                <Icon name={row.directory ? 'folder' : 'file'} />
              </span>
              <span className="wb-tree-name">{row.name}</span>
              {row.link && (
                <span className="wb-link-mark" title="Symbolic link">
                  ↗
                </span>
              )}
              {row.root && (
                <button
                  className="wb-folder-galaxy"
                  aria-label={`View ${row.name} galaxy`}
                  title={`View ${row.name} galaxy`}
                  onClick={e => {
                    e.stopPropagation();
                    void command('selectFolder', row.projectId);
                  }}
                >
                  <Icon name="galaxy" />
                </button>
              )}
            </div>
            {row.directory && expanded.has(row.id) && branches[row.id]?.loading && !branches[row.id].entries.length && (
              <div className="wb-tree-message" role="status">
                Loading…
              </div>
            )}
            {row.directory && expanded.has(row.id) && branches[row.id]?.error && (
              <button className="wb-tree-message wb-tree-retry" onClick={() => void read(row.projectId, row.path)}>
                {branches[row.id].error} Retry
              </button>
            )}
            {row.directory &&
              expanded.has(row.id) &&
              branches[row.id] &&
              !branches[row.id].loading &&
              !branches[row.id].error &&
              !branches[row.id].entries.length && <div className="wb-tree-message">Empty folder</div>}
          </div>
        ))}
      </div>
      {!folders.length && (
        <div id="wbNoFolder">
          <p>{current ? 'This workspace has no folders yet.' : 'You have not yet opened a folder.'}</p>
          <button
            id="wbExplorerOpen"
            className="wb-primary"
            onClick={() => command(current ? 'addFolder' : 'openFolder')}
          >
            {current ? 'Add Folder' : 'Open Folder'}
          </button>
        </div>
      )}
      <div className="wb-explorer-bottom">
        <button id="wbExplorerRecent" onClick={() => command('recent')}>
          Open Recent…
        </button>
      </div>
    </aside>
  );
}
function fileColor(name: string) {
  if (/\.[cm]?tsx?$/.test(name)) return 'typescript';
  if (/\.[cm]?jsx?$/.test(name)) return 'javascript';
  if (/\.(json|ya?ml)$/.test(name)) return 'config';
  if (/\.(css|scss|html|svg)$/.test(name)) return 'markup';
  return '';
}
