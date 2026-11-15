// Aim assist for a hand ray on the galaxy. A file's body is a few millimetres across from the seat, under half a
// degree at arm's length and more, and a tracked hand's ray wanders by about as much. When a ray touches nothing, the
// body nearest the ray within a small angle is taken as what the hand means, so pointing near a planet is enough.

/** How far off the ray a body's centre may be and still be taken, in degrees at the ray's origin. */
export const AIM_ASSIST_DEGREES = 1.5;
/** The body already picked keeps the pick out to this many times the angle, so a hover between two bodies does not
 * flicker. */
export const AIM_STICKINESS = 1.4;

/** The squared tangent of an angle in degrees: the form `offRay` answers in, for comparing without a square root. */
export function tan2(degrees: number): number {
  const t = Math.tan((degrees * Math.PI) / 180);
  return t * t;
}

/**
 * How far a point is off a ray, as the squared tangent of the angle between them at the ray's origin. Infinity when
 * the point is behind the origin or on it. The direction need not be a unit vector. Numbers only: nothing allocated.
 */
export function offRay(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  px: number,
  py: number,
  pz: number,
): number {
  const vx = px - ox,
    vy = py - oy,
    vz = pz - oz;
  const along = vx * dx + vy * dy + vz * dz;
  if (!(along > 0)) return Infinity;
  // |v x d|² / (v · d)²; the direction's length cancels.
  const cx = vy * dz - vz * dy,
    cy = vz * dx - vx * dz,
    cz = vx * dy - vy * dx;
  return (cx * cx + cy * cy + cz * cz) / (along * along);
}

/**
 * The body nearest a ray among `count` bodies, or -1 when none is within `degrees`. `at(i)` gives body i's centre in
 * the ray's own space, or null for a body that cannot be picked. The body `held` (the current pick, or -1) is kept out
 * to AIM_STICKINESS times the angle.
 */
export function nearestToRay(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  count: number,
  at: (i: number) => { x: number; y: number; z: number } | null | undefined,
  held = -1,
  degrees = AIM_ASSIST_DEGREES,
): number {
  const limit = tan2(degrees),
    heldLimit = tan2(degrees * AIM_STICKINESS);
  let best = -1,
    bestOff = Infinity;
  for (let i = 0; i < count; i++) {
    const p = at(i);
    if (!p) continue;
    let off = offRay(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, p.x, p.y, p.z);
    if (i === held) {
      if (off > heldLimit) continue;
      // Compared as if it were that much nearer.
      off /= AIM_STICKINESS * AIM_STICKINESS;
    } else if (off > limit) continue;
    if (off < bestOff) {
      bestOff = off;
      best = i;
    }
  }
  return best;
}

/**
 * Whether a ray passes within `radius` of a point in front of its origin (all in one space; the direction need not
 * be a unit vector). The tutorial's ringed planet is picked this way: a pinch anywhere inside the ring is a pinch on it.
 */
export function rayPassesWithin(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  point: { x: number; y: number; z: number },
  radius: number,
): boolean {
  const vx = point.x - origin.x,
    vy = point.y - origin.y,
    vz = point.z - origin.z;
  const off = offRay(origin.x, origin.y, origin.z, direction.x, direction.y, direction.z, point.x, point.y, point.z);
  if (off === Infinity) return false;
  // sin² = tan² / (1 + tan²); the distance from the ray is |v| sin.
  return ((vx * vx + vy * vy + vz * vz) * off) / (1 + off) <= radius * radius;
}
