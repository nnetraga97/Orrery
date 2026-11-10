import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angularBox, panelPlacements } from './layout.ts';
import type { Seat } from './layout.ts';

const seats: Seat[] = [{ eye: [0, 1.2, 0] }, { eye: [0, 1.25, 0.05] }];

test('the four panels are placed', () => {
  assert.deepEqual(Object.keys(panelPlacements(seats[0])).sort(), ['agentPanel', 'codePage', 'dock', 'tutorial']);
});

test('every panel centre is 0.9 to 1.2 m from the head', () => {
  for (const seat of seats)
    for (const [name, p] of Object.entries(panelPlacements(seat))) {
      const d = Math.hypot(p.position[0] - seat.eye[0], p.position[1] - seat.eye[1], p.position[2] - seat.eye[2]);
      assert.ok(d >= 0.9 - 1e-9 && d <= 1.2 + 1e-9, `${name} at ${d.toFixed(3)} m`);
    }
});

test('every panel centre is within ±32° horizontally and between 20° below and 12° above eye level', () => {
  for (const seat of seats)
    for (const [name, p] of Object.entries(panelPlacements(seat))) {
      const box = angularBox(seat, p);
      assert.ok(Math.abs(box.yaw) <= 32 + 1e-9, `${name} yaw ${box.yaw}`);
      assert.ok(box.pitch >= -20 - 1e-9 && box.pitch <= 12 + 1e-9, `${name} pitch ${box.pitch}`);
    }
});

test('no two panels overlap as seen from the head', () => {
  for (const seat of seats) {
    const boxes = Object.entries(panelPlacements(seat)).map(([name, p]) => ({ name, ...angularBox(seat, p) }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        const apart =
          a.yaw + a.halfWidth <= b.yaw - b.halfWidth ||
          b.yaw + b.halfWidth <= a.yaw - a.halfWidth ||
          a.pitch + a.halfHeight <= b.pitch - b.halfHeight ||
          b.pitch + b.halfHeight <= a.pitch - a.halfHeight;
        assert.ok(apart, `${a.name} overlaps ${b.name}`);
      }
  }
});

test('each panel faces the head', () => {
  const seat = seats[0];
  for (const p of Object.values(panelPlacements(seat))) {
    const toEye = [seat.eye[0] - p.position[0], seat.eye[1] - p.position[1], seat.eye[2] - p.position[2]];
    const l = Math.hypot(...toEye);
    toEye.forEach((v, i) => assert.ok(Math.abs(v / l - p.facing[i]) < 1e-9));
  }
});

test('the code page keeps the size the plan gives it', () => {
  const page = panelPlacements(seats[0]).codePage;
  assert.deepEqual([page.width, page.height], [0.86, 0.77]);
});
