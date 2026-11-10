// Shared town/country road strip. Frames own projection; buffers own geometry.
import * as THREE from 'three';
import { countryLayer, layerHeight } from '../country/country-layers.js';
import { roadPixels, screenRoadMaterial } from '../country/country-road-scale.js';
export const ROAD_COLORS = {
  main: '#202a38',
  branch: '#35404e',
  loop: '#424c55',
  skip: '#56606a',
  curb: '#a5b0b7',
  line: '#f1dc9b',
};
export function roadStrip(target, pts, width, lift, color, dashed, world, liftAt = () => 0) {
  pts.forEach((p, i) => {
    const nq = pts[Math.min(pts.length - 1, i + 1)],
      o = pts[Math.max(0, i - 1)];
    const dx = nq[0] - o[0],
      dy = nq[1] - o[1],
      L = Math.hypot(dx, dy) || 1;
    const nx = ((-dy / L) * width) / 2,
      ny = ((dx / L) * width) / 2,
      lf = lift + liftAt(...p);
    const a = world(p[0] + nx, p[1] + ny, lf),
      b = world(p[0] - nx, p[1] - ny, lf),
      base = target.pos.length / 3;
    target.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
    target.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (i < pts.length - 1 && (!dashed || i % 2 === 0))
      target.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  });
}
export function roadMesh(
  roads,
  {
    color,
    y = 0.085,
    name = 'country-roads',
    screenAware = false,
    pixels,
    layer,
    detailDistance = 0,
    dashed = false,
  } = {},
) {
  const centers = [],
    offsets = [],
    along = [],
    params = [];
  const buf = { pos: [], col: [], idx: [] },
    world = (x, z, h) => new THREE.Vector3(x, h, z);
  for (const r of roads) {
    if (r.points.length < 2) continue;
    const strip = (target, pts, width, lift, col, dashed, world, mark = 0) => {
      const start = buf.pos.length;
      roadStrip(target, pts, width, lift, col, dashed, world);
      let distance = 0;
      pts.forEach((p, k) => {
        if (k) distance += Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]);
        along.push(distance, distance);
      });
      if (!screenAware && !r.laneOffset) return;
      for (let j = start; j < buf.pos.length; j += 6) {
        const x = (buf.pos[j] + buf.pos[j + 3]) / 2,
          z = (buf.pos[j + 2] + buf.pos[j + 5]) / 2;
        const dx = buf.pos[j] - x,
          dz = buf.pos[j + 2] - z,
          len = Math.hypot(dx, dz) || 1;
        const lane = (r.laneOffset || 0) * r.width;
        for (let v = 0; v < 2; v++) {
          centers.push(x, buf.pos[j + 1], z);
          buf.pos[j + v * 3] += (dx / len) * lane;
          buf.pos[j + v * 3 + 2] += (dz / len) * lane;
          offsets.push((v ? -dx : dx) + (dx / len) * lane, (v ? -dz : dz) + (dz / len) * lane);
          params.push(r.screenWidth || r.width, pixels ?? roadPixels(r.kind), mark);
        }
      }
    };
    if (color) strip(buf, r.points, r.width * 0.65, y, new THREE.Color(color), false, world, 3);
    else {
      strip(buf, r.points, r.width * 1.2, y, new THREE.Color(screenAware ? '#a2b4ac' : ROAD_COLORS.curb), false, world);
      strip(buf, r.points, r.width, y + 0.003, new THREE.Color(ROAD_COLORS.main), false, world, 1);
      const lengths = r.points.slice(1).map((p, i) => Math.hypot(p[0] - r.points[i][0], p[1] - r.points[i][1]));
      const period = Math.max(r.width * 3, lengths.reduce((a, b) => a + b, 0) / 40),
        line = new THREE.Color(ROAD_COLORS.line);
      let along = 0;
      lengths.forEach((len, i) => {
        const a = r.points[i],
          b = r.points[i + 1];
        for (let d = Math.floor(along / period) * period; d < along + len; d += period) {
          const from = Math.max(along, d),
            to = Math.min(along + len, d + period * 0.48);
          if (to <= from || len < 1e-9) continue;
          const at = x => [a[0] + ((b[0] - a[0]) * (x - along)) / len, a[1] + ((b[1] - a[1]) * (x - along)) / len];
          strip(buf, [at(from), at(to)], r.width * 0.065, y + 0.006, line, false, world, 2);
        }
        along += len;
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  if (screenAware) {
    g.setAttribute('roadCenter', new THREE.Float32BufferAttribute(centers, 3));
    g.setAttribute('roadOffset', new THREE.Float32BufferAttribute(offsets, 2));
    g.setAttribute('roadParams', new THREE.Float32BufferAttribute(params, 3));
  }
  g.setAttribute('roadAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(buf.idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(
    g,
    color
      ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
  );
  if (layer) countryLayer(mesh.material, layer);
  if (color && screenAware) {
    mesh.material.depthWrite = false;
    mesh.renderOrder = layer === 'incoming' ? 6 : 5;
  }
  if (screenAware) {
    const viewport = screenRoadMaterial(mesh.material, 800, detailDistance);
    mesh.onBeforeRender = renderer => {
      viewport.value = renderer.domElement.clientHeight || 800;
    };
    mesh.frustumCulled = false;
  }
  if (dashed) {
    const compile = mesh.material.onBeforeCompile;
    mesh.material.onBeforeCompile = (shader, renderer) => {
      compile.call(mesh.material, shader, renderer);
      shader.vertexShader = 'attribute float roadAlong; varying float dashAlong;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\ndashAlong=roadAlong;',
      );
      shader.fragmentShader = 'varying float dashAlong;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(fract(dashAlong/0.65)>0.55) discard;',
      );
    };
    mesh.material.customProgramCacheKey = () => 'country-dashed-highlight-v1';
    mesh.userData.dashed = true;
  }
  mesh.name = name;
  return mesh;
}

