// Where each group's system sits in the constellation. Everything lies on one plane around the agent cannon at the
// origin. Folders become spiral arms (folderArms; app/graph.ts also colours each arm as one family): each arm is a
// wedge of the plane sized by its systems, and a folder that holds most of the groups is split into its subfolders.
// Along an arm, systems fill the wedge from the cannon outward: first the groups other groups import, last the groups
// that mostly import others. The wedges turn with distance into spirals.
// Plain arrays in and out; constellation.js turns them into the scene.

const TAU = Math.PI * 2;
const sumOf = (ids, values) => ids.reduce((sum, i) => sum + values[i], 0);

// The folder `depth` segments deep, under `prefix`, that holds most of these files. A file directly in a shallower
// folder counts for that folder.
function homeOf(files, prefix, depth) {
  const count = new Map();
  for (const file of files) {
    if (prefix && !file.startsWith(prefix + '/')) continue;
    const key = file.split('/').slice(0, -1).slice(0, depth).join('/');
    count.set(key, (count.get(key) || 0) + 1);
  }
  let best = prefix,
    most = 0;
  for (const [key, n] of count) if (n > most || (n === most && key < best)) [best, most] = [key, n];
  return best;
}

// Folders as arms, given each group's file paths. Start from the top-level folders. While one arm holds more than half
// of the groups, split it into its subfolders, unless that would leave fewer than two groups per arm. Past MAX_ARMS
// arms, the smallest subfolders stay together under their parent's name. Returns [{ name, members }], largest first.
const MAX_ARMS = 12;
export function folderArms(groupFiles) {
  const groups = groupFiles.map(files => ({ files })),
    area = groupFiles.map(files => files.length);
  const areaOf = arm => sumOf(arm.members, area);
  const bySize = (a, b) => b.members.length - a.members.length || areaOf(b) - areaOf(a) || (a.path < b.path ? -1 : 1);
  let arms = [{ path: '', depth: 0, members: groups.map((_, gi) => gi) }];
  for (let guard = 0; guard < 64; guard++) {
    const big = arms.filter(arm => !arm.done && arm.members.length > 1).sort(bySize)[0];
    if (!big || (arms.length > 1 && big.members.length * 2 <= groups.length)) break;
    const children = new Map();
    for (const gi of big.members) {
      const key = homeOf(groups[gi].files, big.path, big.depth + 1);
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(gi);
    }
    // All of the arm's groups live in one subfolder: follow it down, unless they live in this folder itself.
    if (children.size === 1) {
      const [key] = children.keys();
      if (key === big.path) big.done = true;
      else Object.assign(big, { path: key, depth: big.depth + 1 });
      continue;
    }
    const room = MAX_ARMS - arms.length + 1;
    if (room < 2 || (arms.length > 1 && big.members.length < 2 * children.size)) {
      big.done = true;
      continue;
    }
    const parts = [...children]
      .map(([path, members]) => ({ path, depth: big.depth + 1, members, done: path === big.path }))
      .sort(bySize);
    if (parts.length > room) {
      const rest = parts.splice(room - 1);
      parts.push({ path: big.path, depth: big.depth, members: rest.flatMap(p => p.members), done: true, rest: true });
    }
    arms = arms.filter(arm => arm !== big).concat(parts);
  }
  return arms.sort(bySize).map(arm => ({ name: arm.path || (arm.rest ? 'other' : '(root)'), members: arm.members }));
}

// Arms that import each other sit side by side, and arms that reach far are spread around the circle so the galaxy
// stays balanced about the cannon. Insert the arms largest first where they cost least, then move single arms and
// reverse stretches of the circle while that lowers the cost.
function orderArms(arms, weight, lane) {
  if (arms.length <= 3) return arms;
  let imports = 0;
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) imports += weight(arms[i], arms[j]);
  const cost = order => {
    let sum = 0;
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++)
        sum += weight(order[i], order[j]) * Math.min(j - i, order.length - j + i);
    let angle = 0,
      x = 0,
      z = 0,
      mass = 0;
    for (const arm of order) {
      const mid = angle + arm.width / 2,
        m = arm.reach * arm.width;
      x += Math.cos(mid) * m;
      z += Math.sin(mid) * m;
      mass += m;
      angle += arm.width + lane;
    }
    return sum / (imports || 1) + (order.length / 2) * (Math.hypot(x, z) / mass);
  };
  let order = [arms[0]];
  for (const arm of arms.slice(1)) {
    let best = null,
      least = Infinity;
    for (let at = 1; at <= order.length; at++) {
      const trial = [...order.slice(0, at), arm, ...order.slice(at)],
        c = cost(trial);
      if (c < least) [best, least] = [trial, c];
    }
    order = best;
  }
  for (let improved = true, least = cost(order); improved;) {
    improved = false;
    for (let i = 1; i < order.length; i++)
      for (let j = 1; j < order.length; j++) {
        if (i === j) continue;
        const moved = order.filter((_, q) => q !== i);
        moved.splice(j, 0, order[i]);
        const reversed =
          i < j ? [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)] : null;
        for (const trial of [moved, reversed]) {
          if (!trial) continue;
          const c = cost(trial);
          if (c < least - 1e-9) [order, least, improved] = [trial, c, true];
        }
      }
  }
  return order;
}

