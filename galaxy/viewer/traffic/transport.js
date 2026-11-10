// File routes come from method-level imported-module uses. File-wide reference counts
// classify evidence only; they are not call counts or resolved receiving methods.
import * as THREE from 'three';
import { planetBuildBudget } from '../shared/build-budget.js';
import { RiggedAssets, ShipScale } from '../scene/rigged-assets.js';

export function transportRoutes(fileIdx, regions, nodes, symbols) {
  const byPath = new Map(nodes.map(n => [n.path, n.i]));
  const refs = symbols?.[nodes[fileIdx].path]?.refs;
  return regions.map(r =>
    [...new Set(r.uses || [])].sort().map(path => {
      const target = byPath.get(path),
        counts = refs?.[path];
      const kind = counts?.[0] ? 'value' : counts?.[1] ? 'type' : counts?.[2] ? 'reexport' : 'unknown';
      return { path, target, kind, canFly: target != null && target !== fileIdx && kind === 'value' };
    }),
  );
}

// A user-triggered navigation preview, never an execution trace. One ship at a time,
// scaled to the actual landing pad, with a cancellable takeoff / approach / docking.
export function createSpaceportTransport(T, towns, onStatus = () => {}) {
  let active = null,
    parked = null,
    parkedDock = null,
    disposed = false,
    serial = 0;
  const root = new THREE.Group();
  root.name = 'spaceport-transport';
  T.scene.add(root);
  const emit = (phase, route = null) => onStatus({ phase, route });
  function cancel(notify = true) {
    serial++;
    active?.restoreRoute?.();
    active?.rig?.dispose();
    parked?.dispose();
    towns.releaseDock?.(active?.dock);
    towns.releaseDock?.(parkedDock);
    parkedDock = null;
    parked = null;
    active = null;
    root.children.slice().forEach(o => {
      root.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    });
    if (notify && !disposed) emit('idle');
  }
  async function play(
    k,
    route,
    {
      arrival = false,
      onComplete,
      follow = false,
      isPaused = () => false,
      focus = true,
      showPath = true,
      // A point in planet space where an arriving ship comes from, or a departing one leaves to.
      entry = null,
    } = {},
  ) {
    if (disposed || !towns.portOf(k)) return false;
    // A parked craft departs from its own reserved pad, never a different bay.
    const retainedDock = !arrival && parkedDock?.k === k ? parkedDock : null;
    if (retainedDock) parkedDock = null;
    cancel(false);
    const token = serial;
    emit('loading', route);
    let rig;
    try {
      rig = await RiggedAssets.create('arc');
      await T.prepareDraw?.(rig.root, planetBuildBudget());
    } catch (error) {
      rig?.dispose();
      towns.releaseDock?.(retainedDock);
      if (!disposed && token === serial) emit('unavailable', route);
      console.warn('Transport rig unavailable', error);
      return false;
    }
    if (disposed || token !== serial) {
      rig.dispose();
      towns.releaseDock?.(retainedDock);
      return false;
    }
    const dock = retainedDock || towns.reserveDock?.(k);
    if (towns.docksOf?.(k).length && !dock) {
      rig.dispose();
      emit('no available docking bay', route);
      return false;
    }
    const s = towns.scaleOf(k),
      pad = (dock?.point || towns.portOf(k)).clone(),
      normal = dock?.normal.clone() || pad.clone().normalize();
    const scale = Math.min(ShipScale.padSpan(s, pad.length()), dock ? dock.width * 0.8 : Infinity) / rig.span;
    const forward = towns.frameOf(k).nn.clone().addScaledVector(normal, -towns.frameOf(k).nn.dot(normal)).normalize();
    pad.addScaledVector(normal, s * 0.04);
    const lift = Math.max(s * 3, towns.frameOf(k).roof - pad.length() + s * 2);
    const high = dock?.approach.clone() || pad.clone().addScaledVector(normal, lift);
    const far = high
      .clone()
      .addScaledVector(normal, s * 5)
      .addScaledVector(forward, s * 5);
    const target = pad.clone().lerp(far, 0.35),
      distance = Math.max(s * 12, pad.distanceTo(far) * 1.7);
    if (focus)
      T.flyTo(target, 0, {
        cam: target
          .clone()
          .addScaledVector(normal, distance * 0.55)
          .addScaledVector(forward, -distance),
        arc: true,
      });
    let curve = new THREE.CubicBezierCurve3(
      high,
      high.clone().addScaledVector(normal, s * 2),
      far.clone().addScaledVector(forward, -s * 2),
      far,
    );
    // From a far entry point, arc around the planet (never through it) to the bay's approach.
    let total = 5;
    if (entry) {
      const from = entry.clone(),
        away = far.clone().normalize(),
        toward = from.clone().normalize(),
        floor = Math.max(far.length(), towns.frameOf(k).roof + s * 4),
        arc = [];
      for (let i = 1; i <= 10; i++) {
        const t = i / 10,
          dir = new THREE.Vector3().copy(away).lerp(toward, t);
        if (dir.lengthSq() < 1e-6) dir.copy(normal).cross(toward).normalize();
        arc.push(dir.normalize().multiplyScalar(THREE.MathUtils.lerp(floor, from.length(), t * t)));
      }
      arc[arc.length - 1].copy(from);
      curve = new THREE.CatmullRomCurve3([high, high.clone().addScaledVector(normal, s * 2), far, ...arc]);
      total = 2 + THREE.MathUtils.clamp(3 * Math.sqrt(from.distanceTo(far) / (s * 7)), 3, 9);
    }
    const points = [pad, high, ...curve.getPoints(36).slice(1)];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: '#86bbdc',
        transparent: true,
        opacity: 0.55,
        dashSize: s * 0.3,
        gapSize: s * 0.18,
      }),
    );
    line.computeLineDistances();
    if (showPath) root.add(line);
    else {
      line.geometry.dispose();
      line.material.dispose();
    }
    const ship = rig.root;
    ship.scale.setScalar(scale);
    root.add(ship);
    active = {
      k,
      dock,
      route,
      arrival,
      onComplete,
      ship,
      rig,
      pad,
      normal,
      forward,
      high,
      curve,
      total,
      elapsed: 0,
      last: null,
      phase: null,
      follow,
      isPaused,
      s,
    };
    frame(0);
    return true;
  }
  const smooth = t => t * t * (3 - 2 * t);
  function ride(from, to, { onComplete, follow = false, isPaused = () => false } = {}) {
    cancel(false);
    const route =
      towns.callRoutes?.find(l => l.a === from && l.b === to) ||
      towns.callRoutes?.find(l => l.a === to && l.b === from);
    if (!route?.navigationCurve) return false;
    const s = Math.max(towns.S0 * 0.8, Math.min(towns.scaleOf(from), towns.scaleOf(to)));
    // Port-to-port navigation follows the same directed connection as the persistent call line.
    const geo = new THREE.BoxGeometry(s * 0.55, s * 0.5, s * 1.5).translate(0, s * 0.25 + towns.S0 * 0.09, 0);
    const ship = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#ffd382', metalness: 0.25, roughness: 0.4 }),
    );
    root.add(ship);
    active = {
      callPath: route.navigationCurve,
      reverse: route.a !== from,
      ship,
      elapsed: 0,
      last: null,
      s,
      follow,
      isPaused,
      onComplete,
    };
    frame(0);
    return true;
  }
  function track(a, forward) {
    if (!a.follow || a.isPaused()) return;
    const normal = a.ship.position.clone().normalize(),
      d = Math.max(a.s * 8, 0.06);
    const tangent = forward.clone().addScaledVector(normal, -forward.dot(normal)).normalize();
    const camera = a.ship.position
      .clone()
      .addScaledVector(normal, d * 0.8)
      .addScaledVector(tangent, -d);
    // Ease into the chase camera; retain clearance from the curved surface.
    const blend = a.elapsed < 0.65 ? 0.15 : 1;
    T.setView(T.controls.target.clone().lerp(a.ship.position, blend), T.camera.position.clone().lerp(camera, blend));
  }
  function frame(t) {
    const a = active;
    if (!a) return;
    if (a.last != null && !a.isPaused()) a.elapsed += Math.max(0, Math.min(0.1, t - a.last));
    a.last = t;
    if (a.callPath) {
      const p = Math.max(0, Math.min(1, (a.elapsed - 0.7) / 4)),
        u = a.reverse ? 1 - p : p;
      a.callPath.getPointAt(u, a.ship.position);
      const forward = a.callPath.getTangentAt(Math.max(0.001, Math.min(0.999, u))).multiplyScalar(a.reverse ? -1 : 1);
      a.ship.up.copy(a.ship.position).normalize();
      a.ship.lookAt(a.ship.position.clone().add(forward));
      track(a, forward);
      if (p === 1) {
        const done = a.onComplete;
        cancel(false);
        done?.();
      }
      return;
    }
    const time = a.arrival ? a.total - a.elapsed : a.elapsed;
    const progress = Math.max(0, Math.min(1, (time - 2) / (a.total - 2)));
    let forward = a.forward.clone();
    if (time <= 0.6) a.ship.position.copy(a.pad);
    else if (time < 2) a.ship.position.lerpVectors(a.pad, a.high, smooth((time - 0.6) / 1.4));
    else {
      a.curve.getPoint(smooth(progress), a.ship.position);
      forward = a.curve.getTangent(Math.max(0.001, smooth(progress)));
    }
    // Model +Z is its nose; keep the hull level while rising vertically.
    if (a.arrival) forward.negate();
    const right = new THREE.Vector3().crossVectors(a.normal, forward).normalize();
    const up = new THREE.Vector3().crossVectors(forward, right).normalize();
    a.ship.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
    a.rig.sample('Docking', Math.min(5, time));
    if (a.dock)
      towns.poseDock?.(
        a.k,
        a.dock.index,
        a.arrival ? Math.max(0, a.elapsed - (a.total - 0.6)) * 2.2 : 2.8 + Math.min(1.2, a.elapsed * 2),
      );
    track(a, forward);
    const phase = a.arrival
      ? time > 2
        ? 'approaching'
        : time > 0.6
          ? 'landing'
          : 'docked'
      : time < 0.6
        ? 'boarding'
        : time < 2
          ? 'lifting off'
          : 'departing';
    if (phase !== a.phase) {
      a.phase = phase;
      emit(phase, a.route);
    }
    if (a.elapsed >= a.total) {
      const done = a.onComplete;
      if (a.arrival) {
        a.rig.sample('Docking', 0);
        parked = a.rig;
        parkedDock = a.dock;
        active = null;
        root.children
          .filter(o => o.isLine)
          .forEach(o => {
            root.remove(o);
            o.geometry.dispose();
            o.material.dispose();
          });
        emit('docked', a.route);
      } else {
        cancel(false);
        emit('departed', a.route);
      }
      done?.();
    }
  }
  T.onFrame.push(frame);
  return {
    play,
    ride,
    cancel,
    get active() {
      return active;
    },
    get docked() {
      return parked ? { ship: parked.root, dock: parkedDock } : null;
    },
    dispose: () => {
      disposed = true;
      cancel(false);
      T.scene.remove(root);
      const i = T.onFrame.indexOf(frame);
      if (i >= 0) T.onFrame.splice(i, 1);
    },
  };
}
