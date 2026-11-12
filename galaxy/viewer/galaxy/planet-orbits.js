// Where a star's planets orbit (function-planets.js), shared with the system layout (constellation-orbits.js) so stars
// are spaced by the reach of their planets, not by their own size. Each planet has an orbit of its own; the most
// important functions take the inner orbits.
export const PER_ORBIT = 1;
export const orbitGap = (S, u) => Math.max(0.36 * u, S * 0.3);
/** The radius of orbit `ring` (0 = innermost) around a star of radius S; the first clears the star's glow. */
export const orbitRadius = (S, u, ring) => S * 2.4 + (ring + 0.5) * orbitGap(S, u);
/** A planet's radius, from its function's length, never more than half its star's. */
export const planetSize = (S, u, loc) =>
  Math.min(S * 0.45, 0.42 * u, Math.max(0.12 * u, (0.08 + Math.sqrt(loc) / 45) * u));
/** How far a star's planets reach from its centre: its outermost orbit plus a planet. */
export const systemReach = (S, u, count) =>
  count ? orbitRadius(S, u, Math.ceil(count / PER_ORBIT) - 1) + 0.45 * u : S;
