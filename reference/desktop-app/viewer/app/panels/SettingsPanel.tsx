import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { activeFolder, command, workbenchStore } from '../workbench.ts';
import { filesBridge, openOrCreateFile } from '../workspace-files.ts';
import {
  exceptionModes,
  settingsBridge,
  type Settings,
  type SettingsSnapshot,
  type DebugConfiguration,
  type AdapterStatus,
} from '../settings.ts';
import { AdapterReadiness } from './AdapterReadiness.tsx';
export function SettingsPanel() {
  const project = useSyncExternalStore(workbenchStore.subscribe, () => activeFolder()?.project.id);
  return <SettingsDialog key={project || 'personal'} project={project} />;
}
function SettingsDialog({ project }: { project?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<'personal' | 'project'>('personal');
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [configs, setConfigs] = useState<DebugConfiguration[]>([]);
  const [error, setError] = useState('');
  const [jsonPath, setJsonPath] = useState('');
  const [notice, setNotice] = useState('');
  const [python, setPython] = useState('python3');
  const refreshAdapters = async () => setAdapters(await settingsBridge.debugAdapterStatus());
  const refreshConfigurations = async () =>
    setConfigs(project ? await settingsBridge.debugConfigurations(project) : []);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current!.showModal();
    let cancelled = false;
    if (project)
      void (async () => {
        const executable = window.galaxyDesktop?.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
        for (const folder of ['.venv', 'venv']) {
          try {
            const entries = await filesBridge.listFiles(project, `${folder}/${executable.split('/')[0]}`);
            if (entries.some(entry => entry.name === executable.split('/')[1] && !entry.directory && !entry.blocked)) {
              if (!cancelled) setPython(`${activeFolder()?.path}/${folder}/${executable}`);
              return;
            }
          } catch {
            /* An absent environment falls through to the next auto-detection candidate. */
          }
        }
      })();
    void Promise.all([
      settingsBridge.settingsGet(project),
      settingsBridge.debugAdapterStatus(),
      project ? settingsBridge.debugConfigurations(project) : Promise.resolve([]),
    ])
      .then(([settings, statuses, rows]) => {
        if (!cancelled) {
          setSnapshot(settings);
          setAdapters(statuses);
          setConfigs(rows);
        }
      })
      .catch(e => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [project]);
  const openJSON = async (launch: boolean) => {
    setError('');
    setNotice('');
    try {
      if (!launch && scope === 'personal') {
        setJsonPath(snapshot?.paths.personal || '');
        return;
      }
      if (!project) throw new Error('Open a project first');
      await openOrCreateFile(
        project,
        launch ? '.vscode/launch.json' : '.galaxy/settings.json',
        JSON.stringify(launch ? { version: '0.2.0', configurations: [] } : snapshot?.project || {}, null, 2) + '\n',
      );
      void command('closeSettings');
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <dialog id="wbSettings" aria-label="Settings" ref={dialog} onClose={() => command('closeSettings')}>
      <header>
        <h2>Settings</h2>
        <button aria-label="Close Settings" onClick={() => command('closeSettings')}>
          Close
        </button>
      </header>
      <label>
        Scope
        <select
          aria-label="Settings scope"
          value={scope}
          onChange={e => {
            setScope(e.target.value as typeof scope);
            setJsonPath('');
          }}
        >
          <option value="personal">Personal</option>
          <option value="project" disabled={!project}>
            This project
          </option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {snapshot ? (
        <SettingsFields
          key={scope}
          python={python}
          scope={scope}
          project={project}
          snapshot={snapshot}
          onSaved={value => {
            setSnapshot(value);
            void refreshConfigurations().catch(e => setError(String(e)));
          }}
        />
      ) : (
        !error && <p>Loading settings…</p>
      )}
      <section>
        <h3>Debug adapters</h3>
        {adapters.map(adapter => (
          <AdapterReadiness key={adapter.id} adapter={adapter} refresh={refreshAdapters} />
        ))}
      </section>
      <section>
        <h3>Launch configurations</h3>
        <ul>
          {configs.map((c, i) => (
            <li key={i} title={c.reason}>
              {c.name} · {c.source}
              {!c.supported && ` · ${c.reason}`}
            </li>
          ))}
        </ul>
        {!configs.length && <p>No launch configurations detected</p>}
        <button disabled={!project} onClick={() => void openJSON(true)}>
          Open launch.json
        </button>
        <button disabled={!snapshot} onClick={() => void openJSON(false)}>
          Open settings JSON
        </button>
        {jsonPath && (
          <div className="settings-path">
            <p>Personal settings path</p>
            <code>{jsonPath}</code>
            <button
              onClick={async () => {
                try {
                  await settingsBridge.copyText(jsonPath);
                  setNotice('Path copied');
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Copy path
            </button>
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
    </dialog>
  );
}
function SettingsFields({
  scope,
  project,
  snapshot,
  onSaved,
  python,
}: {
  python: string;
  scope: 'personal' | 'project';
  project?: string;
  snapshot: SettingsSnapshot;
  onSaved: (value: SettingsSnapshot) => void;
}) {
  const [draft, setDraft] = useState<Settings>(snapshot[scope]);
  const latest = useRef(draft),
    queue = useRef(Promise.resolve()),
    sequence = useRef(0);
  const [status, setStatus] = useState(''),
    [error, setError] = useState('');
  const [maxFiles, setMaxFiles] = useState(
    String((scope === 'project' ? snapshot.effective : draft).problems?.maxFiles ?? 2000),
  );
  const inherited = scope === 'project' ? snapshot.personal : {};
  const debug = { ...inherited.debug, ...draft.debug },
    problems = { ...inherited.problems, ...draft.problems };
  const save = (value: Settings) => {
    const serial = ++sequence.current;
    setStatus('Saving…');
    setError('');
    queue.current = queue.current.then(async () => {
      try {
        const result = await settingsBridge.settingsSet(scope, project, value);
        onSaved(result);
        if (serial === sequence.current) setStatus('Saved');
      } catch (e) {
        if (serial === sequence.current) {
          setError(String(e));
          setStatus('');
        }
      }
    });
  };
  const change = (section: 'debug' | 'problems', key: string, value: unknown, persist = true) => {
    const next = { ...latest.current, [section]: { ...latest.current[section], [key]: value } };
    latest.current = next;
    setDraft(next);
    setStatus('');
    if (persist) save(next);
  };
  return (
    <>
      <section>
        <h3>Debugging</h3>
        <label>
          Python interpreter path
          <input
            aria-label="Python interpreter path"
            placeholder={`Auto-detected: ${python}`}
            value={debug.python || ''}
            onChange={e => change('debug', 'python', e.target.value, false)}
            onBlur={() => save(latest.current)}
          />
        </label>
        <label>
          Default exception mode
          <select
            aria-label="Default exception mode"
            value={debug.exceptionMode || 'failures'}
            onChange={e => change('debug', 'exceptionMode', e.target.value)}
          >
            {exceptionModes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <section>
        <h3>Problems</h3>
        {(
          [
            ['enabled', 'Enable Problems'],
            ['typescript', 'TypeScript / JavaScript'],
            ['python', 'Python'],
            ['java', 'Java'],
          ] as const
        ).map(([key, label]) => (
          <label className="settings-toggle" key={key}>
            <input
              type="checkbox"
              checked={problems[key] ?? true}
              onChange={e => change('problems', key, e.target.checked)}
            />
            {label}
          </label>
        ))}
        <label>
          Max files
          <input
            aria-label="Problems max files"
            type="number"
            min="1"
            step="1"
            value={maxFiles}
            onChange={e => {
              setMaxFiles(e.target.value);
              setStatus('');
            }}
            onBlur={() => {
              const value = Number(maxFiles);
              if (!Number.isSafeInteger(value) || value < 1) {
                setError('Max files must be a positive integer');
                setStatus('');
                return;
              }
              change('problems', 'maxFiles', value);
            }}
          />
        </label>
      </section>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
