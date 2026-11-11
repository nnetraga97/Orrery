import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_THREAD_BYTES, badge, createThread, fromJSON, lastFor, summaryOf, titleFor, toJSON, upsert } from './threads.ts';
import type { StoredThread } from './threads.ts';

const at = (t: StoredThread, updatedAt: number, extra: Partial<StoredThread> = {}) => ({ ...t, updatedAt, ...extra });

test('a new thread belongs to a provider and a project and is empty', () => {
  const t = createThread('claude', 'editor-core', 1000, 'abc');
  assert.deepEqual(t, { id: 'abc', provider: 'claude', dataset: 'editor-core', items: [], requests: [], messages: [], status: 'idle', createdAt: 1000, updatedAt: 1000 });
  assert.ok(createThread('claude', 'x').id.length > 6);
  assert.notEqual(createThread('claude', 'x').id, createThread('claude', 'x').id);
});

test('titleFor: the first user message, cut at 48 characters, else New chat', () => {
  const t = createThread('claude', 'p');
  assert.equal(titleFor(t), 'New chat');
  assert.equal(titleFor({ ...t, items: [{ type: 'agentMessage', text: 'hi' }, { type: 'userMessage', text: '  Fix it\nplease ' }] }), 'Fix it please');
  const long = 'Find why the end of a selection is treated as outside it';
  const title = titleFor({ ...t, items: [{ type: 'userMessage', text: long }] });
  assert.equal(title.length, 48);
  assert.ok(title.endsWith('…'));
  assert.equal(titleFor({ ...t, title: 'Named', items: [{ type: 'userMessage', text: 'x' }] }), 'Named');
});

test('badge: Needs input over Working; none when idle', () => {
  const t = createThread('claude', 'p');
  assert.equal(badge(t), null);
  assert.equal(badge({ ...t, status: 'running' }), 'Working');
  assert.equal(badge({ ...t, status: 'running', requests: [{ id: 'r', type: 'questions' }] }), 'Needs input');
});

test('upsert replaces by id and keeps the newest first; lastFor finds the latest for a provider and project', () => {
  const a = createThread('claude', 'p', 1, 'a'),
    b = createThread('claude', 'q', 2, 'b'),
    c = createThread('openai', 'p', 3, 'c');
  let list = upsert(upsert(upsert([], a), b), c);
  assert.deepEqual(list.map(t => t.id), ['c', 'b', 'a']);
  list = upsert(list, at(a, 10, { title: 'A' }));
  assert.deepEqual(list.map(t => t.id), ['a', 'c', 'b']);
  assert.equal(list.length, 3);
  assert.equal(lastFor(list, 'claude', 'p')?.id, 'a');
  assert.equal(lastFor(list, 'openai', 'q'), null);
});

test('summaryOf keeps only what the chat list shows', () => {
  const t = at(createThread('claude', 'p', 1, 'a'), 5, { status: 'running', items: [{ type: 'userMessage', text: 'Fix it' }] });
  assert.deepEqual(summaryOf(t), { id: 'a', provider: 'claude', dataset: 'p', title: 'Fix it', badge: 'Working', updatedAt: 5 });
});

test('toJSON and fromJSON round-trip a thread', () => {
  const t = at(createThread('claude', 'p', 1, 'a'), 2, { items: [{ id: 'u', type: 'userMessage', text: 'hi 👋' }] });
  assert.deepEqual(fromJSON(toJSON(t)), t);
  assert.equal(fromJSON('not json'), null);
  assert.equal(fromJSON('{"id":3}'), null);
});

test('a thread over 2 MB loses its oldest tool output first, never a message', () => {
  const big = 'x'.repeat(700_000);
  const t: StoredThread = {
    ...createThread('claude', 'p', 1, 'a'),
    items: [
      { id: 'u', type: 'userMessage', text: 'first' },
      { id: 'c1', type: 'commandExecution', output: big },
      { id: 'c2', type: 'dynamicToolCall', result: big },
      { id: 'a', type: 'agentMessage', text: 'reply' },
      { id: 'c3', type: 'commandExecution', aggregatedOutput: big },
    ],
    messages: [
      { role: 'user', blocks: [{ type: 'text', text: 'first' }] },
      { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 't', content: big, isError: false }] },
    ],
  };
  const json = toJSON(t);
  assert.ok(new TextEncoder().encode(json).length <= MAX_THREAD_BYTES);
  const back = fromJSON(json)!;
  assert.equal(back.items![0].text, 'first');
  assert.equal(back.items![3].text, 'reply');
  // The oldest outputs went first; the newest survived.
  assert.match(String(back.items![1].output), /removed to save space/);
  assert.equal(back.items![4].aggregatedOutput, big);
  assert.equal((back.messages[0] as { blocks: { text: string }[] }).blocks[0].text, 'first');
});
