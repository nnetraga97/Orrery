// Owns paving, terraces, road meshes, and their detail and focus updates.
import * as THREE from 'three';
import { appendRoadGeometry, screenLayer, screenWidthAttributes, setRoadDrawRange } from './town-road-paint.js';
import { screenRoadMaterial } from '../country/country-road-scale.js';
import { townRoadLayers, definitionLinkVisible } from './town-layout.js';
import { STATEMENT_TYPES, statementType } from '../shared/town-flow.js';

export async function buildTownGround(build) {
  const { ctx, towns, group, disposables, checkpoint } = build;
  const { groundColorAt, groundMaterial } = ctx;
  // --- ground: plazas, terraces, roads (merged across all towns) ---
  const groundRanges = [],
    ground = { pos: [], col: [], idx: [] },
    apron = { pos: [], col: [], idx: [] };
  const pushQuadGrid = (target, fr, fn, nx, ny, lift, color) => {
    const base = target.pos.length / 3;
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= ny; j++) {
        const [x, y] = fn(i / nx, j / ny),
          p = fr.world(x, y, lift);
        target.pos.push(p.x, p.y, p.z);
        target.col.push(color.r, color.g, color.b);
      }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const a = base + i * (ny + 1) + j,
          b = a + ny + 1;
        target.idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
  };
  // Local planet surface colour at a town-plane point (terrain palette when unavailable).
  const surface = (tw, x, y) => (groundColorAt ? groundColorAt(tw.fr.world(x, y, 0)) : new THREE.Color('#718b47'));
  for (const tw of towns) {
    await checkpoint();
    const groundStart = ground.idx.length;
    // Pave occupied lots; leave the unused parts of the footprint as landscape.
    tw.out.lots.forEach(l => {
      const half = tw.s * (l.it.kind === 'throw' ? 1.5 : 1.0);
      pushQuadGrid(
        ground,
        tw.fr,
        (a, b) => [l.x + (a * 2 - 1) * half, l.y + (b * 2 - 1) * half],
        2,
        2,
        tw.s * 0.04 + tw.liftAt(l.x, l.y),
        // Paving reads as the planet's ground, with a hint of the statement type.
        surface(tw, l.x, l.y)
          .multiplyScalar(0.9)
          .lerp(new THREE.Color(STATEMENT_TYPES[statementType(l.it)].color).multiplyScalar(0.55), 0.25),
      );
    });
    const P = tw.port,
      rim = 0.12 * tw.s;
    pushQuadGrid(
      apron,
      tw.fr,
      (a, b) => [P.x0 - rim + (P.x1 - P.x0 + 2 * rim) * a, P.y0 - rim + (P.y1 - P.y0 + 2 * rim) * b],
      8,
      6,
      0.014,
      new THREE.Color('#839aa7'),
    );
    pushQuadGrid(
      apron,
      tw.fr,
      (a, b) => [P.x0 + (P.x1 - P.x0) * a, P.y0 + (P.y1 - P.y0) * b],
      8,
      6,
      0.016,
      new THREE.Color('#526370'),
    );
    tw.out.terraces.forEach(t =>
      pushQuadGrid(
        ground,
        tw.fr,
        (a, b) => [t.x0 + (t.x1 - t.x0) * a, t.y0 + (t.y1 - t.y0) * b],
        6,
        6,
        tw.s * 0.033 + t.depth * 0.1 * tw.s,
        surface(tw, (t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2).multiplyScalar(1 - 0.03 * Math.min(3, t.depth)),
      ),
    );
    groundRanges.push({ k: tw.k, mode: 'detail', start: groundStart, end: ground.idx.length });
  }
  const meshFrom = (g, mat) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    if (g.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.setIndex(g.idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    group.add(m);
    disposables.push(geo, mat);
    return m;
  };
  // Lots and terraces are a light tint over the terrain, so the ground under buildings is the
  // planet's own ground. Port aprons are opaque concrete.
  const groundSurface = groundMaterial?.() || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  Object.assign(groundSurface, {
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: ctx.surface?.flat || ctx.surface?.planar ? 0 : -2,
    polygonOffsetUnits: -2,
  });
  const groundMesh = meshFrom(ground, groundSurface);
  meshFrom(
    apron,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: ctx.surface?.flat || ctx.surface?.planar ? 0 : -2,
      polygonOffsetUnits: -2,
    }),
  );

  // A compressed flat town keeps its roads legible with screen-space minimum widths.
  const roadGeo = { pos: [], col: [], idx: [], screen: ctx.screenRoads ? [] : null },
    lineGeo = { pos: [], col: [], idx: [], screen: ctx.screenRoads ? [] : null },
    roadRanges = [],
    roadColors = [];
  for (const tw of towns) {
    const colorStart = lineGeo.col.length,
      surfaceStart = roadGeo.col.length;
    for (const { road, mode } of townRoadLayers(tw)) {
      await checkpoint();
      roadRanges.push(appendRoadGeometry(roadGeo, lineGeo, road, tw, mode));
    }
    const scopes = new Set();
    for (const co of tw.cols) {
      if (scopes.has(co.c.scope)) continue;
      scopes.add(co.c.scope);
      const [x, y] = co.start;
      const start = roadGeo.idx.length;
      pushQuadGrid(
        roadGeo,
        tw.fr,
        (a, b) => [x + (a * 2 - 1) * tw.s, y - (0.8 + b * 1.2) * tw.s],
        1,
        1,
        tw.s * 0.025,
        new THREE.Color(co.c.parentLine != null ? '#77839c' : '#789e94'),
      );
      screenLayer(roadGeo, 0, 1);
      roadRanges.push({
        k: tw.k,
        mode: 'overview',
        start,
        end: roadGeo.idx.length,
        paintStart: lineGeo.idx.length,
        paintEnd: lineGeo.idx.length,
      });
    }
    roadColors.push({
      k: tw.k,
      start: colorStart,
      end: lineGeo.col.length,
      surfaceStart,
      surfaceEnd: roadGeo.col.length,
    });
  }
  const roadSurface = meshFrom(
    roadGeo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      emissive: '#273b3d',
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide,
      polygonOffset: true,
      // Flat lots use constant depth layers; a slope bias can pull roads through buildings.
      polygonOffsetFactor: ctx.surface?.flat || ctx.surface?.planar ? 0 : -6,
      polygonOffsetUnits: -6,
    }),
  );
  const roadMarkings = meshFrom(
    lineGeo,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: ctx.surface?.flat || ctx.surface?.planar ? 0 : -8,
      polygonOffsetUnits: -8,
    }),
  );
  roadSurface.name = 'town-road-surfaces';
  roadMarkings.name = 'town-road-paint';
  if (ctx.screenRoads)
    for (const [mesh, geo] of [
      [roadSurface, roadGeo],
      [roadMarkings, lineGeo],
    ]) {
      screenWidthAttributes(mesh.geometry, geo.screen);
      const viewport = screenRoadMaterial(mesh.material, 800);
      mesh.onBeforeRender = renderer => (viewport.value = renderer.domElement.clientHeight || 800);
    }
  const baseRoadColors = roadMarkings.geometry.attributes.color.array.slice(),
    baseSurfaceColors = roadSurface.geometry.attributes.color.array.slice();
  // Compact prebuilt index ranges only on a LOD transition, never rebuild ribbons in frame().
  const updateRoadLOD = ({ focusedRegion, focusedScope, hoveredRegion, hoveredScope }) => {
    for (const [mesh, base, a, b, ranges] of [
      [roadSurface, roadGeo.idx, 'start', 'end', roadRanges],
      [roadMarkings, lineGeo.idx, 'paintStart', 'paintEnd', roadRanges],
      [groundMesh, ground.idx, 'start', 'end', groundRanges],
    ]) {
      setRoadDrawRange(
        mesh,
        base,
        ranges,
        k => (mesh === groundMesh ? towns[k].expanded : towns[k].roadExpanded),
        a,
        b,
        (k, rd) =>
          ctx.surface?.flat ||
          definitionLinkVisible(rd, {
            scope: k === focusedRegion ? focusedScope : null,
            hovered: k === hoveredRegion ? hoveredScope : null,
          }),
      );
    }
  };
  let roadFocus = -2;

  const setRoadFocus = k => {
    if (roadFocus !== k) {
      const colors = roadMarkings.geometry.attributes.color;
      for (const range of roadColors) {
        const emphasized = ctx.surface?.flat || range.k === k,
          gain = emphasized || k < 0 ? 1 : 0.38;
        const surfaceColors = roadSurface.geometry.attributes.color;
        for (let i = range.surfaceStart; i < range.surfaceEnd; i++)
          surfaceColors.array[i] = baseSurfaceColors[i] * (emphasized ? 1.65 : k < 0 ? 1 : 0.6);
        surfaceColors.needsUpdate = true;
        for (let i = range.start; i < range.end; i++) colors.array[i] = baseRoadColors[i] * gain;
      }
      colors.needsUpdate = true;
      roadFocus = k;
    }
  };
  return { updateRoadLOD, setRoadFocus };
}
