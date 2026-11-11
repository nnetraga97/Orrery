import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ACTIVITY, addActivity, layoutActivity } from './activity.ts';
import type { ActivityEvent, ActivityRow } from './activity.ts';
import { chatMetrics } from './chat/layout.ts';

const ev = (type: string, payload: Record<string, unknown> = {}, operationId?: string, timestamp = 1000): ActivityEvent => ({ type, payload, operationId, timestamp });
const run = (events: ActivityEvent[]) => events.reduce<ActivityRow[]>(addActivity, []);

test('a tool call is one row: started, then settled by its finish', () => {
  const rows = run([
    ev('turn.started', { text: 'Find the bug' }),
    ev('operation.started', { action: 'read', label: 'read file', files: ['core/range.ts'] }, 'r1'),
    ev('operation.finished', { ok: true }, 'r1'),
    ev('operation.started', { action: 'edit', label: 'replace in file', files: ['core/range.ts'] }, 'e1'),
    ev('operation.finished', { ok: false }, 'e1'),
    ev('turn.finished', { outcome: 'completed' }),
  ]);
  assert.deepEqual(rows.map(r => (r.kind === 'turn' ? `turn:${r.outcome}` : `${r.action}:${r.state}`)), ['turn:completed', 'read:ok', 'edit:failed']);
});

test('a stopped turn settles the calls still running', () => {
  const rows = run([ev('turn.started'), ev('operation.started', { action: 'search' }, 's1'), ev('turn.finished', { outcome: 'interrupted' })]);
  assert.equal((rows[1] as Extract<ActivityRow, { kind: 'operation' }>).state, 'failed');
  assert.equal((rows[0] as Extract<ActivityRow, { kind: 'turn' }>).outcome, 'interrupted');
});

test('other events are ignored, and the list keeps the newest rows', () => {
  assert.deepEqual(run([ev('message', { text: 'hi' }), ev('usage', { context: 5 })]), []);
  const many = run(Array.from({ length: MAX_ACTIVITY + 5 }, (_, i) => ev('operation.started', { action: 'read' }, `o${i}`)));
  assert.equal(many.length, MAX_ACTIVITY);
  assert.equal((many[many.length - 1] as Extract<ActivityRow, { kind: 'operation' }>).id, `o${MAX_ACTIVITY + 4}`);
});

test('the page lists newest first, and only rows with a file are pinchable', () => {
  const rows = run([
    ev('turn.started', { text: 'Go' }),
    ev('operation.started', { action: 'read', label: 'read file', files: ['core/range.ts'] }, 'r1'),
    ev('operation.started', { action: 'task', label: 'update plan' }, 't1'),
    ev('operation.started', { action: 'search', label: 'search', files: ['core/position.ts'] }, 's1'),
  ]);
  const page = layoutActivity(rows, chatMetrics(800, 1), s => s.length * 10);
  assert.deepEqual(page.regions.map(r => r.id), ['file:core/position.ts', 'file:core/range.ts']);
  assert.deepEqual(layoutActivity([], chatMetrics(800, 1), s => s.length * 10).regions, []);
});
