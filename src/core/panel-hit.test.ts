import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionAt, uvToPixel } from './panel-hit.ts';
import type { HitRegion } from './panel-hit.ts';

const regions: HitRegion[] = [
  { id: 'card', x: 0, y: 0, w: 100, h: 100 },
  { id: 'button', x: 10, y: 60, w: 30, h: 20 },
  { id: 'close', x: 80, y: 0, w: 20, h: 20 },
];

test('regionAt returns the last region containing the point', () => {
  assert.equal(regionAt(regions, 20, 70)?.id, 'button');
  assert.equal(regionAt(regions, 90, 10)?.id, 'close');
  assert.equal(regionAt(regions, 50, 50)?.id, 'card');
});

test('regionAt includes the top-left edge and excludes the far edge', () => {
  assert.equal(regionAt(regions, 10, 60)?.id, 'button');
  assert.equal(regionAt(regions, 40, 70)?.id, 'card');
});

test('regionAt returns null outside every region', () => {
  assert.equal(regionAt(regions, 150, 50), null);
  assert.equal(regionAt([], 0, 0), null);
});

test('uvToPixel flips v: uv (0, 1) is the top-left pixel', () => {
  assert.deepEqual(uvToPixel(0, 1, 200, 100), [0, 0]);
  assert.deepEqual(uvToPixel(1, 0, 200, 100), [200, 100]);
  assert.deepEqual(uvToPixel(0.25, 0.75, 200, 100), [50, 25]);
});
