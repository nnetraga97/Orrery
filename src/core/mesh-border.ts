// The border of a region drawn as a triangle soup (three vertices per triangle, no index): the edges used by exactly
// one triangle. Vertices that agree to five decimals are the same point.

/** Line segments (x1, y1, z1, x2, y2, z2, ...) along the border of a non-indexed triangle list. */
export function borderOf(positions: ArrayLike<number>): number[] {
  const key = (i: number) => `${positions[i].toFixed(5)},${positions[i + 1].toFixed(5)},${positions[i + 2].toFixed(5)}`;
  const edges = new Map<string, { count: number; a: number; b: number }>();
  for (let t = 0; t + 8 < positions.length; t += 9)
    for (const [a, b] of [
      [t, t + 3],
      [t + 3, t + 6],
      [t + 6, t],
    ]) {
      const ka = key(a),
        kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(k);
      if (e) e.count++;
      else edges.set(k, { count: 1, a, b });
    }
  const out: number[] = [];
  for (const e of edges.values())
    if (e.count === 1)
      out.push(positions[e.a], positions[e.a + 1], positions[e.a + 2], positions[e.b], positions[e.b + 1], positions[e.b + 2]);
  return out;
}
