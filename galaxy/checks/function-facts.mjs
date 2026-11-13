// A function planet's card states the measures its look, size and lanes are drawn from.
import assert from 'node:assert/strict';
import { planetFacts } from '../viewer/galaxy/function-facts.js';

const p = { start: 1021, end: 1253, params: 2, branches: 50, depth: 7, callers: 1, callees: 12 };
assert.deepEqual(planetFacts(p, 'Very tangled'), [
  'Very tangled · 233 lines',
  '50 branches · nested 7 deep',
  'Called by 1 · calls 12',
]);
assert.deepEqual(planetFacts({ start: 5, end: 5, params: 1, branches: 1, depth: 0, callers: 0, callees: 0 }, 'Straightforward'), [
  'Straightforward · 1 line',
  '1 branch · no nesting',
  'Called by 0 · calls 0',
]);
// A dataset baked before the measures existed still says where the function is.
assert.deepEqual(planetFacts({ start: 3, end: 9 }, null), ['Lines 3–9 · 7 lines']);
// Each line fits the room's card (about 27 characters) for the longest grade and a four-digit function.
for (const line of planetFacts({ start: 1, end: 1200, params: 9, branches: 120, depth: 12, callers: 140, callees: 120 }, 'Straightforward'))
  assert.ok(line.length <= 28, line);
