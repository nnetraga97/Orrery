import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coreOf, fitOverview, viewBoxOf } from './overview-fit.ts';
import type { ViewBox } from './overview-fit.ts';
import type { TableAnchor, Vec3, VirtualCamera } from './table-frame.ts';

const PITCH = (-20 * Math.PI) / 180;
const anchor: TableAnchor = {
  position: [0, 1.05, -0.95],
  orientation: [Math.sin(PITCH / 2), 0, 0, Math.cos(PITCH / 2)],
  width: 1,
  minScale: 0.0005,
  maxScale: 5,
};
// A desktop home view: looking down at the galaxy plane from 46° above it.
const camera: VirtualCamera = { position: [0, 300, 290], target: [0, 0, 0], up: [0, 1, 0], fovDegrees: 45 };
const eye: Vec3 = [0, 1.2, 0];
const target: ViewBox = { yaw: [-17, 14], pitch: [-30, 6] };

// A lopsided galaxy on its plane: most of it to the right of the camera's target.
const galaxy: Vec3[] = [];
for (let i = 0; i < 60; i++) {
  const a = (i / 60) * Math.PI * 2;
  galaxy.push([60 + Math.cos(a) * 140, 0, Math.sin(a) * 100]);
}

const within = (box: ViewBox, t: ViewBox, slack = 1e-6) =>
  box.yaw[0] >= t.yaw[0] - slack && box.yaw[1] <= t.yaw[1] + slack && box.pitch[0] >= t.pitch[0] - slack && box.pitch[1] <= t.pitch[1] + slack;

test('viewBoxOf measures yaw and pitch against the view axis', () => {
  const box = viewBoxOf([[1, 1.2, -1], [0, 0.2, -1]], eye);
  assert.ok(Math.abs(box.yaw[1] - 45) < 1e-9);
  assert.ok(Math.abs(box.yaw[0]) < 1e-9);
  assert.ok(Math.abs(box.pitch[0] + 45) < 1e-9);
  assert.ok(Math.abs(box.pitch[1]) < 1e-9);
});

test('the fitted galaxy lies inside the free box and is centred in it', () => {
  const fit = fitOverview(galaxy, camera, anchor, eye, target);
  assert.ok(within(fit.box, target), JSON.stringify(fit.box));
  const yawGap = fit.box.yaw[0] - target.yaw[0] - (target.yaw[1] - fit.box.yaw[1]);
  const pitchGap = fit.box.pitch[0] - target.pitch[0] - (target.pitch[1] - fit.box.pitch[1]);
  assert.ok(Math.abs(yawGap) < 0.5, `yaw off centre by ${yawGap}`);
  assert.ok(Math.abs(pitchGap) < 0.5, `pitch off centre by ${pitchGap}`);
  // It fills the box in at least one direction: as large as fits.
  const fillsYaw = fit.box.yaw[1] - fit.box.yaw[0] > target.yaw[1] - target.yaw[0] - 1;
  const fillsPitch = fit.box.pitch[1] - fit.box.pitch[0] > target.pitch[1] - target.pitch[0] - 1;
  assert.ok(fillsYaw || fillsPitch, JSON.stringify(fit.box));
});

test('a lopsided galaxy is moved, not only scaled: its anchor shifts away from the heavy side', () => {
  const fit = fitOverview(galaxy, camera, anchor, eye, target);
  assert.ok(fit.position[0] < anchor.position[0]);
});

test('a bigger galaxy gets a smaller width; a tiny one is capped by maxGrow', () => {
  const big = galaxy.map(p => [p[0] * 3, p[1], p[2] * 3] as Vec3);
  assert.ok(fitOverview(big, camera, anchor, eye, target).width < fitOverview(galaxy, camera, anchor, eye, target).width);
  const tiny = galaxy.map(p => [p[0] * 0.001, p[1], p[2] * 0.001] as Vec3);
  assert.equal(fitOverview(tiny, camera, anchor, eye, target, { maxGrow: 2 }).width, 2);
});

test('no points: the anchor is kept', () => {
  const fit = fitOverview([], camera, anchor, eye, target);
  assert.equal(fit.width, anchor.width);
  assert.deepEqual(fit.position, anchor.position);
});

test('coreOf keeps the share of points nearest the centre in the galaxy plane', () => {
  const pts: Vec3[] = [[0, 0, 0], [1, 5, 0], [0, 0, 2], [10, 0, 0], [-1, 0, -1]];
  const core = coreOf(pts, 0.6);
  assert.equal(core.length, 3);
  assert.ok(!core.some(p => p[0] === 10));
  assert.deepEqual(coreOf([], 0.5), []);
  assert.equal(coreOf(pts, 0).length, 1);
});
