// Run and Debug: one sidebar for the whole session. The run bar launches and drives it; while it runs, the call
// stack, the selected frame's variables, breakpoints and the console stack below as collapsible sections.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  breakpointAtBuilding,
  debugCommand,
  debugStore,
  inspectBuilding,
  launchDebug,
  replaceBreakpoints,
  selectDebugFrame,
  startDebug,
  toggleFollowShip,
} from '../debug.ts';
import { AdapterReadiness } from './AdapterReadiness.tsx';
import {
  adapterFor,
  settingsBridge,
  exceptionModes,
  type ExceptionMode,
  type DebugConfiguration,
  type AdapterStatus,
} from '../settings.ts';
import { activeFolder, workbenchStore } from '../workbench.ts';
import { filesStore } from '../workspace-files.ts';
import { EvaluateLine, Signature, VariableNode, frameParts } from './debug-values.tsx';
import { Icon } from './Icon.tsx';

const LIVE = ['starting', 'running', 'paused', 'resuming'];

export function DebugPanel() {
  const d = useSyncExternalStore(debugStore.subscribe, debugStore.get);
  const project = useSyncExternalStore(workbenchStore.subscribe, () => activeFolder()?.project.id);
  const editing = useSyncExternalStore(filesStore.subscribe, () => !!filesStore.get().active);
  const [entry, setEntry] = useState('');
  const [args, setArgs] = useState('[]');
  const [exceptionMode, setExceptionMode] = useState<ExceptionMode>('failures');
  const [configurations, setConfigurations] = useState<DebugConfiguration[]>([]);
  const [choice, setChoice] = useState('');
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loadedProject, setLoadedProject] = useState<string>();
  const [tab, setTab] = useState<'variables' | 'console' | 'breakpoints'>('variables');
  const [rerun, setRerun] = useState(false);
  const [framesHeight, setFramesHeight] = useState(180);
  const split = useRef<{ y: number; height: number } | null>(null);
  const refreshAdapters = async () => setAdapters(await settingsBridge.debugAdapterStatus());
  useEffect(() => {
    if (!d.open || !project) return;
    let cancelled = false,
      request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const [rows, settings, statuses] = await Promise.all([
          settingsBridge.debugConfigurations(project),
          settingsBridge.settingsGet(project),
          settingsBridge.debugAdapterStatus(),
        ]);
        if (cancelled || current !== request) return;
        setLoadedProject(project);
        setConfigurations(rows);
        setAdapters(statuses);
        setLoadError('');
        setExceptionMode(settings.effective.debug?.exceptionMode ?? 'failures');
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(`galaxyDebugConfiguration:${project}`);
        } catch {}
        setChoice(
          saved === '__file__' || rows.some(c => c.name === saved && c.supported)
            ? saved!
            : rows.find(c => c.supported)?.name || '__file__',
        );
      } catch (e) {
        if (!cancelled && current === request) {
          setLoadError(String(e));
          setLoadedProject(undefined);
        }
      }
    };
    void refresh();
    const off = settingsBridge.onSettingsEvent(() => void refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, [project, d.open]);
  useEffect(startDebug, []);
  useEffect(() => {
    setEntry(d.runtime.projectId === project ? d.runtime.entry || '' : '');
    if (d.runtime.projectId === project && d.runtime.entry) setChoice('__file__');
  }, [d.runtime.entry, project]);
  const r = d.runtime,
    live = LIVE.includes(r.status),
    paused = r.status === 'paused';
  const index = r.selected ?? 0,
    frame = r.frames[index];
  const chosen = configurations.find(c => c.name === choice);
  const adapterId = adapterFor(chosen?.type || '', choice === '__file__' ? entry : '');
  const missingName = /(?:missing|install|not installed|not found)/i.test(d.error || r.error || '')
    ? (['js-debug', 'debugpy', 'java-debug'] as const).find(id => (d.error || r.error || '').includes(id))
    : undefined;
  useEffect(() => {
    if (missingName) void refreshAdapters().catch(e => setLoadError(String(e)));
  }, [d.error, r.error]);
  const adapter = adapters.find(a => a.id === adapterId);
  const missingAdapter =
    missingName && missingName !== adapterId ? adapters.find(a => a.id === missingName) : undefined;
  const ready =
    loadedProject === project && !!adapter?.installed && (adapter.id !== 'java-debug' || adapter.available !== false);
  const canLaunch = !!project && ready && !live && (choice === '__file__' ? !!entry : !!chosen?.supported);
  const breakpoints = r.projectId === project ? r.breakpoints || [] : [];
  const breakpointsLocked = d.breakpointBusy || r.status === 'starting';
  const launch = () => {
    try {
      localStorage.setItem(`galaxyDebugConfiguration:${project}`, choice);
    } catch {}
    void launchDebug(entry, args, exceptionMode, choice === '__file__' ? undefined : choice);
  };
  // Rerun stops the session, then launches the same configuration once it has ended.
  useEffect(() => {
    if (rerun && !live) {
      setRerun(false);
      if (canLaunch) launch();
    }
  }, [rerun, live, canLaunch]);
  const notice = r.handoff ? (
    <div className="debug-handoff" role="status">
      <strong>Agent handed this session to you</strong>
      <p>{r.handoff.message}</p>
    </div>
  ) : (
    r.driver === 'agent' && <p className="dbg-note">Agent is driving</p>
  );
  const failure = loadError || d.error || r.error;
  const tool = (label: string, icon: string, onClick: () => void, disabled = false, className = '') => (
    <button type="button" title={label} aria-label={label} className={className} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
  return (
    <aside id="wbDebug" hidden={!d.open} aria-label="Run and Debug" data-status={r.status}>
      <form
        className="dbg-title"
        onSubmit={e => {
          e.preventDefault();
          if (canLaunch) launch();
        }}
      >
        <strong>Debug</strong>
        <select
          aria-label="Debug configuration"
          value={choice}
          disabled={live || !project}
          title={[r.adapter, chosen?.type].filter(Boolean).join(' · ')}
          onChange={e => {
            setChoice(e.target.value);
            try {
              localStorage.setItem(`galaxyDebugConfiguration:${project}`, e.target.value);
            } catch {}
          }}
        >
          {(['launch.json', 'project', 'personal', 'detected'] as const).map(source => (
            <optgroup key={source} label={source}>
              {configurations
                .filter(c => c.source === source)
                .map((c, i) => (
                  <option key={`${c.name}:${i}`} value={c.name} disabled={!c.supported} title={c.reason}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value="__file__">Run file…</option>
        </select>
        {!live && (
          <button type="submit" className="dbg-launch" disabled={!canLaunch} title="Debug">
            <Icon name="bug" />
          </button>
        )}
      </form>
      <div className="dbg-toolbar" role="toolbar" aria-label="Debug controls">
        {tool(
          'Rerun',
          'refresh',
          () => {
            setRerun(true);
            void debugCommand('stop');
          },
          !live || (choice === '__file__' ? !entry : !chosen?.supported),
          'dbg-rerun',
        )}
        {tool('Stop', 'stop', () => void debugCommand('stop'), !live, 'dbg-stop')}
        <span className="dbg-divider" />
        {tool('Resume', 'resume', () => void debugCommand('continue'), !paused, 'dbg-go')}
        {tool('Pause', 'pause', () => void debugCommand('pause'), r.status !== 'running', 'dbg-go')}
        <span className="dbg-divider" />
        {tool('Step over', 'stepOver', () => void debugCommand('over'), !paused, 'dbg-step')}
        {tool('Step into', 'stepInto', () => void debugCommand('into'), !paused, 'dbg-step')}
        {tool('Step out', 'stepOut', () => void debugCommand('out'), !paused, 'dbg-step')}
        <span className="dbg-divider" />
        {tool(
          'View breakpoints',
          'breakpoints',
          () => setTab(tab === 'breakpoints' ? 'variables' : 'breakpoints'),
          false,
          `dbg-bp${tab === 'breakpoints' ? ' active' : ''}`,
        )}
        {tool(
          'Reveal town / building',
          'galaxy',
          () => void selectDebugFrame(index, true),
          !paused || !frame?.local || frame.text == null,
        )}
      </div>
      <div className="dbg-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'variables'} onClick={() => setTab('variables')}>
          Threads &amp; Variables
        </button>
        <button role="tab" aria-selected={tab === 'console'} onClick={() => setTab('console')}>
          Console
        </button>
        {tab === 'breakpoints' && (
          <button role="tab" aria-selected onClick={() => setTab('variables')} title="Close breakpoints">
            Breakpoints <Icon name="close" />
          </button>
        )}
      </div>
      {notice}
      {r.exception && (
        <details className="debug-exception">
          <summary>
            <strong>Paused on exception</strong> {r.exception.split('\n')[0]}
          </summary>
          <pre>{r.exception}</pre>
        </details>
      )}
      {failure && (
        <p role="alert" className="debug-error">
          {failure}
        </p>
      )}
      {tab === 'variables' &&
        (live ? (
          <div className="dbg-split">
            <div className="dbg-frames-pane" style={{ height: framesHeight }}>
              <p className="dbg-thread">
                <Icon name={paused ? 'check' : 'resume'} />
                <span>
                  {r.configuration || r.entry || 'Program'}: <b>{r.status.toUpperCase()}</b>
                </span>
                <button
                  className="dbg-thread-action"
                  title="Select the frame of the building selected on the planet"
                  aria-label="Frame at selected building"
                  disabled={!paused}
                  onClick={() => void inspectBuilding()}
                >
                  <Icon name="follow" />
                </button>
              </p>
              <ol className="dbg-frames" aria-label="Call stack">
                {r.frames.map((f, i) => {
                  const { method, owner, where } = frameParts(f);
                  return (
                    <li key={f.id}>
                      <button
                        aria-pressed={i === index}
                        className={f.local ? '' : 'dbg-library'}
                        title={`${f.file}:${f.line}:${f.column}${f.context !== 'sync' ? ` · ${f.context}` : ''}`}
                        onClick={() => void selectDebugFrame(i, !editing)}
                      >
                        {method}:{f.line}, {owner}
                        {where && <i> ({where})</i>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div
              className="dbg-divider-h"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize call stack"
              onPointerDown={e => {
                split.current = { y: e.clientY, height: framesHeight };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                if (split.current)
                  setFramesHeight(Math.max(60, Math.min(600, split.current.height + e.clientY - split.current.y)));
              }}
              onPointerUp={() => (split.current = null)}
            />
            <div className="dbg-variables">
              <EvaluateLine key={r.session} paused={paused} frame={frame?.id} />
              {paused && frame && <Signature frame={frame} variables={d.variables} />}
              {d.variablesError && (
                <p role="alert" className="debug-error">
                  {d.variablesError}
                </p>
              )}
              <ul role="tree" aria-label="Variables">
                {paused &&
                  d.variables.map(v => <VariableNode key={v.handle || `${r.pause}:${v.kind}:${v.name}`} value={v} />)}
              </ul>
              {!paused && <p className="dbg-hint">Variables appear when execution pauses.</p>}
              {d.location && !d.location.startsWith('Exact source ·') && (
                <p className="dbg-hint dbg-location" role="status">
                  {d.location}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="dbg-idle">
            <label>
              Pause on
              <select
                aria-label="Pause on exceptions"
                value={exceptionMode}
                onChange={e => setExceptionMode(e.target.value as ExceptionMode)}
              >
                {exceptionModes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {choice === '__file__' && (
              <>
                <input
                  aria-label="Debug entry file"
                  placeholder="Entry file: src/main.ts, main.py or Main.java"
                  value={entry}
                  onChange={e => setEntry(e.target.value)}
                />
                <input
                  aria-label="Debug arguments"
                  placeholder='Arguments (JSON array): ["--flag"]'
                  value={args}
                  onChange={e => setArgs(e.target.value)}
                />
              </>
            )}
            {adapter && (!adapter.installed || adapter.available === false) && (
              <AdapterReadiness key={adapter.id} adapter={adapter} refresh={refreshAdapters} compact />
            )}
            {missingAdapter && (
              <AdapterReadiness key={missingAdapter.id} adapter={missingAdapter} refresh={refreshAdapters} />
            )}
            <p className="dbg-hint">
              Press <Icon name="bug" /> to start. Frames and variables appear here when execution pauses.
            </p>
          </div>
        ))}
      {tab === 'console' && <pre className="dbg-console">{r.output || 'No output yet'}</pre>}
      {tab === 'breakpoints' && (
        <div className="debug-breakpoints">
          <div className="dbg-bp-actions">
            <button
              className="dbg-link"
              disabled={breakpointsLocked}
              title="Toggle a breakpoint on the statement building selected on the planet"
              onClick={() => void breakpointAtBuilding()}
            >
              Toggle at selected building
            </button>
          </div>
          {!breakpoints.length && <p className="dbg-hint">Click the editor gutter or press F9.</p>}
          <ul className="dbg-breakpoints">
            {breakpoints.map(b => {
              const name = b.file.split('/').pop(),
                dir = b.file.includes('/') ? b.file.slice(0, b.file.lastIndexOf('/')) : '';
              return (
                <li key={b.id} title={`${b.file}:${b.line}:${b.column} · ${b.status || 'pending'}`}>
                  <span
                    className={`dbg-mark dbg-mark-${b.mode} dbg-mark-${b.status || 'pending'}`}
                    aria-hidden="true"
                  />
                  <span className="dbg-bp-where">
                    {name}:{b.line}
                    {dir && <small> {dir}</small>}
                  </span>
                  <select
                    aria-label={`Breakpoint mode ${b.file}:${b.line}`}
                    value={b.mode}
                    disabled={breakpointsLocked}
                    onChange={e =>
                      void replaceBreakpoints(
                        breakpoints.map(x => (x.id === b.id ? { ...x, mode: e.target.value as 'pause' | 'trace' } : x)),
                      )
                    }
                  >
                    <option value="pause">Suspend</option>
                    <option value="trace">Trace ship</option>
                  </select>
                  <button
                    className="dbg-remove"
                    aria-label={`Remove breakpoint ${b.file}:${b.line}`}
                    disabled={breakpointsLocked}
                    onClick={() => void replaceBreakpoints(breakpoints.filter(x => x.id !== b.id))}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
          <label className="dbg-follow" title="Trace breakpoints fly the execution ship to each hit and resume">
            <input type="checkbox" checked={d.followShip} onChange={toggleFollowShip} /> Follow execution ship
          </label>
          {r.trace && (
            <p className="dbg-hint">
              Ship last seen at {r.trace.file.split('/').pop()}:{r.trace.line} · hit {r.trace.sequence}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
