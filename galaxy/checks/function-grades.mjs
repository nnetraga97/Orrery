// A landed function's grade is looked up by planet id, or by line for a function without a planet; when it cannot be
// told (no line), the answer is "not known", never "straightforward".
import assert from 'node:assert/strict';

const index = {
  version: 1,
  gradeNames: ['Straightforward', 'Some branching', 'Tangled', 'Very tangled'],
  files: [
    {
      path: 'a.ts',
      planets: [{ id: 'a.ts#big', name: 'big', start: 1, end: 90, grade: 3 }],
      hidden: 2,
      grades: [1, 0, 1, 1],
      rest: [[100, 140, 2]],
    },
    { path: 'plain.ts', planets: [], hidden: 3, grades: [3, 0, 0, 0], rest: [] },
  ],
  calls: [],
};
globalThis.fetch = async () => ({ ok: true, json: async () => index });
const { gradeName, gradeOfKey, loadFunctionIndex } = await import('../viewer/app/function-index.js');
await loadFunctionIndex('check');

assert.equal(gradeOfKey('a.ts#big'), 3);
assert.equal(gradeOfKey('belt:a.ts', 120), 2);
// A hidden function that is not listed is straightforward.
assert.equal(gradeOfKey('belt:a.ts', 200), 0);
// Without a line the hidden function is unknown, unless the file has no graded hidden function at all.
assert.equal(gradeOfKey('belt:a.ts'), null);
assert.equal(gradeOfKey('belt:plain.ts'), 0);
assert.equal(gradeOfKey('belt:other.ts', 5), null);
assert.equal(gradeOfKey(null), null);
assert.equal(gradeName(2), 'Tangled');
assert.equal(gradeName(null), null);
