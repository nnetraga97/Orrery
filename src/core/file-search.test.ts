import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFiles, layoutSearch, spokenQueries } from './file-search.ts';
import type { FoundFile } from './file-search.ts';
import { chatMetrics } from './chat/layout.ts';

const FILES: FoundFile[] = [
  { path: 'core/cursorCommon.ts', name: 'cursorCommon.ts' },
  { path: 'core/range.ts', name: 'range.ts' },
  { path: 'core/wordSeparators.ts', name: 'wordSeparators.ts' },
  { path: 'model/text-model.ts', name: 'text-model.ts' },
  { path: 'core/word_helper.ts', name: 'word_helper.ts' },
];
// A stand-in for the copied search: case-insensitive substring of the name.
const search = (q: string) => FILES.filter(f => f.name.toLowerCase().includes(q));

test('spoken words become written forms: joined, hyphenated, underscored, then the longest word', () => {
  assert.deepEqual(spokenQueries('cursor common'), ['cursorcommon', 'cursor-common', 'cursor_common', 'cursor']);
  assert.deepEqual(spokenQueries('range dot ts'), ['range.ts']);
  assert.deepEqual(spokenQueries('Find the word separators file, please!'), ['wordseparators', 'word-separators', 'word_separators', 'separators']);
  assert.deepEqual(spokenQueries('open the file'), []);
});

test('findFiles matches camelCase, dotted, hyphenated and underscored names from speech', () => {
  assert.equal(findFiles('cursor common', search)[0].path, 'core/cursorCommon.ts');
  assert.equal(findFiles('range dot ts', search)[0].path, 'core/range.ts');
  assert.equal(findFiles('text model', search)[0].path, 'model/text-model.ts');
  assert.equal(findFiles('word helper', search)[0].path, 'core/word_helper.ts');
  // No duplicates, and the limit holds.
  const words = findFiles('word', search, 1);
  assert.equal(words.length, 1);
  assert.deepEqual(findFiles('nothing like it', search), []);
});

test('the page offers the microphone, then one pinchable row per file found', () => {
  const measure = (s: string) => s.length * 10;
  const m = chatMetrics(800, 1);
  const before = layoutSearch({ heard: null, results: [], listening: false, partial: '', selected: null, micAvailable: true }, m, measure);
  assert.deepEqual(before.regions.map(r => r.id), ['search:mic']);
  const after = layoutSearch({ heard: 'range', results: FILES.slice(0, 2), listening: false, partial: '', selected: null, micAvailable: true }, m, measure);
  assert.deepEqual(after.regions.map(r => r.id), ['search:mic', 'file:core/cursorCommon.ts', 'file:core/range.ts']);
  const none = layoutSearch({ heard: 'zzz', results: [], listening: false, partial: '', selected: null, micAvailable: false }, m, measure);
  assert.deepEqual(none.regions, []);
});
