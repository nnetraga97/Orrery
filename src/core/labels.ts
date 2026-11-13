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
  /** A multiple of the usual height (default 1): a larger label is drawn larger and keeps others further away. */
  scale?: number;
}
export interface LabelLimits {
  max: number;
  coneDegrees: number;
  minSeparationDegrees: number;
  angularHeightDegrees: number;
}
export interface ChosenLabel {
  index: number;
  /** World height in metres (the candidate's scale included). */
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

/** A label's world height in metres at a distance from the head. */
export const labelHeight = (distance: number, limits: LabelLimits, scale = 1) =>
  2 * distance * Math.tan((limits.angularHeightDegrees * RAD) / 2) * scale;
/** The cosine of the least angle between two labels: the usual separation, widened by the larger label's scale. */
const separationOf = (a: LabelCandidate, b: LabelCandidate, limits: LabelLimits, usual: number) => {
  const scale = Math.max(a.scale ?? 1, b.scale ?? 1);
  return scale === 1 ? usual : Math.cos(limits.minSeparationDegrees * scale * RAD);
};

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
      if (chosen.some(s => cosine(candidates[s.index].direction, c.direction) > separationOf(candidates[s.index], c, limits, separation))) continue;
    }
    if (c.group) groups.set(c.group, (groups.get(c.group) ?? 0) + 1);
    chosen.push({ index: i, height: 2 * c.distance * tanHalf * (c.scale ?? 1) });
  }
  return chosen;
}

/** Reused arrays for chooseLabelsInto. */
export interface LabelWork {
  order: number[];
  /** The chosen labels; the first `count` (the return value) are this frame's. Entries are reused. */
  chosen: ChosenLabel[];
  groups: Map<string, number>;
}
export const createLabelWork = (): LabelWork => ({ order: [], chosen: [], groups: new Map() });

let sorting: readonly LabelCandidate[] = [];
const byFixedThenPriority = (a: number, b: number) =>
  Number(sorting[a].avoidOverlap) - Number(sorting[b].avoidOverlap) || sorting[b].priority - sorting[a].priority || a - b;

/** chooseLabels over the first `count` candidates, writing into `work` (no allocation once warm). Returns how many. */
export function chooseLabelsInto(
  candidates: readonly LabelCandidate[],
  count: number,
  gaze: Vec3,
  limits: LabelLimits,
  work: LabelWork,
): number {
  const order = work.order;
  order.length = count;
  for (let i = 0; i < count; i++) order[i] = i;
  sorting = candidates;
  order.sort(byFixedThenPriority);
  sorting = [];
  const cone = Math.cos(limits.coneDegrees * RAD),
    separation = Math.cos(limits.minSeparationDegrees * RAD),
    tanHalf = Math.tan((limits.angularHeightDegrees * RAD) / 2);
  const chosen = work.chosen,
    groups = work.groups;
  groups.clear();
  let n = 0;
  for (let o = 0; o < count; o++) {
    if (n >= limits.max) break;
    const i = order[o],
      c = candidates[i];
    if (c.avoidOverlap) {
      if (cosine(c.direction, gaze) < cone) continue;
      if (c.group && (groups.get(c.group) ?? 0) >= (c.maxVisible ?? Infinity)) continue;
      let crowded = false;
      for (let s = 0; s < n && !crowded; s++) {
        const other = candidates[chosen[s].index];
        crowded = cosine(other.direction, c.direction) > separationOf(other, c, limits, separation);
      }
      if (crowded) continue;
    }
    if (c.group) groups.set(c.group, (groups.get(c.group) ?? 0) + 1);
    const slot = (chosen[n] ||= { index: 0, height: 0 });
    slot.index = i;
    slot.height = 2 * c.distance * tanHalf * (c.scale ?? 1);
    n++;
  }
  return n;
}
