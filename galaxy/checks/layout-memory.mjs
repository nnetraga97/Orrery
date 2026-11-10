import assert from 'node:assert/strict';
import { validLayoutMemory } from '../source-model/layout-memory.js';
const fresh = { version: 1, clusters: {}, colors: {}, layouts: {}, towns: {} };
assert.ok(validLayoutMemory(fresh));
assert.ok(validLayoutMemory({ ...fresh, layoutVersion: 1 }));
for (const value of [null, {}, { ...fresh, version: 2 }, { ...fresh, layouts: [] }, { ...fresh, layoutVersion: 2 }])
  assert.equal(validLayoutMemory(value), false);
assert.ok(
  validLayoutMemory({
    ...fresh,
    towns: { f: { t: { id: 'a', place: { face: 0, i: 2, j: 3, orientation: 90, w: 5, h: 6 } } } },
  }),
);
// Every retired placement recipe is ignored, including invalid cells and dimensions.
const settled = {
  face: 4,
  i: 325,
  j: 349,
  orientation: 90,
  w: 29,
  h: 24,
  recipe: 3,
  scale: 0.011,
  width: 0.77,
  height: 0.62,
};
assert.ok(validLayoutMemory({ ...fresh, towns: { f: { t: { id: 'a', place: settled, pin: { ...settled } } } } }));
assert.equal(validLayoutMemory({ ...fresh, towns: { f: { t: { id: 'a', place: { ...settled, recipe: 2 } } } } }), true);

// Retired placement records cannot erase stable file and town identities.
const legacy = {
  ...fresh,
  files: { stableFile: { path: 'a.js' } },
  towns: { stableFile: { stableTown: { id: 'a', pin: { face: 7 }, place: 'obsolete' } } },
};
assert.ok(validLayoutMemory(legacy));
assert.equal(legacy.towns.stableFile.stableTown.id, 'a');

console.log('layout-memory: schema and identities survive retired placement data');
