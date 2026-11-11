import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusedPose, modelToRoom, roomToModel, tablePose } from './table-frame.ts';
import type { Quat, TableAnchor, Vec3, VirtualCamera } from './table-frame.ts';

const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  assert.ok(
    a.every((v, i) => Math.abs(v - b[i]) <= eps),
    `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
  );
const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const distance = (a: Vec3, b: Vec3) => length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

// 30 degrees pitched down about +X.
const pitch = (-30 * Math.PI) / 180;
const tilted: Quat = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
const anchor: TableAnchor = { position: [0, 0.85, -0.55], orientation: tilted, width: 0.8, minScale: 0.0005, maxScale: 4 };

const cameras: VirtualCamera[] = [
  { position: [0, 120, 160], target: [0, 0, 0], up: [0, 1, 0], fovDegrees: 45 },
  { position: [10, -5, 3], target: [2, 1, -7], up: [0, 1, 0], fovDegrees: 45 },
  { position: [0, 50, 0.001], target: [0, 0, 0], up: [0, 1, 0], fovDegrees: 60 },
  { position: [-300, 20, 40], target: [12, 8, -3], up: [0.2, 1, 0.1], fovDegrees: 30 },
  { position: [1, 2, 3], target: [1.5, 2.5, 2], up: [0, 0, 1], fovDegrees: 45 },
];

test('the camera target lands on the anchor', () => {
  for (const camera of cameras) near(modelToRoom(camera.target, tablePose(camera, anchor)), anchor.position);
});

test("the camera's own position maps scale · d along the anchor's +Z", () => {
  for (const camera of cameras) {
    const pose = tablePose(camera, anchor);
    const d = distance(camera.position, camera.target);
    const z = 2 * Math.sin(pitch / 2) * Math.cos(pitch / 2);
    const anchorZ: Vec3 = [0, -z, Math.cos(pitch)];
    const expected: Vec3 = [
      anchor.position[0] + anchorZ[0] * pose.scale * d,
      anchor.position[1] + anchorZ[1] * pose.scale * d,
      anchor.position[2] + anchorZ[2] * pose.scale * d,
    ];
    near(modelToRoom(camera.position, pose), expected, 1e-9);
  }
});

test('halving the distance doubles the scale', () => {
  const far: VirtualCamera = { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0], fovDegrees: 45 };
  const close: VirtualCamera = { ...far, position: [0, 0, 50] };
  const a = tablePose(far, anchor).scale,
    b = tablePose(close, anchor).scale;
  assert.ok(Math.abs(b - 2 * a) < 1e-12);
  assert.ok(Math.abs(a - 0.8 / (2 * 100 * Math.tan((45 * Math.PI) / 360))) < 1e-12);
});

test('scale is clamped at both limits', () => {
  const huge: VirtualCamera = { position: [0, 0, 1e7], target: [0, 0, 0], up: [0, 1, 0], fovDegrees: 45 };
  const tiny: VirtualCamera = { ...huge, position: [0, 0, 1e-3] };
  const same: VirtualCamera = { ...huge, position: [0, 0, 0] };
  assert.equal(tablePose(huge, anchor).scale, anchor.minScale);
  assert.equal(tablePose(tiny, anchor).scale, anchor.maxScale);
  assert.equal(tablePose(same, anchor).scale, anchor.maxScale);
  assert.ok(tablePose(same, anchor).orientation.every(Number.isFinite));
});

test('roomToModel undoes modelToRoom', () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [1, 2, 3],
    [-40, 7.5, 200],
    [1e-3, -1e-3, 5],
  ];
  for (const camera of cameras) {
    const pose = tablePose(camera, anchor);
    for (const p of points) near(roomToModel(modelToRoom(p, pose), pose), p, 1e-9);
  }
});

test('a camera looking down -Z with +Y up and an identity anchor gives identity orientation', () => {
  const camera: VirtualCamera = { position: [3, 4, 10], target: [3, 4, 0], up: [0, 1, 0], fovDegrees: 45 };
  const identity: TableAnchor = { position: [0, 0, 0], orientation: [0, 0, 0, 1], width: 1, minScale: 0, maxScale: 100 };
  const q = tablePose(camera, identity).orientation;
  const sign = q[3] < 0 ? -1 : 1;
  near(
    q.map(v => v * sign),
    [0, 0, 0, 1],
    1e-12,
  );
});

test('focusedPose matches tablePose while the scale is under the cap', () => {
  const camera = cameras[0];
  const free = tablePose(camera, anchor);
  const capped = focusedPose(camera, anchor, [5, 5, 5], free.scale * 2);
  near(capped.position, free.position);
  near(capped.orientation, free.orientation);
  assert.equal(capped.scale, free.scale);
});

test('focusedPose caps the scale and puts the focus point on the anchor', () => {
  const camera: VirtualCamera = { position: [0, 2, 3], target: [0, 1, 0], up: [0, 1, 0], fovDegrees: 45 };
  const focus: Vec3 = [0, -9, 0];
  const free = tablePose(camera, anchor);
  const capped = focusedPose(camera, anchor, focus, free.scale / 10);
  assert.equal(capped.scale, free.scale / 10);
  near(capped.orientation, free.orientation);
  near(modelToRoom(focus, capped), anchor.position, 1e-9);
});

// ---- the allocation-free variants used every frame ----
import { emptyPose, focusedPoseInto, tablePoseInto } from './table-frame.ts';

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const close = (a: number[], b: number[], what: string) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${what}[${i}]: ${v} vs ${b[i]}`));

test('tablePoseInto and focusedPoseInto give the same poses as tablePose and focusedPose, reusing one pose', () => {
  const r = seeded(7),
    out = emptyPose();
  const v = (s = 10): [number, number, number] => [(r() - 0.5) * s, (r() - 0.5) * s, (r() - 0.5) * s];
  for (let k = 0; k < 500; k++) {
    const camera = { position: v(), target: v(), up: k % 7 ? v(2) : ([0, 1, 0] as [number, number, number]), fovDegrees: 30 + r() * 60 };
    if (k % 11 === 0) camera.target = [...camera.position];
    const h = r() * Math.PI,
      anchor = {
        position: v(2),
        orientation: [Math.sin(h / 2) * 0.6, Math.sin(h / 2) * 0.8, 0, Math.cos(h / 2)] as [number, number, number, number],
        width: 0.2 + r(),
        minScale: 0.0005,
        maxScale: 5,
      };
    const a = tablePose(camera, anchor),
      b = tablePoseInto(camera, anchor, out);
    assert.equal(b, out);
    close(b.position, a.position, 'position');
    close(b.orientation, a.orientation, 'orientation');
    close([b.scale], [a.scale], 'scale');
    const focus = v(),
      cap = r() * 0.01;
    const c = focusedPose(camera, anchor, focus, cap),
      d = focusedPoseInto(camera, anchor, focus, cap, out);
    close(d.position, c.position, 'focused position');
    close(d.orientation, c.orientation, 'focused orientation');
    close([d.scale], [c.scale], 'focused scale');
  }
});
