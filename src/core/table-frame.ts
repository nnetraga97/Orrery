// The virtual camera -> model pose on the table. The copied galaxy code navigates by moving a camera that is never
// rendered from; this turns "where that camera looks" into "where the whole model sits on the table":
//   model pose = table anchor ∘ scale(s) ∘ inverse(virtual camera looking at its target)
//   s          = anchor.width / (2 · d · tan(fov / 2)),  d = distance from the camera to its target
// Vectors are [x, y, z]; quaternions are [x, y, z, w].

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface VirtualCamera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fovDegrees: number;
}
export interface TableAnchor {
  position: Vec3;
  orientation: Quat;
  width: number;
  minScale: number;
  maxScale: number;
}
export interface Pose {
  position: Vec3;
  orientation: Quat;
  scale: number;
}

const MIN_DISTANCE = 1e-6;

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale3(a, 1 / l) : [0, 0, 0];
};

export const quatMultiply = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const conjugate = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** Rotates v by the unit quaternion q. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale3(cross(u, v), 2);
  return add(add(v, scale3(t, q[3])), cross(u, t));
}

/** The unit quaternion of the rotation whose matrix has columns x, y, z (an orthonormal right-handed basis). */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x[0],
    m10 = x[1],
    m20 = x[2],
    m01 = y[0],
    m11 = y[1],
    m21 = y[2],
    m02 = z[0],
    m12 = z[1],
    m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/**
 * The orientation of a camera frame whose -Z points along `forward` and whose +Y lies along `up` made
 * perpendicular to it. Falls back to another up vector when `up` is parallel to `forward`.
 */
export function lookRotation(forward: Vec3, up: Vec3): Quat {
  const z = scale3(normalize(forward), -1);
  let y = sub(up, scale3(z, dot(up, z)));
  if (length(y) < 1e-9) {
    const other: Vec3 = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    y = sub(other, scale3(z, dot(other, z)));
  }
  y = normalize(y);
  const x = cross(y, z);
  return quatFromBasis(x, y, z);
}

/** The pose of the model root so that the camera's target sits on the anchor, sized to the table. */
export function tablePose(camera: VirtualCamera, anchor: TableAnchor): Pose {
  const offset = sub(camera.target, camera.position);
  const d = Math.max(MIN_DISTANCE, length(offset));
  const forward: Vec3 = length(offset) < MIN_DISTANCE ? [0, 0, -1] : offset;
  const halfFov = (camera.fovDegrees * Math.PI) / 360;
  const raw = anchor.width / (2 * d * Math.tan(halfFov));
  const scale = Math.min(anchor.maxScale, Math.max(anchor.minScale, raw));
  const orientation = quatMultiply(anchor.orientation, conjugate(lookRotation(forward, camera.up)));
  const position = sub(anchor.position, scale3(rotate(orientation, camera.target), scale));
  return { position, orientation, scale };
}

/** Maps a point in model space to room space under a pose. */
export function modelToRoom(point: Vec3, pose: Pose): Vec3 {
  return add(pose.position, scale3(rotate(pose.orientation, point), pose.scale));
}

/** Maps a point in room space back to model space. */
export function roomToModel(point: Vec3, pose: Pose): Vec3 {
  return scale3(rotate(conjugate(pose.orientation), sub(point, pose.position)), 1 / pose.scale);
}

/**
 * tablePose with the scale capped at `maxScale`. While capped, `focus` (a model-space point, such as a landed planet's
 * centre) sits on the anchor instead of the camera's target, so a close-up keeps the whole body on the table.
 */
export function focusedPose(camera: VirtualCamera, anchor: TableAnchor, focus: Vec3, maxScale: number): Pose {
  const pose = tablePose(camera, anchor);
  if (pose.scale <= maxScale) return pose;
  const scale = maxScale;
  const position = sub(anchor.position, scale3(rotate(pose.orientation, focus), scale));
  return { position, orientation: pose.orientation, scale };
}

// ---- allocation-free variants, for every frame ----

/** A pose to write into with tablePoseInto / focusedPoseInto. */
export const emptyPose = (): Pose => ({ position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1 });

// Scratch, reused by the variants below (core is single-threaded).
const sx: Vec3 = [0, 0, 0],
  sy: Vec3 = [0, 0, 0],
  sz: Vec3 = [0, 0, 0],
  sq: Quat = [0, 0, 0, 1];

