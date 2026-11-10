// Agent activity history: recorded operations and evidence for the selected session, searchable and paged, text only.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { activity, eventKey, inSession, searchable, type ActivityEvent } from '../activity.ts';

const PAGE = 40;

export function ActivityHistory() {
  const version = useSyncExternalStore(activity.subscribe, activity.version);
  const open = activity.isOpen();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [noEarlier, setNoEarlier] = useState(false);

  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) {
      setPage(0);
      setNoEarlier(false);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const session = activity.session();
  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return activity
      .rows()
      .filter(e => inSession(e, session) && (!q || searchable(e).includes(q)))
      .reverse();
  }, [version, query, session]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE));
  const shown = Math.min(page, pages - 1);

  return (
    <dialog ref={dialog} className="activity-history" aria-label="Agent activity history" onClose={activity.close}>
      <h2>Agent activity</h2>
      <p>
        Recorded operations and evidence. Animations may group bursts; unknown outcomes remain explicit. Recent events
        are retained here; the host also saves a local journal.
      </p>
      <input
        type="search"
        placeholder="Search tools, paths, outcomes…"
        aria-label="Search activity"
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setPage(0);
        }}
      />
      <p>
        {matches.length} retained events · page {shown + 1} of {pages}
      </p>
      <div className="activity-rows">
        {open &&
          matches.slice(shown * PAGE, shown * PAGE + PAGE).map(e => (
            // Keyed rows keep their expanded state across repaints.
            <details key={eventKey(e)} data-event={eventKey(e)}>
              <summary>{summary(e)}</summary>
              <pre>{JSON.stringify(e, null, 2)}</pre>
            </details>
          ))}
      </div>
      <button onClick={() => setPage(Math.max(0, shown - 1))}>Newer</button>
      <button disabled={(shown + 1) * PAGE >= matches.length} onClick={() => setPage(shown + 1)}>
        Older
      </button>
      <button
        hidden={!activity.paged()}
        disabled={noEarlier}
        onClick={async () => setNoEarlier(!(await activity.loadEarlier()))}
      >
        Load earlier history
      </button>
      <button onClick={activity.close}>Close</button>
    </dialog>
  );
}

function summary(e: ActivityEvent) {
  const p = e.payload || {};
  const status =
    e.type === 'operation.finished' ? (p.awaitingAnswer ? 'waiting for answer' : p.ok ? 'succeeded' : 'failed') : '';
  return `${new Date(e.timestamp || e.t || NaN).toLocaleTimeString()} · ${p.label || p.path || p.action || e.type} · ${status || e.type}${p.completionOnly ? ' · observed on completion' : ''}`;
}
