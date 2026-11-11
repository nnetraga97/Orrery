import { test } from 'node:test';
import assert from 'node:assert/strict';
import { borderOf } from './mesh-border.ts';

const edgesOf = (segments: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 6) {
    const a = segments.slice(i, i + 3).join(','),
      b = segments.slice(i + 3, i + 6).join(',');
    out.push(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return out.sort();
};

test('a single triangle is all border', () => {
  assert.equal(borderOf([0, 0, 0, 1, 0, 0, 0, 1, 0]).length, 18);
});

test('the shared edge of two triangles is not border', () => {
  // A unit square split along its diagonal (0,0)-(1,1).
  const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
  assert.deepEqual(edgesOf(borderOf(square)), [
    '0,0,0|0,1,0',
    '0,0,0|1,0,0',
    '0,1,0|1,1,0',
    '1,0,0|1,1,0',
  ]);
});

test('vertices equal to five decimals count as the same point', () => {
  const a = [0, 0, 0, 1, 0, 0, 1, 1, 0],
    b = [0, 0, 0, 1.000001, 1, 0, 0, 1, 0];
  assert.equal(borderOf([...a, ...b]).length, 4 * 6);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(borderOf([]), []);
});
