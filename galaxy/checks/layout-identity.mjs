// Layout identity (docs/design/planet-towns.md I-1, I-3, I-5): renames and new code leave existing anchors in place.
// node checks/layout-identity.mjs
import assert from 'node:assert/strict';
import ts from 'typescript';
import { analyzeSource } from '../source-model/code-model.js';
import { reconcileFiles, reconcileTowns, townPrint, townSketch } from '../source-model/layout-identity.js';
import { buildRegions, layoutRegions } from '../source-model/semantic-layout.js';

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

check('file renames keep their key; copies and ambiguous matches do not', () => {
  const files = {};
  const first = reconcileFiles(files, [
    { path: 'a.js', content: 'A', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
    { path: 'e1.js', content: 'E', detail: null },
    { path: 'e2.js', content: 'E', detail: null },
  ]);
  const key = first.keyOf.get('a.js');
  // Pure rename: same text.
  let next = reconcileFiles(files, [
    { path: 'lib/a.js', content: 'A', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
    { path: 'e1.js', content: 'E', detail: null },
    { path: 'e2.js', content: 'E', detail: null },
  ]);
  assert.equal(next.keyOf.get('lib/a.js'), key);
  assert.deepEqual(next.renames, [['a.js', 'lib/a.js']]);
  // Rename that also rewrote the file's own imports: the symbols still match.
  next = reconcileFiles(files, [
    { path: 'src/a.js', content: 'A2', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
    { path: 'e1.js', content: 'E', detail: null },
    { path: 'e2.js', content: 'E', detail: null },
  ]);
  assert.equal(next.keyOf.get('src/a.js'), key);
  // A copy keeps the original's key on the original and gets a fresh one.
  next = reconcileFiles(files, [
    { path: 'src/a.js', content: 'A2', detail: 'a' },
    { path: 'src/a-copy.js', content: 'A2', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
    { path: 'e1.js', content: 'E', detail: null },
    { path: 'e2.js', content: 'E', detail: null },
  ]);
  assert.equal(next.keyOf.get('src/a.js'), key);
  assert.notEqual(next.keyOf.get('src/a-copy.js'), key);
  // Two identical files renamed at once are ambiguous: both get fresh keys, neither steals the other's.
  const e1 = next.keyOf.get('e1.js'),
    e2 = next.keyOf.get('e2.js');
  next = reconcileFiles(files, [
    { path: 'src/a.js', content: 'A2', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
    { path: 'x1.js', content: 'E', detail: null },
    { path: 'x2.js', content: 'E', detail: null },
  ]);
  assert.ok(![e1, e2].includes(next.keyOf.get('x1.js')) && ![e1, e2].includes(next.keyOf.get('x2.js')));
  // An undone delete gets its identity back.
  const b = next.keyOf.get('b.js');
  reconcileFiles(files, [{ path: 'src/a.js', content: 'A2', detail: 'a' }]);
  next = reconcileFiles(files, [
    { path: 'src/a.js', content: 'A2', detail: 'a' },
    { path: 'b.js', content: 'B', detail: 'b' },
  ]);
  assert.equal(next.keyOf.get('b.js'), b);
});

const source = `
export class Store {
  load(id) { const row = this.rows.get(id); if (!row) throw new Error('missing'); return row; }
  save(row) { this.rows.set(row.id, row); this.emit('saved', row); }
  emit(name, value) { for (const fn of this.listeners) fn(name, value); }
}
export function helper(value) { return value * 2 + 1; }
`;
// Builds keyed regions for one revision of a file, as planet.js does, and returns each town's anchor by key.
function layout(towns, text, file, elsewhere = []) {
  const regions = buildRegions(analyzeSource(ts, text, { file }), { file });
  const lines = text.split('\n'),
    prints = new Map(regions.map(region => [region.id, townPrint(lines, region)])),
    sketches = new Map(regions.map(region => [region.id, townSketch(lines, region)]));
  const keys = reconcileTowns(towns, regions, file, prints, { sketches, elsewhere });
  layoutRegions(
    regions,
    region => 'f:store.js#' + keys.get(region.id),
    region => towns[keys.get(region.id)].born,
  );
  return new Map(regions.map(region => [keys.get(region.id), { name: region.name, layout: region.layout }]));
}
const same = (before, after, label) => {
  for (const [key, town] of before) {
    const now = after.get(key);
    assert.ok(now, `${label}: ${town.name} lost its town key`);
    assert.deepEqual(now.layout.anchor, town.layout.anchor, `${label}: ${town.name} anchor moved`);
    assert.deepEqual(now.layout.districtAnchor, town.layout.districtAnchor, `${label}: ${town.name} district moved`);
  }
};

check('method, class and file renames keep every town anchor', () => {
  const towns = {};
  const before = layout(towns, source, 'store.js');
  const renamedMethod = layout(towns, source.replace('save(row)', 'persist(row)'), 'store.js');
  assert.equal(renamedMethod.size, before.size);
  assert.ok([...renamedMethod.values()].some(t => t.name === 'persist'));
  same(before, renamedMethod, 'method rename');
  const renamedClass = layout(
    towns,
    source.replace('save(row)', 'persist(row)').replace('Store', 'Repository'),
    'store.js',
  );
  same(before, renamedClass, 'class rename');
  const renamedFile = layout(
    towns,
    source.replace('save(row)', 'persist(row)').replace('Store', 'Repository'),
    'lib/repository.js',
  );
  same(before, renamedFile, 'file rename');
});

check('a new method never re-anchors the towns already there', () => {
  const towns = {};
  const before = layout(towns, source, 'store.js');
  // "aaa" sorts before every existing member, so an id-ordered anchor would move the whole class.
  const added = layout(towns, source.replace('  load(id)', '  aaa() { return 0; }\n  load(id)'), 'store.js');
  assert.equal(added.size, before.size + 1);
  same(before, added, 'added method');
  // Deleting it again restores the original layout exactly.
  same(before, layout(towns, source, 'store.js'), 'removed again');
});

check('ages are reproducible from the same source', () => {
  const a = {},
    b = {};
  layout(a, source, 'store.js');
  layout(b, source, 'store.js');
  assert.deepEqual(a, b);
});

check('saved placements and pins survive edits, renames and an undone deletion', () => {
  const towns = {};
  const first = layout(towns, source, 'store.js');
  const key = [...first].find(([, town]) => town.name === 'helper')[0];
  const pin = { face: 2, i: 31, j: 42, orientation: 90 };
  const place = { ...pin, w: 8, h: 9, recipe: 2, overflow: false };
  Object.assign(towns[key], { pin, place });
  const renamed = source.replace('helper(value)', 'double(value)');
  for (const text of [source, renamed, renamed.replace('return value * 2 + 1', 'return value * 2 + 2')]) {
    layout(towns, text, 'store.js');
    assert.deepEqual(towns[key].pin, pin);
    assert.deepEqual(towns[key].place, place);
  }
  layout(towns, '', 'store.js');
  assert.ok(towns[key].gone);
  layout(towns, renamed, 'store.js');
  assert.equal(towns[key].gone, undefined);
  assert.deepEqual(towns[key].pin, pin);
  assert.deepEqual(towns[key].place, place);
});

const flow = `
export function process(items) {
  const valid = items.filter(item => item && item.id);
  if (!valid.length) throw new Error('nothing to process');
  const totals = valid.map(item => item.price * item.count);
  const sum = totals.reduce((a, b) => a + b, 0);
  const average = sum / totals.length;
  return { sum, average, count: valid.length };
}
export function other(value) {
  const doubled = value * 2;
  return doubled + 1;
}
`;
const keyNamed = (map, name) => [...map].find(([, town]) => town.name === name)?.[0];

check('a split keeps the layout for the part holding most of the old body', () => {
  const towns = {};
  const before = layout(towns, flow, 'flow.js'),
    key = keyNamed(before, 'process'),
    place = { face: 1, i: 40, j: 50, orientation: 0, w: 6, h: 5, recipe: 3 };
  towns[key].place = place;
  const split = flow
    .replace(
      `  const sum = totals.reduce((a, b) => a + b, 0);
  const average = sum / totals.length;
  return { sum, average, count: valid.length };
}`,
      `  const sum = totals.reduce((a, b) => a + b, 0);
  return summarize(sum, totals, valid);
}
function summarize(sum, totals, valid) {
  const average = sum / totals.length;
  return { sum, average, count: valid.length };
}`,
    )
    .replace('function process(items)', 'function prepare(items)');
  const after = layout(towns, split, 'flow.js');
  assert.equal(keyNamed(after, 'prepare'), key, 'the larger part inherits');
  assert.notEqual(keyNamed(after, 'summarize'), key, 'the smaller part is new');
  assert.deepEqual(towns[key].place, place);
  assert.equal(Object.values(towns).filter(t => !t.gone && t.place).length, 1, 'the placement is not duplicated');
  assert.equal(keyNamed(after, 'other'), keyNamed(before, 'other'));
});

check('a merge keeps the earliest layout; the other stays removed', () => {
  const towns = {};
  const parts = `
export function readA(x) {
  const a = x.left * 2;
  const b = x.right * 3;
  return a + b;
}
export function readB(y) {
  const c = y.top - 1;
  const d = y.bottom + 1;
  return c * d;
}
`;
  const before = layout(towns, parts, 'read.js'),
    a = keyNamed(before, 'readA'),
    b = keyNamed(before, 'readB');
  assert.ok(towns[a].born < towns[b].born);
  const merged = layout(
    towns,
    `
export function read(x, y) {
  const a = x.left * 2;
  const b = x.right * 3;
  const c = y.top - 1;
  const d = y.bottom + 1;
  return a + b + c * d;
}
`,
    'read.js',
  );
  assert.equal(keyNamed(merged, 'read'), a);
  assert.ok(towns[b].gone, 'the later town is not resurrected');
  // Undoing the merge gives both towns back their own keys.
  const undone = layout(towns, parts, 'read.js');
  assert.equal(keyNamed(undone, 'readA'), a);
  assert.equal(keyNamed(undone, 'readB'), b);
});

check('a rename that also edits the body keeps its key; identical bodies stay ambiguous', () => {
  const towns = {};
  const before = layout(towns, flow, 'flow.js'),
    key = keyNamed(before, 'other');
  const edited = layout(
    towns,
    flow.replace('other(value)', 'twice(value)').replace('doubled + 1', 'doubled + 2'),
    'flow.js',
  );
  assert.equal(keyNamed(edited, 'twice'), key);
  // Two copies of one body removed and one brought back: which one it is cannot be told.
  const twins = {},
    copy = `export function one(v) {\n  const w = v * 10;\n  return w - 3;\n}\n`;
  const first = layout(twins, copy + copy.replace('one(', 'two('), 'twins.js');
  const back = layout(twins, copy.replace('one(', 'three('), 'twins.js');
  assert.ok(![keyNamed(first, 'one'), keyNamed(first, 'two')].includes(keyNamed(back, 'three')));
});

check('a town moved to another file keeps its identity but takes a new site', () => {
  const source = {},
    target = {};
  const before = layout(source, flow, 'flow.js'),
    key = keyNamed(before, 'other');
  source[key].place = { face: 1, i: 10, j: 10, orientation: 0, w: 4, h: 4, recipe: 3 };
  const originalId = source[key].id;
  layout(source, flow.replace(/export function other[\s\S]*$/, ''), 'flow.js');
  assert.ok(source[key].gone);
  const elsewhere = Object.keys(source)
    .filter(k => source[k].gone)
    .map(k => ({ file: 'f:flow.js', towns: source, key: k }));
  const after = layout(
    target,
    'export const unit = 1;\n' + flow.match(/export function other[\s\S]*$/)[0],
    'math.js',
    elsewhere,
  );
  const moved = target[keyNamed(after, 'other')];
  assert.deepEqual(moved.from, { file: 'f:flow.js', id: originalId });
  assert.equal(moved.place, undefined, 'no site comes with it');
  assert.equal(source[key], undefined, 'the old record is retired');
});

console.log(`${passed.length} passed, ${failed.length} failed`);
if (failed.length) process.exit(1);
