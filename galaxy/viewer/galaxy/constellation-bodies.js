// Owns body instance batches, placement, ghost drawing and the body inspection API.
import * as THREE from 'three';
import { dummy, instanced } from '../scene/scene3d.js';
import { Asteroids } from './asteroids.js';
import { PlanetBodies } from './planet-library.js';
import { StarBodies } from './star-bodies.js';
import { clock, ease, current, orbitPoint, orientationOf } from './constellation-orbits.js';

export function createBodies(ctx) {
  const { host, T, u, model, instances, lod } = ctx;
  const { tmp, tmp2 } = ctx.scratch;
  // Instanced bodies: buffers grow (and are replaced) when a kind outgrows them; slots are reassigned every build.
  function ensureCapacity(kind, needed) {
    if (instances.meshes[kind] && instances.capacity[kind] >= needed) return;
    const old = instances.meshes[kind];
    instances.capacity[kind] = Math.max(16, Math.ceil(needed * 1.5));
    instances.meshes[kind] = instanced(instances.capacity[kind], new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial());
    instances.meshes[kind].count = 0;
    T.scene.add(instances.meshes[kind]);
    if (old) {
      T.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
      old.dispose();
    }
    if (kind === 'comet') {
      if (instances.tails) {
        T.scene.remove(instances.tails);
        instances.tails.geometry.dispose();
        instances.tails.material.dispose();
        instances.tails.dispose();
      }
      instances.tails = instanced(
        instances.capacity.comet,
        new THREE.ConeGeometry(0.5, 1, 6, 1, true),
        new THREE.MeshBasicMaterial({
          color: '#bfe6ff',
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      instances.tails.count = 0;
      T.scene.add(instances.tails);
    }
  }

  function rebuild(now) {
    // Each planet asset has its own instance batch; files retain stable appearances.
    ensureCapacity('comet', model.kinds.comet.length + 8);
    instances.meshes.comet.userData.fileIds = model.kinds.comet;
    if (instances.asteroids) {
      instances.asteroids.meshes.forEach(mesh => T.scene.remove(mesh));
      instances.asteroids.dispose();
    }
    instances.asteroids = Asteroids.create(model.kinds.asteroid.map(i => host.data.nodes()[i]));
    instances.asteroids.meshes.forEach(mesh => T.scene.add(mesh));
    if (!instances.planets) instances.planets = new PlanetBodies(T.scene, syncPickBodies);
    // With a function index, files with planets are stars (star-bodies.js). The planet library still loads each
    // file's look, for the landed globe of one of its functions, but draws nothing in the galaxy.
    instances.starMode = host.data.nodes().some(n => n.star != null);
    if (instances.starMode) {
      if (!instances.stars) instances.stars = new StarBodies(T.scene);
      instances.stars.rebuild(model.kinds.planet);
      instances.planets.rebuild([]);
      syncPickBodies();
      return;
    }
    instances.stars?.rebuild([]);
    const livePlanets = model.kinds.planet.map(i => ({
      path: host.data.nodes()[i].path,
      entry: host.memory.fileAppearance(host.data.nodes()[i].path, host.data.nodes()[i].callables),
      fileId: i,
      ghost: false,
    }));
    const livePaths = new Set(livePlanets.map(n => n.path));
    const retired = new Map(
      model.ghosts
        .filter(g => g.until > now && g.o.kind === 'planet' && !livePaths.has(g.o.path))
        .map(g => [g.o.path, { path: g.o.path, fileId: null, ghost: true }]),
    );
    instances.planets.rebuild([...livePlanets, ...retired.values()]);
  }

  function syncPickBodies() {
    instances.pickBodies.length = 0;
    instances.pickBodies.push(...instances.planets.meshes.filter(m => m.userData.pickablePlanet), instances.meshes.comet, ...instances.asteroids.meshes);
    if (instances.starMode && instances.stars?.mesh) instances.pickBodies.push(instances.stars.mesh);
  }

  const baseColor = i => {
    const c = new THREE.Color(host.graph.color(host.graph.groupOf(host.data.nodes()[i])));
    if (model.orbit[i].kind === 'asteroid') return c.lerp(new THREE.Color('#b1a69a'), 0.9); // mineral rock, faint group tint
    if (model.orbit[i].kind === 'comet') return c.lerp(new THREE.Color('#ffffff'), 0.7); // icy white core
    return c;
  };
  function paintBodies() {
    const dark = new THREE.Color('#070b14'),
      warm = new THREE.Color('#fff1dc'),
      grey = new THREE.Color('#9aa3ad');
    host.data.nodes().forEach(n => {
      const o = model.orbit[n.i],
        c = baseColor(n.i).lerp(dark, 1 - model.tint[n.i]);
      if (o.kind === 'planet' && instances.starMode) {
        // A star: its folder's colour warmed toward white; a test file's star is dimmer and greyer.
        const s = baseColor(n.i).lerp(warm, 0.15);
        if (n.star === 'test') s.lerp(grey, 0.5).multiplyScalar(0.6);
        instances.stars.color(n.i, s.lerp(dark, 1 - model.tint[n.i]));
      } else if (o.kind === 'planet') instances.planets.color(n.path, model.tint[n.i]);
      else if (o.kind === 'asteroid') instances.asteroids.color(n.i, c);
      else instances.meshes[o.kind].setColorAt(o.slot, c);
    });
    Object.values(instances.meshes).forEach(m => {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  // Positions are recomputed every frame (Kepler orbits around each hole).
  const up = new THREE.Vector3(0, 1, 0);
  function placeOne(o, at, scale, t, slotOf) {
    dummy.position.copy(at);
    // A planet keeps one orientation, its own, so its face is recognisable and its close-up lines up with it.
    if (o.kind === 'planet') dummy.quaternion.copy(orientationOf(o));
    else dummy.rotation.set(t * 0.3 + o.spin, t * 0.2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    const slot = slotOf;
    if (o.kind === 'planet' && instances.starMode) {
      const i = model.byPath.get(o.path);
      if (i != null) instances.stars.place(i, dummy.matrix);
    } else if (o.kind === 'planet')
      instances.planets.place(
        o.path,
        dummy.matrix,
        lod.path === o.path && lod.host?.opacity > 0 && host.data.nodes()[lod.i]?.callables !== 0,
      );
    else instances.meshes[o.kind].setMatrixAt(slot, dummy.matrix);
    if (o.kind === 'comet') {
      // tail points away from the black hole
      tmp2.copy(at).sub(o.hole.center).normalize();
      const len = scale * 11;
      dummy.position.copy(at).addScaledVector(tmp2, len * 0.5);
      dummy.quaternion.setFromUnitVectors(up, tmp2.clone().negate());
      dummy.scale.set(scale * 1.6, len, scale * 1.6);
      dummy.updateMatrix();
      instances.tails.setMatrixAt(slot, dummy.matrix);
    }
  }
  function place(t) {
    const now = clock();
    ctx.orbits.stepHoles(now);
    instances.planets.begin(T.camera, T.controls.domElement.clientHeight);
    instances.asteroids.begin(T.camera, T.controls.domElement.clientHeight, T.pinned);
    host.data.nodes().forEach(n => {
      const o = model.orbit[n.i],
        c = current(o, now);
      orbitPoint(o, t, now, tmp);
      model.pos[n.i].copy(tmp);
      const grow = (o.born == null ? 1 : ease((now - o.born) / 0.8)) * (model.birthScale.get(n.path) ?? 1);
      // A star stays while one of its function planets is landed; a file planet gives way to its own close-up.
      const hidden = lod.i === n.i && lod.host?.opacity >= 1 - 1e-6 && !instances.starMode;
      // Omit all library parts (including atmosphere/clouds), rather than leaving
      // a scaled instance in a shared batch while the landed body owns the depth.
      if (hidden && o.kind === 'planet' && !instances.starMode) return;
      if (o.kind === 'asteroid') {
        const p = instances.asteroids.profiles.get(n.i);
        dummy.position.copy(tmp);
        dummy.rotation.set(p.rotation[0] + t * p.spin[0], p.rotation[1] + t * p.spin[1], p.rotation[2] + t * p.spin[2]);
        dummy.scale.set(p.scale[0] * c.size, p.scale[1] * c.size, p.scale[2] * c.size).multiplyScalar(grow);
        if (hidden) dummy.scale.setScalar(1e-6);
        dummy.updateMatrix();
        instances.asteroids.place(n.i, dummy.matrix, tmp, c.size);
      } else placeOne(o, tmp, hidden ? 1e-6 : c.size * grow, t, o.slot);
    });
    // Removed bodies shrink away after the live ones, in the spare slots past them.
    const extra = { comet: model.kinds.comet.length };
    const ghostCount = model.ghosts.length;
    model.ghosts = model.ghosts.filter(gh => gh.until > now);
    if (model.ghosts.length !== ghostCount) instances.planets.pruneGhosts(new Set(model.ghosts.map(gh => gh.o.path)));
    for (const gh of model.ghosts) {
      if (gh.o.kind === 'asteroid' || (gh.o.kind === 'planet' && instances.starMode)) continue;
      if (gh.o.kind === 'comet' && extra.comet >= instances.capacity.comet) continue;
      placeOne(
        gh.o,
        gh.o.frozenAt,
        gh.o.size * ease((gh.until - now) / 0.6),
        t,
        gh.o.kind === 'planet' ? 0 : extra.comet++,
      );
    }
    instances.planets.end(t);
    if (instances.starMode) instances.stars.end(t);
    instances.meshes.comet.count = instances.tails.count = extra.comet;
    Object.values(instances.meshes).forEach(m => {
      m.instanceMatrix.needsUpdate = true;
    });
    instances.tails.instanceMatrix.needsUpdate = true;
    instances.asteroids.end();
  }

  function installAPI() {
    // For the agent cannon: where files are, how big they are, and the open close-up (if any).
    Object.assign(T, {
      unit: u,
      get coreRadius() {
        return model.core;
      },
      get galaxyExtent() {
        return model.extent;
      },
      fileIndex: path => model.byPath.get(path) ?? null,
      bodyPos: i => model.pos[i],
      bodySize: i => model.orbit[i].size,
      bodyKind: i => model.orbit[i].kind,
      bodyState: path => {
        const i = model.byPath.get(path);
        return i == null
          ? null
          : {
              path: model.orbit[i].path,
              kind: model.orbit[i].kind,
              system: model.systems[model.orbit[i].gi].key,
              ring: model.orbit[i].ring ?? null,
              orbitRadius: model.orbit[i].a,
              birthScale: model.birthScale.get(path) ?? 1,
              position: model.pos[i].toArray(),
            };
      },
      setBodyBirth: (i, scale) => {
        const path = model.orbit[i]?.path;
        if (path == null) return;
        if (scale >= 1) model.birthScale.delete(path);
        else model.birthScale.set(path, Math.max(0.001, scale));
      },
      asteroidStats: () => instances.asteroids.stats(),
      planetStats: () => instances.planets.stats(),
      // A library asset's loaded parts, for a landed close-up drawn with the same materials (planet.js).
      libraryParts: entry => instances.planets.landing(entry, T.prepareTexture),
      highDetail: entry => instances.planets.highSurface === instances.planets.resources.get(entry.id)?.find(p => p.pickable),
      setHighDetail: (entry, enabled, signal) => instances.planets.setHighDetail(entry, enabled, signal, T.prepareTexture),
      bodyAppearance: i => host.memory.fileAppearance(host.data.nodes()[i].path, host.data.nodes()[i].callables),
      // For checks: each system's drawn centre and size, by group.
      layoutState: () => ({
        systems: Object.fromEntries(model.holes.map(h => [h.g, { at: [h.center.x, h.center.z], scale: h.scale }])),
        fading: model.fadingHoles.length,
        ghosts: model.ghosts.length,
      }),
      landedDetail: () => (lod.detail && lod.host?.opacity > 0.5 ? lod.detail : null),
      // For checks: the landed body's own scene (towns, surface).
      landedScene: () => lod.host?.scene ?? null,
    });
    // A live getter: Object.assign would copy the value once (always null) instead of the getter.
    Object.defineProperty(T, 'landedIndex', { get: () => lod.i, configurable: true });
  }

  return { rebuild, paintBodies, place, installAPI };
}
