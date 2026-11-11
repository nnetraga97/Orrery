import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, duration, isAction, stat, summarize, textOf, thinkingLabel, total, workingLabel } from './describe.ts';
import type { ChatItem } from './types.ts';

type CommandAction = NonNullable<ChatItem['commandActions']>[number];
const cmd = (type: string, extra: CommandAction[] = [{}], status = 'completed') =>
  ({ type: 'commandExecution', status, commandActions: extra.map(a => ({ type, ...a })) }) as ChatItem;

test('stat counts added and removed lines, skipping the file headers', () => {
  assert.deepEqual(stat({ diff: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n+more\n same' }), { added: 2, removed: 1 });
});

test('stat counts every line of a new file given as plain contents', () => {
  assert.deepEqual(stat({ kind: 'add', diff: 'one\ntwo\n\nthree' }), { added: 3, removed: 0 });
  assert.deepEqual(stat({ kind: { type: 'add' }, patch: '+one\n+two' }), { added: 2, removed: 0 });
});

test('total adds the stats of several changes', () => {
  assert.deepEqual(total([{ diff: '+a\n-b' }, { diff: '+c' }]), { added: 2, removed: 1 });
});

test('reads: Reading while live, Read after, by file name', () => {
  const live = cmd('read', [{ path: 'src/a/x.ts' }, { name: 'y.ts' }], 'inProgress');
  assert.deepEqual(describe(live), { icon: 'file', verb: 'Reading', target: 'x.ts, y.ts', failed: false, live: true });
  assert.equal(describe(cmd('read', [{ path: 'x.ts' }])).verb, 'Read');
});

test('searches: Searching for / Searched for, with the folder as meta', () => {
  const d = describe(cmd('search', [{ query: 'clamp', path: 'src' }]));
  assert.equal(d.icon, 'search');
  assert.equal(d.verb, 'Searched for');
  assert.equal(d.target, 'clamp');
  assert.equal(d.meta, 'in src');
  assert.equal(describe(cmd('search', [{ query: 'q' }], 'running')).verb, 'Searching for');
});

test('listings: Listing / Listed, with . for no path', () => {
  assert.deepEqual(
    [describe(cmd('list_files', [{}], 'running')).verb, describe(cmd('listFiles', [{ path: 'src' }])).target],
    ['Listing', 'src'],
  );
  assert.equal(describe(cmd('list_files')).target, '.');
});

test('commands: Running / Ran with the first line, and exit N when it failed', () => {
  const ran: ChatItem = { type: 'commandExecution', status: 'completed', command: ['npm', 'test'], exitCode: 0 };
  assert.deepEqual(describe(ran), { icon: 'terminal', verb: 'Ran', target: 'npm test', failed: false, live: false });
  const failed: ChatItem = { type: 'commandExecution', status: 'completed', command: 'make\nmore', exitCode: 2 };
  assert.deepEqual(describe(failed), {
    icon: 'terminal',
    verb: 'Ran',
    target: 'make',
    meta: 'exit 2',
    failed: true,
    live: false,
  });
  assert.equal(describe({ type: 'commandExecution', status: 'failed', command: 'x' }).meta, 'failed');
  assert.equal(describe({ type: 'commandExecution', status: 'running', command: 'x' }).verb, 'Running');
  // Mixed command actions are an ordinary command.
  assert.equal(describe(cmd('read', [{}, { type: 'search' }])).verb, 'Ran');
});

test('file changes: Created, Deleted, Edited, with +a −r', () => {
  const created = describe({ type: 'fileChange', status: 'completed', changes: [{ path: 'n.ts', kind: 'add', diff: 'a\nb' }] });
  assert.deepEqual(created, {
    icon: 'fileAdd',
    verb: 'Created',
    target: 'n.ts',
    meta: '+2',
    added: 2,
    removed: 0,
    failed: false,
    live: false,
  });
  const deleted = describe({ type: 'fileChange', status: 'inProgress', changes: [{ path: 'o.ts', kind: 'delete' }] });
  assert.equal(deleted.verb, 'Deleting');
  assert.equal(deleted.icon, 'fileRemove');
  assert.equal(describe({ type: 'fileChange', status: 'completed', changes: [{ path: 'o.ts', kind: 'delete' }] }).verb, 'Deleted');
  const edited = describe({
    type: 'fileChange',
    status: 'completed',
    changes: [
      { path: 'a.ts', diff: '+x\n-y' },
      { path: 'b.ts', kind: 'add', diff: '+z' },
    ],
  });
  assert.equal(edited.verb, 'Edited');
  assert.equal(edited.icon, 'pencil');
  assert.equal(edited.target, '2 files');
  assert.equal(edited.meta, '+2 −1');
  assert.equal(describe({ type: 'fileChange', status: 'running', changes: [{ path: 'a.ts' }] }).verb, 'Editing');
  assert.equal(describe({ type: 'fileChange', status: 'declined', changes: [{ path: 'a.ts' }] }).failed, true);
  assert.equal(describe({ type: 'fileChange', status: 'completed', changes: [{ path: 'a.ts' }] }).meta, undefined);
});

test('tools: Calling / Called server · tool, or a tool', () => {
  assert.equal(describe({ type: 'mcpToolCall', status: 'running', server: 'docs', tool: 'find' }).verb, 'Calling');
  assert.equal(describe({ type: 'dynamicToolCall', status: 'completed', server: 'docs', tool: 'find' }).target, 'docs · find');
  assert.equal(describe({ type: 'dynamicToolCall', status: 'completed' }).target, 'a tool');
  assert.equal(describe({ type: 'dynamicToolCall', status: 'failed', tool: 't' }).failed, true);
});

test('show_user is drawn as its title with sparkles', () => {
  assert.deepEqual(describe({ type: 'dynamicToolCall', status: 'completed', tool: 'show_user', title: 'Look here' }), {
    icon: 'sparkles',
    verb: 'Look here',
    failed: false,
    live: false,
  });
});

test('web searches and compaction', () => {
  assert.deepEqual(
    [
      describe({ type: 'webSearch', status: 'running', query: 'q' }).verb,
      describe({ type: 'webSearch', status: 'completed', query: 'q' }).verb,
      describe({ type: 'contextCompaction', status: 'running' }).verb,
      describe({ type: 'contextCompaction', status: 'completed' }).verb,
    ],
    ['Searching the web for', 'Searched the web for', 'Compacting the conversation', 'Compacted the conversation'],
  );
  assert.equal(describe({ type: 'webSearch', query: 'q' }).icon, 'globe');
  assert.equal(describe({ type: 'contextCompaction' }).icon, 'compress');
});

test('unknown kinds show their title or their type', () => {
  assert.equal(describe({ type: 'somethingNew', title: 'Did it' }).verb, 'Did it');
  assert.equal(describe({ type: 'somethingNew' }).verb, 'somethingNew');
  assert.equal(describe({}).verb, 'Activity');
});

test('isAction: messages, plans and turn diffs stand alone', () => {
  for (const type of ['userMessage', 'agentMessage', 'assistantMessage', 'plan', 'turnDiff', 'imageView', 'imageGeneration'])
    assert.equal(isAction({ type }), false, type);
  assert.equal(isAction({ type: 'x', role: 'user' }), false);
  assert.equal(isAction({ type: 'x', role: 'assistant' }), false);
  assert.equal(isAction({ type: 'reasoning' }), true);
  assert.equal(isAction({ type: 'commandExecution' }), true);
});

test('summarize: each part of the sentence', () => {
  const items: ChatItem[] = [
    cmd('read', [{ path: 'src/x.ts' }]),
    cmd('search', [{ query: 'a' }]),
    cmd('search', [{ query: 'b' }]),
    cmd('search', [{ query: 'c' }]),
    { type: 'commandExecution', command: 'a' },
    { type: 'commandExecution', command: 'b' },
    { type: 'fileChange', changes: [{ path: 'a.ts' }, { path: 'b.ts' }] },
    { type: 'dynamicToolCall', tool: 't' },
  ];
  assert.equal(summarize(items), 'Read x.ts, searched 3 times, ran 2 commands, edited 2 files, called a tool');
});

test('summarize: singular and plural forms', () => {
  assert.equal(
    summarize([cmd('read', [{ path: 'a.ts' }, { path: 'b.ts' }]), cmd('search', [{}]), cmd('list_files', [{}])]),
    'Read 2 files, searched once, listed a folder',
  );
  assert.equal(
    summarize([cmd('list_files'), cmd('list_files'), { type: 'commandExecution' }, { type: 'mcpToolCall' }, { type: 'mcpToolCall' }]),
    'Listed 2 folders, ran a command, called 2 tools',
  );
  assert.equal(
    summarize([
      { type: 'fileChange', changes: [{ path: 'src/n.ts', kind: 'add' }] },
      { type: 'fileChange', changes: [{ path: 'o.ts', kind: 'delete' }, { path: 'p.ts', kind: 'delete' }] },
      { type: 'fileChange', changes: [{ path: 'e.ts' }] },
    ]),
    'Edited e.ts, created n.ts, deleted 2 files',
  );
  assert.equal(summarize([{ type: 'webSearch' }]), 'Searched the web');
  assert.equal(summarize([{ type: 'webSearch' }, { type: 'webSearch' }]), 'Searched the web 2 times');
  assert.equal(summarize([{ type: 'contextCompaction' }]), 'Compacted the conversation');
});

test('summarize: thinking only when it is all there was, else Worked', () => {
  assert.equal(summarize([{ type: 'reasoning' }]), 'Thought');
  assert.equal(summarize([{ type: 'reasoning' }, { type: 'reasoning' }, { type: 'reasoning' }]), 'Thought 3 times');
  assert.equal(summarize([{ type: 'reasoning' }, { type: 'commandExecution' }]), 'Ran a command');
  assert.equal(summarize([]), 'Worked');
  assert.equal(summarize([{ type: 'somethingNew' }]), 'Worked');
});

test('textOf reads text, content parts or the summary', () => {
  assert.equal(textOf({ text: 'a' }), 'a');
  assert.equal(textOf({ content: [{ text: 'a' }, { text: 'b' }] }), 'a\nb');
  assert.equal(textOf({ summary: ['a', { text: 'b' }] }), 'a\nb');
  assert.equal(textOf({}), '');
});

test('duration: seconds under a minute, then minutes and seconds', () => {
  assert.equal(duration(200), '1s');
  assert.equal(duration(12_400), '12s');
  assert.equal(duration(65_000), '1m 5s');
});

test('thinkingLabel: a bold title, else Thinking while live, else Thought for Ns or Thought', () => {
  assert.deepEqual(thinkingLabel({ type: 'reasoning', status: 'inProgress', text: 'hmm' }, null), {
    label: 'Thinking',
    rest: 'hmm',
    live: true,
  });
  assert.equal(thinkingLabel({ type: 'reasoning', status: 'completed', text: 'x' }, 8000).label, 'Thought for 8s');
  assert.equal(thinkingLabel({ type: 'reasoning', status: 'completed', text: 'x' }, null).label, 'Thought');
  assert.deepEqual(thinkingLabel({ type: 'reasoning', status: 'completed', text: '**Checking the edge**\nthe rest' }, 3000), {
    label: 'Checking the edge',
    meta: '3s',
    rest: 'the rest',
    live: false,
  });
  assert.equal(thinkingLabel({ type: 'reasoning', status: 'running', text: '**Title** x' }, null).label, 'Title');
  assert.equal(thinkingLabel({ type: 'reasoning', status: 'completed', durationMs: 2000 }, null).label, 'Thought for 2s');
});

test('workingLabel: what the agent is doing and for how long', () => {
  assert.deepEqual(workingLabel([], 12_000), { word: 'Working…', time: '12s' });
  assert.equal(workingLabel([{ type: 'reasoning', status: 'inProgress' }], 0).word, 'Thinking…');
  assert.equal(workingLabel([cmd('read', [{ path: 'a' }], 'running')], 0).word, 'Reading…');
  assert.equal(workingLabel([cmd('search', [{}], 'running')], 0).word, 'Searching…');
  assert.equal(workingLabel([{ type: 'webSearch', status: 'running' }], 0).word, 'Searching…');
  assert.equal(workingLabel([{ type: 'agentMessage', status: 'inProgress' }], 0).word, 'Writing…');
  // The latest live item wins; finished items are ignored.
  assert.equal(
    workingLabel([{ type: 'reasoning', status: 'inProgress' }, { type: 'fileChange', status: 'running', changes: [] }, { type: 'reasoning', status: 'completed' }], 65_000)
      .word,
    'Editing…',
  );
  assert.equal(workingLabel([{ type: 'reasoning', status: 'completed' }], 65_000).time, '1m 5s');
});
