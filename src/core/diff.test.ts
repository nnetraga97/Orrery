import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineDiff, unifiedDiff } from './diff.ts';
import { stat } from './chat/describe.ts';
import { turnChanges } from './chat/layout.ts';

const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');

test('identical texts have no hunks', () => {
  assert.deepEqual(lineDiff(before, before), []);
  assert.equal(unifiedDiff('x.ts', before, before), '');
});

test('one changed line is one hunk with context', () => {
  const after = before.replace('e', 'E');
  const hunks = lineDiff(before, after, 3);
  assert.equal(hunks.length, 1);
  const h = hunks[0];
  assert.deepEqual([h.oldStart, h.oldLines, h.newStart, h.newLines], [2, 7, 2, 7]);
  assert.deepEqual(
    h.lines.map(l => l.op + l.text),
    [' b', ' c', ' d', '-e', '+E', ' f', ' g', ' h'],
  );
});

test('changes far apart make two hunks; near ones merge', () => {
  const far = lineDiff(before, before.replace('a', 'A').replace('j', 'J'), 1);
  assert.equal(far.length, 2);
  const near = lineDiff(before, before.replace('c', 'C').replace('e', 'E'), 1);
  assert.equal(near.length, 1);
});

test('insertions at the start and deletions at the end', () => {
  const hunks = lineDiff('a\nb', 'x\na', 0);
  assert.deepEqual(
    hunks.flatMap(h => h.lines.map(l => l.op + l.text)),
    ['+x', '-b'],
  );
  // A zero-length side of a hunk counts its start from the line before (as unified diffs do).
  assert.deepEqual([hunks[0].oldStart, hunks[0].oldLines, hunks[0].newStart, hunks[0].newLines], [0, 0, 1, 1]);
});

test('unifiedDiff text starts with the git header and counts with stat', () => {
  const after = before.replace('e', 'E\nE2');
  const text = unifiedDiff('core/x.ts', before, after);
  const lines = text.split('\n');
  assert.equal(lines[0], 'diff --git a/core/x.ts b/core/x.ts');
  assert.equal(lines[2], '--- a/core/x.ts');
  assert.equal(lines[3], '+++ b/core/x.ts');
  assert.match(lines[4], /^@@ -2,7 \+2,8 @@$/);
  assert.deepEqual(stat({ diff: text }), { added: 2, removed: 1 });
  // The chat's "Changed N files this turn" reads it back.
  const changes = turnChanges(text + unifiedDiff('core/y.ts', 'a', 'b'));
  assert.deepEqual(changes.map(c => c.path), ['core/x.ts', 'core/y.ts']);
  assert.deepEqual(stat(changes[0]), { added: 2, removed: 1 });
});

test('a new file and a trailing newline', () => {
  const text = unifiedDiff('n.ts', '', 'one\ntwo\n');
  assert.ok(text.includes('@@ -0,0 +1,2 @@'));
  assert.deepEqual(stat({ diff: text }), { added: 2, removed: 0 });
});