// The free angle that costs least, or null. Angles are relative to an arm's centre line, and `cost` grows with the
// distance outside the arm's wedge. Blocked intervals may run past ±π, so each is also tried a full turn either way.
function bestFree(blocked, edge, cost) {
  const spans = blocked.flatMap(([a, b]) => [
    [a, b],
    [a - TAU, b - TAU],
    [a + TAU, b + TAU],
  ]);
  const free = x => x >= -Math.PI && x <= Math.PI && spans.every(([a, b]) => x <= a || x >= b);
  let best = null;
  for (const x of [0, -edge, edge, ...spans.flatMap(([a, b]) => [a - 1e-6, b + 1e-6])])
    if (free(x) && (best == null || cost(x) < cost(best))) best = x;
  return best;
}

/**
 * groups: [{ reach: number }]; reach is the system's radius including its outer bodies.
 * links:  [{ a, b, w }]: group a imports group b through w file imports (a !== b).
 * arms:   folderArms() of the groups' files.
 * keepOut: the radius around the cannon that stays empty; gap: the space between neighbouring systems;
 * twist: how far an arm turns, in radians, each time its distance from the cannon grows by a factor of e.
 * fixed:  optional remembered centres, [x, z] or null per group. A remembered system stays where it was unless it has
 *         grown into a neighbour or the cannon's surroundings; then it moves straight outward until clear. The other
 *         systems are placed around them, along the direction their arm's remembered systems already take.
 * Returns the system centres on the plane as [x, z], each arm's label anchor past its tip, and the extent.
 */
