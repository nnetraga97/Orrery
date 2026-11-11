import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DECLINED, STOPPED, STOPPED_RUNNING, initialLoop, loopStep } from './loop.ts';
import type { LoopEffect, LoopEvent, LoopState } from './loop.ts';
import { requestErrors } from './wire.ts';
import type { Message, StopReason } from './wire.ts';

const run = (events: LoopEvent[], from: LoopState = initialLoop()) => {
  let state = from;
  const effects: LoopEffect[] = [];
  for (const e of events) {
    const step = loopStep(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
};
const reply = (blocks: Message['blocks'], stopReason: StopReason = 'tool_use'): LoopEvent => ({
  type: 'stream',
  event: { type: 'message', message: { role: 'assistant', blocks }, stopReason },
});
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use' as const, id, name, input });
const valid = (s: LoopState) => assert.deepEqual(requestErrors({ provider: 'p', system: '', tools: [], messages: s.messages }), []);

test('a user message calls the model; a text reply ends the turn', () => {
  const { state, effects } = run([{ type: 'userSaid', text: 'Hi' }, reply([{ type: 'text', text: 'Hello' }], 'end')]);
  assert.deepEqual(effects.map(e => e.kind), ['callModel', 'turnEnded']);
  assert.equal(state.status, 'idle');
  assert.equal(state.messages.length, 2);
});

test('the assistant message is kept exactly as received, thinking included', () => {
  const message: Message = { role: 'assistant', blocks: [{ type: 'thinking', text: 't', opaque: { sig: 'x' } }, { type: 'text', text: 'ok' }] };
  const { state } = run([{ type: 'userSaid', text: 'Hi' }, { type: 'stream', event: { type: 'message', message, stopReason: 'end' } }]);
  assert.equal(state.messages[1], message);
});

test('all tool calls of a message run, then every result goes back in one user message', () => {
  let r = run([{ type: 'userSaid', text: 'Look' }, reply([use('a', 'read_file', { path: 'x' }), use('b', 'search', { pattern: 'y' })])]);
  assert.deepEqual(r.effects.filter(e => e.kind === 'runTool').map(e => (e as { id: string }).id), ['a', 'b']);
  assert.equal(r.state.status, 'tools');
  r = run([{ type: 'toolFinished', id: 'b', content: 'found' }], r.state);
  assert.deepEqual(r.effects, []);
  r = run([{ type: 'toolFinished', id: 'a', content: 'text' }], r.state);
  assert.equal(r.effects[0].kind, 'callModel');
  const last = r.state.messages.at(-1)!;
  assert.deepEqual(last, {
    role: 'user',
    blocks: [
      { type: 'tool_result', toolUseId: 'a', content: 'text', isError: false },
      { type: 'tool_result', toolUseId: 'b', content: 'found', isError: false },
    ],
  });
  valid(r.state);
});

test('an invalid input is an error result, not an exception', () => {
  const r = run([{ type: 'userSaid', text: 'x' }, reply([use('a', 'read_file', {}), use('b', 'nope', {})])]);
  assert.equal(r.effects.at(-1)!.kind, 'callModel');
  const blocks = r.state.messages.at(-1)!.blocks;
  assert.deepEqual(blocks.map(b => (b.type === 'tool_result' ? [b.content, b.isError] : null)), [
    ['path is required.', true],
    ['There is no tool called nope.', true],
  ]);
});

test('tools are never run from a refused or cut-off message; their calls are answered so history stays valid', () => {
  for (const reason of ['refusal', 'max_tokens'] as const) {
    const r = run([{ type: 'userSaid', text: 'x' }, reply([use('a', 'read_file', { path: 'x' })], reason)]);
    assert.ok(!r.effects.some(e => e.kind === 'runTool'), reason);
    assert.equal(r.effects.at(-1)!.kind, 'turnEnded');
    assert.equal(r.state.status, 'idle');
    valid(r.state);
    // The next message joins the trailing results, keeping user and assistant alternating.
    const next = run([{ type: 'userSaid', text: 'go on' }], r.state);
    valid(next.state);
  }
});

test('edits ask for approval in workspace mode; approve runs it, decline answers with an error', () => {
  const edit = use('e', 'replace_in_file', { path: 'a', old_text: 'x', new_text: 'y' });
  let r = run([{ type: 'userSaid', text: 'Fix' }, reply([edit])]);
  assert.deepEqual(r.effects.map(e => e.kind), ['callModel', 'askApproval']);
  const approved = run([{ type: 'approved', id: 'e' }], r.state);
  assert.deepEqual(approved.effects.map(e => e.kind), ['runTool']);
  r = run([{ type: 'declined', id: 'e' }], r.state);
  assert.equal(r.effects[0].kind, 'callModel');
  const block = r.state.messages.at(-1)!.blocks[0];
  assert.ok(block.type === 'tool_result' && block.content === DECLINED && block.isError);
});

test('read-only and plan mode refuse edits with an error result', () => {
  const edit = use('e', 'write_file', { path: 'a', content: 'y' });
  const plan = run([{ type: 'settings', permission: 'full', mode: 'plan' }, { type: 'userSaid', text: 'x' }, reply([edit])]);
  const block = plan.state.messages.at(-1)!.blocks[0];
  assert.ok(block.type === 'tool_result' && block.content === 'Plan mode: no edits.');
  const full = run([{ type: 'settings', permission: 'full', mode: 'work' }, { type: 'userSaid', text: 'x' }, reply([edit])]);
  assert.ok(full.effects.some(e => e.kind === 'runTool'));
});

test('ask_user waits for the answer, which goes back as the result', () => {
  let r = run([{ type: 'userSaid', text: 'x' }, reply([use('q', 'ask_user', { questions: [{ id: 's', question: 'Which?' }] })])]);
  assert.equal(r.effects.at(-1)!.kind, 'askUser');
  r = run([{ type: 'answered', id: 'q', response: { answers: { s: { answers: ['One'] } } } }], r.state);
  const block = r.state.messages.at(-1)!.blocks[0];
  assert.ok(block.type === 'tool_result' && JSON.parse(block.content).answers.s.answers[0] === 'One');
});

test('stop while tools run answers the open calls with an error and leaves a valid history', () => {
  let r = run([{ type: 'userSaid', text: 'x' }, reply([use('a', 'read_file', { path: 'x' }), use('b', 'read_file', { path: 'y' })])]);
  r = run([{ type: 'toolFinished', id: 'a', content: 'ok' }, { type: 'stop' }], r.state);
  assert.equal(r.state.status, 'stopped');
  assert.deepEqual(r.effects.map(e => e.kind), ['turnEnded']);
  const blocks = r.state.messages.at(-1)!.blocks;
  assert.deepEqual(blocks.map(b => (b.type === 'tool_result' ? b.content : '')), ['ok', STOPPED_RUNNING]);
  valid(r.state);
  // A late result is ignored.
  assert.deepEqual(loopStep(r.state, { type: 'toolFinished', id: 'b', content: 'late' }).effects, []);
  valid(run([{ type: 'userSaid', text: 'again' }], r.state).state);
});

test('stop while the model is answering cancels the call; a late reply is ignored', () => {
  let r = run([{ type: 'userSaid', text: 'x' }, { type: 'stop' }]);
  assert.deepEqual(r.effects.map(e => e.kind), ['callModel', 'cancelModel', 'turnEnded']);
  r = run([reply([{ type: 'text', text: 'late' }], 'end')], r.state);
  assert.equal(r.state.messages.length, 1);
});

test('steer goes in after the current tool results', () => {
  let r = run([{ type: 'userSaid', text: 'x' }, reply([use('a', 'read_file', { path: 'x' })]), { type: 'steer', text: 'Also check strict' }]);
  r = run([{ type: 'toolFinished', id: 'a', content: 'ok' }], r.state);
  const blocks = r.state.messages.at(-1)!.blocks;
  assert.deepEqual(blocks.map(b => b.type), ['tool_result', 'text']);
  assert.ok(blocks[1].type === 'text' && blocks[1].text === 'Also check strict');
  valid(r.state);
});

test('a steer said while the final answer streams keeps the turn going', () => {
  const r = run([{ type: 'userSaid', text: 'x' }, { type: 'steer', text: 'and explain' }, reply([{ type: 'text', text: 'done' }], 'end')]);
  assert.deepEqual(r.effects.map(e => e.kind), ['callModel', 'callModel']);
  valid(r.state);
});

test('a message sent while the turn runs is delivered when it ends', () => {
  let r = run([{ type: 'userSaid', text: 'first' }, { type: 'userSaid', text: 'second' }]);
  assert.deepEqual(r.state.queue, ['second']);
  r = run([reply([{ type: 'text', text: 'one' }], 'end')], r.state);
  assert.deepEqual(r.effects.map(e => e.kind), ['turnEnded', 'callModel']);
  assert.deepEqual(r.state.queue, []);
  const last = r.state.messages.at(-1)!.blocks[0];
  assert.ok(last.type === 'text' && last.text === 'second');
});

test('a stream error fails the turn', () => {
  const r = run([{ type: 'userSaid', text: 'x' }, { type: 'stream', event: { type: 'error', code: 'rate_limited', message: 'Too many requests' } }]);
  assert.equal(r.state.status, 'failed');
  assert.equal(r.state.error, 'Too many requests');
  assert.deepEqual(r.effects.at(-1), { kind: 'turnEnded', outcome: 'failed', reason: 'rate_limited' });
  valid(run([{ type: 'userSaid', text: 'again' }], r.state).state);
});

test('stop while a question waits says it never ran', () => {
  let r = run([{ type: 'userSaid', text: 'x' }, reply([use('q', 'ask_user', { questions: [{ id: 's', question: 'Which?' }] })])]);
  r = run([{ type: 'stop' }], r.state);
  const b = r.state.messages.at(-1)!.blocks[0];
  assert.ok(b.type === 'tool_result' && b.content === STOPPED);
});