export function smoothPath(input, s, { free = false, step = null } = {}) {
  const n = input.length,
    out = [],
    leg = [],
    at = new Array(n).fill(0);
  if (!n) return { pts: out, at, leg };
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const diagonal = (a, b) => Math.abs(b[0] - a[0]) > 0.1 * s && Math.abs(b[1] - a[1]) > 0.1 * s;
  const RADIUS = 0.9 * s,
    STEP = step ?? 0.3 * s,
    push = (p, segment) => {
      out.push(p);
      leg.push(segment);
    };
  const trim = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = input[i - 1],
      v = input[i],
      b = input[i + 1];
    if (!free && (diagonal(a, v) || diagonal(v, b))) continue;
    const l1 = len(a, v),
      l2 = len(v, b);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    if (((v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1])) / (l1 * l2) > 0.985) continue; // nearly straight
    trim[i] = Math.min(RADIUS, 0.5 * l1, 0.5 * l2); // at most half of each neighbour, so corners never overlap
  }
  push(input[0], 0);
  for (let i = 0; i < n - 1; i++) {
    const a = input[i],
      b = input[i + 1],
      l = len(a, b);
    if (l < 1e-9) {
      at[i + 1] = out.length - 1;
      continue;
    }
    if (!free && diagonal(a, b)) {
      const dy = b[1] - a[1],
        steps = Math.max(4, Math.ceil((l * 1.15) / STEP));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps,
          u = 1 - t,
          c1 = u * u * u,
          c2 = 3 * u * u * t,
          c3 = 3 * u * t * t,
          c4 = t * t * t; // cubic with vertical tangents at both ends
        push(
          [
            c1 * a[0] + c2 * a[0] + c3 * b[0] + c4 * b[0],
            c1 * a[1] + c2 * (a[1] + dy / 2) + c3 * (b[1] - dy / 2) + c4 * b[1],
          ],
          i,
        );
      }
      at[i + 1] = out.length - 1;
      continue;
    }
    const tb = trim[i + 1],
      from = out[out.length - 1],
      ux = (b[0] - a[0]) / l,
      uy = (b[1] - a[1]) / l,
      sb = [b[0] - ux * tb, b[1] - uy * tb];
    const straight = len(from, sb),
      steps = Math.ceil(straight / (step ?? 0.35 * s));
    for (let k = 1; k <= steps; k++)
      push([from[0] + ((sb[0] - from[0]) * k) / steps, from[1] + ((sb[1] - from[1]) * k) / steps], i);
    if (tb > 0) {
      // rounded corner: quadratic curve with the corner as its control point
      const c = input[i + 1],
        nx = input[i + 2],
        l2 = len(c, nx),
        e = [c[0] + ((nx[0] - c[0]) / l2) * tb, c[1] + ((nx[1] - c[1]) / l2) * tb],
        m = 8;
      for (let k = 1; k <= m; k++) {
        const t = k / m,
          u = 1 - t;
        push(
          [u * u * sb[0] + 2 * u * t * c[0] + t * t * e[0], u * u * sb[1] + 2 * u * t * c[1] + t * t * e[1]],
          k <= m / 2 ? i : i + 1,
        );
      }
      at[i + 1] = out.length - 1 - m / 2;
    } else at[i + 1] = out.length - 1;
  }
  return { pts: out, at, leg };
}

