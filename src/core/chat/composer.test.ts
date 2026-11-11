import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_PROMPT,
  cancel,
  enqueue,
  heard,
  initialComposer,
  removeQueued,
  replaceQueued,
  reply,
  resumeQueue,
  reuse,
  send,
  slash,
  steer,
  stop,
  toggleContext,
  turnEnded,
} from './composer.ts';

test('heard text waits as pending; Send sends it with the context chip, mode and permission', () => {
  const s = heard(initialComposer(), '  Fix it ');
  assert.equal(s.pending, 'Fix it');
  const step = send(s);
  assert.deepEqual(step.effect, { kind: 'send', text: 'Fix it', attachContext: true, mode: 'work', permission: 'workspace' });
  assert.equal(step.state.pending, '');
  assert.equal(step.state.running, true);
  assert.equal(send(initialComposer()).effect, null);
  // Pinching the "What I'm looking at" chip drops the context.
  const without = send(toggleContext(heard(initialComposer(), 'x'))).effect as { attachContext: boolean };
  assert.equal(without.attachContext, false);
});

test('Cancel drops the pending text', () => {
  assert.equal(cancel(heard(initialComposer(), 'x')).pending, '');
});

test('while a turn runs, a new message asks to steer or queue', () => {
  const running = initialComposer({ running: true });
  const s = heard(running, 'Also check strict');
  assert.equal(s.choosing, true);
  assert.equal(send(s).effect, null);
  const steered = steer(s);
  assert.deepEqual(steered.effect, { kind: 'steer', text: 'Also check strict', attachContext: true, mode: 'work', permission: 'workspace' });
  assert.equal(steered.state.choosing, false);
  const queued = enqueue(s, 'q1');
  assert.deepEqual(queued.queue, [{ id: 'q1', text: 'Also check strict', state: 'ready' }]);
  assert.equal(queued.pending, '');
});

test('a queued message is sent when the turn ends; Say it again and Remove change the queue', () => {
  let s = enqueue(heard(initialComposer({ running: true }), 'one'), 'a');
  s = enqueue(heard(s, 'two'), 'b');
  s = replaceQueued(s, 'a', 'one again');
  assert.deepEqual(s.queue.map(q => q.text), ['one again', 'two']);
  const ended = turnEnded(s);
  assert.equal(ended.effect?.kind, 'send');
  assert.equal((ended.effect as { text: string }).text, 'one again');
  assert.equal(ended.state.running, true);
  assert.deepEqual(ended.state.queue.map(q => q.id), ['b']);
  assert.deepEqual(removeQueued(ended.state, 'b').queue, []);
});

test('Stop pauses the queue; Resume queue sends the next', () => {
  const s = enqueue(heard(initialComposer({ running: true }), 'later'), 'a');
  const stopped = stop(s);
  assert.deepEqual(stopped.effect, { kind: 'stop' });
  assert.equal(stopped.state.queuePaused, true);
  const ended = turnEnded(stopped.state);
  assert.equal(ended.effect, null);
  assert.equal(ended.state.running, false);
  const resumed = resumeQueue(ended.state);
  assert.equal(resumed.effect?.kind, 'send');
  assert.equal(resumed.state.queuePaused, false);
});

test('Reuse refills the pending message; Reply quotes each line', () => {
  assert.equal(reuse(initialComposer(), 'Fix it').pending, 'Fix it');
  assert.equal(reply(initialComposer(), 'line one\nline two').pending, '> line one\n> line two\n\n');
  assert.equal(reply(heard(initialComposer(), 'why?'), 'a').pending, '> a\n\nwhy?');
});

test('slash commands do what the desktop does', () => {
  assert.deepEqual(slash(initialComposer(), 'new').effect, { kind: 'newChat' });
  assert.equal(slash(initialComposer(), 'plan').state.mode, 'plan');
  assert.equal(slash(initialComposer({ mode: 'plan' }), 'default').state.mode, 'work');
  // A mode change waits for the turn to end.
  assert.equal(slash(initialComposer({ running: true }), 'plan').state.notice, 'Change modes after the current turn finishes.');
  const review = slash(initialComposer(), 'review');
  assert.equal(review.effect?.kind, 'send');
  assert.equal((review.effect as { text: string }).text, REVIEW_PROMPT);
  assert.deepEqual(slash(initialComposer(), 'compact').effect, { kind: 'compact' });
  assert.equal(slash(initialComposer({ running: true }), 'compact').effect, null);
  assert.deepEqual(slash(initialComposer(), 'model').effect, { kind: 'openPicker', which: 'model' });
  assert.deepEqual(slash(initialComposer(), 'permissions').effect, { kind: 'openPicker', which: 'permission' });
});

test('a spoken slash command runs; text after /plan is sent in plan mode', () => {
  const step = send(heard(initialComposer(), '/plan look at the edge'));
  assert.equal(step.effect?.kind, 'send');
  assert.deepEqual([(step.effect as { text: string; mode: string }).text, (step.effect as { mode: string }).mode], ['look at the edge', 'plan']);
  assert.equal(send(heard(initialComposer(), '/unknown')).state.notice, 'There is no /unknown command.');
});
