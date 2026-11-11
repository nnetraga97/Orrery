import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, safePattern } from './workspace.ts';

const files: Record<string, string> = {
  'core/range.ts': 'export class Range {\n  a = 1;\n  b = 2;\n}\n',
  'core/position.ts': 'export class Position {\n  column = 1;\n}\n',
  'README.md': 'Range and Position\n',
};
const make = () => createWorkspace(async path => files[path] ?? null, Object.keys(files));

test('read and list', async () => {
  const ws = make();
  assert.equal(await ws.read('core/range.ts'), files['core/range.ts']);
  assert.deepEqual(ws.list(), ['README.md', 'core/position.ts', 'core/range.ts']);
  await assert.rejects(ws.read('core/missing.ts'), /No such file: core\/missing.ts/);
});

test('paths that are absolute or climb out are rejected', async () => {
  const ws = make();
  for (const bad of ['/etc/passwd', '../x', 'core/../../x', 'C:\\x', 'core\\x', '', 'a//b'])
    await assert.rejects(ws.read(bad), /Invalid path/, bad);
  assert.throws(() => ws.write('../x', 'y'), /Invalid path/);
});

test('search finds substrings with their line numbers', async () => {
  const ws = make();
  assert.deepEqual(await ws.search('Range'), [
    { path: 'README.md', line: 1, text: 'Range and Position' },
    { path: 'core/range.ts', line: 1, text: 'export class Range {' },
  ]);
  assert.deepEqual(await ws.search('column', 'core'), [{ path: 'core/position.ts', line: 2, text: '  column = 1;' }]);
  assert.deepEqual(await ws.search('nothing here'), []);
});

test('search takes a safe regular expression between slashes', async () => {
  const ws = make();
  assert.deepEqual((await ws.search('/^\\s+[ab] =/')).map(r => r.line), [2, 3]);
  // A pattern that could take exponential time is searched as plain text instead.
  assert.equal(safePattern('/(a+)+$/'), null);
  assert.equal(safePattern('/(a|a)*$/'), null);
  assert.equal(safePattern('/(a|aa)+$/'), null);
  assert.ok(safePattern('/(get|set)Value/') instanceof RegExp);
  // Nested groups no longer hide a repeated group; any quantified group is refused.
  for (const bad of ['/((a|a))*$/', '/(?:(a+))+$/', '/((a+)b)+/', '/(ab)?c/', '/(a){2,}/', '/(a)\\1/', '/(?<x>a)\\k<x>/', '/a*b*c*d*e*/'])
    assert.equal(safePattern(bad), null, bad);
  // Escaped parentheses are text.
  assert.ok(safePattern('/f\\(x\\)+/') instanceof RegExp);
  assert.ok(safePattern('/^\\s*if \\(\\w+/') instanceof RegExp);
  assert.ok(safePattern('/^\\s+[ab] =/') instanceof RegExp);
  assert.equal(safePattern('plain'), null);
});

test('search stops at 200 results', async () => {
  const many = Array.from({ length: 300 }, () => 'hit').join('\n');
  const ws = createWorkspace(async () => many, ['a.ts']);
  assert.equal((await ws.search('hit')).length, 200);
});

test('replace changes one exact occurrence, else fails', async () => {
  const ws = make();
  await ws.replace('core/range.ts', '  a = 1;', '  a = 10;');
  assert.ok((await ws.read('core/range.ts')).includes('a = 10;'));
  await assert.rejects(ws.replace('core/range.ts', 'nope', 'x'), /old_text was not found in core\/range.ts/);
  await assert.rejects(ws.replace('core/range.ts', ' = ', 'x'), /old_text occurs 2 times in core\/range.ts/);
});

test('write, changed, diff and edited text', async () => {
  const ws = make();
  assert.deepEqual(ws.changed(), []);
  ws.write('core/new.ts', 'x\n');
  await ws.replace('core/range.ts', 'b = 2', 'b = 3');
  assert.deepEqual(ws.changed(), ['core/new.ts', 'core/range.ts']);
  assert.ok(ws.list().includes('core/new.ts'));
  assert.equal(ws.edited('core/range.ts'), files['core/range.ts'].replace('b = 2', 'b = 3'));
  assert.equal(ws.edited('core/position.ts'), null);
  const diff = await ws.diff('core/range.ts');
  assert.ok(diff.startsWith('diff --git a/core/range.ts b/core/range.ts'));
  assert.ok(diff.includes('-  b = 2;\n+  b = 3;'));
  // Writing the original text back leaves nothing changed.
  ws.write('core/range.ts', files['core/range.ts']);
  assert.deepEqual(ws.changed(), ['core/new.ts']);
});

test('turnDiff covers what changed since markTurn', async () => {
  const ws = make();
  await ws.replace('core/range.ts', 'a = 1', 'a = 5');
  ws.markTurn();
  assert.equal(await ws.turnDiff(), '');
  await ws.replace('core/position.ts', 'column = 1', 'column = 2');
  const diff = await ws.turnDiff();
  assert.ok(diff.includes('core/position.ts') && !diff.includes('core/range.ts'));
});

test('reset returns every file to its original', async () => {
  const ws = make();
  await ws.replace('core/range.ts', 'a = 1', 'a = 5');
  ws.write('n.ts', 'n');
  ws.reset();
  assert.deepEqual(ws.changed(), []);
  assert.equal(await ws.read('core/range.ts'), files['core/range.ts']);
  assert.ok(!ws.list().includes('n.ts'));
});

test('listeners hear each change', async () => {
  const ws = make();
  const heard: string[] = [];
  ws.onChange(path => heard.push(path));
  await ws.replace('core/range.ts', 'a = 1', 'a = 5');
  ws.write('n.ts', 'n');
  assert.deepEqual(heard, ['core/range.ts', 'n.ts']);
});
