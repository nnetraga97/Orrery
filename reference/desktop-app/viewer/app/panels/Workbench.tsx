import { AgentShip } from './AgentShip.tsx';
import { AgentShow } from './AgentShow.tsx';
// The Electron window shell: title bar, activity bar, Explorer, editor tabs, Welcome page, status bar, the Open
// Recent picker and the File menu. The galaxy's own header and stage move into the editor area.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import logo from '../../brand/logo.svg';
import { $ } from '../dom.ts';
import {
  actionList,
  activeFolder,
  closePicker,
  command,
  dismissError,
  openPicker,
  pickerClosed,
  showGalaxy,
  showsWelcome,
  startWorkbench,
  toggleExplorer,
  toggleChats,
  workbenchStore,
  type RecentEntry,
  type Workbench as WorkbenchState,
  type WorkbenchOptions,
} from '../workbench.ts';
import { ProblemsPanel } from './ProblemsPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { problemsStore, startProblems } from '../problems.ts';
import { DebugPanel } from './DebugPanel.tsx';
import { debugStore, toggleDebug } from '../debug.ts';
import { Icon } from './Icon.tsx';
import { FileExplorer } from './FileExplorer.tsx';
import { activateFile, clearFileError, closeFile, filesStore, isDirty, pinFile } from '../workspace-files.ts';
import { projectStore } from '../project-store.ts';
const FileEditor = lazy(() => import('./FileEditor.tsx'));

function useWorkbench<T>(select: (w: WorkbenchState) => T): T {
  return useSyncExternalStore(workbenchStore.subscribe, () => select(workbenchStore.get()));
}

function Shell() {
  const problemsOpen = useWorkbench(w => w.problemsOpen);
  const settingsOpen = useWorkbench(w => w.settingsOpen);
  const debugOpen = useSyncExternalStore(debugStore.subscribe, () => debugStore.get().open);
  const activeFile = useSyncExternalStore(filesStore.subscribe, () => filesStore.get().active);
  const welcome = useWorkbench(showsWelcome) && !activeFile;
  const busy = useWorkbench(w => !!w.busy);
  const chatsOpen = useSyncExternalStore(projectStore.subscribe, () => projectStore.get().panelOpen);
  useLayoutEffect(() => {
    const chat = document.getElementById('agentPanel');
    if (chat) document.getElementById('wbBody')!.append(chat);
  }, []);
  useLayoutEffect(() => {
    document.body.classList.toggle('workspace-file', !!activeFile);
    window.dispatchEvent(new Event('resize'));
  }, [activeFile]);
  const explorerHidden = useWorkbench(w => w.explorerHidden);
  useEffect(() => {
    document.body.classList.toggle('workspace-welcome', welcome);
    // Leaving or returning to Welcome resizes the galaxy's stage.
    window.dispatchEvent(new Event('resize'));
  }, [welcome]);
  useEffect(() => {
    document.body.classList.toggle('workspace-busy', busy);
  }, [busy]);
  useEffect(() => {
    document.body.classList.toggle('explorer-hidden', explorerHidden);
    window.dispatchEvent(new Event('resize'));
  }, [explorerHidden]);
  return (
    <>
      <TitleBar />
      <div id="wbBody">
        <nav id="wbActivity" aria-label="Activity bar">
          <button
            id="wbExplorerActivity"
            aria-label="Explorer"
            title="Explorer"
            aria-pressed={!explorerHidden && !debugOpen && !problemsOpen}
            onClick={() => {
              if (problemsOpen) {
                void command('closeProblems');
                if (debugOpen) toggleDebug();
                if (explorerHidden) toggleExplorer();
              } else if (debugOpen) {
                toggleDebug();
                if (explorerHidden) toggleExplorer();
              } else toggleExplorer();
            }}
          >
            <Icon name="folder" />
          </button>
          <button
            id="wbChatsActivity"
            aria-label="Chats"
            title="Chats (⌘/Ctrl Alt B)"
            aria-pressed={chatsOpen}
            aria-controls="agentPanel"
            onClick={toggleChats}
          >
            <Icon name="chats" />
          </button>
          <button
            aria-label="Run and Debug"
            title="Run and Debug"
            aria-pressed={debugOpen && !problemsOpen}
            onClick={() => {
              void command('closeProblems');
              if (!debugOpen || !problemsOpen) toggleDebug();
            }}
          >
            <Icon name="bug" />
          </button>
          <button id="wbHomeActivity" aria-label="Welcome" title="Welcome" onClick={() => command('welcome')}>
            <Icon name="galaxy" />
          </button>
        </nav>
        {!debugOpen && !problemsOpen && <FileExplorer />}
        {problemsOpen && <ProblemsPanel />}
        <div className="debug-panel-slot" hidden={problemsOpen}>
          <DebugPanel />
        </div>
        <Editor />
      </div>
      {createPortal(
        <>
          <StatusBar />
          {settingsOpen && <SettingsPanel />}
          <ErrorNotice />
          <Picker />
        </>,
        document.body,
      )}
      {createPortal(<FileMenu />, $('projectPop'))}
    </>
  );
}

