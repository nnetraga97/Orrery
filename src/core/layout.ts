// Where the panels sit around a seated user, who faces -Z. Each panel is placed by its angle from the eye and its
// distance, and turned to face the eye. Limits: every centre 0.9-1.2 m from the head, within ±32° to either side and
// between 20° below and 12° above eye level, and no two panels overlapping as seen from the head. The narrower glasses
// view (37° either side, 25° up, 43° down) contains these.
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
export type PanelName = 'codePage' | 'agentPanel' | 'dock' | 'tutorial';

const RAD = Math.PI / 180;
// yaw: degrees to the right; pitch: degrees above eye level; distance in metres; size in metres.
const SPEC: Record<PanelName, { yaw: number; pitch: number; distance: number; width: number; height: number }> = {
  codePage: { yaw: 32, pitch: -6, distance: 1.2, width: 0.86, height: 0.77 },
  agentPanel: { yaw: -32, pitch: -6, distance: 1.15, width: 0.6, height: 0.7 },
  tutorial: { yaw: 0, pitch: 10, distance: 1.1, width: 0.4, height: 0.12 },
  // Low at the table's far edge: the table's near edge is too close to the head for a panel.
  dock: { yaw: 0, pitch: -19, distance: 0.95, width: 0.4, height: 0.09 },
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
