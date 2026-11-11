import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from './arrange.ts';
import type { ChatItem } from './types.ts';

const user: ChatItem = { id: 'u1', type: 'userMessage', text: 'fix it' };
const think: ChatItem = { id: 'r1', type: 'reasoning' };
const read: ChatItem = { id: 'c1', type: 'commandExecution', commandActions: [{ type: 'read', path: 'a.ts' }] };
const edit: ChatItem = { id: 'f1', type: 'fileChange', changes: [{ path: 'a.ts' }] };
const reply: ChatItem = { id: 'a1', type: 'agentMessage', text: 'done' };
const plan: ChatItem = { id: 'p1', type: 'plan', plan: [] };
const ran: ChatItem = { type: 'commandExecution', command: 'npm test' };

test('messages stand alone; the actions between two messages form one group; one action is a plain row', () => {
  const entries = arrange([user, think, read, edit, reply, plan, ran]);
  assert.deepEqual(entries, [
    { kind: 'message', key: 'u1', item: user },
    { kind: 'group', key: 'r1', items: [think, read, edit] },
    { kind: 'message', key: 'a1', item: reply },
    { kind: 'message', key: 'p1', item: plan },
    { kind: 'row', key: 'i6', item: ran },
  ]);
});

test('an empty transcript arranges to nothing', () => {
  assert.deepEqual(arrange([]), []);
});

test('actions at the start, with no message before them, still group', () => {
  const entries = arrange([think, read]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'group');
});
