// How large a star may look from the seat. In the overview a star is a few millimetres across. Landed on one of its
// functions, the model is shown at the globe's scale, where that file's own star is metres across a few metres away:
// a bright wall that sits behind, or through, the windows either side of the globe. A star is drawn at full size up
// to SHRINK_FROM degrees of radius as seen from the eye and shrinks smoothly to nothing by SHRINK_TO, so it leaves
// as the landing flight closes in, with no pop, and comes back the same way.

/** A star's radius as seen from the eye, in degrees: full size up to SHRINK_FROM, gone at SHRINK_TO. */
export const SHRINK_FROM = 4;
export const SHRINK_TO = 8;

const RAD = Math.PI / 180;
const FROM = Math.tan(SHRINK_FROM * RAD),
  TO = Math.tan(SHRINK_TO * RAD);

/** The factor to draw a star at (1 to 0), from its radius and its centre's distance from the eye, in the same unit. */
export function starShrink(radius: number, distance: number): number {
  if (!(radius > 0)) return 1;
  // Inside the star, or on it: nothing to draw around the eye.
  if (!(distance > radius)) return 0;
  const size = radius / distance;
  if (size <= FROM) return 1;
  if (size >= TO) return 0;
  const k = (TO - size) / (TO - FROM);
  return k * k * (3 - 2 * k);
}
