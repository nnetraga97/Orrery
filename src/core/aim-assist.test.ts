import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIM_ASSIST_DEGREES, AIM_STICKINESS, nearestToRay, offRay, rayPassesWithin, tan2 } from './aim-assist.ts';

const rad = Math.PI / 180;
/** A point `metres` along a ray from the origin that is `degrees` to the right of straight ahead (-Z). */
const at = (degrees: number, metres = 1.4) => ({ x: Math.sin(degrees * rad) * metres, y: 0, z: -Math.cos(degrees * rad) * metres });
const origin = { x: 0, y: 0, z: 0 },
  ahead = { x: 0, y: 0, z: -1 };

test('offRay is the squared tangent of the angle, whatever the direction length', () => {
  const p = at(2);
  assert.ok(Math.abs(offRay(0, 0, 0, 0, 0, -1, p.x, p.y, p.z) - tan2(2)) < 1e-12);
  assert.ok(Math.abs(offRay(0, 0, 0, 0, 0, -7, p.x, p.y, p.z) - tan2(2)) < 1e-12);
  assert.equal(offRay(0, 0, 0, 0, 0, -1, 0, 0, -3), 0);
});

test('a point behind the origin, or on it, is never near', () => {
  assert.equal(offRay(0, 0, 0, 0, 0, -1, 0, 0, 1), Infinity);
  assert.equal(offRay(0, 0, 0, 0, 0, -1, 0, 0, 0), Infinity);
});

test('a body within the angle is taken; one outside is not', () => {
  assert.equal(nearestToRay(origin, ahead, 1, () => at(AIM_ASSIST_DEGREES - 0.1)), 0);
  assert.equal(nearestToRay(origin, ahead, 1, () => at(AIM_ASSIST_DEGREES + 0.1)), -1);
});

test('the nearest by angle wins, not the nearest by distance', () => {
  const bodies = [at(1.2, 0.5), at(0.4, 3), at(-0.9, 1)];
  assert.equal(nearestToRay(origin, ahead, bodies.length, i => bodies[i]), 1);
});

test('bodies that cannot be picked are skipped', () => {
  const bodies = [null, at(1)];
  assert.equal(nearestToRay(origin, ahead, bodies.length, i => bodies[i]), 1);
  assert.equal(nearestToRay(origin, ahead, 1, () => null), -1);
});

test('the held body keeps the pick a little past the angle, and against a slightly nearer neighbour', () => {
  const past = AIM_ASSIST_DEGREES * (AIM_STICKINESS - 0.1);
  assert.equal(nearestToRay(origin, ahead, 1, () => at(past)), -1);
  assert.equal(nearestToRay(origin, ahead, 1, () => at(past), 0), 0);
  const pair = [at(0.6), at(-0.5)];
  assert.equal(nearestToRay(origin, ahead, 2, i => pair[i]), 1);
  assert.equal(nearestToRay(origin, ahead, 2, i => pair[i], 0), 0);
  // A clearly nearer neighbour still takes over.
  const far = [at(1.2), at(-0.2)];
  assert.equal(nearestToRay(origin, ahead, 2, i => far[i], 0), 1);
});

test('a ray passes within a radius of a point in front of it, at any distance', () => {
  const point = { x: 0.03, y: 0, z: -0.5 };
  assert.equal(rayPassesWithin(origin, ahead, point, 0.035), true);
  assert.equal(rayPassesWithin(origin, ahead, point, 0.025), false);
  assert.equal(rayPassesWithin(origin, { x: 0, y: 0, z: -9 }, { x: 0.03, y: 0, z: -2 }, 0.035), true);
  assert.equal(rayPassesWithin(origin, ahead, { x: 0, y: 0, z: 0.5 }, 0.035), false);
});
