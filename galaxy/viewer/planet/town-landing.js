// Initial navigation targets populated source lanes, not a potentially empty region centroid. Statement counts can be
// missing before towns are built (Java regions carry only spans), so the layout demand ranks the largest method.
export function startTown(regions) {
  const size = r => r?.areaMetric?.statements || r?.areaMetric?.value || r?.loc || 0;
  return regions.reduce((best, r, k) => (size(r) > size(regions[best]) ? k : best), 0);
}

export function townLandingView(towns, k, R) {
  const town = towns.townOf(k),
    column = town.cols[0],
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