export function layoutGalaxy(groups, links, { arms: folders, keepOut, gap, twist = 0.5, fixed = [] }) {
  const n = groups.length;
  if (!n) return { centers: [], arms: [], extent: 0 };
  const area = groups.map(g => (g.reach + gap / 2) ** 2);
  // How foundational each group is: near +1 when other groups only import it, near -1 when it only imports them.
  // Groups with no imports either way belong on the outskirts.
  const into = new Array(n).fill(0),
    from = new Array(n).fill(0);
  links.forEach(({ a, b, w }) => {
    from[a] += w;
    into[b] += w;
  });
  const score = into.map((w, gi) => (w + from[gi] ? (w - from[gi]) / (w + from[gi] + 2) : -1));

  const arms = folders.map(arm => ({ ...arm }));
  const armOf = new Array(n);
  arms.forEach((arm, q) => arm.members.forEach(gi => (armOf[gi] = q)));
  const between = new Map();
  links.forEach(({ a, b, w }) => {
    const p = armOf[a],
      q = armOf[b];
    if (p === q) return;
    const key = Math.min(p, q) + ',' + Math.max(p, q);
    between.set(key, (between.get(key) || 0) + w);
  });
  // Wedges sized by the area of their systems, so arms of several systems reach about as far. An arm around one large
  // system reaches further; the order around the circle spreads those arms out. A dark lane separates neighbours, and
  // the largest arm faces away from the default camera.
  const k = arms.length,
    lane = k > 1 ? Math.min(0.12, 0.8 / k) : 0,
    room = TAU - k * lane,
    total = area.reduce((sum, x) => sum + x, 0);
  const want = arms.map(arm => Math.max(0.2, (sumOf(arm.members, area) / total) * room));
  const fill = room / want.reduce((s, x) => s + x, 0);
  arms.forEach((arm, q) => {
    arm.width = want[q] * fill;
    arm.reach = Math.max(
      Math.sqrt(keepOut ** 2 + (2 * sumOf(arm.members, area)) / arm.width),
      keepOut + 2 * Math.max(...arm.members.map(gi => groups[gi].reach)),
    );
  });
  const ordered = orderArms(
    arms,
    (x, y) => {
      const p = arms.indexOf(x),
        q = arms.indexOf(y);
      return between.get(Math.min(p, q) + ',' + Math.max(p, q)) || 0;
    },
    lane,
  );
  let start = -Math.PI / 2 - ordered[0].width / 2;
  ordered.forEach(arm => {
    arm.center = start + arm.width / 2;
    start += arm.width + lane;
  });

  // Remembered systems first, innermost first: each keeps its centre, or moves outward along its own direction until
  // it clears the systems already settled and the cannon's surroundings.
  const placed = new Array(n);
  const step = gap / 2;
  const settled = [];
  groups
    .map((g, gi) => ({ gi, at: fixed[gi] }))
    .filter(f => f.at)
    .map(f => ({ ...f, r: Math.hypot(f.at[0], f.at[1]), a: Math.atan2(f.at[1], f.at[0]) }))
    .sort((p, q) => p.r - q.r || p.gi - q.gi)
    .forEach(({ gi, r, a, at }) => {
      const reach = groups[gi].reach;
      const clashes = r =>
        r < keepOut + reach - 1e-9 ||
        settled.some(p => {
          const dx = r * Math.cos(a) - p.r * Math.cos(p.a),
            dz = r * Math.sin(a) - p.r * Math.sin(p.a);
          return Math.hypot(dx, dz) < reach + p.reach + gap - 1e-9;
        });
      const from = r;
      while (clashes(r)) r += step;
      // Unmoved, a system keeps its exact coordinates.
      settled.push((placed[gi] = { r, a, reach, xy: r === from ? [at[0], at[1]] : null }));
    });
  // An arm with remembered systems keeps their direction: its centre line is their average, unwound by the twist.
  arms.forEach(arm => {
    let x = 0,
      z = 0;
    for (const gi of arm.members) {
      const p = placed[gi];
      if (!p) continue;
      const line = p.a - twist * Math.log(Math.max(1, p.r / keepOut));
      x += Math.cos(line);
      z += Math.sin(line);
    }
    if (x || z) arm.center = Math.atan2(z, x);
  });

  // Most foundational first, each system takes the innermost free spot in its arm's wedge, as near the arm's centre
  // line as it can. The wedge turns with distance, so arms curve into spirals. Where its wedge is full, a system may
  // lean into a neighbour's: leaving the wedge costs as much as moving outward by the arc it strays.
  const order = groups
    .map((_, gi) => gi)
    .filter(gi => !placed[gi])
    .sort((a, b) => score[b] - score[a] || area[b] - area[a] || a - b);
  for (const gi of order) {
    const arm = arms[armOf[gi]],
      reach = groups[gi].reach,
      edge = arm.width / 2;
    let best = null;
    for (let r = keepOut + reach; !best || r < best.cost; r += step) {
      const center = arm.center + twist * Math.log(r / keepOut);
      const blocked = [];
      for (const p of placed) {
        if (!p) continue;
        const clear = reach + p.reach + gap;
        if (Math.abs(r - p.r) >= clear) continue;
        const cos = (r * r + p.r * p.r - clear * clear) / (2 * r * p.r);
        const half = cos <= -1 ? Math.PI : Math.acos(Math.min(1, cos)),
          mid = p.a - center - TAU * Math.round((p.a - center) / TAU);
        blocked.push([mid - half, mid + half]);
      }
      const cost = x => r + 2 * r * Math.max(0, Math.abs(x) - edge) + 1e-3 * Math.abs(x);
      const at = bestFree(blocked, edge, cost);
      if (at != null && (!best || cost(at) < best.cost)) best = { cost: cost(at), r, a: center + at };
    }
    placed[gi] = { r: best.r, a: best.a, reach };
  }
  const centers = placed.map(p => p.xy || [p.r * Math.cos(p.a), p.r * Math.sin(p.a)]);
  const extent = Math.max(...placed.map(p => p.r + p.reach));

  // Each arm's name sits just past its outermost system, in the average direction of its systems. Arms keep their
  // input order.
  return {
    centers,
    extent,
    arms: arms.map(arm => {
      let x = 0,
        z = 0;
      arm.members.forEach(gi => {
        x += Math.cos(placed[gi].a) * area[gi];
        z += Math.sin(placed[gi].a) * area[gi];
      });
      const len = Math.hypot(x, z) || 1,
        ux = x / len,
        uz = z / len;
      const tip =
        Math.max(...arm.members.map(gi => centers[gi][0] * ux + centers[gi][1] * uz + groups[gi].reach)) + gap;
      return { name: arm.name, members: arm.members, at: [ux * tip, uz * tip] };
    }),
  };
}
