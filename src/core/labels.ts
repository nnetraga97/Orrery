// Which scene labels show in the headset, and how big. Desktop labels were HTML placed in screen pixels; in a headset
// a label is chosen by its angle from the gaze and sized to a constant angle, so it reads the same near or far.
import type { Vec3 } from './table-frame.ts';

export interface LabelCandidate {
  /** Unit vector from the head to the label. */
  direction: Vec3;
  /** Metres from the head. */
  distance: number;
  priority: number;
  /** False for fixed labels (controls, method names): they always show and claim their space first. */
  avoidOverlap: boolean;
  group?: string;
  maxVisible?: number;
}
export interface LabelLimits {
  max: number;
  coneDegrees: number;
  minSeparationDegrees: number;
  angularHeightDegrees: number;
}
export interface ChosenLabel {
  index: number;
  /** World height in metres. */
  height: number;
}

export const DEFAULT_LABEL_LIMITS: LabelLimits = {
  max: 24,
  coneDegrees: 35,
  minSeparationDegrees: 4,
  angularHeightDegrees: 1.4,
};

const RAD = Math.PI / 180;
const cosine = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The labels to show, fixed ones first, then by priority (stable), within the limits. */
export function chooseLabels(candidates: readonly LabelCandidate[], gaze: Vec3, limits: LabelLimits): ChosenLabel[] {
  const order = candidates.map((_, i) => i);
  order.sort(
    (a, b) =>
      Number(candidates[a].avoidOverlap) - Number(candidates[b].avoidOverlap) ||
      candidates[b].priority - candidates[a].priority ||
      a - b,
  );
  const cone = Math.cos(limits.coneDegrees * RAD),
    separation = Math.cos(limits.minSeparationDegrees * RAD),
    tanHalf = Math.tan((limits.angularHeightDegrees * RAD) / 2);
  const chosen: ChosenLabel[] = [];
  const groups = new Map<string, number>();
  for (const i of order) {
    if (chosen.length >= limits.max) break;
    const c = candidates[i];
    if (c.avoidOverlap) {
      if (cosine(c.direction, gaze) < cone) continue;
      if (c.group && (groups.get(c.group) ?? 0) >= (c.maxVisible ?? Infinity)) continue;
      if (chosen.some(s => cosine(candidates[s.index].direction, c.direction) > separation)) continue;
    }
    if (c.group) groups.set(c.group, (groups.get(c.group) ?? 0) + 1);
    chosen.push({ index: i, height: 2 * c.distance * tanHalf });
  }
  return chosen;
}
