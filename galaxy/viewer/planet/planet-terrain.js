// Pure planet data generation: used in the worker; field hydration is shared with the viewer.
import * as THREE from 'three';

const noise3 = (x, y, z) =>
  (Math.sin(x * 1.7 + Math.sin(z * 1.3)) * Math.cos(y * 1.9 + Math.sin(x * 0.7)) +
    Math.sin(z * 2.3 + y * 0.8) * 0.5 +
    Math.sin((x + y + z) * 3.1) * 0.25) /
  1.75;
const planetAngle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
// A hierarchical partition keeps an owner's methods together and preserves
// source-derived neighborhoods inside it. Geometry and hydration use this exact
// same rule; transport and picking therefore agree with the visible terrain.
function planetPartition(topology) {
  const nodes = topology.map(n => ({ ...n, seed: new THREE.Vector3().fromArray(n.seed) }));
  const descend = (v, start = 0) => {
    let at = start;
    while (nodes[at].children?.length) {
      let best = -1,
        score = Infinity;
      for (const child of nodes[at].children) {
        const d = planetAngle(v, nodes[child].seed) - nodes[child].weight;
        if (d < score) {
          score = d;
          best = child;
        }
      }
      at = best;
    }
    return nodes[at].region;
  };
  const probe = v => {
    let at = 0,
      margin = Infinity,
      alternative = -1;
    while (nodes[at].children?.length) {
      let best = -1,
        second = -1,
        d1 = Infinity,
        d2 = Infinity;
      for (const child of nodes[at].children) {
        const d = planetAngle(v, nodes[child].seed) - nodes[child].weight;
        if (d < d1) {
          d2 = d1;
          second = best;
          d1 = d;
          best = child;
        } else if (d < d2) {
          d2 = d;
          second = child;
        }
      }
      if (d2 - d1 < margin) {
        margin = d2 - d1;
        alternative = second;
      }
      at = best;
    }
    return { k1: nodes[at].region, k2: alternative < 0 ? -1 : descend(v, alternative), margin };
  };
  return { probe, ownerOfDir: descend };
}
function planetHeightField(regions, R, seeds, w, centerOf, shapeOf, partition = null, seed = 0) {
  const K = regions.length;
  const BASE = R * 0.012;
  // Method regions are buildable islands. Their outer margin becomes a shared channel;
  // packed lots stop at 80% of the border, before the shoreline starts descending.
  const COAST_FROM = 0.8,
    CLAMP_EPS = 0.006;
  const clamp01 = x => Math.min(1, Math.max(0, x)),
    ease = t => t * t * (3 - 2 * t);
  const shoreMask = (v, k) => {
    if (regions.length === 1) return 0;
    const d = Math.acos(Math.max(-1, Math.min(1, v.dot(centerOf[k])))),
      shape = shapeOf[k];
    const coast = COAST_FROM + 0.04 * noise3(v.x * 16 + seed * 31, v.y * 16, v.z * 16);
    return ease(clamp01((d / shape.borderAt(Math.atan2(v.dot(shape.north), v.dot(shape.e))) - coast) / (1 - coast)));
  };
  // Nearest two regions by weighted distance; margin is 0 on the border and grows into the interior.
  const probe =
    partition?.probe ||
    (v => {
      let k1 = -1,
        k2 = -1,
        d1 = Infinity,
        d2 = Infinity;
      for (let k = 0; k < K; k++) {
        const x = Math.acos(Math.min(1, v.dot(seeds[k]))) - w[k];
        if (x < d1) {
          d2 = d1;
          k2 = k1;
          d1 = x;
          k1 = k;
        } else if (x < d2) {
          d2 = x;
          k2 = k;
        }
      }
      return { k1, k2, margin: k2 < 0 ? Infinity : d2 - d1 };
    });
  const fieldAt = (v, hit = probe(v)) => {
    const { k1, k2, margin } = hit;
    const relief = R * 0.006 * noise3(v.x * 7 + seed * 31, v.y * 7, v.z * 7);
    if (k2 < 0) return BASE + relief;
    const mask = shoreMask(v, k1),
      seam = 1 - ease(clamp01(margin / CLAMP_EPS));
    const coast = 0.88 + 0.12 * noise3(v.x * 28, v.y * 28, v.z * 28);
    return BASE + relief * (1 - Math.max(mask, seam)) - R * 0.038 * Math.max(mask, seam) * coast;
  };
  const heightAt = v => fieldAt(v); // callers pass a direction; the region is implied

  return { probe, fieldAt, heightAt };
}
// Ground colour from an albedo sample at a direction on the unit sphere, using
// SphereGeometry's equirectangular orientation. Water texels read as the land mean.
export function sampleGround(ground, dir, out) {
  const { width: W, height: H, rgb, water, land } = ground;
  const u = (Math.atan2(dir.z, -dir.x) / (2 * Math.PI) + 1) % 1,
    v = Math.acos(Math.max(-1, Math.min(1, dir.y))) / Math.PI;
  const x = u * W - 0.5,
    y = v * H - 0.5,
    x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let r = 0,
    g = 0,
    b = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ]) {
    const i = Math.min(H - 1, Math.max(0, y0 + dy)) * W + ((((x0 + dx) % W) + W) % W);
    if (water?.[i]) {
      r += land[0] * w;
      g += land[1] * w;
      b += land[2] * w;
    } else {
      r += (rgb[i * 3] / 255) * w;
      g += (rgb[i * 3 + 1] / 255) * w;
      b += (rgb[i * 3 + 2] / 255) * w;
    }
  }
  return out.setRGB(r, g, b, THREE.SRGBColorSpace);
}

