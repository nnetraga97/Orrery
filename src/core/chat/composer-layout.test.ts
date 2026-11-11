import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACEHOLDER, UNAVAILABLE, layoutComposer } from './composer-layout.ts';
import type { ComposerView } from './composer-layout.ts';
import { enqueue, heard, initialComposer } from './composer.ts';
import { chatMetrics } from './layout.ts';
import type { Line } from './layout.ts';

const measure = (text: string) => text.length * 10;
const metrics = chatMetrics(1200);
const view = (over: Partial<ComposerView> = {}): ComposerView => ({
  state: initialComposer(),
  prompts: ['Find why the end of a selection is treated as outside it', 'Fix it'],
  project: 'editor-core',
  changedFiles: 0,
  looking: null,
  available: true,
  mic: 'idle',
  partial: '',
  providers: [{ id: 'recorded', label: 'Recorded', available: true }],
  provider: 'recorded',
  models: [],
  model: '',
  ...over,
});
const ids = (v: ComposerView) => layoutComposer(v, metrics, measure).regions.map(r => r.id);
const text = (l: Line) => l.spans.map(s => s.text).join('');

test('idle: chips for the prompts and More, the placeholder, and the microphone', () => {
  const layout = layoutComposer(view(), metrics, measure);
  assert.deepEqual(layout.regions.map(r => r.id), ['chip:prompt:0', 'chip:prompt:1', 'chip:more', 'mic']);
  assert.ok(layout.lines.some(l => text(l) === PLACEHOLDER));
  assert.ok(layout.boxes.some(b => b.kind === 'field') && layout.boxes.some(b => b.kind === 'mic'));
});

test('heard text replaces the placeholder, with Cancel and Send', () => {
  const layout = layoutComposer(view({ state: heard(initialComposer(), 'Fix it') }), metrics, measure);
  assert.ok(layout.lines.some(l => text(l) === 'Fix it'));
  assert.ok(!layout.lines.some(l => text(l) === PLACEHOLDER));
  assert.deepEqual(layout.regions.map(r => r.id).slice(-3), ['button:cancel', 'button:send', 'mic']);
});

test('while listening, the words heard so far', () => {
  const layout = layoutComposer(view({ mic: 'listening', partial: 'fix the' }), metrics, measure);
  assert.ok(layout.lines.some(l => text(l) === 'fix the'));
});

test('running with a follow-up: Stop, then Steer, Queue and ✕', () => {
  const state = heard(initialComposer({ running: true }), 'Also strict');
  assert.deepEqual(ids(view({ state })).slice(3, 7), ['button:stop', 'button:steer', 'button:queue', 'button:dropFollowUp']);
});

test('two queued messages, each with Say it again and Remove; Resume queue when paused', () => {
  let state = enqueue(heard(initialComposer({ running: true }), 'one'), 'a');
  state = enqueue(heard(state, 'two'), 'b');
  const r = ids(view({ state: { ...state, queuePaused: true } }));
  assert.deepEqual(r.filter(id => id.startsWith('queue:') || id === 'button:resumeQueue'), [
    'queue:again:a',
    'queue:remove:a',
    'queue:again:b',
    'queue:remove:b',
    'button:resumeQueue',
  ]);
  const layout = layoutComposer(view({ state }), metrics, measure);
  assert.ok(layout.lines.some(l => text(l) === '2 QUEUED'));
});

test('More opens the slash commands and the mode, permission and provider choices', () => {
  const r = ids(view({ state: initialComposer({ more: true }), providers: [{ id: 'claude', label: 'Claude', available: false }, { id: 'recorded', label: 'Recorded', available: true }] }));
  for (const id of ['slash:new', 'slash:plan', 'slash:default', 'slash:review', 'slash:compact', 'slash:model', 'slash:permissions', 'choice:mode:plan', 'choice:permission:full', 'choice:provider:claude'])
    assert.ok(r.includes(id), id);
});

test("the context line asks for a review; What I'm looking at is a chip", () => {
  const r = ids(view({ changedFiles: 2, looking: 'range.ts:90–101' }));
  assert.ok(r.includes('button:review') && r.includes('chip:context'));
  const layout = layoutComposer(view({ changedFiles: 1 }), metrics, measure);
  assert.ok(layout.lines.some(l => text(l).endsWith('1 file changed')));
});

test('an unavailable provider says so, and the microphone takes no pinch', () => {
  const layout = layoutComposer(view({ available: false }), metrics, measure);
  assert.ok(layout.lines.some(l => text(l) === UNAVAILABLE));
  assert.ok(!layout.regions.some(r => r.id === 'mic'));
});

test('left-handed: the microphone at the left end of the row', () => {
  const right = layoutComposer(view(), metrics, measure).regions.find(r => r.id === 'mic')!;
  const left = layoutComposer(view({ micLeft: true }), metrics, measure).regions.find(r => r.id === 'mic')!;
  assert.ok(left.x < right.x);
  assert.equal(left.x, metrics.pad);
});