function TitleBar() {
  const name = useWorkbench(w => w.workspace.current?.name);
  const explorerHidden = useWorkbench(w => w.explorerHidden);
  const chatsOpen = useSyncExternalStore(projectStore.subscribe, () => projectStore.get().panelOpen);
  useEffect(() => {
    document.title = name ? `${name} — Codebase Galaxy` : 'Welcome — Codebase Galaxy';
  }, [name]);
  return (
    <div id="wbTitlebar">
      <span className="wb-brand">
        <Icon name="galaxy" />
      </span>
      <button id="wbCommandCenter" aria-label="Open recent folders and workspaces" onClick={openPicker}>
        <Icon name="folder" />
        <span id="wbTitle">{name || 'Codebase Galaxy'}</span>
        <span className="wb-title-disclosure" aria-hidden="true">
          ⌄
        </span>
      </button>
      <div className="wb-layout-actions">
        <button
          id="wbSidebarToggle"
          aria-label="Toggle Explorer"
          title="Toggle Explorer (⌘/Ctrl B)"
          aria-expanded={!explorerHidden}
          aria-controls="wbExplorer"
          onClick={toggleExplorer}
        >
          <Icon name="sidebarLeft" />
        </button>
        <button
          id="wbChatsToggle"
          aria-label="Toggle Chats"
          title="Toggle Chats (⌘/Ctrl Alt B)"
          aria-expanded={chatsOpen}
          aria-controls="agentPanel"
          onClick={toggleChats}
        >
          <Icon name="sidebarRight" />
        </button>
      </div>
    </div>
  );
}