// Dark land under towns is lifted towards this linear luminance, by at most LAND_LIFT, so it keeps its hue and depth:
// lifting all the way bleached a navy moon to pale grey. The roads' light curbs keep them readable on dark land.
const LAND_FLOOR = 0.16,
  LAND_LIFT = 1.5;
// A globe that holds one function (planet-scene.js OneTown). Its town may spread this far from its middle, in radians
// of arc: about 46 degrees, which fills most of the face the viewer sees (the limb is near 70) and keeps the whole
// function in sight at once. It used to spread to 65 and wrap out of view.
export const ONE_TOWN_REACH = 0.8;
// Where that town sits: on the equator, so turning the globe by hand goes around it and over it evenly (a town near a
// pole can only be spun), and on the side the sun lights.
const ONE_TOWN_CENTRE = [0.8, 0, 0.6];
export function generatePlanetTerrain({ regions, R, color, seed = 0, palette = null, naturalSurface = false }) {
  // Land is proportional to each callable's statement and junction demand, so buildings come out at one scale
  // across the planet and a large method is not squeezed into a strip of tiny buildings. The small floor keeps a
  // short accessor independently navigable; no callable is discarded or merged because its body is short.
  const weight = r => Math.max(1, r.areaMetric?.value || Math.sqrt(Math.max(1, r.loc || 1)) + 1.5 * (r.branches || 0)),
    total = regions.reduce((sum, r) => sum + weight(r), 0);
  const target = regions.map(r => Math.max(0.08 / regions.length, weight(r) / total));
  const tsum = target.reduce((sum, t) => sum + t, 0);
  target.forEach((t, k) => {
    target[k] = t / tsum;
  });

  // ---- surface partition: additively weighted spherical Voronoi, weights tuned to hit each region's area ----
  // Library planets need a territory map, not another detailed procedural surface beneath the real terrain.
  const geo = new THREE.IcosahedronGeometry(R, naturalSurface ? 12 : 22);
  const P = geo.attributes.position,
    faceCount = P.count / 3;
  const centroid = new Array(faceCount);
  for (let f = 0; f < faceCount; f++) {
    const c = new THREE.Vector3();
    for (let v = 0; v < 3; v++) c.add(new THREE.Vector3(P.getX(f * 3 + v), P.getY(f * 3 + v), P.getZ(f * 3 + v)));
    centroid[f] = c.normalize();
  }
  const K = regions.length,
    owner = new Int32Array(faceCount),
    leafOf = new Array(K);
  const hash = value => {
    let h = 2166136261;
    for (const c of String(value)) {
      h ^= c.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const sphere = id => {
    const y = 2 * hash(id + ':latitude') - 1,
      angle = 2 * Math.PI * hash(id + ':longitude');
    return new THREE.Vector3(Math.cos(angle) * Math.sqrt(1 - y * y), y, Math.sin(angle) * Math.sqrt(1 - y * y));
  };
  const groups = (indices, key) => {
    const map = new Map();
    for (const k of indices) {
      const id = key(regions[k]);
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(k);
    }
    return [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  };
  const structure = { id: 'planet', indices: regions.map((_, k) => k), children: [] };
  for (const [id, indices] of groups(structure.indices, r => r.district?.id || r.owner || r.id || r.name)) {
    // Hash ids come from the persistent layout keys (layout-identity.js) when present, so renames keep their places.
    const district = {
      id: regions[indices[0]].layout?.districtId || id,
      indices,
      raw: regions[indices[0]].layout?.districtAnchor,
      children: [],
    };
    for (const [nid, members] of groups(
      indices,
      r => r.neighborhood?.id || r.layout?.neighborhoodId || r.id || r.name,
    )) {
      district.children.push({
        id: regions[members[0]].layout?.neighborhoodId || nid,
        indices: members,
        raw: regions[members[0]].layout?.neighborhoodAnchor,
        children: members.map(k => ({
          id: regions[k].layout?.key || regions[k].id || regions[k].name,
          indices: [k],
          raw: regions[k].layout?.globalAnchor,
          region: k,
        })),
      });
    }
    structure.children.push(district);
  }
  // A sole owner/cluster already owns its parent's whole area; skip that level
  // so a one-class planet can use the full sphere, rather than a small cap.
  function collapse(node) {
    while (node.children?.length === 1) node = node.children[0];
    if (node.children) node.children = node.children.map(collapse);
    return node;
  }
  structure.children = structure.children.map(collapse);
  while (structure.children.length === 1 && structure.children[0].children)
    structure.children = structure.children[0].children;
  const topology = [{ id: 'planet', seed: [0, 1, 0], weight: 0, children: [], target: 1, span: Math.PI }];
  function appendChildren(parentIndex, children, top = false) {
    const parent = topology[parentIndex],
      parentSeed = new THREE.Vector3().fromArray(parent.seed);
    const east = new THREE.Vector3(Math.abs(parentSeed.y) > 0.95 ? 1 : 0, Math.abs(parentSeed.y) > 0.95 ? 0 : 1, 0)
        .cross(parentSeed)
        .normalize(),
      north = parentSeed.clone().cross(east);
    // Overloads can share an id, and identical seeds tie forever: the later sibling would own no land. Repeats hash
    // with their occurrence, so every sibling gets its own place.
    const seen = new Map();
    const entries = children.map(child => {
      const repeat = seen.get(child.id) ?? 0;
      seen.set(child.id, repeat + 1);
      const key = repeat ? `${child.id}#${repeat}` : child.id;
      let seed;
      if (top) seed = child.raw && !repeat ? new THREE.Vector3().fromArray(child.raw) : sphere(key);
      else {
        const bearing = hash(key + ':bearing') * Math.PI * 2,
          distance = parent.span * (0.15 + 0.65 * Math.sqrt(hash(key + ':distance')));
        seed = parentSeed
          .clone()
          .multiplyScalar(Math.cos(distance))
          .addScaledVector(east, Math.sin(distance) * Math.cos(bearing))
          .addScaledVector(north, Math.sin(distance) * Math.sin(bearing));
      }
      return { child, seed };
    });
    for (const { child, seed } of entries) {
      const nearest = entries.reduce((m, e) => (e.seed === seed ? m : Math.min(m, planetAngle(seed, e.seed))), Math.PI);
      const index = topology.length;
      topology.push({
        id: child.id,
        seed: seed.toArray(),
        anchor: seed.toArray(),
        weight: 0,
        children: [],
        parent: parentIndex,
        target: child.indices.reduce((sum, k) => sum + target[k], 0),
        span: Math.max(0.04, Math.min(top ? Math.PI : parent.span, nearest * 0.48)),
        region: child.region,
      });
      parent.children.push(index);
      if (child.region != null) leafOf[child.region] = index;
      if (child.children?.length) appendChildren(index, child.children);
    }
  }
  appendChildren(0, structure.children, true);
  const vectors = topology.map(n => new THREE.Vector3().fromArray(n.seed)),
    anchors = vectors.map(v => v.clone());
  const count = topology.length,
    distances = new Float64Array(faceCount * count);
  let bestScore = Infinity,
    bestState = null;
  const iterations = naturalSurface ? 16 : 80;
  // A small cell can end up owning no faces, which leaves its method no land at all: its hashed seed lies outside the
  // area its parent actually won, and no weight it reaches in time pulls faces in. `via` records each face's descent;
  // an empty cell (the highest empty node on the path) moves onto its parent's face farthest from its siblings, at
  // the weakest sibling's weight. Cells that own land keep their places.
  const MIN_FACES = 3,
    via = new Int32Array(faceCount * 8);
  function relocateStarved(area) {
    const starved = new Set();
    for (const leaf of leafOf) {
      if (area[leaf] >= MIN_FACES) continue;
      let k = leaf;
      while (topology[k].parent > 0 && area[topology[k].parent] < MIN_FACES) k = topology[k].parent;
      starved.add(k);
    }
    // Moved cells count as occupied for the next pick, or empty siblings would all take the same face and tie again.
    const occupied = new Map();
    for (const k of starved) {
      const parent = topology[k].parent;
      if (!occupied.has(parent))
        occupied.set(
          parent,
          topology[parent].children.filter(c => area[c] >= MIN_FACES),
        );
      const siblings = occupied.get(parent);
      let best = -1,
        room = -Infinity;
      for (let f = 0; f < faceCount; f++) {
        if (parent) {
          let inside = false;
          for (let d = 0; d < 8 && !inside; d++) inside = via[f * 8 + d] === parent;
          if (!inside) continue;
        }
        let clear = Math.PI;
        for (const c of siblings) clear = Math.min(clear, planetAngle(centroid[f], vectors[c]) - topology[c].weight);
        if (clear > room) {
          room = clear;
          best = f;
        }
      }
      if (best < 0) continue;
      vectors[k].copy(centroid[best]);
      topology[k].weight = siblings.length ? Math.min(...siblings.map(c => topology[c].weight)) : 0;
      siblings.push(k);
    }
    return starved.size;
  }
  for (let it = 0; it < iterations; it++) {
    if (it % 8 === 0)
      for (let f = 0; f < faceCount; f++)
        for (let k = 1; k < count; k++) distances[f * count + k] = planetAngle(centroid[f], vectors[k]);
    const area = new Float64Array(count),
      acc = vectors.map(() => new THREE.Vector3());
    area[0] = faceCount;
    const relocating = it % 8 === 7 && it < iterations - 8;
    if (relocating) via.fill(-1);
    for (let f = 0; f < faceCount; f++) {
      let at = 0,
        depth = 0;
      while (topology[at].children.length) {
        let best = -1,
          bd = Infinity;
        for (const child of topology[at].children) {
          const d = distances[f * count + child] - topology[child].weight;
          if (d < bd) {
            bd = d;
            best = child;
          }
        }
        at = best;
        area[at]++;
        if (it % 8 === 7) acc[at].add(centroid[f]);
        if (relocating && depth < 8) via[f * 8 + depth++] = at;
      }
      owner[f] = topology[at].region;
    }
    const score = leafOf.reduce(
      (sum, k) => sum + (area[k] ? Math.pow(area[k] / faceCount - topology[k].target, 2) : 100),
      0,
    );
    if (score < bestScore) {
      bestScore = score;
      bestState = { weights: topology.map(n => n.weight), seeds: vectors.map(v => v.toArray()) };
    }
    for (let k = 1; k < count; k++) {
      const node = topology[k],
        parent = topology[node.parent],
        gain = parent.span * 0.24 * (1 - it / (iterations * 1.375));
      node.weight +=
        gain * (Math.sqrt(node.target / parent.target) - Math.sqrt(area[k] / Math.max(1, area[node.parent])));
      if (it < 64 && it % 8 === 7 && acc[k].lengthSq()) {
        const leaf = node.region != null,
          desired = vectors[k]
            .clone()
            .lerp(acc[k].normalize(), leaf ? 0.65 : 0.18)
            .normalize();
        const angle = planetAngle(anchors[k], desired),
          limit = leaf && node.parent !== 0 ? Math.PI : Math.min(0.22, parent.span * 0.18);
        if (angle > limit)
          desired
            .copy(anchors[k])
            .lerp(desired, limit / angle)
            .normalize();
        vectors[k].copy(desired);
      }
    }
    if (relocating) relocateStarved(area);
  }
  if (bestState)
    topology.forEach((node, k) => {
      node.weight = bestState.weights[k];
      vectors[k].fromArray(bestState.seeds[k]);
    });
  // The best state can still leave a cell empty; settle those against the final weights.
  for (let round = 0; round < 12; round++) {
    const area = new Float64Array(count);
    via.fill(-1);
    for (let f = 0; f < faceCount; f++) {
      let at = 0,
        depth = 0;
      area[0]++;
      while (topology[at].children.length) {
        let best = -1,
          bd = Infinity;
        for (const child of topology[at].children) {
          const d = planetAngle(centroid[f], vectors[child]) - topology[child].weight;
          if (d < bd) {
            bd = d;
            best = child;
          }
        }
        at = best;
        area[at]++;
        if (depth < 8) via[f * 8 + depth++] = at;
      }
    }
    if (!relocateStarved(area)) break;
  }
  topology.forEach((node, k) => {
    node.seed = vectors[k].toArray();
  });
  const seeds = leafOf.map(k => vectors[k]),
    w = leafOf.map(k => topology[k].weight);
  const partition = planetPartition(topology),
    { ownerOfDir } = partition;
  // The last relaxation changed seeds/weights; assign faces with that final rule, too.
  centroid.forEach((d, f) => {
    owner[f] = ownerOfDir(d);
  });
  const facesOf = regions.map(() => []);
  for (let f = 0; f < faceCount; f++) facesOf[owner[f]].push(f);
  const centerOf = facesOf.map((fs, k) => {
    // A lone region owns the whole sphere, whose centroid is rounding noise: place it deliberately.
    if (regions.length === 1) return new THREE.Vector3().fromArray(ONE_TOWN_CENTRE);
    const a = new THREE.Vector3();
    fs.forEach(f => a.add(centroid[f]));
    if (a.lengthSq() < 1e-12) return seeds[k].clone();
    a.normalize();
    if (ownerOfDir(a) === k) return a;
    // Nested boundaries can make a cell's geometric centroid fall outside it.
    // Pick a sampled point belonging to the cell instead of a foreign seed.
    const nearest = fs.reduce((best, f) => (centroid[f].dot(a) > centroid[best].dot(a) ? f : best), fs[0]);
    return centroid[nearest].clone();
  });
  const radiusOf = facesOf.map(
    (fs, k) => fs.reduce((max, f) => Math.max(max, Math.acos(Math.min(1, centroid[f].dot(centerOf[k])))), 0) || 0.2,
  );

  // ---- green industrial regions, surrounded by shallow water ----
  const regionColor = regions.map(r =>
    new THREE.Color().setHSL(
      0.2 + hash(r.layout?.districtId || r.district?.id || r.owner || r.id || r.name) * 0.22,
      0.36,
      0.33 + (hash(r.layout?.neighborhoodId || r.neighborhood?.id || r.id || r.name) - 0.5) * 0.08,
    ),
  );
  // Sample the actual border in every direction, instead of fitting the town into one inscribed circle.
  // A tangent chart covers the visible hemisphere; a one-region planet has no artificial shoreline.
  const shapeOf = centerOf.map((c, k) => {
    if (ownerOfDir(c) !== k) c.copy(seeds[k]);
    const e = new THREE.Vector3(0, 1, 0).cross(c).normalize();
    if (e.lengthSq() < 1e-6) e.set(1, 0, 0);
    const north = c.clone().cross(e).normalize(),
      count = naturalSurface ? 32 : 128,
      limit = Math.PI / 2 - 0.15,
      // The share of the way to its border a town may build on.
      usable = regions.length === 1 ? ONE_TOWN_REACH / limit : 0.8;
    const radii = Array.from({ length: count }, (_, j) => {
      const angle = (j * Math.PI * 2) / count,
        tangent = e.clone().multiplyScalar(Math.cos(angle)).addScaledVector(north, Math.sin(angle));
      const dir = a => c.clone().multiplyScalar(Math.cos(a)).addScaledVector(tangent, Math.sin(a));
      let lo = 0,
        hi = limit;
      // Find the first crossing even if the weighted cell has a less regular outline.
      for (let a = 0.025; a < limit; a += 0.025) {
        if (ownerOfDir(dir(a)) !== k) {
          hi = a;
          break;
        }
        lo = a;
      }
      if (ownerOfDir(dir(hi)) === k) return hi;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (ownerOfDir(dir(mid)) === k) lo = mid;
        else hi = mid;
      }
      return lo;
    });
    const borderAt = angle => {
      const t = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * count,
        j = Math.floor(t),
        f = t - j;
      return radii[j % count] * (1 - f) + radii[(j + 1) % count] * f;
    };
    const edge = radii.map((a, j) => {
      const r = R * Math.tan(a * usable),
        t = (j * Math.PI * 2) / count;
      return [r * Math.cos(t), r * Math.sin(t)];
    });
    return {
      e,
      north,
      borderAt,
      edge,
      radii,
      limit,
      usable,
      contains: (x, y) => Math.atan(Math.hypot(x, y) / R) <= borderAt(Math.atan2(y, x)) * usable,
    };
  });
  const siteOf = shapeOf.map(s => Math.min(...s.edge.map(([x, y]) => Math.atan(Math.hypot(x, y) / R))));
  const { probe, fieldAt, heightAt } = planetHeightField(regions, R, seeds, w, centerOf, shapeOf, partition, seed);
  const clamp01 = x => Math.min(1, Math.max(0, x));
  // ---- render mesh: fine, indexed (shared vertices) so borders are resolved and normals are smooth ----
  const FINE = naturalSurface ? 12 : 64;
  const fineSrc = new THREE.IcosahedronGeometry(1, FINE).attributes.position;
  const vertexOf = new Map(),
    dirs = [],
    triangles = new Uint32Array(fineSrc.count);
  for (let i = 0; i < fineSrc.count; i++) {
    const x = fineSrc.getX(i),
      y = fineSrc.getY(i),
      z = fineSrc.getZ(i),
      key = `${Math.round(x * 2e4)},${Math.round(y * 2e4)},${Math.round(z * 2e4)}`;
    let j = vertexOf.get(key);
    if (j === undefined) {
      j = dirs.length;
      vertexOf.set(key, j);
      dirs.push(new THREE.Vector3(x, y, z).normalize());
    }
    triangles[i] = j;
  }
  const surfacePos = new Float32Array(dirs.length * 3),
    colors = new Float32Array(dirs.length * 3);
  dirs.forEach((dir, j) => {
    if (naturalSurface) {
      surfacePos.set([dir.x * R, dir.y * R, dir.z * R], j * 3);
      colors.set(regionColor[ownerOfDir(dir)].toArray(), j * 3);
      return;
    }
    const hit = probe(dir),
      h = fieldAt(dir, hit);
    surfacePos[j * 3] = dir.x * (R + h);
    surfacePos[j * 3 + 1] = dir.y * (R + h);
    surfacePos[j * 3 + 2] = dir.z * (R + h);
    // Climate varies continuously across district boundaries. District tint is subtle;
    // the region channels and outlines still carry the semantic geography.
    const moisture = noise3(dir.x * 3.7 + seed * 31, dir.y * 3.7, dir.z * 3.7) * 0.5 + 0.5;
    const latitude = Math.abs(dir.y);
    const grain = noise3(dir.x * 42, dir.y * 42, dir.z * 42);
    const c = new THREE.Color('#927346').lerp(new THREE.Color('#4e6940'), clamp01((moisture - 0.3) * 2.4));
    c.lerp(new THREE.Color('#284d3d'), clamp01((moisture - 0.57) * 3));
    c.lerp(new THREE.Color('#888475'), clamp01((latitude - 0.56) * 2) * 0.7);
    c.lerp(new THREE.Color('#c4d4ce'), THREE.MathUtils.smoothstep(latitude + grain * 0.025, 0.8, 0.96));
    if (palette?.ground) {
      sampleGround(palette.ground, dir, c);
      c.multiplyScalar(0.88 + moisture * 0.14 + grain * 0.08);
    } else if (palette) {
      const ground = new THREE.Color(palette.land);
      c.copy(ground).multiplyScalar(0.76 + moisture * 0.33 + grain * 0.08);
      if (!palette.airless) c.lerp(new THREE.Color('#c4d4ce'), THREE.MathUtils.smoothstep(latitude, 0.83, 0.98) * 0.5);
    }
    c.lerp(regionColor[hit.k1], palette?.ground ? 0.05 : 0.1).multiplyScalar(0.94 + grain * 0.1);
    // Roads are dark asphalt; on the darkest land they disappeared. Brighten that land a little, keeping its hue.
    const luminance = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (luminance < LAND_FLOOR) c.multiplyScalar(Math.min(LAND_LIFT, LAND_FLOOR / Math.max(luminance, 0.02)));
    // Limestone beaches and teal shelves descend into deep blue channels.
    const beach = palette?.ground
        ? new THREE.Color().fromArray(palette.ground.land).convertSRGBToLinear().multiplyScalar(1.08)
        : new THREE.Color(palette?.land || '#aa9871'),
      shallow = palette?.ground?.ocean
        ? new THREE.Color().fromArray(palette.ground.ocean).convertSRGBToLinear().multiplyScalar(1.4)
        : new THREE.Color(palette?.ocean || '#306f76');
    if (h < R * 0.004) c.copy(beach).lerp(shallow, clamp01((R * 0.003 - h) / (R * 0.02)));
    colors.set([c.r, c.g, c.b], j * 3);
  });
  const geoFine = new THREE.BufferGeometry();
  geoFine.setAttribute('position', new THREE.BufferAttribute(surfacePos, 3));
  geoFine.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geoFine.setIndex(new THREE.BufferAttribute(triangles, 1));
  geoFine.computeVertexNormals();
  // Which region each render triangle belongs to (hover picking and the highlight overlay).
  const fineFaces = triangles.length / 3,
    fineOwner = new Int32Array(fineFaces),
    fineFacesOf = regions.map(() => []);
  for (let f = 0; f < fineFaces; f++) {
    const c = dirs[triangles[f * 3]]
      .clone()
      .add(dirs[triangles[f * 3 + 1]])
      .add(dirs[triangles[f * 3 + 2]])
      .normalize();
    fineOwner[f] = ownerOfDir(c);
    fineFacesOf[fineOwner[f]].push(f);
  }
  // Region borders traced along the true (bisected) border of every region, drawn once per pair.
  const seg = [];
  {
    const t = new THREE.Vector3();
    shapeOf.forEach((s, k) => {
      const n = s.radii.length,
        c = centerOf[k];
      const at = (j, extra = 0) => {
        const a = (j * Math.PI * 2) / n,
          r = s.radii[j % n] + extra;
        t.copy(s.e).multiplyScalar(Math.cos(a)).addScaledVector(s.north, Math.sin(a));
        return c.clone().multiplyScalar(Math.cos(r)).addScaledVector(t, Math.sin(r)).normalize();
      };
      for (let j = 0; j < n; j++) {
        if (s.radii[j] >= s.limit - 1e-6 || s.radii[(j + 1) % n] >= s.limit - 1e-6) continue; // no border found in this direction
        if (ownerOfDir(at(j, 0.004)) < k) continue; // the neighbour draws this stretch
        for (const d of [at(j), at(j + 1)])
          seg.push(
            ...d
              .clone()
              .multiplyScalar(R + heightAt(d) + 0.06)
              .toArray(),
          );
      }
    });
  }

  const mapPaths = regions.map(() => '');
  for (let f = 0; f < faceCount; f++) {
    const side = centroid[f].z < 0 ? -1 : 1,
      points = [];
    for (let q = 0; q < 3; q++) {
      const i = f * 3 + q,
        d = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i)).normalize();
      points.push(`${((side > 0 ? 59 : 185) + side * d.x * 52).toFixed(1)},${(56 - d.y * 52).toFixed(1)}`);
    }
    mapPaths[owner[f]] += 'M' + points.join('L') + 'Z';
  }

  return {
    mapPaths,
    seed,
    R,
    regions,
    topology,
    seeds: seeds.map(v => v.toArray()),
    w,
    centers: centerOf.map(v => v.toArray()),
    radiusOf,
    shapes: shapeOf.map(s => ({
      e: s.e.toArray(),
      north: s.north.toArray(),
      radii: s.radii,
      edge: s.edge,
      limit: s.limit,
      usable: s.usable,
    })),
    siteOf,
    regionColors: regionColor.map(c => c.toArray()),
    surfacePos,
    colors,
    normals: geoFine.attributes.normal.array,
    triangles,
    fineOwner,
    borders: new Float32Array(seg),
  };
}
export function hydratePlanetTerrain(data) {
  const { regions, R, w } = data,
    seeds = data.seeds.map(v => new THREE.Vector3().fromArray(v)),
    centerOf = data.centers.map(v => new THREE.Vector3().fromArray(v));
  const shapeOf = data.shapes.map(s => {
    const radii = s.radii,
      count = radii.length;
    const borderAt = angle => {
      const t = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * count,
        j = Math.floor(t),
        f = t - j;
      return radii[j % count] * (1 - f) + radii[(j + 1) % count] * f;
    };
    return {
      ...s,
      e: new THREE.Vector3().fromArray(s.e),
      north: new THREE.Vector3().fromArray(s.north),
      borderAt,
      contains: (x, y) => Math.atan(Math.hypot(x, y) / R) <= borderAt(Math.atan2(y, x)) * (s.usable ?? 0.8),
    };
  });
  const partition = data.topology ? planetPartition(data.topology) : null;
  const ownerOfDir =
    partition?.ownerOfDir ||
    (d => {
      let best = 0,
        bd = Infinity;
      for (let k = 0; k < seeds.length; k++) {
        const x = Math.acos(Math.min(1, d.dot(seeds[k]))) - w[k];
        if (x < bd) {
          bd = x;
          best = k;
        }
      }
      return best;
    });
  return {
    ...data,
    centerOf,
    shapeOf,
    ownerOfDir,
    regionColor: data.regionColors.map(c => new THREE.Color().fromArray(c)),
    ...planetHeightField(regions, R, seeds, w, centerOf, shapeOf, partition, data.seed || 0),
  };
}
