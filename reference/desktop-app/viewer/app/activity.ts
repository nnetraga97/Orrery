// Inspectable event history, independent of frame and animation budgets. Panels read it through subscribe/version;
// the project UI (projects.ts) supplies it with setSource.

export type ActivityEvent = {
  id: string;
  type?: string;
  provider?: string;
  sessionId?: string;
  rootSessionId?: string;
  timestamp?: number;
  t?: number;
  historySequence?: number;
  payload?: {
    label?: string;
    path?: string;
    action?: string;
    ok?: boolean;
    awaitingAnswer?: boolean;
    completionOnly?: boolean;
  };
};
type HistoryPage = { limit: number; session: string | null; before?: number };
export type ActivitySource = {
  /** Selected session key (`provider:sessionId`), or null for all sessions. */
  session: () => string | null;
  read: (page: HistoryPage) => Promise<ActivityEvent[] | null | undefined>;
  /** Whether older pages can be requested. */
  paged: () => boolean;
};

const MAX_ROWS = 4096,
  MAX_BYTES = 8 * 1024 * 1024,
  // Bursts of ingested events repaint an open dialog at most this often.
  REPAINT_MS = 250;

let rows: ActivityEvent[] = [],
  seen = new Set<string>(),
  bytes = 0,
  open = false,
  version = 0,
  repaint: ReturnType<typeof setTimeout> | null = null;
let source: ActivitySource = { session: () => null, read: async () => [], paged: () => false };
const listeners = new Set<() => void>();

export const eventKey = (e: ActivityEvent) => `${e.provider || 'disk'}:${e.sessionId || ''}:${e.id}`;
const time = (e: ActivityEvent) => e.timestamp || e.t || 0;
const searchText = new WeakMap<ActivityEvent, string>();
export function searchable(e: ActivityEvent) {
  let text = searchText.get(e);
  if (text === undefined) searchText.set(e, (text = JSON.stringify(e).toLowerCase()));
  return text;
}
export const inSession = (e: ActivityEvent, session: string | null) =>
  !session || !e.provider || `${e.provider}:${e.rootSessionId || e.sessionId}` === session;

function notify() {
  if (repaint) clearTimeout(repaint);
  repaint = null;
  version++;
  for (const fn of listeners) fn();
}
function notifySoon() {
  if (open && !repaint)
    repaint = setTimeout(() => {
      repaint = null;
      if (open) notify();
    }, REPAINT_MS);
}

function ingest(e: ActivityEvent) {
  if (!e?.id) return;
  const key = eventKey(e);
  if (seen.has(key)) {
    if (e.historySequence) {
      const old = rows.find(r => eventKey(r) === key);
      if (old) old.historySequence = e.historySequence;
    }
    return;
  }
  seen.add(key);
  rows.push(e);
  bytes += JSON.stringify(e).length;
  while (rows.length > MAX_ROWS || bytes > MAX_BYTES) {
    const old = rows.shift()!;
    seen.delete(eventKey(old));
    bytes -= JSON.stringify(old).length;
  }
  notifySoon();
}
function ingestAll(events: ActivityEvent[] | null | undefined) {
  events?.forEach(ingest);
  rows.sort((a, b) => time(a) - time(b));
}
function clear() {
  rows = [];
  seen = new Set();
  bytes = 0;
  notify();
}
/** Loads the latest history for the selected session, then opens the dialog. */
async function openHistory() {
  ingestAll(await source.read({ limit: 500, session: source.session() }));
  open = true;
  notify();
}
/** Loads up to 500 events older than the oldest retained one; resolves to whether any arrived. */
async function loadEarlier() {
  const session = source.session();
  const before = Math.min(...rows.filter(e => e.historySequence && inSession(e, session)).map(e => e.historySequence!));
  const events = await source.read({ before, limit: 500, session });
  ingestAll(events);
  notify();
  return !!events?.length;
}
function close() {
  if (!open) return;
  open = false;
  notify();
}

export const activity = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Changes whenever the rows or the open state change. */
  version: () => version,
  isOpen: () => open,
  rows: (): readonly ActivityEvent[] => rows,
  session: () => source.session(),
  paged: () => source.paged(),
  loadEarlier,
  close,
};

// The API the hosts and the activity delivery call.
export const AgentActivity = {
  ingest,
  clear,
  open: openHistory,
  setSource(next: ActivitySource) {
    source = next;
  },
};
