// Live structural traffic across the planet's method towns. Each car illustrates
// an independent trip along real control-flow roads. Main arrivals enter at the
// port's landside road; callback trips enter at their own neighborhood street head.
//   - if / switch: takes one arm's lane; loops drive the ring road (right half = skip or exit, left half = back edge)
//   - return / uncaught throw: the trip ends at that statement; break / continue jump to the loop or switch exit
//   - try: a throw with a catch drives (off-road, red) to the handler; every abrupt exit runs `finally` first
//   - switch: old-style cases fall through to the next case unless they end in break / return / throw
// Values are unknown (static analysis only), so vehicles do not claim to know which inputs take which path. Instead the town
// gets a bounded set of structural paths: each path takes, at every decision, the arm used least so far (ties: source order).
// Paths explore alternate branches, loop skip/entry, and catch clauses; vehicles
// drive these in turn. This is not an exhaustive execution proof. A path combines choices
// independently, so it may be infeasible when conditions are correlated. Calls into other methods and callbacks are not
// entered; a callback's block is its own trip.
// Vehicles follow smoothed roads: ordinary trips use the four imported sci-fi cars; a trip whose exception is caught
// is an ambulance, and one that ends in an uncaught throw is a police car.
// Starts automatically on landing. One shared car pool serves nearby visible
// towns; the method action only pauses/resumes its town's simulated traffic.

// Ancestors of common JDK exceptions. A user-defined class can never be an ancestor of a JDK class, so for these a catch clause
// either takes the throw or it does not, with no guessing.
import * as THREE from 'three';
import { countStmts } from '../shared/town-flow.js';
import { planTrip } from './town-traffic-plan.js';
import { smoothPath } from '../towns/towns.js';
import { createRoadFleet, ROAD_CARS } from './road-vehicles.js';
import { ROAD_LIFT } from '../towns/town-road-paint.js';

