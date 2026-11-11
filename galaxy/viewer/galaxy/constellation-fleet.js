// Owns dependency convoys, ship instances and rigs, route lines and fleet disposal.
import * as THREE from 'three';
import * as d3 from 'd3';
import { planetBuildBudget } from '../shared/build-budget.js';
import { dummy } from '../scene/scene3d.js';
import { PLANET_R } from '../planet/planet.js';
import { RiggedAssets, ShipScale } from '../scene/rigged-assets.js';
import { dotTex } from '../scene/textures.js';
import { keyHash } from './constellation-orbits.js';

// How many ship hulls are drawn at once; a host may lower it (the XR app does, for a headset's budget).
export const FleetLimits = { visible: 900 };

// ---------- shared assets ----------
let shipGeometryPromise = null;
export function loadShipGeometry() {
  if (!shipGeometryPromise)
    shipGeometryPromise = new Promise(ok => {
      RiggedAssets.proxy('cargo').then(
        model => ok(model.geo),
        () => ok(null),
      );
    }).then(geo => {
      if (geo) return geo;
      // Fallback if the GLB is missing: a simple dart.
      const g = new THREE.ConeGeometry(0.35, 1.8, 5);
      g.rotateX(Math.PI / 2);
      return g;
    });
  return shipGeometryPromise;
}

