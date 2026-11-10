import assert from 'node:assert/strict';
import { SelectionGesture, wheelPixels, dampingBlend, wheelAction } from '../viewer/scene/camera-input.js';

const gesture = new SelectionGesture();
const pointer = (overrides = {}) => ({ pointerId: 1, button: 0, clientX: 10, clientY: 20, ...overrides });
gesture.start(pointer());
assert.equal(gesture.end(pointer()), true, 'A primary click can select.');
for (const overrides of [
  { button: 1 },
  { button: 2 },
  { shiftKey: true },
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
]) {
  gesture.start(pointer(overrides));
  assert.equal(gesture.end(pointer(overrides)), false, 'Navigation gestures never select.');
}
gesture.start(pointer());
gesture.move(pointer({ clientX: 35 }));
gesture.move(pointer());
assert.equal(gesture.end(pointer()), false, 'Returning a drag to its origin does not make it a click.');
gesture.start(pointer());
gesture.start(pointer({ pointerId: 2 }));
assert.equal(gesture.end(pointer({ pointerId: 2 })), false);
assert.equal(gesture.end(pointer()), false, 'A two-finger gesture never selects.');
gesture.start(pointer());
gesture.cancel();
assert.equal(gesture.end(pointer()), false, 'Canceled gestures never select.');

const wheel = (overrides = {}) => ({ deltaX: 2, deltaY: 3, deltaMode: 0, ...overrides });
assert.deepEqual(wheelPixels(wheel(), 800), { x: 2, y: 3 });
assert.deepEqual(wheelPixels(wheel({ deltaMode: 1 }), 800), { x: 32, y: 48 });
assert.deepEqual(wheelPixels(wheel({ deltaMode: 2 }), 800), { x: 1600, y: 2400 });
assert.deepEqual(wheelPixels(wheel({ ctrlKey: true }), 800), { x: 2, y: 30 });
assert.equal(wheelAction(wheel(), 'trackpad'), 'pan');
assert.equal(wheelAction(wheel({ shiftKey: true }), 'trackpad'), 'orbit');
assert.equal(wheelAction(wheel({ ctrlKey: true, shiftKey: true }), 'trackpad'), 'zoom');
assert.equal(wheelAction(wheel(), 'mouse'), 'zoom');
assert.equal(wheelAction(wheel({ shiftKey: true }), 'mouse'), 'pan');
for (const fps of [30, 60, 120]) {
  let remainder = 1;
  for (let i = 0; i < fps / 2; i++) remainder *= 1 - dampingBlend(1 / fps, 0.12);
  assert(Math.abs(remainder - Math.pow(0.88, 30)) < 1e-12, 'Damping settles equally across refresh rates.');
}
console.log('Camera gesture, wheel normalization and elapsed-time damping checks passed.');
