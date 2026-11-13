import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasSelection, maxScrollTop, scrollToRange, shownRange, visibleLines, wrapLine } from './code-view.ts';
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

test('a selected line too long for the card wraps onto continuation rows; other long lines are cut', () => {
  const long = '\t\tif (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) {';
  const lines = file(10);
  lines[4] = [{ text: long, cls: 'tok-keyword' }];
  lines[5] = [{ text: long }];
  const v = view({ lines, regions: [], selectedRegion: null, selectedRange: { start: 5, end: 5 } });
  const rows = visibleLines(v, { rows: 12, columns: 56, scrollTop: 0 });
  const five = rows.filter(r => r.number === 5);
  assert.equal(five.length, 2);
  assert.deepEqual(five.map(r => [!!r.continuation, r.truncated, r.highlight]), [[false, false, 'selected'], [true, false, 'selected']]);
  for (const r of five) assert.ok(r.segments.map(s => s.text).join('').length <= 56);
  // Nothing is lost: the rows hold the whole line (tabs as two spaces), the second one indented.
  const joined = five.map(r => r.segments.map(s => s.text).join('')).join('|');
  assert.ok(joined.includes('position.column >= range.endColumn) {'));
  assert.ok(five[1].segments[0].text.startsWith('        '));
  assert.equal(five[1].segments[1].cls, 'tok-keyword');
  // The unselected long line stays one cut row.
  const six = rows.filter(r => r.number === 6);
  assert.deepEqual(six.map(r => r.truncated), [true]);
  // The continuation row counts toward the scroll range.
  assert.equal(maxScrollTop(v, 4), 10 + 1 - 4);
  assert.equal(maxScrollTop(view({ lines, regions: [], selectedRegion: null }), 4), 10 - 4);
});

test('scrolling counts rows: at the end the card is full and shows the last line, wrapped lines above included', () => {
  const long = '\t\tif (position.lineNumber === range.endLineNumber && position.column >= range.endColumn) {';
  const lines = file(20);
  for (const n of [2, 3, 4]) lines[n - 1] = [{ text: long }];
  const v = view({ lines, regions: [], selectedRegion: null, selectedRange: { start: 2, end: 4 } });
  // 20 lines and three continuation rows.
  const max = maxScrollTop(v, 6);
  assert.equal(max, 20 + 3 - 6);
  const end = visibleLines(v, { rows: 6, columns: 56, scrollTop: max });
  assert.deepEqual(end.map(r => r.number), [15, 16, 17, 18, 19, 20]);
  // One row down from the top: line 1 is gone, the selection starts the card.
  const one = visibleLines(v, { rows: 6, columns: 56, scrollTop: 1 });
  assert.deepEqual(one.map(r => [r.number, !!r.continuation]), [[2, false], [2, true], [3, false], [3, true], [4, false], [4, true]]);
  // Two rows down: the card starts on line 2's continuation row.
  const two = visibleLines(v, { rows: 6, columns: 56, scrollTop: 2 });
  assert.deepEqual(two.map(r => [r.number, !!r.continuation]), [[2, true], [3, false], [3, true], [4, false], [4, true], [5, false]]);
  // Every scroll position shows a full card, each one row further on.
  for (let top = 0; top <= max; top++) assert.equal(visibleLines(v, { rows: 6, columns: 56, scrollTop: top }).length, 6);
  // A range below the wrapped lines is placed by rows.
  assert.equal(scrollToRange(v, { start: 12, end: 12 }, 6), 11 + 3 - 2);
});

test('wrapLine breaks at a space near the end of a row, or mid-word when there is none', () => {
  const rows = wrapLine([{ text: 'aaaa bbbb cccc dddd eeee ffff' }], 20);
  assert.deepEqual(rows.map(r => r.map(s => s.text).join('')), ['aaaa bbbb cccc dddd ', '    eeee ffff']);
  const solid = wrapLine([{ text: 'x'.repeat(50) }], 20);
  assert.deepEqual(solid.map(r => r.map(s => s.text).join('').length), [20, 20, 18]);
  assert.deepEqual(wrapLine([{ text: 'short' }], 20), [[{ text: 'short' }]]);
});
