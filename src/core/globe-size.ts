// How wide a landed globe is shown. A function's town is laid out to fill the face of its globe (the copied planet code
// packs it at the largest lot size that fits), so a long function gets small lots on a full-size globe. A function of a
// few statements cannot fill that face without absurdly large buildings: its lots stop growing at a cap, and the globe
// is shown smaller instead, so its buildings stay the size of a full globe's largest and little of the sphere is bare.

/** The widest a landed globe is shown, in metres (the owner's choice), and the narrowest. */
export const GLOBE_DIAMETER = 0.64;
export const MIN_GLOBE_DIAMETER = 0.3;
/** A lot's size, as a share of its globe's radius, at which buildings are as large as the room shows them: on a
 * full-size globe that is a lot about 4 cm wide. */
export const FULL_LOT = 0.13;

/** The diameter to show a globe at, from its town's lot size as a share of the globe's radius (null while the town is
 * still being built: a full-size globe). */
export function globeDiameter(lotScale: number | null | undefined): number {
  if (!lotScale || !(lotScale > FULL_LOT)) return GLOBE_DIAMETER;
  return Math.max(MIN_GLOBE_DIAMETER, (GLOBE_DIAMETER * FULL_LOT) / lotScale);
}
