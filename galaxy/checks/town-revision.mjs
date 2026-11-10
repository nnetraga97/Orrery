import assert from 'node:assert/strict';
import { townRevision, rebaseTownItem } from '../source-model/town-revision.js';
const source = 'function a(){ return 1; }';
const region = {
  id: 'a.js#a',
  name: 'a',
  start: 1,
  end: 1,
  sourceStart: 0,
  sourceEnd: source.length,
  members: [{ id: 'a.js#a', start: 1, end: 1, sourceStart: 0, sourceEnd: source.length }],
  layout: { key: 'a' },
};
const shifted = {
  ...region,
  start: 2,
  end: 2,
  sourceStart: 1,
  sourceEnd: source.length + 1,
  members: region.members.map(m => ({ ...m, start: 2, end: 2, sourceStart: 1, sourceEnd: source.length + 1 })),
};
assert.equal(townRevision(region, source, 'a.js'), townRevision(shifted, '\n' + source, 'a.js'));
assert.notEqual(townRevision(region, source, 'a.js'), townRevision(region, source.replace('1', '2'), 'a.js'));
const item = { id: 'a.js#a/statement:0', line: 1, parentLine: 1, end: 1, sourceStart: 14, sourceEnd: 23, _co: {} };
const next = rebaseTownItem(item, region, shifted, 'a.js', 'b.js');
assert.equal(next.line, 2);
assert.equal(next.parentLine, 2);
assert.equal(next.sourceStart, 15);
assert.equal(next.id, 'b.js#a/statement:0');
assert.equal(next._co, item._co);
assert.equal(item.line, 1);
assert.equal(item.sourceStart, 14);
const copies = new Map();
const parent = rebaseTownItem({ body: [item] }, region, shifted, 'a.js', 'b.js', new Map(), copies);
assert.equal(rebaseTownItem(item, region, shifted, 'a.js', 'b.js', new Map(), copies), parent.body[0]);
console.log('PASS: town fingerprints ignore rebasing; revision views do not mutate retained source metadata.');
