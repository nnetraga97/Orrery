import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlock, isMessage, isStreamEvent, requestErrors, resultCount, toolUses } from './wire.ts';
import type { Message } from './wire.ts';

const user: Message = { role: 'user', blocks: [{ type: 'text', text: 'Fix it' }] };
const assistant: Message = {
  role: 'assistant',
  blocks: [
    { type: 'thinking', text: 'hmm', opaque: { signature: 'abc' } },
    { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } },
  ],
};
const results: Message = { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 't1', content: 'text', isError: false }] };

test('blocks: each kind and its required fields', () => {
  assert.ok(isBlock({ type: 'text', text: '' }));
  assert.ok(isBlock({ type: 'thinking', opaque: null }));
  assert.ok(!isBlock({ type: 'thinking', text: 'x' }));
  assert.ok(isBlock({ type: 'tool_use', id: 'a', name: 'n', input: {} }));
  assert.ok(!isBlock({ type: 'tool_use', id: '', name: 'n', input: {} }));
  assert.ok(isBlock({ type: 'tool_result', toolUseId: 'a', content: 'c', isError: true }));
  assert.ok(!isBlock({ type: 'tool_result', toolUseId: 'a', content: 'c' }));
  assert.ok(!isBlock({ type: 'image' }));
});

test('messages: tool calls from the assistant, results from the user', () => {
  assert.ok(isMessage(user) && isMessage(assistant) && isMessage(results));
  assert.ok(!isMessage({ role: 'user', blocks: assistant.blocks }));
  assert.ok(!isMessage({ role: 'assistant', blocks: results.blocks }));
  assert.ok(!isMessage({ role: 'user', blocks: [] }));
  assert.ok(!isMessage({ role: 'system', blocks: user.blocks }));
});

test('requests: valid, and each kind of error', () => {
  const good = { provider: 'claude', system: 's', tools: [{ name: 'a', description: 'd', input_schema: {} }], messages: [user, assistant, results] };
  assert.deepEqual(requestErrors(good), []);
  assert.deepEqual(requestErrors({ ...good, provider: '' }), ['provider is required.']);
  assert.deepEqual(requestErrors({ ...good, messages: [assistant] }), ['The conversation must start with the user.']);
  assert.deepEqual(requestErrors({ ...good, messages: [user, user] }), ['Messages must alternate between user and assistant.']);
  assert.deepEqual(requestErrors({ ...good, tools: [{ name: 'a' }] }), ['tools must be a list of tool specs.']);
  assert.deepEqual(requestErrors(null), ['The request must be an object.']);
});

test('stream events', () => {
  assert.ok(isStreamEvent({ type: 'text', delta: 'a' }));
  assert.ok(isStreamEvent({ type: 'thinking', delta: 'a' }));
  assert.ok(isStreamEvent({ type: 'tool_use_start', id: 't', name: 'n' }));
  assert.ok(isStreamEvent({ type: 'progress' }));
  assert.ok(isStreamEvent({ type: 'message', message: assistant, stopReason: 'tool_use' }));
  assert.ok(!isStreamEvent({ type: 'message', message: assistant, stopReason: 'done' }));
  assert.ok(!isStreamEvent({ type: 'message', message: user, stopReason: 'end' }));
  assert.ok(isStreamEvent({ type: 'usage', usage: { input: 1, output: 2 } }));
  assert.ok(isStreamEvent({ type: 'error', code: 'rate_limited', message: 'slow down' }));
  assert.ok(!isStreamEvent({ type: 'error', code: 'nope', message: 'x' }));
});

test('helpers: the tool calls of a message and the results in a conversation', () => {
  assert.deepEqual(toolUses(assistant).map(t => t.id), ['t1']);
  assert.equal(resultCount([user, assistant, results]), 1);
});