export function createTraffic(T, towns) {
  const CIVIL = ROAD_CARS;
  const CAR_LENGTH = 0.8,
    CAR_YAW = 0; // car length in town scales; every exported car faces +Z
  const MAX_VEHICLES = 96,
    MAX_TOWNS = 24,
    MAX_PER_TOWN = 18;

  // Keep the first trip even when the method has no branches. Then add paths while
  // they expand coverage; a straight-line method still needs one drivable route.
  function planPaths(tw) {
    if (!tw?.cols?.some(co => co.c.items.length)) return [];
    const scopes = [...new Set(tw.cols.filter(co => co.c.items.length).map(co => co.c.scope))],
      paths = [];
    // Each callback neighborhood has its own trip from its street head. This
    // does not claim the enclosing invocation entered that callback.
    const perScope = Math.min(40, Math.max(1, Math.floor(80 / scopes.length)));
    for (const scope of scopes) {
      const planned = new Map(),
        seen = new Set();
      let added = 0;
      for (let idle = 0; idle < 3 && added < perScope;) {
        const before = planned.size,
          trip = planTrip(tw, { planned }, scope),
          key = trip.map(w => w.p.join(',')).join(';');
        if ((!added || planned.size > before) && !seen.has(key)) {
          seen.add(key);
          paths.push(trip);
          added++;
          idle = 0;
        } else idle++;
      }
    }
    return paths;
  }

  // ---------- sampling a trip onto the terrain ----------
  function toWorld(tw, trip) {
    const sm = smoothPath(
      trip.map(w => w.p),
      tw.s,
    ); // the same curves the roads are drawn with
    const pts = sm.pts.map(p => tw.fr.world(p[0], p[1], tw.s * ROAD_LIFT.car + tw.liftAt(p[0], p[1])));
    const how = sm.leg.map(l => trip[Math.min(trip.length - 1, l + 1)].how);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const visits = [];
    trip.forEach((wp, i) => {
      if (wp.visits.length) visits.push({ d: cum[sm.at[i]], items: wp.visits });
    });
    return { pts, how, cum, visits };
  }

  // ---------- running ----------
  const up = new THREE.Vector3(),
    right = new THREE.Vector3(),
    fwd = new THREE.Vector3(),
    pos = new THREE.Vector3(),
    basis = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), CAR_YAW);
  const runs = new Map(),
    paused = new Set();
  const eligible = new Set(
    Array.from({ length: towns.regionCount }, (_, k) => k).filter(k =>
      towns.townOf(k)?.cols?.some(co => co.c.items.length),
    ),
  );
  const fleet = createRoadFleet(T, MAX_VEHICLES);
  let stopped = false,
    held = false,
    active = [],
    last = null,
    sinceSurvey = Infinity;
  function prepare(k) {
    if (runs.has(k)) return runs.get(k);
    const tw = towns.townOf(k);
    const mainScope = tw.cols[0].c.scope,
      items = tw.cols.filter(co => co.c.scope === mainScope).flatMap(co => co.c.items);
    const paths = planPaths(tw)
      .map(trip => Object.assign(toWorld(tw, trip), { kind: trip.kind }))
      .filter(trip => trip.pts.length > 1 && Number.isFinite(trip.cum.at(-1)) && trip.cum.at(-1) > 1e-6);
    if (!paths.length) {
      eligible.delete(k);
      return null;
    }
    const run = {
      k,
      tw,
      paths,
      vehicles: [],
      visited: new Set(),
      total: countStmts(items),
      trips: 0,
      seeded: false,
      population: Math.min(
        MAX_PER_TOWN,
        Math.max(2, Math.ceil(Math.max(...paths.map(p => p.cum.at(-1))) / (tw.s * 14))),
      ),
      spawnEvery: 2.2 + (k % 7) * 0.23,
      sinceSpawn: Infinity,
    };
    runs.set(k, run);
    return run;
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    const i = T.onFrame.indexOf(step);
    if (i >= 0) T.onFrame.splice(i, 1);
    fleet.dispose();
    runs.clear();
    active = [];
  }
  const pickModel = (kind, n) => {
    const avail = i => fleet.available(i);
    if (kind === 'police' && avail(CIVIL.length)) return CIVIL.length;
    if (kind === 'ambulance' && avail(CIVIL.length + 1)) return CIVIL.length + 1;
    const civil = CIVIL.map((_, i) => i).filter(avail);
    return civil.length ? civil[n % civil.length] : -1;
  };
  const frustum = new THREE.Frustum(),
    projection = new THREE.Matrix4();
  const inView = p =>
    (towns.flat ? T.camera.position.y > p.y : p.dot(T.camera.position) > p.lengthSq()) && frustum.containsPoint(p);
  function spawn(run, fraction = 0, pathIndex = null) {
    const n = run.trips++,
      index = pathIndex ?? run.visiblePaths?.[n % run.visiblePaths.length]?.index ?? n % run.paths.length,
      trip = run.paths[index],
      model = pickModel(trip.kind, n + run.k);
    if (model < 0) return false;
    run.vehicles.push({ ...trip, pathIndex: index, model, d: trip.cum.at(-1) * fraction, seen: 0, segment: 1 });
    return true;
  }
  function survey() {
    const camera = T.camera.position;
    frustum.setFromProjectionMatrix(
      projection.multiplyMatrices(T.camera.projectionMatrix, T.camera.matrixWorldInverse),
    );
    const candidates = [...eligible]
      .filter(k => !paused.has(k) && (towns.townOf(k).roadExpanded ?? towns.townOf(k).expanded) !== false)
      .map(k => {
        const center = towns.centerOf(k),
          distance = center.distanceTo(camera);
        // Only the camera-facing surface can contribute visible cars.
        const horizon = Math.acos(Math.min(1, center.length() / camera.length()));
        const reach = Math.atan(towns.extentOf(k) / center.length());
        const facing = towns.flat
          ? camera.y > center.y
          : center.dot(camera) / (center.length() * camera.length()) > Math.cos(Math.min(Math.PI, horizon + reach));
        return { k, facing, score: distance / towns.scaleOf(k) };
      })
      .filter(c => c.facing)
      .sort((a, b) => a.score - b.score)
      .slice(0, MAX_TOWNS);
    active = candidates.map(c => prepare(c.k)).filter(Boolean);
    for (const run of active) {
      const visiblePaths = [];
      run.paths.forEach((path, index) => {
        const samples = [],
          stride = Math.max(1, Math.ceil(path.pts.length / 64));
        for (let i = 0; i < path.pts.length; i += stride)
          if (path.cum[i] < path.cum.at(-1) * 0.98 && inView(path.pts[i])) samples.push(path.cum[i]);
        if (samples.length) visiblePaths.push({ index, samples });
      });
      const key = visiblePaths
        .map(
          p =>
            `${p.index}:${Math.floor(p.samples[0] / (run.tw.s * 8))}:${Math.floor(p.samples.at(-1) / (run.tw.s * 8))}`,
        )
        .join(',');
      if (run.viewKey !== key) {
        // Preserve cars already visible, and reclaim offscreen capacity as the
        // camera enters other neighborhoods of a large method.
        run.vehicles = run.vehicles.filter(v => inView(v.pts[Math.min(v.segment, v.pts.length - 1)]));
        run.seeded = false;
        run.viewKey = key;
      }
      run.visiblePaths = visiblePaths;
      if (visiblePaths.length) {
        const length = visiblePaths.reduce((n, p) => n + p.samples.at(-1) - p.samples[0], 0);
        run.population = Math.min(MAX_PER_TOWN, Math.max(2, Math.ceil(length / (run.tw.s * 14))));
      }
      run.seedSlots = Math.max(0, run.population - run.vehicles.length);
      run.spawnEvery = 2.2 / Math.sqrt(run.population);
    }
    const visible = new Set(active.map(r => r.k));
    for (const [k, run] of runs) {
      if (!visible.has(k)) {
        run.vehicles.length = 0;
        run.seeded = false;
      }
      if (!visible.has(k) && runs.size > MAX_TOWNS * 2) runs.delete(k);
    }
  }
  function step(t) {
    if (stopped) return;
    // A paused debugger holds the world: trips stop where they are and resume from there.
    const dt = last == null || held ? 0 : Math.max(0, Math.min(0.1, t - last));
    last = t;
    if (!fleet.loaded) return;
    sinceSurvey += dt;
    if (sinceSurvey >= 0.45) {
      sinceSurvey = 0;
      survey();
    }
    for (const run of active) {
      const speed = 3 * run.tw.s;
      run.sinceSpawn += dt;
      run.vehicles = run.vehicles.filter(v => {
        v.d += speed * dt;
        while (v.seen < v.visits.length && v.visits[v.seen].d <= v.d)
          v.visits[v.seen++].items.forEach(it => run.visited.add(it));
        return v.d < v.cum[v.cum.length - 1];
      });
    }
    let count = active.reduce((n, run) => n + run.vehicles.length, 0);
    // Warm-start the simulation along existing routes so a long method does
    // not have an empty road network while every car queues at its entrance.
    // Round-robin allocation gives neighboring towns a share of the same cap.
    for (let wave = 0; wave < MAX_PER_TOWN && count < MAX_VEHICLES; wave++) {
      for (const run of active) {
        if (count >= MAX_VEHICLES) break;
        if (run.seeded || wave >= run.seedSlots) continue;
        const visible = run.visiblePaths[wave % run.visiblePaths.length];
        const index = visible?.index ?? Math.floor((wave * run.paths.length) / run.population);
        const sample =
          visible?.samples[
            Math.min(
              visible.samples.length - 1,
              Math.floor(
                ((Math.floor(wave / run.visiblePaths.length) + 0.5) /
                  Math.ceil(run.seedSlots / run.visiblePaths.length)) *
                  visible.samples.length,
              ),
            )
          ];
        const fraction = sample != null ? sample / run.paths[index].cum.at(-1) : (wave + 0.5) / run.population;
        if (spawn(run, fraction, index)) count++;
      }
    }
    for (const run of active) {
      if (!run.seeded) run.sinceSpawn = 0;
      run.seeded = true;
    }
    for (const run of active) {
      if (paused.has(run.k)) continue;
      // Maintain room at the entrance; traffic never piles cars on one spawn.
      if (
        count >= MAX_VEHICLES ||
        run.vehicles.length >= run.population ||
        run.sinceSpawn < run.spawnEvery ||
        run.vehicles.some(v => v.d < run.tw.s * 2)
      )
        continue;
      run.sinceSpawn = 0;
      if (spawn(run)) count++;
    }
    fleet.begin();
    // While execution is paused the roads clear for the debugger's own car; every trip keeps its place for resume.
    if (held) {
      fleet.end();
      return;
    }
    active.forEach(run =>
      run.vehicles.forEach(v => {
        const tw = run.tw;
        if ((tw.roadExpanded ?? tw.expanded) === false) return;
        // Cars only move forward. Resume at the current segment instead of
        // scanning the entire sampled route for every vehicle on every frame.
        let i = v.segment;
        while (i < v.cum.length - 1 && v.cum[i] < v.d) i++;
        v.segment = i;
        const a = v.pts[i - 1],
          b = v.pts[i],
          f = (v.d - v.cum[i - 1]) / Math.max(1e-6, v.cum[i] - v.cum[i - 1]);
        pos.lerpVectors(a, b, Math.min(1, Math.max(0, f)));
        up.copy(towns.frameOf(run.k).normalAt(pos));
        fwd.subVectors(b, a);
        fwd.addScaledVector(up, -fwd.dot(up));
        if (fwd.lengthSq() < 1e-12) fwd.set(1, 0, 0).addScaledVector(up, -up.x);
        fwd.normalize();
        right.crossVectors(up, fwd).normalize();
        up.crossVectors(fwd, right);
        basis.makeBasis(right, up, fwd);
        q.setFromRotationMatrix(basis).multiply(yaw);
        const carScale = fleet.scaleOf(v.model, CAR_LENGTH, 0.34);
        scale.setScalar(tw.s * carScale);
        basis.compose(pos, q, scale);
        // Look ahead along the compiled route for front-wheel steering.
        const next = v.pts[Math.min(i + 1, v.pts.length - 1)];
        const dx = next.x - b.x,
          dy = next.y - b.y,
          dz = next.z - b.z;
        const ahead = dx * fwd.x + dy * fwd.y + dz * fwd.z;
        const across = dx * right.x + dy * right.y + dz * right.z;
        const turn = Math.max(-0.45, Math.min(0.45, Math.atan2(across, Math.max(1e-6, ahead))));
        fleet.draw(v.model, basis, v.d / (tw.s * carScale), turn);
      }),
    );
    fleet.end();
  }
  T.onFrame.push(step);

  return {
    toggle: k => {
      if (stopped || !eligible.has(k)) return;
      if (paused.has(k)) paused.delete(k);
      else {
        paused.add(k);
        const run = runs.get(k);
        if (run) {
          run.vehicles.length = 0;
          run.seeded = false;
        }
      }
      sinceSurvey = Infinity;
    },
    stop,
    /** Holds every trip in place and clears the roads while execution is paused. */
    hold: on => {
      held = !!on;
    },
    /** The stretch of road a debugger step drives in town k: the shortest planned trip section that passes statement
     * `from` and then `to`, or a spot where a trip passes `to` when none links them (or `from` is null). With `to`
     * null it is the shortest way on from `from` to the end of a trip, out of the method. Trip points are world
     * positions at car height; `from` and `to` are distances along them. */
    stepRoute: (k, from, to) => {
      const run = !stopped && eligible.has(k) ? prepare(k) : null;
      if (!run) return null;
      const passes = id =>
        run.paths.flatMap(path =>
          path.visits.filter(v => v.items.some(it => it.id === id)).map(v => ({ path, d: v.d })),
        );
      if (to == null)
        return passes(from).reduce((best, a) => {
          const end = a.path.cum.at(-1);
          return !best || end - a.d < best.to - best.from ? { path: a.path, from: a.d, to: end } : best;
        }, null);
      const ends = passes(to);
      if (!ends.length) return null;
      let best = null;
      if (from != null)
        for (const a of passes(from))
          for (const b of ends)
            if (b.path === a.path && b.d > a.d && (!best || b.d - a.d < best.to - best.from))
              best = { path: a.path, from: a.d, to: b.d };
      return best ?? { path: ends[0].path, from: ends[0].d, to: ends[0].d };
    },
    get held() {
      return held;
    },
    running: k => !stopped && eligible.has(k) && !paused.has(k),
    snapshot: () => ({
      automatic: true,
      stopped,
      capacity: MAX_VEHICLES,
      fleet: fleet.snapshot(),
      activeTowns: active
        .filter(r => !paused.has(r.k))
        .map(r => ({
          k: r.k,
          vehicles: r.vehicles.length,
          trips: r.trips,
          positions: r.vehicles.map(v => v.d),
          paths: r.paths.length,
        })),
      vehicles: active.reduce((n, r) => n + r.vehicles.length, 0),
    }),
    // The town's paths as the ordered statements each visits (for checks and debugging; nothing is drawn).
    paths: k =>
      planPaths(towns.townOf(k)).map(path => {
        const list = path.flatMap(wp => wp.visits.map(it => ({ line: it.line, t: it.t, kind: it.kind, how: wp.how })));
        list.vehicle = path.kind;
        return list;
      }),
    trip: k => {
      const tw = towns.townOf(k),
        path = planTrip(tw, { planned: new Map() }),
        list = path.flatMap(wp => wp.visits.map(it => ({ line: it.line, t: it.t, kind: it.kind, how: wp.how })));
      list.vehicle = path.kind;
      return list;
    },
    label: k => (!stopped && eligible.has(k) && !paused.has(k) ? 'Pause road traffic' : 'Resume road traffic'),
  };
}
