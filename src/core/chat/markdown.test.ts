import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inline, parseMarkdown } from './markdown.ts';

test('inline: bold and code runs; everything else is literal', () => {
  assert.deepEqual(inline('a **b** `c` d'), [
    { text: 'a ' },
    { text: 'b', bold: true },
    { text: ' ' },
    { text: 'c', code: true },
    { text: ' d' },
  ]);
  assert.deepEqual(inline('_it_ [link](x) <b>html</b>'), [{ text: '_it_ [link](x) <b>html</b>' }]);
  assert.deepEqual(inline(''), []);
});

test('paragraphs keep their line breaks; a blank line starts a new one', () => {
  assert.deepEqual(parseMarkdown('one\ntwo\n\nthree'), [
    { kind: 'paragraph', lines: [[{ text: 'one' }], [{ text: 'two' }]] },
    { kind: 'paragraph', lines: [[{ text: 'three' }]] },
  ]);
});

test('headings at levels 1 to 4', () => {
  assert.deepEqual(parseMarkdown('# A\n#### **B**\n##### five'), [
    { kind: 'heading', level: 1, runs: [{ text: 'A' }] },
    { kind: 'heading', level: 4, runs: [{ text: 'B', bold: true }] },
    { kind: 'paragraph', lines: [[{ text: '##### five' }]] },
  ]);
});

test('lists: unordered and ordered, not nested', () => {
  assert.deepEqual(parseMarkdown('- a\n* `b`\n\n1. one\n2) two'), [
    { kind: 'list', ordered: false, items: [[{ text: 'a' }], [{ text: 'b', code: true }]] },
    { kind: 'list', ordered: true, items: [[{ text: 'one' }], [{ text: 'two' }]] },
  ]);
  assert.deepEqual(parseMarkdown('  - indented'), [{ kind: 'list', ordered: false, items: [[{ text: 'indented' }]] }]);
});

test('code blocks keep their lines and language, including blank lines and Markdown', () => {
  assert.deepEqual(parseMarkdown('Look:\n```ts\nconst a = 1;\n\n# not a heading\n```\nAfter'), [
    { kind: 'paragraph', lines: [[{ text: 'Look:' }]] },
    { kind: 'code', language: 'ts', lines: ['const a = 1;', '', '# not a heading'] },
    { kind: 'paragraph', lines: [[{ text: 'After' }]] },
  ]);
});

test('an unclosed code fence runs to the end of the text', () => {
  assert.deepEqual(parseMarkdown('```\nline one\nline two'), [
    { kind: 'code', language: '', lines: ['line one', 'line two'] },
  ]);
});

test('emoji pass through as text', () => {
  assert.deepEqual(parseMarkdown('Fixed it 🎉 **done** ✅'), [
    { kind: 'paragraph', lines: [[{ text: 'Fixed it 🎉 ' }, { text: 'done', bold: true }, { text: ' ✅' }]] },
  ]);
});

test('tables and links stay literal', () => {
  assert.deepEqual(parseMarkdown('| a | b |\n[x](y)'), [
    { kind: 'paragraph', lines: [[{ text: '| a | b |' }], [{ text: '[x](y)' }]] },
  ]);
});

test('empty text gives no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
});
