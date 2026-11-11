// The agent's activity, as the Activity page lists it: one row per tool call (its start and finish paired by
// operation id), and a row per turn. Built from the same provider-neutral events the cannon receives
// (src/galaxy-bridge/agent-events.ts), newest last, at most MAX_ACTIVITY rows.
import { Builder } from './chat/layout.ts';
import type { ChatLayout, ChatMetrics, Measure } from './chat/layout.ts';

export const MAX_ACTIVITY = 200;

export type ActivityRow =
  | { kind: 'turn'; id: string; at: number; text: string; outcome: 'running' | 'completed' | 'failed' | 'interrupted' }
  | { kind: 'operation'; id: string; at: number; action: string; label: string; files: string[]; state: 'running' | 'ok' | 'failed' };

/** One event, in the v1 shape the bridge sends: type, payload, an operation id for tool calls, and its time. */
export type ActivityEvent = { type: string; operationId?: string; timestamp: number; payload: Record<string, unknown> };

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const files = (v: unknown) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === 'string') : []);

/** The rows after one more event. */
export function addActivity(rows: readonly ActivityRow[], e: ActivityEvent): ActivityRow[] {
  const p = e.payload ?? {};
  let next: ActivityRow[] = [...rows];
  if (e.type === 'turn.started') next.push({ kind: 'turn', id: `turn:${e.timestamp}:${rows.length}`, at: e.timestamp, text: str(p.text), outcome: 'running' });
  else if (e.type === 'turn.finished') {
    const k = next.map(r => r.kind).lastIndexOf('turn');
    const outcome = p.outcome === 'completed' || p.outcome === 'failed' || p.outcome === 'interrupted' ? p.outcome : 'completed';
    if (k >= 0) next[k] = { ...(next[k] as Extract<ActivityRow, { kind: 'turn' }>), outcome };
    // A turn that ends leaves nothing running.
    next = next.map(r => (r.kind === 'operation' && r.state === 'running' ? { ...r, state: outcome === 'completed' ? 'ok' : 'failed' } : r));
  } else if (e.type === 'operation.started' && e.operationId)
    next.push({ kind: 'operation', id: e.operationId, at: e.timestamp, action: str(p.action) || 'other', label: str(p.label) || str(p.tool), files: files(p.files), state: 'running' });
  else if (e.type === 'operation.finished' && e.operationId) {
    const k = next.findIndex(r => r.kind === 'operation' && r.id === e.operationId);
    if (k >= 0) {
      const r = next[k] as Extract<ActivityRow, { kind: 'operation' }>;
      next[k] = { ...r, state: p.ok === false ? 'failed' : 'ok', files: r.files.length ? r.files : files(p.files) };
    }
  } else return [...rows];
  return next.slice(-MAX_ACTIVITY);
}

const ICONS: Record<string, string> = {
  read: 'file',
  search: 'search',
  edit: 'pencil',
  create: 'fileAdd',
  question: 'thought',
  debug: 'terminal',
  task: 'checklist',
  ui: 'sparkles',
};
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** The Activity page: newest first, a heading per turn, and one row per tool call; a row with a file is `file:<path>`. */
export function layoutActivity(rows: readonly ActivityRow[], metrics: ChatMetrics, measure: Measure): ChatLayout {
  const b = new Builder(metrics, measure);
  b.line('cardTitle', [{ text: 'ACTIVITY', x: b.left, font: 'label', tone: 'line' }], 'label');
  b.gap(6);
  if (!rows.length) b.text('notice', [{ text: "The agent's tool calls appear here as it works.", font: 'small', tone: 'dim' }], b.left);
  for (const r of [...rows].reverse()) {
    if (r.kind === 'turn') {
      b.gap(b.m.gap);
      const state = r.outcome === 'running' ? 'working' : r.outcome;
      b.text('notice', [{ text: `${clock(r.at)} · ${state} · ${r.text || 'Turn'}`, font: 'small', tone: r.outcome === 'failed' ? 'failed' : 'dim' }], b.left);
      b.gap(6);
      continue;
    }
    const file = r.files[0];
    const label = `${r.label}${file ? ` · ${file}` : ''}${r.state === 'failed' ? ' · failed' : r.state === 'running' ? ' · running' : ''}`;
    b.chips([{ id: file ? `file:${file}` : `op:${r.id}`, label, icon: ICONS[r.action] ?? 'plug', lit: r.state !== 'failed' }]);
    b.gap(6);
  }
  b.gap(metrics.pad);
  // Rows without a file are not pinchable.
  return { lines: b.lines, boxes: b.boxes, regions: b.regions.filter(g => !g.id.startsWith('op:')), height: b.y };
}
