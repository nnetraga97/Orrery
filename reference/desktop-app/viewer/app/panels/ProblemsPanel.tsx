import { useState, useSyncExternalStore } from 'react';
import {
  installProblemServer,
  navigateProblem,
  problemsStore,
  refreshProblems,
  type ProblemServer,
} from '../problems.ts';
import { Icon } from './Icon.tsx';
function ServerStatus({ server }: { server: ProblemServer }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="problem-server">
      <strong>{server.label}</strong>
      <p>{server.reason || server.status}</p>
      {server.installable && server.id !== 'jdtls' && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await installProblemServer(server.id as 'typescript' | 'pyright');
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Installing…' : 'Install'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ProblemsPanel() {
  const p = useSyncExternalStore(problemsStore.subscribe, problemsStore.get);
  const [filter, setFilter] = useState('');
  const [severities, setSeverities] = useState({ error: true, warning: true, info: true });
  const rows = p.diagnostics.filter(
    d =>
      severities[d.severity === 'hint' ? 'info' : d.severity] &&
      `${d.file} ${d.message} ${d.source}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const files = new Map<string, typeof rows>();
  for (const row of rows) files.set(row.file, [...(files.get(row.file) || []), row]);
  return (
    <aside id="wbProblems" aria-label="Problems">
      <header>
        <strong>Problems</strong>
        <button onClick={() => void refreshProblems()} disabled={p.loading}>
          Refresh
        </button>
      </header>
      <div className="problems-filters">
        {(
          [
            ['error', 'Errors'],
            ['warning', 'Warnings'],
            ['info', 'Info'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={severities[key]}
            onClick={() => setSeverities({ ...severities, [key]: !severities[key] })}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        type="search"
        aria-label="Filter problems"
        placeholder="Filter problems…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      {p.error && <p role="alert">{p.error}</p>}
      {p.actionError && <p role="alert">{p.actionError}</p>}
      <div aria-label="Language servers">
        {p.servers
          // Idle servers are not needed for this project (yet); only problems worth acting on are listed.
          .filter(s => s.status !== 'ready' && s.status !== 'idle')
          .map(s => (
            <ServerStatus key={s.id} server={s} />
          ))}
      </div>
      {p.loading && <p role="status">Checking project…</p>}
      {!p.loading && !p.error && !rows.length && (
        <p>{p.projectId ? 'No matching problems' : 'Open a project to see problems'}</p>
      )}
      {[...files].map(([file, diagnostics]) => (
        <details key={`${p.projectId}:${file}`} open className="problem-file">
          <summary>
            {file} <small>({diagnostics.length})</small>
          </summary>
          <ul>
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button className="problem-row" onClick={() => void navigateProblem(d)} title={d.code}>
                  <Icon name={d.severity === 'hint' ? 'info' : d.severity} />
                  <span>
                    {d.message}
                    <small>
                      {d.source} · {d.line}:{d.column}
                    </small>
                  </span>
                </button>
                <button className="problem-galaxy" onClick={() => void navigateProblem(d, true)}>
                  Show in galaxy
                </button>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </aside>
  );
}