/** quatFromBasis writing into `out`. */
function quatFromBasisInto(x: Vec3, y: Vec3, z: Vec3, out: Quat): Quat {
  const m00 = x[0],
    m10 = x[1],
    m20 = x[2],
    m01 = y[0],
    m11 = y[1],
    m21 = y[2],
    m02 = z[0],
    m12 = z[1],
    m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[0] = (m21 - m12) * s;
    out[1] = (m02 - m20) * s;
    out[2] = (m10 - m01) * s;
    out[3] = 0.25 / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out[0] = 0.25 * s;
    out[1] = (m01 + m10) / s;
    out[2] = (m02 + m20) / s;
    out[3] = (m21 - m12) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out[0] = (m01 + m10) / s;
    out[1] = 0.25 * s;
    out[2] = (m12 + m21) / s;
    out[3] = (m02 - m20) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out[0] = (m02 + m20) / s;
    out[1] = (m12 + m21) / s;
    out[2] = 0.25 * s;
    out[3] = (m10 - m01) / s;
  }
  const l = Math.hypot(out[0], out[1], out[2], out[3]);
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  out[3] /= l;
  return out;
}

/** lookRotation writing into `out`. */
function lookRotationInto(fx: number, fy: number, fz: number, up: Vec3, out: Quat): Quat {
  const fl = Math.hypot(fx, fy, fz) || 1;
  sz[0] = -fx / fl;
  sz[1] = -fy / fl;
  sz[2] = -fz / fl;
  let d = up[0] * sz[0] + up[1] * sz[1] + up[2] * sz[2];
  sy[0] = up[0] - sz[0] * d;
  sy[1] = up[1] - sz[1] * d;
  sy[2] = up[2] - sz[2] * d;
  if (Math.hypot(sy[0], sy[1], sy[2]) < 1e-9) {
    const ox = Math.abs(sz[1]) < 0.9 ? 0 : 1,
      oy = Math.abs(sz[1]) < 0.9 ? 1 : 0;
    d = ox * sz[0] + oy * sz[1];
    sy[0] = ox - sz[0] * d;
    sy[1] = oy - sz[1] * d;
    sy[2] = -sz[2] * d;
  }
  const yl = Math.hypot(sy[0], sy[1], sy[2]);
  sy[0] /= yl;
  sy[1] /= yl;
  sy[2] /= yl;
  sx[0] = sy[1] * sz[2] - sy[2] * sz[1];
  sx[1] = sy[2] * sz[0] - sy[0] * sz[2];
  sx[2] = sy[0] * sz[1] - sy[1] * sz[0];
  return quatFromBasisInto(sx, sy, sz, out);
}

/** out = anchor - rotate(q, p) * s. */
function placeInto(anchor: Vec3, q: Quat, p: Vec3, s: number, out: Vec3) {
  const ux = q[0],
    uy = q[1],
    uz = q[2],
    w = q[3];
  const tx = 2 * (uy * p[2] - uz * p[1]),
    ty = 2 * (uz * p[0] - ux * p[2]),
    tz = 2 * (ux * p[1] - uy * p[0]);
  const rx = p[0] + w * tx + (uy * tz - uz * ty),
    ry = p[1] + w * ty + (uz * tx - ux * tz),
    rz = p[2] + w * tz + (ux * ty - uy * tx);
  out[0] = anchor[0] - rx * s;
  out[1] = anchor[1] - ry * s;
  out[2] = anchor[2] - rz * s;
}

/** tablePose writing into `out` (no allocation). Returns `out`. */
export function tablePoseInto(camera: VirtualCamera, anchor: TableAnchor, out: Pose): Pose {
  let fx = camera.target[0] - camera.position[0],
    fy = camera.target[1] - camera.position[1],
    fz = camera.target[2] - camera.position[2];
  const len = Math.hypot(fx, fy, fz);
  const d = Math.max(MIN_DISTANCE, len);
  if (len < MIN_DISTANCE) {
    fx = 0;
    fy = 0;
    fz = -1;
  }
  const halfFov = (camera.fovDegrees * Math.PI) / 360;
  const raw = anchor.width / (2 * d * Math.tan(halfFov));
  out.scale = Math.min(anchor.maxScale, Math.max(anchor.minScale, raw));
  lookRotationInto(fx, fy, fz, camera.up, sq);
  // orientation = anchor.orientation * conjugate(look)
  const a = anchor.orientation,
    bx = -sq[0],
    by = -sq[1],
    bz = -sq[2],
    bw = sq[3];
  const o = out.orientation;
  o[0] = a[3] * bx + a[0] * bw + a[1] * bz - a[2] * by;
  o[1] = a[3] * by - a[0] * bz + a[1] * bw + a[2] * bx;
  o[2] = a[3] * bz + a[0] * by - a[1] * bx + a[2] * bw;
  o[3] = a[3] * bw - a[0] * bx - a[1] * by - a[2] * bz;
  placeInto(anchor.position, o, camera.target, out.scale, out.position);
  return out;
}

/** focusedPose writing into `out` (no allocation). Returns `out`. */
export function focusedPoseInto(camera: VirtualCamera, anchor: TableAnchor, focus: Vec3, maxScale: number, out: Pose): Pose {
  tablePoseInto(camera, anchor, out);
  if (out.scale <= maxScale) return out;
  out.scale = maxScale;
  placeInto(anchor.position, out.orientation, focus, maxScale, out.position);
  return out;
}
