import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseLabels, DEFAULT_LABEL_LIMITS, labelHeight } from './labels.ts';
import type { LabelCandidate } from './labels.ts';
import type { Vec3 } from './table-frame.ts';

const deg = Math.PI / 180;
// A unit direction `yaw` degrees right of straight ahead (-Z) and `pitch` degrees up.
const dir = (yaw: number, pitch = 0): Vec3 => [
  Math.sin(yaw * deg) * Math.cos(pitch * deg),
  Math.sin(pitch * deg),
  -Math.cos(yaw * deg) * Math.cos(pitch * deg),
];
const gaze: Vec3 = [0, 0, -1];
const label = (yaw: number, extra: Partial<LabelCandidate> = {}): LabelCandidate => ({
  direction: dir(yaw),
  distance: 1,
  priority: 0,
  avoidOverlap: true,
  ...extra,
});
const shown = (list: LabelCandidate[]) =>
  chooseLabels(list, gaze, DEFAULT_LABEL_LIMITS)
    .map(c => c.index)
    .sort((a, b) => a - b);

test('the defaults are the plan limits', () => {
  assert.deepEqual(DEFAULT_LABEL_LIMITS, { max: 24, coneDegrees: 35, minSeparationDegrees: 4, angularHeightDegrees: 1.4 });
});

test('fixed labels always show, even out of the cone or on top of each other', () => {
  assert.deepEqual(shown([label(80, { avoidOverlap: false }), label(0, { avoidOverlap: false }), label(0.5, { avoidOverlap: false })]), [0, 1, 2]);
});

test('a fixed label claims its space before the others', () => {
  assert.deepEqual(shown([label(1, { priority: 9 }), label(0, { avoidOverlap: false })]), [1]);
});

test('among the rest, higher priority wins a contested spot', () => {
  assert.deepEqual(shown([label(0, { priority: 1 }), label(2, { priority: 5 })]), [1]);
  assert.deepEqual(shown([label(0, { priority: 5 }), label(2, { priority: 1 })]), [0]);
});

test('equal priority keeps the given order', () => {
  assert.deepEqual(shown([label(0), label(2)]), [0]);
});

test('at most max labels show', () => {
  const many = Array.from({ length: 60 }, (_, k) => label(-30 + (k % 12) * 5, { direction: dir(-30 + (k % 12) * 5, -25 + Math.floor(k / 12) * 5) }));
  assert.equal(shown(many).length, 24);
});

test('a label beyond the cone is dropped', () => {
  assert.deepEqual(shown([label(34), label(36)]), [0]);
});

test('a label within the minimum separation of a shown label is dropped', () => {
  assert.deepEqual(shown([label(0), label(3.9), label(4.1)]), [0, 2]);
});

test('a group shows at most maxVisible labels', () => {
  const list = [0, 10, 20, -10].map(y => label(y, { group: 'g', maxVisible: 2 }));
  assert.deepEqual(shown([...list, label(-20, { group: 'h', maxVisible: 2 })]), [0, 1, 4]);
});

test('size is constant in angle', () => {
  const [near, far] = chooseLabels([label(0, { distance: 0.5 }), label(10, { distance: 2 })], gaze, DEFAULT_LABEL_LIMITS);
  const h = (d: number) => 2 * d * Math.tan((1.4 * deg) / 2);
  assert.ok(Math.abs(near.height - h(0.5)) < 1e-12);
  assert.ok(Math.abs(far.height - h(2)) < 1e-12);
  assert.ok(Math.abs(far.height / near.height - 4) < 1e-9);
});

test('a larger label is drawn larger and keeps others further away', () => {
  // 4.1 degrees clears a usual label; beside a label at 1.5 times the size it needs 6.
  assert.deepEqual(shown([label(0, { scale: 1.5 }), label(4.1), label(6.1)]), [0, 2]);
  assert.deepEqual(shown([label(0), label(4.1, { scale: 1.5 }), label(8.2)]), [0, 2]);
  const [big, usual] = chooseLabels([label(0, { scale: 1.5 }), label(10)], gaze, DEFAULT_LABEL_LIMITS);
  assert.ok(Math.abs(big.height / usual.height - 1.5) < 1e-9);
  assert.ok(Math.abs(labelHeight(1, DEFAULT_LABEL_LIMITS, 1.5) - big.height) < 1e-12);
});

// ---- the allocation-free variant used every frame ----
import { chooseLabelsInto, createLabelWork } from './labels.ts';

test('chooseLabelsInto chooses what chooseLabels chooses, reusing its arrays', () => {
  let seed = 3;
  const r = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const work = createLabelWork();
  for (let k = 0; k < 200; k++) {
    const n = Math.floor(r() * 60);
    const candidates: LabelCandidate[] = Array.from({ length: n }, () => {
      const a = (r() - 0.5) * 2.4,
        b = (r() - 0.5) * 1.2;
      return {
        direction: [Math.sin(a) * Math.cos(b), Math.sin(b), -Math.cos(a) * Math.cos(b)],
        distance: 0.5 + r() * 3,
        priority: Math.floor(r() * 4),
        avoidOverlap: r() > 0.15,
        ...(r() > 0.8 ? { scale: r() > 0.5 ? 1.5 : 1.2 } : {}),
        ...(r() > 0.6 ? { group: r() > 0.5 ? 'g1' : 'g2', maxVisible: 1 + Math.floor(r() * 3) } : {}),
      };
    });
    const expected = chooseLabels(candidates, [0, 0, -1], DEFAULT_LABEL_LIMITS);
    const count = chooseLabelsInto(candidates, n, [0, 0, -1], DEFAULT_LABEL_LIMITS, work);
    assert.equal(count, expected.length);
    assert.deepEqual(work.chosen.slice(0, count).map(c => ({ ...c })), expected);
  }
});
