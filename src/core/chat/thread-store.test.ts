import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreadStore } from './thread-store.ts';
import { createThread, lastFor } from './threads.ts';

const memory = () => {
  const map = new Map<string, string>();
  return { map, get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
};

test('save, list newest first, load and remove', () => {
  const kv = memory();
  const store = createThreadStore(kv);
  const a = { ...createThread('claude', 'p', 1, 'a'), items: [{ type: 'userMessage', text: 'Fix it' }] };
  const b = createThread('claude', 'p', 2, 'b');
  store.save(a);
  store.save(b);
  assert.deepEqual(store.list().map(t => [t.id, t.title]), [['b', 'New chat'], ['a', 'Fix it']]);
  assert.deepEqual(store.load('a'), a);
  assert.equal(lastFor(store.list(), 'claude', 'p')?.id, 'b');
  store.save({ ...a, updatedAt: 3 });
  assert.equal(lastFor(store.list(), 'claude', 'p')?.id, 'a');
  store.remove('a');
  assert.equal(store.load('a'), null);
  assert.deepEqual(store.list().map(t => t.id), ['b']);
});

test('a damaged index reads as empty', () => {
  const kv = memory();
  kv.set('chats', 'nonsense');
  assert.deepEqual(createThreadStore(kv).list(), []);
});

test('only the newest fifty chats are kept', () => {
  const kv = memory();
  const store = createThreadStore(kv);
  for (let i = 0; i < 55; i++) store.save(createThread('claude', 'p', i, `t${i}`));
  assert.equal(store.list().length, 50);
  assert.equal(store.load('t0'), null);
  assert.ok(store.load('t54'));
});