export function createFleet(ctx) {
  const { host, T, u, model, lod, frame: frameState } = ctx;
  const { tmp, tmp2 } = ctx.scratch;
  // ---------- ships ----------
  const MAX_SHIPS = 900;
  const ships = {
    batches: [],
    heroes: new Map(),
    pending: new Set(),
    failed: new Set(),
    glow: null,
    routes: [],
    glowPos: new Float32Array(MAX_SHIPS * 3),
    glowCol: new Float32Array(MAX_SHIPS * 3),
  };
  const ROUTE_COL = { ambient: '#8791a8', out: '#ffc93c', in: '#39b8ff', probe: '#ff3b3b' };
  const ENGINE_COL = { ambient: '#7bc9e8', out: '#ffd66b', in: '#7fd6ff', probe: '#ff5a4a' };
  const hullColors = Object.fromEntries(
    Object.entries(ROUTE_COL).map(([kind, color]) => [
      kind,
      new THREE.Color('#ffffff').lerp(new THREE.Color(color), 0.2),
    ]),
  );
  const engineColors = Object.fromEntries(
    Object.entries(ENGINE_COL).map(([kind, color]) => [kind, new THREE.Color(color)]),
  );
  const routeSpan = r => ShipScale.routeSpan([model.orbit[r.a]?.size, model.orbit[r.b]?.size], r.kind, u);
  const routeLines = new THREE.Group();
  routeLines.name = 'dependency-route-lines';
  T.scene.add(routeLines);
  function curveFor(a, b, lift = 0.22, reuse) {
    const A = typeof a === 'number' ? model.pos[a] : a,
      B = typeof b === 'number' ? model.pos[b] : b;
    const mid = tmp.copy(A).add(B).multiplyScalar(0.5);
    mid.y += Math.min(1.5 * u + A.distanceTo(B) * lift, 40);
    // Meet the visible surface along each end's tangent, rather than vanishing at
    // a body's centre. The close-up uses the actual town pad at its own scale.
    const curve = reuse || new THREE.QuadraticBezierCurve3();
    curve.v0.copy(A);
    curve.v1.copy(mid);
    curve.v2.copy(B);
    if (typeof a === 'number')
      curve.v0.add(
        tmp2
          .copy(mid)
          .sub(A)
          .normalize()
          .multiplyScalar(model.orbit[a].size * 1.08),
      );
    if (typeof b === 'number')
      curve.v2.add(
        tmp2
          .copy(mid)
          .sub(B)
          .normalize()
          .multiplyScalar(model.orbit[b].size * 1.08),
      );
    return curve;
  }
  // This fleet illustrates static dependencies, never observed calls. Known type-only/re-export
  // lanes carry no ships. Unclassified graph edges remain visible as unweighted dependencies:
  // a partial symbol index (for example CommonJS) must not erase the workspace's graph.
  const BACKGROUND_SHIPS = 520;
  // Lanes are keyed by the two files' paths, so a convoy keeps its place along a lane from one build to the next.
  const laneKey = (a, b) => host.data.nodes()[a].path + '>' + host.data.nodes()[b].path;
  const convoy = (a, b, n, kind, speed) => {
    const key = laneKey(a, b),
      lane = { curve: new THREE.QuadraticBezierCurve3(), frame: -1, key, seed: keyHash(key) };
    return d3.range(n).map(q => ({
      a,
      b,
      kind,
      lane,
      phase: (lane.seed + q / n) % 1,
      speed,
      model:
        kind === 'ambient'
          ? keyHash(lane.key + '#' + q) < 0.2
            ? 'arc'
            : keyHash(lane.key + '#' + q) < 0.32
              ? 'arrow'
              : 'cargo'
          : null,
    }));
  };
  function buildAmbient(indexed) {
    const lanes = host.data.links()
      .map(l => ({ l, use: indexed ? host.graph.importUse(l.s, l.t) : null }))
      .filter(x => x.use?.kind !== 'type' && x.use?.kind !== 'reexport')
      .sort((a, b) => (b.use?.refs || 0) - (a.use?.refs || 0));
    const count = Math.min(BACKGROUND_SHIPS, lanes.length * 3);
    // Cover the graph before adding convoys. Large graphs mix busy lanes with a distributed
    // sample so the entire budget does not disappear into one high-degree hub.
    const busy = Math.min(lanes.length, Math.ceil(count * 0.65));
    const shown = lanes.slice(0, busy),
      rest = lanes.slice(busy),
      room = Math.min(count - busy, rest.length);
    for (let i = 0; i < room; i++) shown.push(rest[Math.floor((i * rest.length) / room)]);
    const loads = shown.map(x => ({ ...x, n: 1 }));
    let allocated = loads.length;
    // Additional passes favor higher reference ranks while capping each lane's convoy.
    for (let round = 0; allocated < count && round < 5; round++) {
      for (const lane of loads) {
        if (allocated >= count) break;
        lane.n++;
        allocated++;
      }
    }
    return {
      weighted: indexed,
      routes: loads.flatMap(({ l, n }) =>
        convoy(l.s, l.t, n, 'ambient', 0.065 + keyHash(laneKey(l.s, l.t) + '#v') * 0.03),
      ),
      shown: loads.length,
      eligible: lanes.length,
      value: lanes.filter(x => x.use?.kind === 'runtime').length,
      unclassified: lanes.filter(x => !x.use || x.use.kind === 'unknown').length,
      typeOnly: indexed ? host.data.links().filter(l => host.graph.importUse(l.s, l.t)?.kind === 'type').length : 0,
    };
  }
  // Weighted by how each import is used when the dataset classifies its imports; an even sample otherwise.
  const currentAmbient = () => buildAmbient(host.graph.importsIndexed());
  let ambient = currentAmbient();
  let focusRoutes = [],
    focusLanes = [];
  Promise.allSettled(['cargo', 'arc', 'arrow'].map(key => RiggedAssets.proxy(key))).then(async results => {
    const fallback = results.some(r => r.status === 'rejected') ? await loadShipGeometry() : null;
    if (T.stopped) return;
    ['cargo', 'arc', 'arrow'].forEach((key, index) => {
      const model = results[index].status === 'fulfilled' ? results[index].value : { geo: fallback };
      model.geo.computeBoundingBox();
      const bounds = model.geo.boundingBox.getSize(new THREE.Vector3());
      const material = new THREE.MeshStandardMaterial({
        vertexColors: !!model.geo.attributes.color,
        transparent: true,
        roughness: 0.65,
        metalness: 0.15,
        emissive: '#111b24',
      });
      const mesh = new THREE.InstancedMesh(model.geo, material, MAX_SHIPS);
      mesh.name = key === 'cargo' ? 'dependency-ships' : 'dependency-ships-' + key;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      const batch = { key, mesh, span: model.span || Math.max(bounds.x, bounds.y, bounds.z), slots: [] };
      mesh.userData.fleetBatch = batch;
      ships.batches.push(batch);
      T.scene.add(mesh);
    });
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(ships.glowPos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(ships.glowCol, 3));
    // Keep the existing engine cue readable at overview distance without inflating the hull.
    ships.glow = new THREE.Points(
      gg,
      new THREE.PointsMaterial({
        size: 2.2,
        sizeAttenuation: false,
        map: dotTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    // The small engine glint is also a 4px pointer target. Hit tolerance follows
    // the screen, not hull size; zooming out never makes a physically larger ship.
    const enginePoint = new THREE.Vector3(),
      engineDelta = new THREE.Vector3();
    ships.glow.raycast = (raycaster, hits) => {
      const perPixel = (2 * Math.tan((T.camera.fov * Math.PI) / 360)) / Math.max(1, T.controls.domElement.clientHeight);
      for (let i = 0; i < ships.routes.length; i++) {
        enginePoint.fromArray(ships.glowPos, i * 3);
        const distance = engineDelta.subVectors(enginePoint, raycaster.ray.origin).dot(raycaster.ray.direction);
        if (distance < Math.max(T.camera.near, raycaster.near) || distance > raycaster.far) continue;
        if (raycaster.ray.distanceSqToPoint(enginePoint) <= (distance * perPixel * 4) ** 2)
          hits.push({ distance, point: enginePoint.clone(), index: i, object: ships.glow });
      }
    };
    T.scene.add(ships.glow);
  });
  function requestHero(key) {
    if (ships.heroes.has(key) || ships.pending.has(key) || ships.failed.has(key)) return;
    ships.pending.add(key);
    RiggedAssets.create(key)
      .then(async rig => {
        if (T.stopped) {
          rig.dispose();
          return;
        }
        try {
          await T.prepareDraw(rig.root, T.camera, T.scene, planetBuildBudget());
        } catch (error) {
          rig.dispose();
          throw error;
        }
        if (T.stopped) {
          rig.dispose();
          return;
        }
        rig.root.visible = false;
        T.scene.add(rig.root);
        ships.heroes.set(key, rig);
      })
      .catch(error => {
        ships.failed.add(key);
        console.warn('Close-up ship unavailable', key, error);
      })
      .finally(() => ships.pending.delete(key));
  }
  T.fleetStats = () => ({
    instances: ships.batches.reduce((n, b) => n + b.mesh.count, 0),
    budget: MAX_SHIPS,
    ambient: {
      ships: ambient.routes.length,
      lanes: ambient.shown,
      eligible: ambient.eligible,
      value: ambient.value,
      unclassified: ambient.unclassified,
    },
    batches: ships.batches.map(b => ({
      key: b.key,
      count: b.mesh.count,
      triangles: (b.mesh.geometry.index?.count || b.mesh.geometry.attributes.position.count) / 3,
    })),
    rigs: [...ships.heroes].filter(([, r]) => r.root.visible).map(([key]) => key),
  });
  const shipAt = new THREE.Vector3(),
    shipAhead = new THREE.Vector3();
  // Radius, in planet radii, where fleet ships and town-port traffic meet.
  const HANDOFF = 3,
    BOOKING = 8;
  function flyShips(t) {
    const visibility = 1 - (lod.host?.opacity || 0);
    routeLines.children.forEach(line => {
      line.userData.baseOpacity ??= line.material.opacity;
      line.material.opacity = line.userData.baseOpacity * visibility;
    });
    routeLines.visible = visibility > 0.001;
    if (!ships.glow) return;
    // The fleet stays in flight while a planet is open. Its own lanes hand ships to the
    // town ports at the planet's edge instead of flying through the surface.
    ships.glow.material.opacity = 1;
    ships.batches.forEach(b => {
      b.mesh.material.opacity = 1;
      b.mesh.visible = true;
      b.mesh.count = 0;
      b.slots.length = 0;
    });
    ships.heroes.forEach(rig => {
      rig.root.visible = false;
    });
    ships.glow.visible = true;
    ships.routes.length = 0;
    const port = (lod.host?.opacity || 0) > 0.5 ? lod.detail?.portTraffic : null,
      landed = port ? lod.i : null;
    if (port && !port.exitLanes) {
      port.exitLanes = true;
      // Departures leave along one of this planet's outgoing lanes.
      port.setExit(() => {
        const out = ambient.routes.filter(r => r.a === lod.i);
        if (!out.length) return null;
        const r = out[Math.floor(Math.random() * out.length)],
          toward = curveFor(r.a, r.b).getPoint(0.2).sub(model.pos[lod.i]).normalize();
        return toward.multiplyScalar(PLANET_R * 1.01 * HANDOFF);
      });
    }
    // Prioritize the followed ship and selected lanes, then use the remaining budget
    // for the background fleet. Selecting a file no longer empties the rest of the galaxy.
    const list = [
      ...(frameState.journeyFlight ? [frameState.journeyFlight.route] : []),
      ...(frameState.traffic ? [...(!frameState.journeyFlight ? focusRoutes : []), ...ambient.routes] : []),
    ];
    frameState.fleetFrame++;
    // A hull under ~1.5 px is all engine glint: skip its instance (about 25k triangles) and
    // keep the glint, which is also the ship's pointer target.
    const shipPx = T.controls.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(T.camera.fov) / 2));
    let k = 0;
    for (const r of list) {
      if (k >= Math.min(MAX_SHIPS, FleetLimits.visible)) break;
      const p = r.progress != null ? r.progress : (t * r.speed + r.phase) % 1;
      if (p < 0 || p > 1) continue;
      if (r.lane && r.lane.frame !== frameState.fleetFrame) {
        curveFor(r.a, r.b, 0.22, r.lane.curve);
        r.lane.frame = frameState.fleetFrame;
      }
      const curve = r.curve ? r.curve() : r.lane?.curve || curveFor(r.a, r.b);
      const at = curve.getPoint(p, shipAt),
        ahead = curve.getPoint(Math.min(1, p + 0.01), shipAhead);
      if (landed != null && r !== frameState.journeyFlight?.route && (r.a === landed || r.b === landed)) {
        const distance = at.distanceTo(model.pos[landed]),
          size = model.orbit[landed].size,
          trip = r.progress != null ? 0 : Math.floor(t * r.speed + r.phase);
        // Leaving ships are represented by port departures until they clear the planet.
        if (r.a === landed && distance < size * HANDOFF) continue;
        if (r.b === landed && distance < size * BOOKING) {
          // Arriving: book a bay while far out; ships without one leave the stream there.
          if (r.bookedTrip !== trip) {
            r.bookedTrip = trip;
            r.booking = port.book();
          }
          if (!r.booking) continue;
          if (distance < size * HANDOFF) {
            // Hand the trip to the town port from where the ship actually is.
            const local = at
              .clone()
              .sub(model.pos[landed])
              .setLength(PLANET_R * 1.01 * HANDOFF);
            port.arrive(local, { path: host.data.nodes()[r.a].path, kind: 'import', canFly: true }, r.booking);
            r.booking = null;
            continue;
          }
        }
      }
      if (at.distanceToSquared(ahead) < 1e-8) ahead.copy(curve.getPoint(1)).add(tmp2.set(0, 0, 0.001));
      const key = r.model || (r.kind === 'probe' ? 'arrow' : r.kind === 'ambient' ? 'cargo' : 'arc');
      let span = routeSpan(r);
      // Over a landed planet, hulls shrink toward the town ports' scale, so a ship never dwarfs a settlement.
      if (landed != null) {
        const near = (at.distanceTo(model.pos[landed]) - model.orbit[landed].size) / (model.orbit[landed].size * 3);
        if (near < 1) span *= THREE.MathUtils.lerp(0.02, 1, THREE.MathUtils.smoothstep(Math.max(0, near), 0, 1));
      }
      const batch = ships.batches.find(b => b.key === key);
      dummy.position.copy(at);
      dummy.scale.setScalar(span / batch.span);
      dummy.lookAt(ahead);
      dummy.updateMatrix();
      const close =
        (r === frameState.journeyFlight?.route || (r.kind === 'probe' && T.camera.position.distanceTo(at) < 20 * u)) &&
        visibility > 0.5;
      if (close) requestHero(key);
      const hero = close && ships.heroes.get(key);
      if (hero) {
        hero.root.position.copy(at);
        hero.root.quaternion.copy(dummy.quaternion);
        hero.root.scale.setScalar(span / hero.span);
        hero.root.visible = true;
        hero.root.userData.route = r;
        // Sample from the route clock: pausing/scrubbing never starts an independent animation timer.
        hero.sample(
          key === 'arrow' ? 'Air brake' : key === 'cargo' ? 'Hover' : 'Thrust vectoring',
          r.progress == null ? t : r.progress * 5,
          r.progress == null,
        );
      } else if ((span * shipPx) / Math.max(1e-6, T.camera.position.distanceTo(at)) >= 1.5) {
        const slot = batch.mesh.count++;
        batch.mesh.setMatrixAt(slot, dummy.matrix);
        batch.slots[slot] = r;
        batch.mesh.setColorAt(slot, hullColors[r.kind]);
      }
      tmp2
        .copy(at)
        .sub(ahead)
        .normalize()
        .multiplyScalar(span * 0.45)
        .add(at);
      ships.glowPos.set([tmp2.x, tmp2.y, tmp2.z], k * 3);
      const gc = engineColors[r.kind];
      ships.glowCol.set([gc.r, gc.g, gc.b], k * 3);
      ships.routes.push(r);
      (r.at ||= new THREE.Vector3()).copy(at);
      r.seen = frameState.fleetFrame;
      k++;
    }
    ships.batches.forEach(b => {
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    });
    ships.glow.geometry.setDrawRange(0, k);
    ships.glow.geometry.attributes.position.needsUpdate = true;
    ships.glow.geometry.attributes.color.needsUpdate = true;
  }
  const lanePoint = new THREE.Vector3(),
    previousLanePoint = new THREE.Vector3();
  // Visible moving lanes reuse their curves, vertices and dash distances.
  function drawRouteLines() {
    if (!routeLines.visible) return;
    routeLines.children.forEach((line, k) => {
      const r = focusLanes[k];
      if (!r) return;
      const curve = curveFor(r.a, r.b, 0.22, r.curve),
        previous = r.previous;
      if (r.drawn && previous[0].equals(curve.v0) && previous[1].equals(curve.v1) && previous[2].equals(curve.v2))
        return;
      const positions = line.geometry.attributes.position,
        distances = line.geometry.attributes.lineDistance;
      let distance = 0;
      for (let q = 0; q <= 24; q++) {
        curve.getPoint(q / 24, lanePoint);
        positions.setXYZ(q, lanePoint.x, lanePoint.y, lanePoint.z);
        if (distances) {
          if (q) distance += previousLanePoint.distanceTo(lanePoint);
          distances.setX(q, distance);
          previousLanePoint.copy(lanePoint);
        }
      }
      positions.needsUpdate = true;
      if (distances) distances.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      previous[0].copy(curve.v0);
      previous[1].copy(curve.v1);
      previous[2].copy(curve.v2);
      r.drawn = true;
    });
  }

  // Hover / selection: every import (yellow, outgoing) and importer (blue, incoming) gets a lane. With a symbol index a lane
  // carries an illustrative convoy for value references; unclassified static lanes carry one ship.
  function highlight(i) {
    routeLines.children.forEach(line => {
      line.geometry.dispose();
      line.material.dispose();
    });
    routeLines.clear();
    focusRoutes = [];
    focusLanes = [];
    const sel = i;
    if (sel != null) {
      const lane = (a, b, kind) => {
        const u = host.graph.importUse(a, b);
        return {
          a,
          b,
          kind,
          use: u?.kind || 'unknown',
          ships: !u || u.kind === 'unknown' ? 1 : u.kind === 'runtime' ? Math.min(6, u.refs) : 0,
        };
      };
      focusLanes = [
        ...host.data.out()[sel].slice(0, 60).map(t => lane(sel, t, 'out')),
        ...host.data.inc()[sel].slice(0, 60).map(s => lane(s, sel, 'in')),
      ];
      focusLanes.forEach(r => {
        focusRoutes.push(...convoy(r.a, r.b, r.ships, r.kind, 0.22));
        const typeOnly = r.use === 'type',
          mat = typeOnly
            ? new THREE.LineDashedMaterial({
                color: ROUTE_COL[r.kind],
                transparent: true,
                opacity: 0.45,
                dashSize: 0.5 * u,
                gapSize: 0.5 * u,
              })
            : new THREE.LineBasicMaterial({
                color: ROUTE_COL[r.kind],
                transparent: true,
                opacity: r.ships ? 0.35 : 0.15,
              });
        r.curve = new THREE.QuadraticBezierCurve3();
        r.previous = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(25 * 3), 3).setUsage(THREE.DynamicDrawUsage),
        );
        if (typeOnly)
          geometry.setAttribute(
            'lineDistance',
            new THREE.BufferAttribute(new Float32Array(25), 1).setUsage(THREE.DynamicDrawUsage),
          );
        routeLines.add(new THREE.Line(geometry, mat));
      });
    }
    ctx.selection.refreshTint();
  }
  function dispose() {
    ships.heroes.forEach(rig => rig.dispose());
    ships.batches.forEach(b => {
      T.scene.remove(b.mesh);
      b.mesh.dispose();
      b.mesh.material.dispose();
    });
    if (ships.glow) {
      T.scene.remove(ships.glow);
      ships.glow.geometry.dispose();
      ships.glow.material.dispose();
    }
  }

  return {
    flyShips, drawRouteLines, highlight, curveFor, routeSpan, currentAmbient, dispose, ships, routeLines,
    get ambient() { return ambient; },
    set ambient(value) { ambient = value; },
    get focusLanes() { return focusLanes; },
  };
}
