// Source index and debug records (docs/design/planet-towns.md I-6, I-7, I-8): exact, approximate, stale and unmapped
// answers, two-way round trips, and validated evidence. node checks/source-index.mjs
import assert from 'node:assert/strict';
import ts from 'typescript';
import { analyzeSource } from '../source-model/code-model.js';
import {
  EVIDENCE,
  createDebugRecord,
  resolveDebugRecord,
  resolveStack,
  stackPaths,
} from '../source-model/debug-records.js';
import { buildRegions } from '../source-model/semantic-layout.js';
import { MATCH, createSourceIndex } from '../source-model/source-index.js';

const source = `export function run(items) {
  const a = items.length; const b = a * 2;

  for (const item of items) {
    send(item, () => { log(item); });
  }
  // a comment inside the method
  return a + b;
}

export function other() { return 1; }
`;
const file = 'run.js';
const regions = buildRegions(analyzeSource(ts, source, { file }), { file });
const statements = [];
function walk(items, town) {
  for (const it of items || []) {
    if (!it || typeof it !== 'object') continue;
    if (it.id && it.line) statements.push({ ...it, town });
    for (const key of ['then', 'else', 'body', 'handler', 'finalizer']) walk(it[key], town);
    for (const c of it.cases || []) walk(c, town);
  }
}
regions.forEach((r, k) => walk(r.flow?.body || r.flow, k));
const elements = [
  ...regions.map((r, k) => ({
    id: r.id,
    kind: 'town',
    town: k,
    line: r.start,
    end: r.end,
    sourceStart: r.sourceStart,
    sourceEnd: r.sourceEnd,
  })),
  ...statements.map(it => ({
    id: it.id,
    kind: 'statement',
    town: it.town,
    line: it.line,
    end: it.end,
    sourceStart: it.sourceStart,
    sourceEnd: it.sourceEnd,
  })),
];
const index = createSourceIndex({ file, revision: 7, source, elements });
const passed = [],
  failed = [];
function check(name, fn) {
  try {
    fn();
    passed.push(name);
  } catch (error) {
    failed.push(name);
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}

check('statements carry source offsets', () => {
  assert.ok(statements.length >= 4, 'flow statements found');
  for (const it of statements) assert.ok(Number.isFinite(it.sourceStart) && it.sourceEnd > it.sourceStart, it.id);
});

check('two statements on one line: by line it is approximate, by column each is exact', () => {
  const byLine = index.locate({ line: 2 });
  assert.equal(byLine.status, MATCH.approximate);
  assert.equal(byLine.candidates.length, 2);
  const first = index.locate({ line: 2, column: source.split('\n')[1].indexOf('const a') + 1 });
  const second = index.locate({ line: 2, column: source.split('\n')[1].indexOf('const b') + 1 });
  assert.equal(first.status, MATCH.exact);
  assert.equal(second.status, MATCH.exact);
  assert.notEqual(first.element.id, second.element.id);
});

check('ranges round-trip to the same element', () => {
  for (const it of statements) {
    const range = index.rangeOf(it.id);
    const back = index.locate({ offset: range.sourceStart, revision: 7 });
    assert.equal(back.status, MATCH.exact, it.id);
    assert.equal(back.element.id, it.id);
  }
});

check('blank lines, comments and code outside methods are not snapped to a neighbour', () => {
  assert.equal(index.locate({ line: 3 }).element?.kind, 'town', 'blank line inside a method maps to the town only');
  assert.equal(index.locate({ line: 7 }).element?.kind, 'town', 'comment inside a method maps to the town only');
  assert.equal(index.locate({ line: 10 }).status, MATCH.unmapped, 'blank line between methods');
  assert.equal(index.locate({ line: 10 }).element, null);
  assert.equal(index.nearest({ line: 10 }).status, MATCH.approximate, 'browsing fallback says it is approximate');
});

check('invalid columns cannot spill onto the next source line', () => {
  assert.equal(index.locate({ line: 10, column: 3 }).status, 'unmapped');
  assert.equal(index.locate({ line: 2, column: 999 }).status, 'unmapped');
});

check('another revision is stale, not remapped', () => {
  const stale = index.locate({ line: 8, revision: 6 });
  assert.equal(stale.status, MATCH.stale);
  assert.equal(stale.element, null);
});

check('debug records need provenance and a revision, and keep recursive frames apart', () => {
  assert.throws(() => createDebugRecord({ type: EVIDENCE.exception, file, line: 8 }), /revision is required/);
  assert.throws(() => createDebugRecord({ type: 'crash', file, line: 8, revision: 7, source: 'x' }), /unknown/);
  assert.throws(
    () => createDebugRecord({ type: EVIDENCE.coverage, file, line: 8, revision: 7, source: 'c8' }),
    /coverage needs covered/,
  );
  const exception = createDebugRecord({
    type: EVIDENCE.exception,
    file,
    line: 8,
    revision: 7,
    source: 'node-inspector',
  });
  assert.equal(resolveDebugRecord(exception, index).status, MATCH.exact);
  const frames = [2, 0, 1].map(depth =>
    createDebugRecord({
      type: EVIDENCE.frame,
      file,
      line: 5,
      revision: 7,
      source: 'adapter',
      invocation: 'i' + depth,
      depth,
    }),
  );
  const stack = resolveStack(frames, f => (f === file ? index : null));
  assert.deepEqual(
    stack.map(s => [s.n, s.frame.depth]),
    [
      [1, 0],
      [2, 1],
      [3, 2],
    ],
  );
  assert.equal(new Set(stack.map(s => s.frame.invocation)).size, 3, 'recursive frames stay separate');
});

check('numbered invocation paths keep recursion and explicit async parents, without inventing evidence', () => {
  const record = (invocation, depth, extras = {}) => ({
    type: 'frame',
    file,
    line: 8,
    revision: 7,
    source: 'fixture',
    session: 's',
    context: 'main',
    invocation,
    depth,
    ...extras,
  });
  const frames = [
    record('inner', 0),
    record('outer', 1, { continues: 'async' }),
    record('async', 2, { context: 'worker' }),
    record('elsewhere', 3, { file: 'other.js', context: 'other' }),
    record('old', 4, { revision: 6, context: 'old' }),
  ];
  const result = stackPaths(frames, f => (f === file ? index : null));
  assert.deepEqual(result.edges, [
    { from: 2, to: 1, async: false },
    { from: 3, to: 2, async: true },
  ]);
  assert.deepEqual(
    result.rows.map(r => r.n),
    [1, 2, 3, 4, 5],
  );
  assert.equal(result.rows[3].status, 'unmapped');
  assert.equal(result.rows[4].status, 'stale');
  assert.throws(() => stackPaths([frames[0], frames[0]], () => index), /distinct/);
  assert.throws(() => stackPaths([record('negative', -1)], () => index), /depth/);
  assert.throws(() => stackPaths([null], () => index), /object/);
  assert.deepEqual(stackPaths([record('a', 0, { continues: 'missing' }), record('b', 1)], () => index).edges, []);
  assert.deepEqual(stackPaths([record('a', 0), record('b', 1, { session: 'different' })], () => index).edges, []);
});

console.log(`${passed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
