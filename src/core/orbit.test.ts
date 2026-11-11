import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDolly, applyOrbit, dollyFromSpread, orbitFromDrag } from './orbit.ts';
import type { Vec3, VirtualCamera } from './table-frame.ts';

const deg = Math.PI / 180;
const distance = (c: VirtualCamera) =>
  Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
const polar = (c: VirtualCamera) => Math.acos((c.position[1] - c.target[1]) / distance(c));
const camera: VirtualCamera = { position: [0, 50, 100], target: [10, 0, 0], up: [0, 1, 0], fovDegrees: 45 };

test('half a metre of hand travel is a half turn', () => {
  assert.ok(Math.abs(Math.abs(orbitFromDrag(0.5, 0, 1).dAzimuth) - Math.PI) < 1e-12);
  assert.ok(Math.abs(Math.abs(orbitFromDrag(0, 0.5, 1).dPolar) - Math.PI) < 1e-12);
  assert.equal(orbitFromDrag(0.5, 0, 1).dPolar, 0);
  assert.ok(Math.abs(orbitFromDrag(0.25, 0, 2).dAzimuth - orbitFromDrag(0.5, 0, 1).dAzimuth) < 1e-12);
});

test('applyOrbit keeps the distance and the target', () => {
  const next = applyOrbit(camera, 1.2, 0.3);
  assert.ok(Math.abs(distance(next) - distance(camera)) < 1e-9);
  assert.deepEqual(next.target, camera.target);
  assert.notDeepEqual(next.position, camera.position);
});

test('applyOrbit turns about the up axis by dAzimuth', () => {
  const start: VirtualCamera = { ...camera, position: [10, 0, 100], target: [10, 0, 0] };
  const p = applyOrbit(start, Math.PI / 2, 0).position;
  assert.ok(Math.abs(p[0] - 110) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9, String(p));
});

test('the polar angle stays within 5 and 175 degrees', () => {
  assert.ok(Math.abs(polar(applyOrbit(camera, 0, -10)) - 5 * deg) < 1e-9);
  assert.ok(Math.abs(polar(applyOrbit(camera, 0, 10)) - 175 * deg) < 1e-9);
});

test('applyDolly moves along the view line; factor 2 doubles the distance', () => {
  const next = applyDolly(camera, 2, 0.5, 1e4);
  assert.ok(Math.abs(distance(next) - 2 * distance(camera)) < 1e-9);
  const dir = (c: VirtualCamera): Vec3 => {
    const d = distance(c);
    return [(c.position[0] - c.target[0]) / d, (c.position[1] - c.target[1]) / d, (c.position[2] - c.target[2]) / d];
  };
  dir(next).forEach((v, i) => assert.ok(Math.abs(v - dir(camera)[i]) < 1e-12));
});

test('applyDolly clamps the distance', () => {
  assert.ok(Math.abs(distance(applyDolly(camera, 1e-9, 0.5, 1e4)) - 0.5) < 1e-9);
  assert.ok(Math.abs(distance(applyDolly(camera, 1e9, 0.5, 1e4)) - 1e4) < 1e-6);
});

test('hands apart zooms in', () => {
  assert.equal(dollyFromSpread(0.2, 0.4), 0.5);
  assert.equal(dollyFromSpread(0.4, 0.2), 2);
});
