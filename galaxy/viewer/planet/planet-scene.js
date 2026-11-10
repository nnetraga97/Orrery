// Owns terrain, body materials, region overlays, towns and their transport layers.
import * as THREE from 'three';
import { Asteroids } from '../galaxy/asteroids.js';
import { loadPlanetTerrain } from './planet-build.js';
import { planetBuildBudget } from '../shared/build-budget.js';
import { hydratePlanetTerrain, sampleGround } from './planet-terrain.js';
import { createTownPlan } from '../towns/town-plan.js';
import { createTraffic } from '../traffic/traffic.js';
import { createSpaceportTransport, transportRoutes } from '../traffic/transport.js';
import { createCallRoutes } from '../traffic/call-routes.js';
import { createPortTraffic } from '../traffic/port-traffic.js';
import { planetLandMaterial, planetOceanMaterial } from './planet-appearance.js';
import { planetGroundSample } from '../galaxy/planet-library.js';
import { buildIncrementalTowns } from '../towns/incremental-towns.js';

export async function buildPlanetSurface(ctx, sym, source, model, { previous, publish, bodyKind }) {
  const {
    T,
    host,
    n,
    revision,
    R,
    detail,
    buildAbort,
    loading,
    preparedCache,
    panel,
    ctl,
    appearance,
    appearanceSeed,
    baseCol,
  } = ctx;
  const fileIdx = ctl.fileIdx;
  const { CODE_BODY_R } = ctx;
  if (previous?.towns && source == null) throw new Error('Source is unavailable for this revision');
  await model.ready;
  sym = await model.semanticSource(sym, source, n.path, host.data.nodes);
  if (detail.stopped) return null;
  if (sym) {
    (window.SYMBOLS ||= {})[host.data.dataset()] ||= {};
    window.SYMBOLS[host.data.dataset()][n.path] = sym;
  }
  const regions = model.regionsFor(sym, n.path);
  // Anchors hash persistent town keys, so renaming a method, its class or this file leaves towns where they were.
  const identity = host.memory.townKeys(n.path, regions, source);
  if (model.layout) model.layout.layoutRegions(regions, identity.keyOf, identity.ageOf);
  // Geometry workers/cache only receive geometry inputs, never full source flows.
  const terrainRegions = regions.map(({ id, name, loc, branches, areaMetric, district, neighborhood, layout }) => ({
    id,
    name,
    loc,
    branches,
    areaMetric,
    district,
    neighborhood,
    layout,
  }));
  loading?.update('Preparing terrain…');
  const ground = await planetGroundSample(appearance);
  if (detail.stopped) return null;
  const terrainKey = JSON.stringify(regions.map(r => identity.keyOf(r)));
  const terrain =
    previous?.terrainKey === terrainKey
      ? previous.terrain
      : await loadPlanetTerrain(
          {
            regions: terrainRegions,
            naturalSurface: false,
            R,
            color: baseCol.toArray(),
            seed: appearanceSeed,
            palette: { land: appearance.land, ocean: appearance.ocean, airless: !appearance.atmosphere, ground },
          },
          buildAbort.signal,
        );
  if (detail.stopped) return null;
  const { centerOf, shapeOf, siteOf, radiusOf, regionColor, ownerOfDir, heightAt, surfacePos, triangles, fineOwner } =
    hydratePlanetTerrain(terrain);
  const fineFacesOf = regions.map(() => []);
  for (let f = 0; f < fineOwner.length; f++) fineFacesOf[fineOwner[f]].push(f);
  const geoFine = new THREE.BufferGeometry();
  geoFine.setAttribute('position', new THREE.BufferAttribute(surfacePos, 3));
  geoFine.setAttribute('color', new THREE.BufferAttribute(terrain.colors, 3));
  geoFine.setAttribute('normal', new THREE.BufferAttribute(terrain.normals, 3));
  geoFine.setIndex(new THREE.BufferAttribute(triangles, 1));
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(terrain.borders, 3));
  if (n.callables !== 0)
    T.scene.add(
      new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: '#a7e2b0', transparent: true, opacity: 0.16 })),
    );
  ctx.surface = new THREE.Mesh(geoFine, planetLandMaterial(appearanceSeed));
  ctx.surface.name = 'planet-terrain';
  const seaMaterial = planetOceanMaterial(appearanceSeed, appearance);
  if (ground?.ocean) seaMaterial.color.fromArray(ground.ocean).multiplyScalar(1.4);
  // Light bounced from below takes the planet's own ground colour, not a green default.
  if (ground) T.scene.getObjectByName('planet-fill')?.groundColor.fromArray(ground.land).multiplyScalar(0.6);
  const ocean = new THREE.Mesh(new THREE.SphereGeometry(CODE_BODY_R, 128, 80), seaMaterial);
  ocean.name = 'planet-ocean';
  let groundRadius = d => R + Math.max(0.025, heightAt(d));
  const local = new THREE.Vector3();
  const onGround = (dir, lift) =>
    dir
      .clone()
      .normalize()
      .multiplyScalar(groundRadius(dir) + lift);
  const body = { group: new THREE.Group(), surface: ctx.surface };
  body.group.add(ctx.surface, ocean);
  T.scene.add(body.group);
  // Files without callable regions retain their gas/rock body. Library relief never shapes code islands.
  if (n.callables === 0) {
    body.group.remove(ctx.surface, ocean);
    ctx.surface.geometry.dispose();
    ctx.surface.material.dispose();
    ocean.geometry.dispose();
    ocean.material.dispose();
    const orientation = T.frame().quaternion ?? new THREE.Quaternion();
    if (bodyKind === 'planet') {
      const parts = await T.libraryParts(appearance);
      if (detail.stopped) return null;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(), orientation, new THREE.Vector3().setScalar(R));
      for (const part of parts) {
        const mesh = new THREE.InstancedMesh(part.geometry.clone(), part.material, 1);
        mesh.setMatrixAt(0, matrix);
        mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        body.group.add(mesh);
        if (part.pickable) ctx.surface = mesh;
      }
    } else {
      const profile = Asteroids.profile(n.seed ?? n.path);
      const geometry =
        bodyKind === 'asteroid' ? Asteroids.geometry(profile.variant, 3) : new THREE.OctahedronGeometry(1, 0);
      geometry.setAttribute(
        'aRockSeed',
        new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(profile.seed), 1),
      );
      ctx.surface = new THREE.Mesh(
        geometry,
        bodyKind === 'asteroid' ? Asteroids.material() : new THREE.MeshStandardMaterial({ color: '#d4e4ee' }),
      );
      ctx.surface.scale.setScalar(R);
      ctx.surface.quaternion.copy(orientation);
      body.group.add(ctx.surface);
    }
    body.surface = ctx.surface;
    body.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    groundRadius = d => {
      const normal = d.clone().normalize();
      ray.set(normal.clone().multiplyScalar(R * 2), normal.clone().negate());
      return ray.intersectObject(ctx.surface)[0]?.point.length() ?? R;
    };
  }
  await T.prepareDraw(body.group, planetBuildBudget(buildAbort.signal));
  ctl.ready = !publish;
  const surfacePoint = (dir, k, lift = 0) => {
    const d = dir.clone().normalize();
    return d.multiplyScalar(groundRadius(d) + lift);
  };

  // Region highlight overlay (rebuilt on hover / pin).
  const hlMat = new THREE.MeshBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const pinMat = new THREE.MeshBasicMaterial({
    color: '#7cc4ff',
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const overlay = (k, mat) => {
    const g = new THREE.BufferGeometry(),
      arr = [];
    fineFacesOf[k].forEach(f => {
      for (let q = 0; q < 3; q++) {
        const j = triangles[f * 3 + q];
        arr.push(...onGround(local.fromArray(surfacePos, j * 3), 0.02).toArray());
      }
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const m = new THREE.Mesh(g, mat);
    T.scene.add(m);
    return m;
  };

  // ---- landing pads on public regions ----
  const importerCalls = new Map(); // region -> importer files calling into it
  const names = regions.map(r => new Set(r.members.map(m => m.name)));
  for (const j of host.data.inc()[fileIdx]) {
    const calls = window.SYMBOLS?.[host.data.dataset()]?.[host.data.nodes()[j].path]?.calls || [];
    regions.forEach((r, k) => {
      if (calls.some(c => names[k].has(c))) (importerCalls.get(k) || importerCalls.set(k, []).get(k)).push(j);
    });
  }

  // Type declarations are listed in the inspector; orbiting objects would occlude source detail.
  const moonDecls = (sym?.decls || []).filter(d => ['interface', 'type', 'enum', 'const'].includes(d.kind));

  // ---- debug layer: throw site fissure + uncommitted seam ----
  const lineToPoint = (k, line, lift = 0.05) => {
    // map a source line onto a spine across the region
    const r = regions[k],
      tNorm = r.end > r.start ? (line - r.start) / (r.end - r.start) : 0.5;
    const axis = new THREE.Vector3(0, 1, 0).cross(centerOf[k]).normalize();
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const dir = centerOf[k].clone().applyAxisAngle(axis, (tNorm - 0.5) * radiusOf[k] * 1.4);
    return surfacePoint(dir, k, lift);
  };
  const regionOfLine = line => regions.findIndex(r => r.members.some(m => line >= m.start && line <= m.end));

  // ---- towns on every region, linked by ships ----
  const loadingInfo = panel.querySelector('#planetInfo');
  if (loadingInfo && !loading) loadingInfo.textContent = 'Building towns and transport routes…';
  loading?.update('Placing towns and connecting roads…');
  ctx.towns = source
    ? await buildIncrementalTowns({
        signal: buildAbort.signal,
        terrain,
        T,
        R,
        source,
        file: n.path,
        revision,
        preparedCache,
        previousPrepared: previous?.preparedCache,
        previousTowns: previous?.towns,
        language: sym?.language,
        regions,
        centerOf,
        siteOf,
        shapeOf,
        ownerOfDir,
        groundAt: groundRadius,
        groundMaterial: () => planetLandMaterial(appearanceSeed),
        // Paving and terraces take the planet's own surface colour.
        groundColorAt: d =>
          ground ? sampleGround(ground, d.clone().normalize(), new THREE.Color()) : new THREE.Color(appearance.land),
        regionColor,
        regionOfLine,
      })
    : null;
  if (detail.stopped) {
    ctx.towns?.dispose();
    ctx.towns = null;
    return null;
  }
  if (ctx.towns) {
    ctx.plan = createTownPlan(T, ctx.towns, { R, source, file: n.path, language: sym?.language, regions });
    // Register retained labels after the retired host has released its DOM nodes.
    T.onFrame.push(t => ctx.towns.frame(t));
    // Towns rise out of their regions once the close-up handoff completes.
    let riseStart = null;
    const rising = ctx.towns.group;
    rising.scale.setScalar(previous ? 1 : 0.975);
    T.onFrame.push(() => {
      if (rising.scale.x === 1 || T.opacity < 1) return;
      riseStart ??= performance.now();
      const k = Math.min(1, (performance.now() - riseStart) / 900);
      rising.scale.setScalar(k === 1 ? 1 : 0.975 + 0.025 * k * k * (3 - 2 * k));
    });
  }

  if (ctx.towns) {
    // Route and gate labels jump to what they name: a town on this planet, or a method on another file's planet.
    const navigate = {
      toTown: k => ctx.goToTown?.(k),
      toFile: async (path, method) => {
        const i = host.data.nodes().findIndex(x => x.path === path);
        if (i < 0) return;
        const symbols = (await ctx.loadSymbols?.([path]).catch(() => null)) || window.SYMBOLS?.[host.data.dataset()],
          member = (symbols?.[path]?.decls || []).flatMap(d => d.members || []).find(m => m.name === method);
        host.actions.enterPlanet(i, member ? { line: member.start } : {});
      },
    };
    // Callers in the files that import this one, from their analyzed calls on typed receivers.
    const incoming = [];
    for (const j of host.data.inc()[fileIdx]) {
      const path = host.data.nodes()[j].path,
        decls = window.SYMBOLS?.[host.data.dataset()]?.[path]?.decls || [];
      for (const member of decls.flatMap(d => d.members || []))
        for (const call of member.externalCalls || []) {
          if (call.target !== n.path) continue;
          const k = regions.findIndex(
            r =>
              r.name === call.name &&
              (r.params == null ||
                !Number.isFinite(call.argc) ||
                (r.varargs ? call.argc >= r.params - 1 : call.argc === r.params)),
          );
          if (k >= 0) incoming.push({ k, file: path, caller: member.name });
        }
    }
    ctx.callLayer = await createCallRoutes(
      T,
      ctx.towns,
      regions,
      groundRadius,
      n.path,
      buildAbort.signal,
      navigate,
      incoming,
    );
    ctx.towns.callRoutes = ctx.callLayer.routes;
  }
  const routes = transportRoutes(fileIdx, regions, host.data.nodes(), window.SYMBOLS?.[host.data.dataset()]);
  if (ctx.towns)
    ctx.transport = createSpaceportTransport(T, ctx.towns, status => ctx.inspector?.transportStatus(status));
  if (ctx.towns?.docksOf(0).length) ctx.portTraffic = createPortTraffic(T, ctx.towns, routes);
  // ---- labels: regions facing the camera, moons ----
  const facing = p => () => p.clone().normalize().dot(T.camera.position.clone().sub(p).normalize()) > 0.15;
  if (ctx.towns) ctx.traffic = createTraffic(T, ctx.towns);
  // A planet built while execution is paused starts held, like one that was paused while open.
  if (ctx.traffic && ctx.stackLayer?.rows.length) ctx.traffic.hold(true);
  // Road traffic is automatic; per-town pause controls remain in Method details,
  // so a large town has no duplicate floating title or action blocking its roads.
  return {
    sym,
    source,
    regions,
    identity,
    terrain,
    terrainKey,
    centerOf,
    regionColor,
    regionOfLine,
    ownerOfDir,
    groundRadius,
    surfacePoint,
    body,
    overlay,
    hlMat,
    pinMat,
    importerCalls,
    moonDecls,
    routes,
    loadingInfo,
  };
}