// Country lane markings are procedural: long corridors cost four vertices, not forty dash quads.
export function countryRoadMesh(lanes, kind, extent = 90, exact = false) {
  const bands = new Map();
  for (const lane of lanes) {
    if (!lane.renderPoints.length) continue;
    const key = exact ? lane.id : lane.corridor;
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push(lane);
  }
  const positions = [],
    uv = [],
    centers = [],
    offsets = [],
    params = [],
    indices = [];
  for (const group of bands.values()) {
    const first = group[0],
      canonical = l => (l.direction === -1 ? [...l.renderPoints].reverse() : l.renderPoints),
      [p, q] = canonical(first),
      len = Math.hypot(q[0] - p[0], q[1] - p[1]),
      normal = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len],
      lo = Math.min(...group.map(l => l.offset - l.width * 0.6)),
      hi = Math.max(...group.map(l => l.offset + l.width * 0.6)),
      shift = (lo + hi) / 2 - first.offset,
      lane = { width: (hi - lo) / 1.2 },
      [a, b] = [p, q].map(v => [v[0] + normal[0] * shift, v[1] + normal[1] * shift]),
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      nx = (-dz / length) * lane.width * 0.6,
      nz = (dx / length) * lane.width * 0.6,
      base = positions.length / 3;
    positions.push(
      a[0] + nx,
      layerHeight(kind, extent),
      a[1] + nz,
      a[0] - nx,
      layerHeight(kind, extent),
      a[1] - nz,
      b[0] + nx,
      layerHeight(kind, extent),
      b[1] + nz,
      b[0] - nx,
      layerHeight(kind, extent),
      b[1] - nz,
    );
    for (const point of [a, b])
      for (const sign of [1, -1]) {
        centers.push(point[0], layerHeight(kind, extent), point[1]);
        offsets.push(nx * sign, nz * sign);
        params.push(lane.width, exact ? 0 : roadPixels(kind), 0);
      }
    uv.push(0.6, 0, -0.6, 0, 0.6, length / lane.width, -0.6, length / lane.width);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('roadCenter', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('roadOffset', new THREE.Float32BufferAttribute(offsets, 2));
  geometry.setAttribute('roadParams', new THREE.Float32BufferAttribute(params, 3));
  geometry.setAttribute('roadUv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: kind === 'trunk' ? ROAD_COLORS.main : kind === 'collector' ? ROAD_COLORS.branch : ROAD_COLORS.loop,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.countryCurb = { value: new THREE.Color(ROAD_COLORS.curb) };
    shader.uniforms.countryLine = { value: new THREE.Color(ROAD_COLORS.line) };
    shader.vertexShader = 'attribute vec2 roadUv;\nvarying vec2 countryRoadUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ncountryRoadUv=roadUv;',
    );
    shader.fragmentShader =
      'varying vec2 countryRoadUv;\nuniform vec3 countryCurb;\nuniform vec3 countryLine;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float across=abs(countryRoadUv.x), pixel=fwidth(countryRoadUv.x);
      diffuseColor.rgb=mix(diffuseColor.rgb,countryCurb,smoothstep(0.5-pixel,0.5+pixel,across));
      float marking=(1.0-smoothstep(0.0325-pixel,0.0325+pixel,across))*step(fract(countryRoadUv.y/3.0),0.48)*step(8.0,roadProjectedPixels);
      diffuseColor.rgb=mix(diffuseColor.rgb,countryLine,marking);
    `,
    );
  };
  countryLayer(material, kind);
  // Pixel-expanded bands can overlap. Paint them in class order without writing
  // coplanar depths back over one another; buildings still occlude the roads.
  material.depthWrite = false;
  const viewport = screenRoadMaterial(material, 800);
  material.customProgramCacheKey = () => 'country-lane-markings-v2';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.onBeforeRender = renderer => {
    viewport.value = renderer.domElement.clientHeight || 800;
  };
  mesh.frustumCulled = false;
  mesh.renderOrder = kind === 'trunk' ? 4 : kind === 'collector' ? 3 : 2;
  mesh.name = 'country-' + kind;
  return mesh;
}

export function countryJunctionMesh(junctions, extent = 90) {
  const positions = [],
    centers = [],
    offsets = [],
    params = [],
    indices = [],
    uv = [];
  for (const j of junctions) {
    const base = positions.length / 3;
    for (const p of [j.point, ...j.polygon]) {
      positions.push(p[0], layerHeight('junction', extent), p[1]);
      centers.push(j.point[0], layerHeight('junction', extent), j.point[1]);
      offsets.push(p[0] - j.point[0], p[1] - j.point[1]);
      params.push(j.radius * 2, roadPixels(j.kind), 0);
      uv.push((p[0] - j.point[0]) / j.radius, (p[1] - j.point[1]) / j.radius, j.kind === 'access' ? 1 : 0);
    }
    j.polygon.forEach((_, k) => indices.push(base, base + k + 1, base + ((k + 1) % j.polygon.length) + 1));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('roadCenter', new THREE.Float32BufferAttribute(centers, 3));
  geometry.setAttribute('roadOffset', new THREE.Float32BufferAttribute(offsets, 2));
  geometry.setAttribute('roadParams', new THREE.Float32BufferAttribute(params, 3));
  geometry.setAttribute('junctionUv', new THREE.Float32BufferAttribute(uv, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = countryLayer(
    new THREE.MeshStandardMaterial({ color: ROAD_COLORS.main, roughness: 0.95, side: THREE.DoubleSide }),
    'junction',
  );
  material.onBeforeCompile = shader => {
    shader.uniforms.countryCurb = { value: new THREE.Color(ROAD_COLORS.curb) };
    shader.vertexShader = 'attribute vec3 junctionUv;\nvarying vec3 countryJunctionUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ncountryJunctionUv=junctionUv;',
    );
    shader.fragmentShader = 'varying vec3 countryJunctionUv;\nuniform vec3 countryCurb;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>

      vec2 q=abs(countryJunctionUv.xy)-vec2(0.8);
      float edge=length(max(q,0.0))+min(max(q.x,q.y),0.0)-0.2;
      diffuseColor.rgb=mix(diffuseColor.rgb,countryCurb,smoothstep(-0.12,-0.04,edge));`,
    );
  };
  const viewport = screenRoadMaterial(material, 800);
  material.customProgramCacheKey = () => 'country-junction-v2';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.onBeforeRender = renderer => {
    viewport.value = renderer.domElement.clientHeight || 800;
  };
  mesh.frustumCulled = false;
  material.depthWrite = false;
  mesh.renderOrder = 1;
  mesh.name = 'country-junctions';
  return mesh;
}
