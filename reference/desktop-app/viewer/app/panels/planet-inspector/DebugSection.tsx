// Captured stack and evidence marker controls.
import { useState, useSyncExternalStore } from 'react';
import { FAMILIES } from '../../../shared/evidence-records.js';
import { createDebugRecord } from '../../../../source-model/debug-records.js';
import type { Rec, Overlay, OverlayStore } from './shared.tsx';

export function createDebugSection({
  ctx,
  file,
  towns,
  overlayStore,
  setOverlay,
}: {
  ctx: Rec;
  file: Rec;
  towns: Rec | null;
  overlayStore: OverlayStore;
  setOverlay: (patch: Partial<Overlay>) => void;
}) {
  function CapturedStack() {
    const { stackRows, stackSelected, stackVisible } = useSyncExternalStore(overlayStore.subscribe, overlayStore.get);
    const [error, setError] = useState('');
    return (
      <div className="planet-stack">
        <strong>Debug evidence</strong>
        <p className="note">
          Numbered invocation frames from a capture. Arrows point from caller to callee; dashed blue paths show explicit
          async continuations. Paths remain visible when ships are paused. Other evidence (exceptions, failing tests,
          logs, coverage, hot paths) appears as markers.
        </p>
        <label>
          Load evidence (.json)
          <input
            id="stackCaptureFile"
            type="file"
            accept=".json,application/json"
            onChange={async e => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                if (file.size > 2 * 1024 * 1024) throw new Error('Capture must be smaller than 2 MB.');
                const records = JSON.parse(await file.text());
                if (!Array.isArray(records)) throw new Error('Capture must be an array of evidence records.');
                // Check every record before applying any, so a bad file changes nothing.
                records.forEach(record => createDebugRecord(record));
                const frames = records.filter(r => r.type === 'frame'),
                  other = records.filter(r => r.type !== 'frame');
                if (frames.length) ctx.onStackLoad(frames);
                if (other.length) ctx.onEvidenceLoad(other);
                setError('');
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <label>
          <input
            id="stackPathsToggle"
            type="checkbox"
            checked={stackVisible}
            onChange={e => {
              setOverlay({ stackVisible: e.target.checked });
              ctx.onStackVisible(e.target.checked);
            }}
          />{' '}
          Show numbered paths
        </label>
        {!!stackRows.length && (
          <button
            onClick={() => {
              ctx.onStackLoad([]);
              setError('');
            }}
          >
            Clear capture
          </button>
        )}
        <ol className="planet-stack-frames">
          {stackRows.map(row => (
            <li key={row.n}>
              <button
                data-stack-frame={row.n}
                aria-pressed={stackSelected === row.n}
                onClick={() => ctx.onStackFrame(row.n)}
              >
                <span>
                  {row.n}. {row.frame.file}:{row.frame.line}
                  {row.frame.column != null ? `:${row.frame.column}` : ''}
                </span>
                <small>
                  {row.status === 'unmapped' && row.frame.file !== file.path ? 'Outside this planet' : row.status} ·
                  invocation {String(row.frame.invocation)}
                </small>
                <small>
                  {String(row.frame.source)} · {String(row.frame.context ?? 'default context')} · revision{' '}
                  {String(row.frame.revision)}
                </small>
                {row.frame.continues != null && <small>Async continuation of {String(row.frame.continues)}</small>}
              </button>
            </li>
          ))}
        </ol>
        {!stackRows.length && <p className="note">No capture loaded. Static call routes do not imply execution.</p>}
        <EvidenceMarkers />
        <details>
          <summary>Capture format</summary>
          <p className="note">
            A JSON array with one record per invocation, up to 512 frames. Depth 0 is innermost. Use distinct invocation
            IDs for recursive frames. Revision must match the source revision when captured; mismatches remain listed as
            stale.
          </p>
          <pre>
            {JSON.stringify(
              [
                {
                  type: 'frame',
                  file: file.path,
                  line: 1,
                  revision: towns?.sourceIndex.revision,
                  source: 'your-debugger',
                  session: 'capture-1',
                  context: 'main',
                  invocation: 'frame-1',
                  depth: 0,
                },
              ],
              null,
              2,
            )}
          </pre>
        </details>
      </div>
    );
  }
  function EvidenceMarkers() {
    const { evidenceRows, evidenceSelected, evidenceVisible, gitChanges } = useSyncExternalStore(
      overlayStore.subscribe,
      overlayStore.get,
    );
    const [error, setError] = useState('');
    const where = (r: Rec) => `${r.line}${r.column != null ? ':' + r.column : ''}`;
    return (
      <div className="planet-evidence">
        <strong>Markers</strong>
        <label>
          <input
            id="evidenceToggle"
            type="checkbox"
            checked={evidenceVisible}
            onChange={e => {
              setOverlay({ evidenceVisible: e.target.checked });
              ctx.onEvidenceVisible(e.target.checked);
            }}
          />{' '}
          Show evidence markers
        </label>
        <label>
          <input
            id="gitChangesToggle"
            type="checkbox"
            checked={gitChanges}
            onChange={async e => {
              const enabled = e.target.checked;
              setOverlay({ gitChanges: enabled });
              try {
                await ctx.onGitChanges(enabled);
                setError('');
              } catch (cause) {
                setOverlay({ gitChanges: false });
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          />{' '}
          Git changes since the last commit
        </label>
        {error && <p role="alert">{error}</p>}
        {!!evidenceRows.some(r => r.source === 'loaded') && (
          <button onClick={() => ctx.onEvidenceLoad([])}>Clear loaded evidence</button>
        )}
        <ol className="planet-stack-frames planet-evidence-rows">
          {evidenceRows.map(row => (
            <li key={row.id}>
              <button
                data-evidence={row.id}
                aria-pressed={evidenceSelected === row.id}
                onClick={() => ctx.onEvidenceSelect(row.id)}
              >
                <span style={{ '--kind': (FAMILIES as Rec)[row.record.type]?.color } as Rec}>
                  <i aria-hidden="true"></i>
                  {(FAMILIES as Rec)[row.record.type]?.label ?? row.record.type} · line {where(row.record)}
                </span>
                <small>
                  {row.status === 'line' ? 'whole line' : row.status}
                  {row.record.message ? ` · ${row.record.message}` : ''}
                  {row.record.change ? ` · ${row.record.change}` : ''}
                  {row.record.samples != null ? ` · ${row.record.samples} samples` : ''}
                  {row.record.covered != null ? (row.record.covered ? ' · covered' : ' · not covered') : ''}
                </small>
                <small>
                  {String(row.record.source)} · revision {String(row.record.revision)}
                </small>
              </button>
            </li>
          ))}
        </ol>
        {!evidenceRows.length && <p className="note">No evidence on this planet.</p>}
      </div>
    );
  }
  return { CapturedStack };
}
