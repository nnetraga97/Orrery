import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHRINK_FROM, SHRINK_TO, starShrink } from './star-limit.ts';

const at = (degrees: number, distance = 3) => starShrink(Math.tan((degrees * Math.PI) / 180) * distance, distance);

test('a star of the overview is drawn at full size', () => {
  assert.equal(starShrink(0.004, 1.2), 1);
  assert.equal(at(SHRINK_FROM - 0.1), 1);
});

test('the landed file\'s own star, metres across a few metres away, is not drawn', () => {
  assert.equal(starShrink(1.77, 3.31), 0);
  assert.equal(at(SHRINK_TO + 0.1), 0);
  assert.equal(starShrink(2, 1), 0);
});

test('between the two sizes it shrinks smoothly, at any distance', () => {
  const sizes = [4.5, 5, 6, 7, 7.5].map(d => at(d));
  for (let k = 1; k < sizes.length; k++) assert.ok(sizes[k] < sizes[k - 1]);
  assert.ok(Math.abs(at(6) - 0.5) < 0.02);
  assert.ok(Math.abs(at(6, 0.5) - at(6, 40)) < 1e-9);
  assert.ok(1 - at(SHRINK_FROM + 0.01) < 1e-3 && at(SHRINK_TO - 0.01) < 1e-3);
});

test('a star with no size is left alone', () => {
  assert.equal(starShrink(0, 3), 1);
});
