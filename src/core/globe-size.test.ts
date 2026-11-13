import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FULL_LOT, GLOBE_DIAMETER, MIN_GLOBE_DIAMETER, globeDiameter } from './globe-size.ts';

test('a town that fills its globe is shown full size', () => {
  assert.equal(globeDiameter(null), GLOBE_DIAMETER);
  assert.equal(globeDiameter(0.02), GLOBE_DIAMETER);
  assert.equal(globeDiameter(FULL_LOT), GLOBE_DIAMETER);
});

test('a few-statement town gets a smaller globe, with buildings the same size in the room', () => {
  const d = globeDiameter(0.2);
  assert.ok(d < GLOBE_DIAMETER && d > MIN_GLOBE_DIAMETER);
  // lot width in metres = lot share × radius: the same as a full globe's largest lot.
  assert.ok(Math.abs(0.2 * (d / 2) - FULL_LOT * (GLOBE_DIAMETER / 2)) < 1e-9);
});

test('the globe never shrinks below the minimum', () => {
  assert.equal(globeDiameter(0.28), Math.max(MIN_GLOBE_DIAMETER, (GLOBE_DIAMETER * FULL_LOT) / 0.28));
  assert.equal(globeDiameter(5), MIN_GLOBE_DIAMETER);
});
