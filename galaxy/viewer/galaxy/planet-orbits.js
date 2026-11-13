// Where a star's planets orbit (function-planets.js), shared with the system layout (constellation-orbits.js) so stars
// are spaced by the reach of their planets, not by their own size. Each planet has an orbit of its own; the most
// important functions take the inner orbits.
export const PER_ORBIT = 1;
export const orbitGap = (S, u) => Math.max(0.36 * u, S * 0.3);
/** The radius of orbit `ring` (0 = innermost) around a star of radius S; the first clears the star's glow. */
export const orbitRadius = (S, u, ring) => S * 2.1 + (ring + 0.5) * orbitGap(S, u);
/** A planet's radius, from its function's length, never more than half its star's. The floor is the smallest planet a
 * pinch can still pick (10 lines or fewer); from there it grows with the square root of the length up to about 300
 * lines, so a 20-line and an 80-line function are plainly different sizes. */
export const planetSize = (S, u, loc) =>
  Math.min(S * 0.45, 0.75 * u, Math.max(0.18 * u, (0.06 + Math.sqrt(loc) / 26) * u));
/** How far a star's planets reach from its centre: its outermost orbit plus a planet. */
export const systemReach = (S, u, count) =>
  count ? orbitRadius(S, u, Math.ceil(count / PER_ORBIT) - 1) + 0.8 * u : S;
