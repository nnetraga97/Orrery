import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSelection, maxScrollTop, scrollToRange, shownRange, visibleLines } from './code-view.ts';
import type { CodeView } from './code-view.ts';

const file = (n: number) => Array.from({ length: n }, (_, i) => [{ text: `line ${i + 1}` }]);
const view = (patch: Partial<CodeView> = {}): CodeView => ({
  file: 'a.ts',
  lines: file(100),
  regions: [
    { name: 'first', start: 2, end: 6 },
    { name: 'middle', start: 40, end: 49 },
    { name: 'last', start: 96, end: 100 },
  ],
  selectedRegion: 1,
  selectedRange: null,
  hoveredRange: null,
  ...patch,
});
const options = { rows: 12, columns: 56, scrollTop: 0 };

test('the card shows the selected function with 3 lines of context each side, 12 rows at a time', () => {
  const rows = visibleLines(view(), options);
  assert.deepEqual(
    rows.map(r => r.number),
    Array.from({ length: 12 }, (_, i) => 37 + i),
  );
  assert.deepEqual(shownRange(view()), { start: 37, end: 52 });
  const more = visibleLines(view(), { ...options, rows: 24 });
  assert.equal(more.length, 16);
  assert.equal(maxScrollTop(view(), 12), 4);
});

test('context is clipped at the start and end of the file', () => {
  assert.deepEqual(shownRange(view({ selectedRegion: 0 })), { start: 1, end: 9 });
  assert.deepEqual(shownRange(view({ selectedRegion: 2 })), { start: 93, end: 100 });
});

test('with no selected function the whole file shows from scrollTop', () => {
  const rows = visibleLines(view({ selectedRegion: null }), { ...options, scrollTop: 10 });
  assert.equal(rows.length, 12);
  assert.equal(rows[0].number, 11);
  assert.deepEqual(shownRange(view({ selectedRegion: null })), { start: 1, end: 100 });
});

test('the card has something to show only while a function or a range is selected', () => {
  assert.equal(hasSelection(null), false);
  assert.equal(hasSelection(view()), true);
  assert.equal(hasSelection(view({ selectedRegion: null })), false);
  assert.equal(hasSelection(view({ selectedRegion: null, selectedRange: { start: 3, end: 3 } })), true);
  assert.equal(hasSelection(view({ lines: [] })), false);
});

test('highlight flags: selected wins over hovered', () => {
  const rows = visibleLines(
    view({ selectedRange: { start: 41, end: 42 }, hoveredRange: { start: 42, end: 44 } }),
    options,
  );
  const of = (n: number) => rows.find(r => r.number === n)!.highlight;
  assert.equal(of(40), 'none');
  assert.equal(of(41), 'selected');
  assert.equal(of(42), 'selected');
  assert.equal(of(43), 'hovered');
  assert.equal(of(45), 'none');
});

test('a long line is cut at the column limit and flagged, splitting a segment', () => {
  const lines = [[{ text: 'const ', cls: 'tok-keyword' }, { text: 'x'.repeat(10) }, { text: ' = 1;' }]];
  const [row] = visibleLines(view({ lines, regions: [], selectedRegion: null }), { ...options, columns: 10 });
  assert.equal(row.truncated, true);
  assert.deepEqual(row.segments, [{ text: 'const ', cls: 'tok-keyword' }, { text: 'xxxx' }]);
  const [short] = visibleLines(view({ lines, regions: [], selectedRegion: null }), { ...options, columns: 80 });
  assert.equal(short.truncated, false);
  assert.equal(short.segments.map(s => s.text).join(''), 'const xxxxxxxxxx = 1;');
});

test('an empty file gives no rows', () => {
  assert.deepEqual(visibleLines(view({ lines: [], regions: [], selectedRegion: null }), options), []);
});

test('scrollToRange puts the range a third of the way down, clamped', () => {
  const v = view({ selectedRegion: null });
  assert.equal(scrollToRange(v, { start: 50, end: 52 }, 30), 50 - 1 - 10);
  assert.equal(scrollToRange(v, { start: 3, end: 4 }, 30), 0);
  assert.equal(scrollToRange(v, { start: 99, end: 99 }, 30), maxScrollTop(v, 30));
  assert.equal(maxScrollTop(v, 30), 70);
  assert.equal(maxScrollTop(view(), 24), 0);
});

test('a tab counts as two columns, as the card draws it', () => {
  const lines = [[{ text: '\t\treturn x;' }]];
  const [row] = visibleLines(view({ lines, regions: [], selectedRegion: null }), { ...options, columns: 8 });
  assert.equal(row.segments.map(s => s.text).join(''), '    retu');
  assert.equal(row.truncated, true);
});
