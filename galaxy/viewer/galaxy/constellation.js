// Owns constellation assembly, frame ordering, snapshot updates and teardown.
import * as THREE from 'three';
import * as d3 from 'd3';
import { scene3D, size } from '../scene/scene3d.js';
import { dotTex } from '../scene/textures.js';
import { createOrbits } from './constellation-orbits.js';
import { createBodies } from './constellation-bodies.js';
import { createFleet } from './constellation-fleet.js';
import { createNavigation, fitView } from './constellation-navigation.js';
import { createDetail } from './constellation-detail.js';
import { createExecutionShip } from './execution-ship.js';
import { createSelection } from './constellation-selection.js';
import { createFunctionPlanets } from './function-planets.js';

export { loadShipGeometry } from './constellation-fleet.js';

export function constellation(host) {
  const memory = host.memory.layout(host.data.grouping());
  // The scale and the cannon's clearing stay as first chosen, so a growing project does not shrink every body. A
  // project that has grown or shrunk by more than a factor of four in files is laid out afresh.
  const idealUnit = () => Math.max(0.6, Math.min(1, 16 / Math.sqrt(Math.max(1, host.data.nodes().length))) * 1.1);
  if (memory.unit && (idealUnit() / memory.unit > 2 || memory.unit / idealUnit() > 2)) {
    memory.systems = {};
    memory.unit = memory.core = undefined;
  }
  const u = (memory.unit ??= idealUnit());
  const e3 = new THREE.Euler(),
    tmp = new THREE.Vector3(),
    tmp2 = new THREE.Vector3();
  const lod = { detail: null, host: null, i: null, land: null, pending: null }; // the close-up of one body
  // Replaced snapshots and mutable frame/LOD data are shared, never copied by a module.
  const model = {
    N: 0,
    members: [],
    systems: [],
    holes: [],
    orbit: [],
    kinds: { planet: [], asteroid: [], comet: [] },
    pos: [],
    tint: [],
    byPath: new Map(),
    galaxy: { centers: [], arms: [], extent: 0 },
    extent: 50,
    viewPoints: [],
    core: 0,
    ghosts: [], // removed bodies shrinking away: { kind, o, until }
    holeByKey: new Map(),
    fadingHoles: [],
    birthScale: new Map(), // path -> creation-effect scale, independent of a body's own growth
    builtInputs: null,
  };
  const instances = {
    asteroids: null,
    planets: null,
    pickBodies: [],
    meshes: {},
    capacity: { comet: 0 },
    tails: null,
  };
  const frameState = {
    speed: 1,
    traffic: true,
    time: 0,
    journeyFlight: null,
    fleetFrame: 0,
    hoverSel: null,
    last: null,
    shipFollow: null,
    zoomTime: null,
  };

  // The scene outlives every build: renderer, camera, sky, starfield and the agent's cannon stay as files change.
  const T = host.sceneKit
    ? host.sceneKit([0, 120, 160], { space: true })
    : scene3D([0, 120, 160], { space: true }, host);
  const ctx = { host, T, u, memory, model, instances, lod, frame: frameState, scratch: { e3, tmp, tmp2 } };
  ctx.orbits = createOrbits(ctx);
  ctx.bodies = createBodies(ctx);
  T.overview = () => fitView(model.viewPoints, T.camera.aspect);
  ctx.orbits.build();
  {
    const [stageW, stageH] = size(host),
      home = fitView(model.viewPoints, stageW / stageH || 1.6);
    T.camera.position.copy(home.position);
    T.controls.target.copy(home.target);
  }
  ctx.bodies.place(0);

  // Starfield.
  const sg = new THREE.BufferGeometry();
  sg.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      d3.range(4000 * 3).map(() => (Math.random() - 0.5) * 1600),
      3,
    ),
  );
  T.scene.add(
    new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        color: '#9fb4e6',
        size: 1.2,
        map: dotTex,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    ),
  );

  ctx.fleet = createFleet(ctx);

  // ---------- frame loop ----------
  frameState.last = performance.now();
  T.onFrame.push(() => {
    const now = performance.now();
    frameState.time += ((now - frameState.last) / 1000) * frameState.speed;
    frameState.last = now;
    for (const h of [...model.holes, ...model.fadingHoles]) h.dm.uniforms.uTime.value = frameState.time;
    ctx.bodies.place(frameState.time);
    ctx.functions?.update(frameState.time);
    ctx.navigation.updateCruise(now);
    ctx.fleet.flyShips(frameState.time);
    ctx.fleet.drawRouteLines();
  });
  ctx.navigation = createNavigation(ctx);
  ctx.selection = createSelection(ctx);
  ctx.detail = createDetail(ctx);
  ctx.functions = createFunctionPlanets(ctx);
  T.functionPlanets = () => ctx.functions.shown();
  T.functionPlanetCount = () => ctx.functions.count();
  ctx.bodies.installAPI();
  ctx.executionShip = createExecutionShip(ctx);

  // A new snapshot of the same project: rebuild the content in place, easing from where everything is now. `refresh`
  // holds the paths whose text or symbols changed. An open close-up stays open unless its file changed or moved
  // index; then it is rebuilt where the camera already is, and closed if its file is gone.
  T.update = ({ refresh = new Set() } = {}) => {
    const landedPath = lod.detail ? lod.path : null,
      landedSeed = lod.detail ? lod.seed : null;
    frameState.journeyFlight = null; // a flight's ends are indices into the previous snapshot
    frameState.hoverSel = null;
    if (model.builtInputs !== ctx.orbits.layoutInputs()) {
      ctx.orbits.build();
      ctx.fleet.ambient = ctx.fleet.currentAmbient();
      ctx.selection.describeTraffic();
      ctx.selection.labelGalaxy();
      ctx.functions.refocus();
    } else {
      // prepare() supplies fresh node records even when their layout is unchanged.
      // Rebind inspector members and preserve their established body kinds.
      model.members = model.members.map(list => list.map(n => host.data.nodes()[n.i]));
      for (const system of model.systems)
        for (const body of system.bodies) {
          body.n = host.data.nodes()[body.n.i];
          body.n.kind = body.kind;
        }
    }
    if (landedPath != null) {
      // The landed file is found by identity, so renaming it keeps the close-up open.
      const i = host.data.nodes().find(n => n.seed === landedSeed)?.i;
      if (i == null) ctx.detail.closeDetail();
      else if (i !== lod.i || host.data.nodes()[i].path !== landedPath || refresh.has(landedPath)) {
        if (lod.detail.inspection) ctx.detail.refreshDetail(i);
        else {
          ctx.detail.closeDetail();
          ctx.detail.openDetail(i);
        }
      }
    }
  };

  const stop = T.stop;
  T.stop = () => {
    T.stopped = true;
    ctx.detail.closeDetail();
    instances.planets.dispose();
    instances.stars?.dispose();
    ctx.functions.dispose();
    instances.asteroids.dispose();
    ctx.fleet.dispose();
    ctx.executionShip.dispose();
    stop();
  };
  return T;
}
