// Paint is geometry, so its width and orientation survive spherical and flat projection.
import * as THREE from 'three';
import { roadStrip, smoothPath, ROAD_COLORS } from './road-ribbon.js';
// Heights use the same town scale as cars and buildings, including tiny decks.
export const ROAD_LIFT = Object.freeze({ curb: 0.015, asphalt: 0.02, paint: 0.022, marking: 0.023, car: 0.024 });
export const ROAD_WIDTH = { main: 0.5, branch: 0.42, loop: 0.42, continuation: 0.38, skip: 0.26, definition: 0.12 };
// Minimum on-screen widths for flat towns opted into screen-aware roads; the curb stays wider than the asphalt.
const CURB_PIXELS = 3,
  SURFACE_PIXELS = 2.2;
// Tag the vertices a strip just appended with [pixels, depth layer]. Only geometry with a `screen` list records it.
export function screenLayer(geo, pixels, mark) {
  if (!geo.screen) return;
  while (geo.screen.length / 2 < geo.pos.length / 3) geo.screen.push(pixels, mark);
}
// Strips are vertex pairs across the road, so each pair gives a centre, a half-width offset and the full width.
export function screenWidthAttributes(geometry, screen) {
  const pos = geometry.attributes.position.array,
    n = pos.length / 3,
    centers = new Float32Array(n * 3),
    offsets = new Float32Array(n * 2),
    params = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 2) {
    const j = Math.min(i + 1, n - 1),
      cx = (pos[i * 3] + pos[j * 3]) / 2,
      cz = (pos[i * 3 + 2] + pos[j * 3 + 2]) / 2,
      width = Math.hypot(pos[i * 3] - pos[j * 3], pos[i * 3 + 2] - pos[j * 3 + 2]);
    for (const v of i === j ? [i] : [i, j]) {
      centers.set([cx, pos[v * 3 + 1], cz], v * 3);
      offsets.set([pos[v * 3] - cx, pos[v * 3 + 2] - cz], v * 2);
      params.set([width, screen[v * 2] ?? 0, screen[v * 2 + 1] ?? 1], v * 3);
    }
  }
  geometry.setAttribute('roadCenter', new THREE.BufferAttribute(centers, 3));
  geometry.setAttribute('roadOffset', new THREE.BufferAttribute(offsets, 2));
  geometry.setAttribute('roadParams', new THREE.BufferAttribute(params, 3));
}
export function paintRoad(target, rd, tw, pts = smoothPath(rd.pts, tw.s).pts) {
  const s = tw.s,
    color = new THREE.Color(rd.terminal === 'throw' ? '#ffc09b' : rd.kind === 'definition' ? '#b3b5de' : '#ecdfad');
  const strip = (p, width, col = color) =>
    roadStrip(target, p, width * s, ROAD_LIFT.marking * s, col, false, tw.fr.world, tw.liftAt);
  roadStrip(
    target,
    pts,
    (rd.kind === 'definition' ? 0.07 : 0.055) * s,
    ROAD_LIFT.paint * s,
    color,
    true,
    tw.fr.world,
    tw.liftAt,
  );
  if (rd.terminal) {
    const p = pts.at(-1);
    strip(
      [
        [p[0] - 0.24 * s, p[1]],
        [p[0] + 0.24 * s, p[1]],
      ],
      0.12,
    );
  }
  if (rd.kind === 'definition' || (!rd.arm && !['loop', 'continuation'].includes(rd.kind))) return;
  const i = rd.kind === 'continuation' ? Math.floor(pts.length / 2) : Math.min(3, pts.length - 1),
    p = pts[i],
    a = pts[Math.max(0, i - 1)],
    dx = p[0] - a[0],
    dy = p[1] - a[1],
    len = Math.hypot(dx, dy) || 1,
    ux = dx / len,
    uy = dy / len;
  const chevron = back => {
    const x = p[0] - ux * back * s,
      y = p[1] - uy * back * s;
    strip(
      [
        [x - ux * 0.22 * s - uy * 0.14 * s, y - uy * 0.22 * s + ux * 0.14 * s],
        [x, y],
        [x - ux * 0.22 * s + uy * 0.14 * s, y - uy * 0.22 * s - ux * 0.14 * s],
      ],
      0.07,
    );
  };
  chevron(0);
  if (rd.kind === 'continuation') chevron(0.28);
}

// Shared by spherical towns and their flat plan scenes, including the LOD ranges.
export function appendRoadGeometry(roadGeo, lineGeo, rd, tw, mode) {
  const start = roadGeo.idx.length,
    paintStart = lineGeo.idx.length,
    pts = smoothPath(rd.pts, tw.s).pts,
    width = ROAD_WIDTH[rd.kind] * tw.s;
  if (rd.kind !== 'definition') {
    roadStrip(
      roadGeo,
      pts,
      width + 0.1 * tw.s,
      ROAD_LIFT.curb * tw.s,
      new THREE.Color('#6d8079'),
      false,
      tw.fr.world,
      tw.liftAt,
    );
    screenLayer(roadGeo, CURB_PIXELS, 0);
    roadStrip(
      roadGeo,
      pts,
      width,
      ROAD_LIFT.asphalt * tw.s,
      new THREE.Color(ROAD_COLORS[rd.kind] || ROAD_COLORS.main),
      false,
      tw.fr.world,
      tw.liftAt,
    );
    screenLayer(roadGeo, SURFACE_PIXELS, 1);
  }
  paintRoad(lineGeo, rd, tw, pts);
  // Paint never widens; layer 3 keeps it above the asphalt without the overview mark fade.
  screenLayer(lineGeo, 0, 3);
  return {
    k: tw.k,
    mode,
    definition: mode === 'definition' ? rd : null,
    start,
    end: roadGeo.idx.length,
    paintStart,
    paintEnd: lineGeo.idx.length,
  };
}
export function setRoadDrawRange(
  mesh,
  base,
  ranges,
  expanded,
  start = 'start',
  end = 'end',
  definitionVisible = () => false,
) {
  const indices = mesh.geometry.index.array;
  let n = 0;
  for (const range of ranges) {
    if (
      range.mode === 'definition'
        ? !definitionVisible(range.k, range.definition)
        : range.mode !== 'always' && (range.mode === 'detail') !== expanded(range.k)
    )
      continue;
    for (let i = range[start]; i < range[end]; i++) indices[n++] = base[i];
  }
  mesh.geometry.index.needsUpdate = true;
  mesh.geometry.setDrawRange(0, n);
}
