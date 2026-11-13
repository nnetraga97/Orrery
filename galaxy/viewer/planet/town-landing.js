// Initial navigation targets populated source lanes, not a potentially empty region centroid. Statement counts can be
// missing before towns are built (Java regions carry only spans), so the layout demand ranks the largest method.
export function startTown(regions) {
  const size = r => r?.areaMetric?.statements || r?.areaMetric?.value || r?.loc || 0;
  return regions.reduce((best, r, k) => (size(r) > size(regions[best]) ? k : best), 0);
}

/** The box around a town's lots and roads in its own flat frame: [x0, x1, y0, y1] and its middle. */
export function townBounds(town) {
  const pts = [...town.out.lots.map(l => [l.x, l.y]), ...town.out.roads.flatMap(r => r.pts)];
  if (!pts.length) return { box: [0, 0, 0, 0], cx: 0, cy: 0, pts };
  const xs = pts.map(p => p[0]),
    ys = pts.map(p => p[1]),
    box = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { box, cx: (box[0] + box[1]) / 2, cy: (box[2] + box[3]) / 2, pts };
}

// `facing` (the room, where the whole globe is in view at once): the town is shown square on, its middle toward the
// viewer and the start of the function at the top. Its value is an angle in radians: how far above the town's
// middle the camera stands, which the room sets so that the middle faces the viewer's real eye and not the axis
// its model is shown along. Without it (a screen), the camera flies low across the streets.
export function townLandingView(towns, k, R, facing = null) {
  const town = towns.townOf(k);
  if (facing != null) {
    const { cx, cy } = townBounds(town),
      target = town.fr.world(cx, cy, 0),
      normal = target.clone().normalize(),
      north = town.fr.nn.clone().addScaledVector(normal, -town.fr.nn.dot(normal)).normalize(),
      distance = R * 0.9;
    return {
      target,
      cam: target
        .clone()
        .addScaledVector(normal, distance * Math.cos(facing))
        .addScaledVector(north, distance * Math.sin(facing)),
    };
  }
  const column = town.cols[0],
    [x, y] = column.map([0, -Math.min(column.c.m.h * 0.35, 8)]),
    target = town.fr.world(x, y, town.s * 0.2 + town.liftAt(x, y)),
    normal = target.clone().normalize(),
    north = town.fr.nn.clone().addScaledVector(normal, -town.fr.nn.dot(normal)).normalize(),
    distance = Math.min(R * 0.9, Math.max(R * 0.45, town.s * 28)),
    // A low oblique reads streets up close; from farther out it would graze the curve of the planet and fill half the
    // view with space, so the view steepens with distance.
    t = Math.min(1, Math.max(0, (distance / R - 0.2) / 0.6)),
    elevation = 0.55 + 0.5 * t * t * (3 - 2 * t);
  return {
    target,
    cam: target
      .clone()
      .addScaledVector(normal, distance * Math.sin(elevation))
      .addScaledVector(north, -distance * Math.cos(elevation)),
  };
}
