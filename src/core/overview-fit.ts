// Fits the galaxy's opening view to the room. The copied code frames the galaxy for a 1600 × 1000 desktop stage, and
// the table frame maps that framing onto a fixed width, so a project's galaxy came out the same size wherever its bodies
// actually sat: off centre, and under the chat window. This sizes and moves the model's anchor, once per project, so the
// bodies seen from the seat fill the free box between the windows. Orbit and dolly then work from the fitted anchor.
import { rotate, tablePose } from './table-frame.ts';
import type { TableAnchor, Vec3, VirtualCamera } from './table-frame.ts';

/** A box of directions from the eye, in degrees: yaw to the right of straight ahead (-Z), pitch above it. */
export interface ViewBox {
  yaw: [number, number];
  pitch: [number, number];
}

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * The directions of room points from the eye. Both angles are measured against the view axis (atan2 over the depth),
 * as a headset's projection is, so a point far to the side is not under-reported vertically.
 */
export function viewBoxOf(points: readonly Vec3[], eye: Vec3): ViewBox {
  const box: ViewBox = { yaw: [Infinity, -Infinity], pitch: [Infinity, -Infinity] };
  for (const p of points) {
    const depth = eye[2] - p[2];
    const yaw = Math.atan2(p[0] - eye[0], depth) * DEG;
    const pitch = Math.atan2(p[1] - eye[1], depth) * DEG;
    if (yaw < box.yaw[0]) box.yaw[0] = yaw;
    if (yaw > box.yaw[1]) box.yaw[1] = yaw;
    if (pitch < box.pitch[0]) box.pitch[0] = pitch;
    if (pitch > box.pitch[1]) box.pitch[1] = pitch;
  }
  return box;
}

const inside = (box: ViewBox, target: ViewBox) =>
  box.yaw[0] >= target.yaw[0] && box.yaw[1] <= target.yaw[1] && box.pitch[0] >= target.pitch[0] && box.pitch[1] <= target.pitch[1];

export interface OverviewFit {
  /** The anchor's width, which sets the model's scale. */
  width: number;
  /** The anchor's position: where the camera's target sits in the room. */
  position: Vec3;
  /** Where the points land, seen from the eye. */
  box: ViewBox;
}

/**
 * The anchor width and position that put the model-space `points`, seen from `eye` through the home `camera`, as large
 * as they can be inside `target` and centred in it. The model's orientation is unchanged; it only grows or shrinks
 * about its anchor and moves sideways and up or down. `maxGrow` caps how far a small project is enlarged.
 */
export function fitOverview(
  points: readonly Vec3[],
  camera: VirtualCamera,
  anchor: TableAnchor,
  eye: Vec3,
  target: ViewBox,
  { maxGrow = 2, minGrow = 0.05 }: { maxGrow?: number; minGrow?: number } = {},
): OverviewFit {
  if (!points.length) return { width: anchor.width, position: [...anchor.position], box: viewBoxOf([], eye) };
  // Each point's offset from the anchor at the given width: room = anchor + grow · offset.
  const pose = tablePose(camera, anchor);
  const offsets = points.map(p =>
    rotate(pose.orientation, [p[0] - camera.target[0], p[1] - camera.target[1], p[2] - camera.target[2]]).map(
      v => v * pose.scale,
    ) as Vec3,
  );
  const room: Vec3[] = points.map(() => [0, 0, 0]);
  const centreYaw = (target.yaw[0] + target.yaw[1]) / 2,
    centrePitch = (target.pitch[0] + target.pitch[1]) / 2;

  /** The points at `grow`, moved so that their box is centred in the target. */
  const place = (grow: number) => {
    const at: Vec3 = [...anchor.position];
    let box = viewBoxOf([], eye);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < offsets.length; i++)
        for (let c = 0; c < 3; c++) room[i][c] = at[c] + grow * offsets[i][c];
      box = viewBoxOf(room, eye);
      // Move by the angle the box is off centre, at the anchor's depth.
      const depth = Math.max(0.1, eye[2] - at[2]);
      const yaw = (box.yaw[0] + box.yaw[1]) / 2,
        pitch = (box.pitch[0] + box.pitch[1]) / 2;
      at[0] += depth * (Math.tan(centreYaw * RAD) - Math.tan(yaw * RAD));
      at[1] += depth * (Math.tan(centrePitch * RAD) - Math.tan(pitch * RAD));
    }
    return { at, box };
  };

  let low = minGrow,
    high = maxGrow;
  let best = place(low);
  const top = place(high);
  if (inside(top.box, target)) best = top;
  else
    for (let step = 0; step < 30; step++) {
      const mid = (low + high) / 2;
      const placed = place(mid);
      if (inside(placed.box, target)) {
        low = mid;
        best = placed;
      } else high = mid;
    }
  const grow = best === top ? high : low;
  return { width: anchor.width * grow, position: best.at, box: best.box };
}

/**
 * The share of points nearest their centre (in the galaxy's plane, x and z). The opening view is fitted to this core so
 * that the bright middle of the galaxy fills the view; the outlying bodies spill past its edges.
 */
export function coreOf(points: readonly Vec3[], share: number): Vec3[] {
  if (!points.length) return [];
  let cx = 0,
    cz = 0;
  for (const p of points) {
    cx += p[0];
    cz += p[2];
  }
  cx /= points.length;
  cz /= points.length;
  const keep = Math.max(1, Math.ceil(points.length * Math.min(1, Math.max(0, share))));
  return points
    .map(p => ({ p, d: Math.hypot(p[0] - cx, p[2] - cz) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, keep)
    .map(e => e.p);
}
