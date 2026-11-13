import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FUNCTION_LINES, NOTE_HEAD, contextNote, lookingLabel } from './context.ts';
import type { Where } from './context.ts';

const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
const problem = { title: 'End of a selection counts as outside', text: 'A position at the end is outside.', file: 'core/range.ts', line: 97, fn: 'Range.containsPosition' };
const code: Where['code'] = { file: 'core/range.ts', fn: 'containsPosition', fnRange: { start: 90, end: 101 }, range: { start: 97, end: 99 }, lines };

test('the label is the most specific place in view', () => {
  assert.equal(lookingLabel({}), null);
  assert.equal(lookingLabel({ selected: 'core/selection.ts' }), 'selection.ts');
  assert.equal(lookingLabel({ selected: 'a.ts', landed: { file: 'core/range.ts', fn: 'lift' } }), 'range.ts · lift');
  assert.equal(lookingLabel({ landed: { file: 'core/range.ts', fn: null } }), 'range.ts');
  assert.equal(lookingLabel({ landed: { file: 'x.ts', fn: 'f' }, code }), 'range.ts:97–99');
  assert.equal(lookingLabel({ code: { ...code!, range: null } }), 'range.ts:90–101');
});

test('nothing in view and no problem: no note', () => {
  assert.equal(contextNote({}, { first: true, attach: true }), '');
  assert.equal(contextNote({ selected: 'a.ts' }, { first: false, attach: false }), '');
});

test("a chat's first message carries the problem card, even with the chip off", () => {
  const note = contextNote({ problem, selected: 'a.ts' }, { first: true, attach: false });
  assert.ok(note.startsWith(`\n\n${NOTE_HEAD}\n`));
  assert.match(note, /A problem card is open: "End of a selection counts as outside" A position at the end is outside\. It names Range\.containsPosition in core\/range\.ts, line 97\./);
  assert.doesNotMatch(note, /selected/);
  assert.doesNotMatch(contextNote({ problem }, { first: false, attach: true }), /problem card/);
});

test('a selected file and a landed function are named', () => {
  assert.match(contextNote({ selected: 'core/selection.ts' }, { first: false, attach: true }), /The user has the file core\/selection\.ts selected\./);
  assert.match(contextNote({ landed: { file: 'core/range.ts', fn: 'Range.lift' } }, { first: false, attach: true }), /landed on the function Range\.lift in core\/range\.ts\./);
  assert.match(contextNote({ landed: { file: 'core/range.ts', fn: null } }, { first: false, attach: true }), /landed on core\/range\.ts\./);
});

test('the code card sends a short function whole, with the selected lines named', () => {
  const note = contextNote({ code }, { first: false, attach: true });
  assert.match(note, /code card open on core\/range\.ts, function containsPosition \(lines 90–101\), with lines 97–99 selected\./);
  assert.match(note, /\n90\tline 90\n/);
  assert.match(note, /\n101\tline 101$/);
});

test('a long function sends only the selected lines', () => {
  const long: Where['code'] = { ...code!, fnRange: { start: 10, end: 10 + MAX_FUNCTION_LINES } };
  const note = contextNote({ code: long }, { first: false, attach: true });
  assert.match(note, /\n97\tline 97\n98\tline 98\n99\tline 99$/);
  assert.doesNotMatch(note, /\n10\tline 10\n/);
});

test('an undone turn is said in the same note', () => {
  const note = contextNote({ selected: 'a.ts' }, { first: false, attach: true, undone: true });
  assert.equal(note.split(NOTE_HEAD).length, 2);
  assert.match(note, /undid the file changes from your last turn/);
  assert.match(note, /The user has the file a\.ts selected\./);
  assert.match(contextNote({}, { first: false, attach: false, undone: true }), /undid the file changes/);
});