function Editor() {
  const files = useSyncExternalStore(filesStore.subscribe, filesStore.get);
  const welcome = useWorkbench(showsWelcome) && !files.active;
  const folderName = useWorkbench(w => activeFolder(w)?.name);
  const hasFolder = useWorkbench(w => !!w.workspace.current?.activeProjectId);
  const recent = useWorkbench(w => w.workspace.recent);
  const welcomeFocus = useWorkbench(w => w.welcomeFocus);
  const editor = useRef<HTMLElement>(null);
  const welcomePage = useRef<HTMLElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (welcomeFocus) title.current!.focus();
  }, [welcomeFocus]);
  // The galaxy's header and stage live between the tabs and the Welcome page. React never moves its own two
  // children here, so these nodes keep their place.
  useLayoutEffect(() => {
    const header = document.querySelector('body > header'),
      main = document.querySelector('body > main');
    if (header && main) editor.current!.insertBefore(header, welcomePage.current).after(main);
  }, []);
  return (
    <section id="wbEditor" aria-label="Workspace" ref={editor}>
      <div
        id="wbTabs"
        role="tablist"
        aria-label="Workspace views"
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(
            t => !t.hidden,
          );
          const index = tabs.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
          tabs[next].focus();
          tabs[next].click();
        }}
      >
        <button id="wbWelcomeTab" role="tab" aria-selected={welcome} onClick={() => command('welcome')}>
          Welcome
        </button>
        <button
          id="wbGalaxyTab"
          role="tab"
          aria-selected={!welcome && !files.active}
          hidden={!hasFolder}
          onClick={showGalaxy}
        >
          <Icon name="galaxy" /> {folderName || 'Galaxy'}
        </button>
        {files.documents.map(doc => (
          <div key={doc.id} className={`wb-file-tab${files.active === doc.id ? ' active' : ''}`}>
            <button
              role="tab"
              aria-selected={files.active === doc.id}
              className={doc.pinned ? '' : 'preview'}
              title={doc.path}
              onClick={() => activateFile(doc.id)}
              onDoubleClick={() => pinFile(doc.id)}
            >
              <Icon name="file" />
              <span>{doc.name}</span>
              {files.documents.some(other => other.id !== doc.id && other.name === doc.name) && (
                <small>{doc.path.includes('/') ? doc.path.slice(0, doc.path.lastIndexOf('/')) : 'root'}</small>
              )}
            </button>
            <button
              className={`wb-tab-close${isDirty(doc) ? ' dirty' : ''}`}
              title={isDirty(doc) ? `Close ${doc.name} (unsaved changes)` : `Close ${doc.name}`}
              aria-label={`Close ${doc.name}`}
              onClick={() => void closeFile(doc.id)}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
      <AgentShow />
      <AgentShip />
      <div className="wb-file-notice" role="status" hidden={!files.error && !files.loading}>
        <span>{files.error || `Opening ${files.loading}…`}</span>
        {files.error && (
          <button aria-label="Dismiss file error" onClick={clearFileError}>
            <Icon name="close" />
          </button>
        )}
      </div>
      <section id="wbWelcome" aria-label="Welcome" hidden={!welcome} ref={welcomePage}>
        <div className="wb-welcome-inner">
          <h1 id="wbWelcomeTitle" tabIndex={-1} ref={title}>
            <img className="wb-logo" src={logo} alt="" />
            Codebase Galaxy
          </h1>
          <p className="wb-subtitle">Explore your code. Build your world.</p>
          <div className="wb-welcome-columns">
            <div>
              <section className="wb-start">
                <h2>Start</h2>
                <div id="wbStartActions">
                  {actionList.map(([action, shape, label]) => (
                    <button key={action} className="wb-start-link" onClick={() => command(action)}>
                      <Icon name={shape} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="wb-recents">
                <h2>Recent</h2>
                <div id="wbRecent">
                  <RecentRows items={recent.slice(0, 7)} />
                </div>
                <button id="wbMoreRecent" className="wb-text-button" hidden={recent.length < 8} onClick={openPicker}>
                  More…
                </button>
              </section>
            </div>
            <section className="wb-guide">
              <h2>Your workspace</h2>
              <GuideRow icon="folder" title="Start with a folder" text="Open code where it lives on your computer." />
              <GuideRow
                icon="layers"
                title="Bring projects together"
                text="Open a .code-workspace file, or add folders and save a workspace."
              />
              <GuideRow
                icon="galaxy"
                title="Explore and build"
                text="Browse files in Explorer, explore the galaxy, and keep Chats alongside your work."
              />
            </section>
          </div>
        </div>
      </section>
      {files.documents.length > 0 && (
        <Suspense fallback={files.active ? <div className="wb-editor-loading">Loading editor…</div> : null}>
          <FileEditor />
        </Suspense>
      )}
    </section>
  );
}

function GuideRow({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="wb-guide-row">
      <Icon name={icon} />
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
    </div>
  );
}

function RecentRows({ items, removable = false }: { items: RecentEntry[]; removable?: boolean }) {
  const anyRecent = useWorkbench(w => w.workspace.recent.length > 0);
  if (!items.length)
    return (
      <p className="wb-muted">
        {anyRecent
          ? 'No matching folders or workspaces.'
          : 'Your recently opened folders and workspaces will appear here.'}
      </p>
    );
  return items.map(item => (
    <div key={item.id} className="wb-recent-row">
      <button
        className="wb-recent-open"
        title={item.path}
        onClick={() => {
          closePicker();
          void command('openRecent', item.id);
        }}
      >
        <Icon name={item.kind === 'workspace' ? 'layers' : 'folder'} />
        <span className="wb-recent-name">{item.name}</span>
        <small>{item.kind === 'workspace' ? 'Workspace' : 'Folder'}</small>
        <span className="wb-recent-path">{item.path}</span>
      </button>
      {removable && (
        <button
          className="wb-remove"
          title={`Remove ${item.name} from recent`}
          aria-label={`Remove ${item.name} from recent`}
          onClick={() => command('removeRecent', item.id)}
        >
          ×
        </button>
      )}
    </div>
  ));
}

function Picker() {
  const open = useWorkbench(w => w.picker);
  const recent = useWorkbench(w => w.workspace.recent);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) {
      setQuery('');
      d.showModal();
      input.current!.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  const q = query.trim().toLowerCase();
  return (
    <dialog
      id="wbPicker"
      aria-label="Open Recent"
      ref={dialog}
      onClose={pickerClosed}
      onClick={e => {
        // A click on the backdrop lands on the dialog itself, outside its box.
        if (e.target !== dialog.current) return;
        const r = dialog.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePicker();
      }}
    >
      <input
        id="wbQuickInput"
        ref={input}
        type="search"
        aria-label="Search recent folders and workspaces"
        placeholder="Search recent folders and workspaces…"
        autoComplete="off"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            list.current?.querySelector('button')?.focus();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            list.current?.querySelector('button')?.click();
          }
        }}
      />
      <h2>recently opened</h2>
      <div id="wbQuickRecent" ref={list}>
        <RecentRows items={recent.filter(r => `${r.name} ${r.path}`.toLowerCase().includes(q))} removable />
      </div>
      <div id="wbQuickActions">
        {actionList
          .filter(([, , label]) => label.toLowerCase().includes(q))
          .map(([action, , label]) => (
            <button
              key={action}
              onClick={() => {
                closePicker();
                void command(action);
              }}
            >
              {label}
            </button>
          ))}
      </div>
      <button id="wbQuickClose" onClick={closePicker}>
        Close
      </button>
    </dialog>
  );
}

function StatusBar() {
  const problems = useSyncExternalStore(problemsStore.subscribe, problemsStore.get);
  const open = useWorkbench(w => w.problemsOpen);
  useEffect(startProblems, []);
  const current = useWorkbench(w => w.workspace.current);
  const busy = useWorkbench(w => w.busy);
  const folderName = useWorkbench(w => activeFolder(w)?.name);
  const count = current?.folders.length ?? 0;
  return (
    <footer id="wbStatus">
      <button
        id="wbProblemsStatus"
        aria-label="Problems"
        aria-expanded={open}
        aria-controls="wbProblems"
        onClick={() => command('problems')}
        title={problems.error || 'Show Problems'}
      >
        <Icon name="error" /> {problems.diagnostics.filter(d => d.severity === 'error').length}
        <Icon name="warning" /> {problems.diagnostics.filter(d => d.severity === 'warning').length}
        {problems.error && <span>Problems unavailable</span>}
      </button>
      <span id="wbStatusContext">
        {current
          ? `${count} folder${count === 1 ? '' : 's'}${current.kind === 'workspace' && !current.path ? ' · Unsaved workspace' : ''}`
          : 'No folder opened'}
      </span>
      <span id="wbStatusHint">{busy || folderName || 'Codebase Galaxy'}</span>
    </footer>
  );
}

function ErrorNotice() {
  const error = useWorkbench(w => w.error);
  return (
    <div id="wbError" role="alert" hidden={!error}>
      <span id="wbErrorText">{error}</span>
      <button id="wbDismissError" aria-label="Dismiss error" onClick={dismissError}>
        ×
      </button>
    </div>
  );
}

const FILE_MENU = [
  ...actionList,
  ['recent', '', 'Open Recent…'],
  ['settings', '', 'Settings…'],
  ['addFolder', '', 'Add Folder to Workspace…'],
  ['saveWorkspace', '', 'Save Workspace As…'],
  ['welcome', '', 'Welcome'],
  ['closeWorkspace', '', 'Close Folder / Workspace'],
] as const;

function FileMenu() {
  const unavailable = useWorkbench(w => !!w.busy || !w.workspace.current);
  return FILE_MENU.map(([action, , label]) => {
    const needsWorkspace = action === 'saveWorkspace' || action === 'closeWorkspace';
    return (
      <button
        key={action}
        data-wb-needs-workspace={needsWorkspace ? '' : undefined}
        disabled={needsWorkspace && unavailable}
        onClick={() => command(action)}
      >
        {label}
      </button>
    );
  });
}

/** Builds the shell around the galaxy, then loads the workspace; resolves to the dataset to show first. */
export function mountWorkbench(options: WorkbenchOptions) {
  document.body.classList.add('desktop-workbench');
  document.body.dataset.platform = options.bridge.platform;
  const root = document.createElement('div');
  root.id = 'workbench';
  root.style.display = 'contents';
  document.body.prepend(root);
  flushSync(() => createRoot(root).render(<Shell />));
  return startWorkbench(options);
}
