// The debugger's car on a planet's roads: the constellation's execution ship, landed. It parks at the paused statement
// and, when a step pauses at another statement in the same town, drives the planned road between the two, so the
// branch or loop edge execution took reads as a route instead of a jump. A step into or out of a call on this planet
// travels the call's connection between the towns. Road traffic clears while it is out.
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RiggedAssets } from '../scene/rigged-assets.js';

// In town scales: a little longer than road traffic, so it reads as the one car that matters.
const LENGTH = 1.1;
// The debugger's amber, shared with frame cards and the paused building's ring.
const AMBER = '#ffb347';

export function createStepCar(T, towns, traffic, callRoutes = () => []) {
  const root = new THREE.Group();
  root.name = 'execution-step-car';
  root.visible = false;
  T.scene.add(root);
  let rig = null,
    loading = null,
    dead = false,
    left = null, // { k, id, line }: the statement execution last paused at, kept while it runs on
    shown = null, // { k, id } of the pause the car is out for
    drive = null; // { k, pts, cum, scales, stop, started, duration, trail }, kept while running so it can resume
  const materials = [];
  async function ensureRig() {
    if (rig || dead) return rig;
    loading ||= RiggedAssets.create('arc', 1);
    const loaded = await loading;
    // Pauses arrive in bursts; the first to finish loading fits the car for all of them.
    if (rig) return rig;
    if (dead) {
      loaded.dispose();
      return null;
    }
    rig = loaded;
    // Its own material copies take the debugger's amber, so it stands out on grey asphalt; the constellation ship
    // shares the originals.
    rig.root.traverse(o => {
      if (!o.isMesh) return;
      const tint = m => {
        const copy = m.clone();
        if (copy.emissive) {
          copy.emissive.set(AMBER);
          copy.emissiveMap = null;
          copy.emissiveIntensity = 0.35;
        }
        materials.push(copy);
        return copy;
      };
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
    });
    root.add(rig.root);
    return rig;
  }
  const pos = new THREE.Vector3(),
    ahead = new THREE.Vector3(),
    behind = new THREE.Vector3(),
    up = new THREE.Vector3(),
    fwd = new THREE.Vector3(),
    right = new THREE.Vector3(),
    basis = new THREE.Matrix4();
  // Polylines carry `pts` and the running length `cum` at each point (trip paths and drives alike).
  const segmentAt = (line, d) => {
    let i = 1;
    while (i < line.cum.length - 1 && line.cum[i] < d) i++;
    return [i, Math.min(1, Math.max(0, (d - line.cum[i - 1]) / Math.max(1e-9, line.cum[i] - line.cum[i - 1])))];
  };
  const pointAt = (line, d, out) => {
    const [i, f] = segmentAt(line, d);
    return out.lerpVectors(line.pts[i - 1], line.pts[i], f);
  };
  // A drive is one polyline at car height, built from legs: stretches of a town's planned road and, for a step into or
  // out of a call, that call's connection between two towns. Each point carries its town scale, for the car's size.
  const road = (k, path, from, to) => {
    const s = towns.scaleOf(k),
      points = [{ p: pointAt(path, from, new THREE.Vector3()), s }];
    path.cum.forEach((d, i) => {
      if (i && d > from && d < to) points.push({ p: path.pts[i].clone(), s });
    });
    points.push({ p: pointAt(path, to, new THREE.Vector3()), s });
    return points;
  };
  const connection = (route, reversed) => {
    const from = towns.scaleOf(route.a),
      to = towns.scaleOf(route.b),
      points = [];
    for (let i = 0; i <= 48; i++) {
      const u = reversed ? 1 - i / 48 : i / 48;
      points.push({ p: route.curve.getPointAt(u).clone(), s: from + (to - from) * u });
    }
    return points;
  };
  const polyline = points => {
    const line = { pts: [], cum: [], scales: [] };
    for (const { p, s } of points) {
      if (line.pts.length && p.distanceToSquared(line.pts.at(-1)) < 1e-12) continue;
      line.cum.push(line.pts.length ? line.cum.at(-1) + p.distanceTo(line.pts.at(-1)) : 0);
      line.pts.push(p);
      line.scales.push(s);
    }
    return line;
  };
  // Into a call: from the calling building along the call to the callee's port, then down its road to the pause. Out
  // of one: back along the call that entered the method, then on from its building to the pause. Returns the points
  // and the statement the car ends at: a return that pauses on the call's own line, or on the closing line of a
  // statement around it, leaves the car standing at the call.
  function callTrip(k, it, id) {
    const routes = callRoutes(),
      pick = (list, site) => list.find(r => r.sourceLot?.it.id === site) ?? list[0],
      into = pick(
        routes.filter(r => r.a === left.k && r.b === k),
        left.id,
      );
    if (into) {
      const entry = it && traffic?.stepRoute(k, null, id);
      return {
        points: [...connection(into, false), ...(entry ? road(k, entry.path, 0, entry.to) : [])],
        at: { id, line: it?.line },
      };
    }
    const back = pick(
      routes.filter(r => r.a === k && r.b === left.k),
      id,
    );
    if (!back) return null;
    const site = back.sourceLot?.it,
      rest = it && site && site.id !== id ? traffic?.stepRoute(k, site.id, id) : null,
      onward = rest && rest.to > rest.from;
    return {
      points: [...connection(back, true), ...(onward ? road(k, rest.path, rest.from, rest.to) : [])],
      at: onward || !site ? { id, line: it?.line } : { id: site.id, line: site.line },
    };
  }
  // The road the last step drove, drawn in behind the car and left in place while execution stays paused there: the
  // branch, loop edge or call it took stays readable while the variables are inspected.
  const trailMaterial = new LineMaterial({ color: AMBER, linewidth: 4, transparent: true, opacity: 0.85 }),
    trail = new Line2(new LineGeometry(), trailMaterial),
    viewport = new THREE.Vector2();
  trail.name = 'execution-step-trail';
  trail.visible = false;
  trail.frustumCulled = false;
  T.scene.add(trail);
  function layTrail() {
    const points = [];
    drive.pts.forEach((p, i) => {
      const lifted = p.clone().addScaledVector(towns.frameOf(drive.k).normalAt(p), 0.05 * drive.scales[i]);
      points.push(lifted.x, lifted.y, lifted.z);
    });
    trail.geometry.dispose();
    trail.geometry = new LineGeometry().setPositions(points);
  }
  function place() {
    root.visible = !!rig && !!drive && !!shown;
    trail.visible = root.visible && drive.trail;
    if (!root.visible) return;
    const t = drive.duration ? Math.min(1, (performance.now() - drive.started) / drive.duration) : 1,
      d = drive.stop * t * t * (3 - 2 * t),
      [i, f] = segmentAt(drive, d),
      s = drive.scales[i - 1] + (drive.scales[i] - drive.scales[i - 1]) * f;
    pointAt(drive, d, pos);
    if (trail.visible) {
      let segments = 0;
      while (segments < drive.cum.length - 1 && drive.cum[segments + 1] <= d + 1e-6) segments++;
      trail.geometry.instanceCount = segments;
      const canvas = T.controls?.domElement;
      if (canvas) trailMaterial.resolution.copy(viewport.set(canvas.clientWidth || 1, canvas.clientHeight || 1));
    }
    // Face along the way at the car's spot; at the end of it, carry on its last direction.
    const end = drive.cum.at(-1);
    if (d + 0.3 * s <= end) pointAt(drive, d + 0.3 * s, ahead);
    else
      ahead
        .copy(pos)
        .multiplyScalar(2)
        .sub(pointAt(drive, Math.max(0, d - 0.3 * s), behind));
    up.copy(towns.frameOf(drive.k).normalAt(pos));
    fwd.subVectors(ahead, pos);
    fwd.addScaledVector(up, -fwd.dot(up));
    if (fwd.lengthSq() < 1e-12) return;
    fwd.normalize();
    right.crossVectors(up, fwd).normalize();
    up.crossVectors(fwd, right);
    basis.makeBasis(right, up, fwd);
    root.quaternion.setFromRotationMatrix(basis);
    root.position.copy(pos);
    root.scale.setScalar(s * LENGTH);
  }
  T.onFrame.push(place);
  return {
    /** Execution paused at `element` ({ town, lot? }) – after a step when `stepped` – or null once it runs on. */
    async at(element, stepped = false) {
      if (element?.town == null) {
        shown = null;
        return;
      }
      const k = element.town,
        it = element.lot?.it ?? null,
        id = it?.id ?? `town:${k}`;
      // A pause reports more than once (stack, then variables); only a new pause moves the car.
      if (shown?.k === k && shown.id === id) return;
      // Only a step links two pauses; after a continue the program may have run anywhere in between.
      const linked = stepped && !!left && !(left.k === k && left.id === id);
      // A step onto the closing line of a statement around the last one (`} else {` after a then-branch) is still
      // inside it: the car stays where execution was rather than backing up to the statement's start.
      if (it && linked && left.k === k && drive && it.line <= left.line && it.end >= left.line) {
        shown = { k, id };
        drive = { ...drive, duration: 0, trail: false };
        return;
      }
      const across = linked && left.k !== k;
      let points = null,
        stop = null,
        trip = null;
      if (linked && !across) {
        // In the same town; a step onto the method's own closing line drives on out to the end of its road.
        const route = traffic?.stepRoute(k, left.id, it ? id : null);
        if (route && route.to > route.from) points = road(k, route.path, route.from, route.to);
      } else if (across) {
        trip = callTrip(k, it, id);
        points = trip?.points ?? null;
      }
      // Leave from where the car stood, so a trip that starts at a building or a port does not jump.
      if (points && drive) points.unshift({ p: root.position.clone(), s: points[0].s });
      const moved = !!points;
      if (!points) {
        // Park: a short stretch of road around the spot gives the car its heading.
        const spot = it && traffic?.stepRoute(k, null, id);
        if (spot) {
          const s = towns.scaleOf(k),
            from = Math.max(0, spot.to - 0.6 * s),
            to = from < spot.to ? spot.to : Math.min(spot.path.cum.at(-1), spot.to + 0.6 * s);
          points = road(k, spot.path, from, to);
          stop = spot.to - from;
        }
      }
      left = { k, ...(trip?.at ?? { id, line: it?.line }) };
      shown = { k, id };
      if (!points) {
        drive = null;
        return;
      }
      if (!(await ensureRig()) || shown?.id !== id) return;
      const line = polyline(points),
        length = line.cum.at(-1) ?? 0,
        s = Math.min(...line.scales);
      drive = {
        k,
        ...line,
        stop: stop ?? length,
        started: performance.now(),
        // Long enough to follow by eye, short enough that holding the step key keeps up; a call between towns takes a
        // little longer.
        duration: moved && length > 0 ? 1000 * Math.min(across ? 2.2 : 1.4, Math.max(0.6, length / (8 * s))) : 0,
        trail: moved && length > 0,
      };
      if (drive.trail) layTrail();
    },
    snapshot: () => ({
      visible: root.visible,
      trail: trail.visible ? trail.geometry.instanceCount : 0,
      position: root.position.toArray(),
      drive: drive && { k: drive.k, length: drive.cum.at(-1), stop: drive.stop, duration: drive.duration },
    }),
    dispose() {
      dead = true;
      rig?.dispose();
      materials.forEach(m => m.dispose());
      trail.geometry.dispose();
      trailMaterial.dispose();
      trail.removeFromParent();
      root.removeFromParent();
      const i = T.onFrame.indexOf(place);
      if (i >= 0) T.onFrame.splice(i, 1);
    },
  };
}
