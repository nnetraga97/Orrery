import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFunctionIndex } from './functions.ts';

const index = createFunctionIndex({
  files: [
    {
      path: 'core/range.ts',
      planets: [
        { id: 'r#a', name: 'Range.containsPosition', kind: 'method', start: 83, end: 85 },
        { id: 'r#b', name: 'Range.containsPosition', kind: 'method', start: 90, end: 101 },
        { id: 'r#c', name: 'Range.lift', kind: 'method', start: 386, end: 391 },
      ],
    },
    { path: 'core/selection.ts', planets: [{ id: 's#a', name: 'Selection.containsCursor', kind: 'method', start: 10, end: 20 }] },
  ],
  calls: [
    ['r#a', 'r#b'],
    ['s#a', 'r#b'],
    ['s#a', 'gone'],
  ],
});

test('a function is found by its whole name, its name after the class, or part of it', () => {
  assert.deepEqual(index.find('Range.lift').map(f => f.id), ['r#c']);
  assert.deepEqual(index.find('containsposition').map(f => f.id), ['r#a', 'r#b']);
  assert.deepEqual(index.find('contains').map(f => f.id), ['r#a', 'r#b', 's#a']);
  assert.deepEqual(index.find('  '), []);
});

test('the description names the place, the callers and the callees, and the files for the scene', () => {
  const d = index.describe('containsPosition');
  assert.match(d.text, /Range\.containsPosition — core\/range\.ts, lines 90–101 \(method\)/);
  assert.match(d.text, /called by: Range\.containsPosition \(core\/range\.ts:83\), Selection\.containsCursor \(core\/selection\.ts:10\)/);
  assert.match(d.text, /lines 83–85 \(method\)\n {2}called by: none the galaxy shows\n {2}calls: Range\.containsPosition \(core\/range\.ts:90\)/);
  assert.deepEqual(d.files, ['core/range.ts']);
});

test('a miss says what the galaxy holds and points at search', () => {
  const d = index.describe('tokenize');
  assert.match(d.text, /No function the galaxy shows is named like "tokenize"/);
  assert.match(d.text, /4 in all/);
  assert.deepEqual(d.files, []);
});
