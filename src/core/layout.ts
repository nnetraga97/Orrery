// Where the windows first appear around a seated user, who faces -Z, and how far a moved window may go. Each window
// is placed by its angle from the eye and its distance, and turned to face the eye. Limits: every centre 0.9-1.2 m
// from the head, within ±32° to either side and between 20° below and 12° above eye level, and no two windows
// overlapping as seen from the head. The narrower glasses view (37° either side, 25° up, 43° down) contains these
// centres. The model floats in the middle; the chat sits to its left and the code card to its right.
import type { Vec3 } from './table-frame.ts';

export interface Seat {
  /** The eye position in room metres. */
  eye: Vec3;
}
export interface Placement {
  position: Vec3;
  /** Unit vector from the panel toward the eye: the panel's front. */
  facing: Vec3;
  width: number;
  height: number;
}
export type PanelName = 'codeCard' | 'agentPanel' | 'tutorial';

const RAD = Math.PI / 180;
// yaw: degrees to the right; pitch: degrees above eye level; distance in metres; size in metres.
const SPEC: Record<PanelName, { yaw: number; pitch: number; distance: number; width: number; height: number }> = {
  codeCard: { yaw: 30, pitch: -4, distance: 1.0, width: 0.46, height: 0.34 },
  agentPanel: { yaw: -30, pitch: -6, distance: 1.1, width: 0.4, height: 0.72 },
  tutorial: { yaw: 0, pitch: 12, distance: 1.0, width: 0.3, height: 0.1 },
};

export function panelPlacements(seat: Seat): Record<PanelName, Placement> {
  const out = {} as Record<PanelName, Placement>;
  for (const name of Object.keys(SPEC) as PanelName[]) {
    const { yaw, pitch, distance, width, height } = SPEC[name];
    const direction: Vec3 = [
      Math.sin(yaw * RAD) * Math.cos(pitch * RAD),
      Math.sin(pitch * RAD),
      -Math.cos(yaw * RAD) * Math.cos(pitch * RAD),
    ];
    out[name] = {
      position: [
        seat.eye[0] + direction[0] * distance,
        seat.eye[1] + direction[1] * distance,
        seat.eye[2] + direction[2] * distance,
      ],
      facing: [-direction[0], -direction[1], -direction[2]],
      width,
      height,
    };
  }
  return out;
}

/** A placement as seen from the seat: centre angles and half extents, in degrees. */
export function angularBox(seat: Seat, p: Placement) {
  const dx = p.position[0] - seat.eye[0],
    dy = p.position[1] - seat.eye[1],
    dz = p.position[2] - seat.eye[2];
  const d = Math.hypot(dx, dy, dz);
  return {
    yaw: Math.atan2(dx, -dz) / RAD,
    pitch: Math.asin(dy / d) / RAD,
    halfWidth: Math.atan(p.width / 2 / d) / RAD,
    halfHeight: Math.atan(p.height / 2 / d) / RAD,
  };
}

/** A moved window's position, kept between min and max metres from the eye along the same direction. */
export function clampReach(eye: Vec3, position: Vec3, min: number, max: number): Vec3 {
  let dx = position[0] - eye[0],
    dy = position[1] - eye[1],
    dz = position[2] - eye[2];
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) {
    dx = 0;
    dy = 0;
    dz = -1;
    d = 1;
    const k = min / d;
    return [eye[0] + dx * k, eye[1] + dy * k, eye[2] + dz * k];
  }
  if (d >= min && d <= max) return position;
  const k = (d < min ? min : max) / d;
  return [eye[0] + dx * k, eye[1] + dy * k, eye[2] + dz * k];
}

/** The seated eye the windows are laid out for (room metres; the user faces -Z). */
export const DEFAULT_SEAT: Seat = { eye: [0, 1.2, 0] };
