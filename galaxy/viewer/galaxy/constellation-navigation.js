// Owns overview fitting, camera presets, ship following, journeys and anchored zoom.
import * as THREE from 'three';
import * as d3 from 'd3';

// The overview camera: looking down from `elevation` toward -z, as close as it can be with every point (x, z) on the
// galactic plane in view. The cannon at the origin stays centred left to right; the target slides along z so the near
// half, which perspective enlarges, does not crowd out the far half.
export function fitView(points, aspect, elevation = 0.8) {
  // An unbounded far plane keeps "fits" monotonic in distance, so the bisection below finds the closest fit.
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.5, 1e9),
    toward = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation)),
    target = new THREE.Vector3(),
    p = new THREE.Vector3();
  const [x0, x1] = d3.extent(points, q => q[0]),
    [z0, z1] = d3.extent(points, q => q[1]),
    span = Math.max(x1 - x0, z1 - z0, 1);
  const fits = distance => {
    camera.position.copy(target).addScaledVector(toward, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return points.every(([x, z]) => {
      p.set(x, 0, z).project(camera);
      return p.z < 1 && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.86;
    });
  };
  const closest = z => {
    target.z = z;
    let near = span * 0.1,
      far = span * 20;
    for (let i = 0; i < 30; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return far;
  };
  // Golden-section search for the target depth that lets the camera come closest.
  let a = z0,
    b = z1;
  for (let i = 0; i < 24; i++) {
    const c = b - (b - a) * 0.618,
      d = a + (b - a) * 0.618;
    if (closest(c) < closest(d)) b = d;
    else a = c;
  }
  const distance = closest((a + b) / 2);
  return { target: target.clone(), position: target.clone().addScaledVector(toward, distance) };
}

export function createNavigation(ctx) {
  const { host, T, u, model, instances, lod, frame: frameState } = ctx;
  const { tmp } = ctx.scratch;
  T.beforeCamera.push(applyZoom);

  // Camera presets keep the current target and distance and change only the viewing angle.
  // On a planet, "up" points away from its centre and the flight tracks the moving body.
  T.cameraPreset = kind => {
    if (kind === 'focus') {
      if (T.pinned != null) T.select(T.pinned);
      return;
    }
    const body = lod.detail ? lod.i : T.pinned != null && T.following ? T.pinned : null,
      frame = body != null ? T.bodyFrame(body) : null,
      origin = frame ? frame().origin : new THREE.Vector3(),
      target = T.controls.target.clone().sub(origin),
      offset = T.camera.position.clone().sub(T.controls.target),
      distance = Math.max(offset.length(), T.camera.near * 4),
      up = lod.detail && target.lengthSq() > 1e-9 ? target.clone().normalize() : new THREE.Vector3(0, 1, 0);
    const across = offset.addScaledVector(up, -offset.dot(up));
    if (across.lengthSq() < 1e-9) across.set(1, 0, 0).addScaledVector(up, -up.x);
    across.normalize();
    const elevation = { top: 89.5, angle: 45, horizon: 8 }[kind];
    if (elevation == null) return;
    const a = THREE.MathUtils.degToRad(elevation);
    const cam = target
      .clone()
      .addScaledVector(across, Math.cos(a) * distance)
      .addScaledVector(up, Math.sin(a) * distance);
    T.interruptNavigation();
    T.flyTo(target, 0, { cam, frame, duration: 900 });
  };

  // Clicking a ship flies to it and then carries the camera along its lane until the
  // user navigates or the ship leaves the drawn fleet.
  function followShip(route) {
    if (!route.at) return;
    T.setFollowing(false);
    const frame = () => ({ origin: route.at, scale: 1 });
    T.flyTo(new THREE.Vector3(), Math.max(ctx.fleet.routeSpan(route) * 20, T.camera.near * 3), { frame, duration: 1200 });
    frameState.shipFollow = { route, frame, revision: T.navigationRevision, previous: null };
  }
  T.beforeCamera.push(() => {
    const follow = frameState.shipFollow;
    if (!follow) return;
    const { route } = follow;
    if (T.navigationRevision !== follow.revision || route.seen !== frameState.fleetFrame) {
      frameState.shipFollow = null;
      return;
    }
    if (follow.previous && !T.flying) {
      tmp.subVectors(route.at, follow.previous);
      // A looping convoy restarts at its source: fly there instead of jumping.
      if (tmp.length() > ctx.fleet.routeSpan(route) * 40)
        T.flyTo(new THREE.Vector3(), T.camera.position.distanceTo(T.controls.target), {
          frame: follow.frame,
          duration: 900,
        });
      else {
        T.camera.position.add(tmp);
        T.controls.target.add(tmp);
      }
    }
    (follow.previous ||= new THREE.Vector3()).copy(route.at);
  });

  T.cruise = (a, b, opts) => {
    T.cancelFlight();
    T.clearControlMotion();
    T.setFollowing(false);
    frameState.journeyFlight = {
      fromCamera: T.camera.position.clone(),
      fromTarget: T.controls.target.clone(),
      route: { a, b, kind: 'out', progress: 0 },
      elapsed: 0,
      last: null,
      ...opts,
    };
    return true;
  };
  T.cancelCruise = () => {
    frameState.journeyFlight = null;
  };
  function updateCruise(now) {
    const flight = frameState.journeyFlight;
    if (!flight) return;
    if (flight.last != null && !flight.isPaused()) flight.elapsed += Math.min(0.1, (now - flight.last) / 1000);
    flight.last = now;
    if (flight.isPaused()) return;
    const p = (flight.route.progress = Math.min(1, flight.elapsed / 4)),
      curve = ctx.fleet.curveFor(flight.route.a, flight.route.b),
      at = curve.getPoint(p);
    const tangent = curve.getTangent(Math.min(0.999, p));
    const blend = THREE.MathUtils.smoothstep(flight.elapsed, 0, 1.2);
    const chaseDistance = Math.max(ctx.fleet.routeSpan(flight.route) * 20, T.camera.near * 3);
    T.controls.target.lerpVectors(flight.fromTarget, at, blend);
    T.camera.position.lerpVectors(
      flight.fromCamera,
      at
        .clone()
        .add(new THREE.Vector3(0, chaseDistance * 0.55, 0))
        .addScaledVector(tangent, -chaseDistance * 0.85),
      blend,
    );
    if (p === 1) {
      frameState.journeyFlight = null;
      flight.onComplete();
    }
  }
  // ---------- zoom: scroll toward whatever is under the cursor ----------
  // Zooming scales the camera and target about an anchor, so the anchor stays under the cursor. Over a body the anchor is
  // its centre (and the body becomes the focus); once the close-up is open it is the surface point under the cursor, so
  // one continuous scroll goes from the system to a statement. Zooming out eases the target back to the body's centre.
  T.controls.enableZoom = false;
  // Body/surface anchors below own the minimum at every scale, including tiny towns.
  T.controls.minDistance = 0;
  const zoomEl = T.controls.domElement,
    zRay = new THREE.Raycaster(),
    ndc = new THREE.Vector2(),
    za = new THREE.Vector3(),
    zb = new THREE.Vector3();
  const zoom = { log: 0, anchor: null };
  // The body under the cursor, or failing that the one closest to the cursor ray within ~1°, so small moving bodies are easy to aim at.
  const bodyUnder = () => {
    const hit = zRay.intersectObjects(instances.pickBodies)[0];
    if (hit) return hit.object.userData.fileIds[hit.instanceId];
    let best = null,
      bestMiss = 0.02;
    host.data.nodes().forEach(n => {
      const t = zb.subVectors(model.pos[n.i], zRay.ray.origin).dot(zRay.ray.direction);
      if (t <= 0) return;
      const miss = Math.max(0, zRay.ray.distanceToPoint(model.pos[n.i]) - model.orbit[n.i].size) / t;
      if (miss < bestMiss) {
        bestMiss = miss;
        best = n.i;
      }
    });
    return best;
  };
  function anchorFor(zoomIn) {
    const focus = T.pinned;
    if (lod.detail) {
      const i = lod.i,
        min = () => lod.host.minDistance * ctx.detail.bodyScale(i);
      if (!zoomIn) return { i, out: true };
      const p = lod.detail.surfaceHit(ndc);
      return { i, rel: p ? p.sub(model.pos[i]) : T.controls.target.clone().sub(model.pos[i]), min };
    }
    if (zoomIn) {
      const i = bodyUnder();
      if (i != null) {
        if (i !== focus) host.actions.selectFile(i, { fly: false });
        else T.setFollowing(true);
        return { i, rel: new THREE.Vector3(), center: true, min: () => model.orbit[i].size * 1.2 };
      }
    }
    if (focus != null && T.following)
      return zoomIn
        ? { i: focus, rel: T.controls.target.clone().sub(model.pos[focus]), min: () => model.orbit[focus].size * 1.2 }
        : { i: focus, out: true };
    // Empty space: anchor at the depth of the nearest system the cursor ray passes through, else at the target's depth.
    let depth = T.camera.position.distanceTo(T.controls.target);
    const crossed = model.holes
      .map(h => ({ h, t: zRay.ray.closestPointToPoint(h.center, za).distanceTo(T.camera.position) }))
      .filter(
        ({ h }) =>
          za.copy(zRay.ray.direction).dot(zb.subVectors(h.center, T.camera.position)) > 0 &&
          zRay.ray.distanceToPoint(h.center) < model.systems[h.gi].reach,
      )
      .sort((a, b) => a.t - b.t)[0];
    if (crossed) depth = crossed.t;
    return { world: zRay.ray.at(depth, new THREE.Vector3()), min: () => 0.5 * u };
  }
  T.navigation.setZoomHandler(
    (step, x, y) => {
      const r = zoomEl.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1);
      zRay.setFromCamera(ndc, T.camera);
      zoom.anchor = anchorFor(step < 0);
      zoom.log = THREE.MathUtils.clamp(Math.sign(zoom.log) === Math.sign(step) ? zoom.log + step : step, -1.2, 1.2);
    },
    () => {
      zoom.log = 0;
      zoom.anchor = null;
    },
  );
  function applyZoom(t) {
    const dt = frameState.zoomTime == null ? 1 / 60 : Math.min(0.05, Math.max(0, t - frameState.zoomTime));
    frameState.zoomTime = t;
    const a = zoom.anchor;
    if (!a || Math.abs(zoom.log) < 1e-4) return;
    const k = zoom.log * (1 - Math.pow(0.78, dt * 60)),
      cam = T.camera.position,
      tgt = T.controls.target;
    zoom.log -= k;
    let factor = Math.exp(k);
    if (a.out) {
      const c = model.pos[a.i];
      cam.sub(tgt).multiplyScalar(factor).add(tgt);
      const d = cam.distanceTo(c) / model.orbit[a.i].size;
      tgt.lerp(c, Math.min(1, k * 2.5 * THREE.MathUtils.smoothstep(d, 1.2, 5))); // turn back toward the centre while backing away
      if (d > (model.systems[model.orbit[a.i].gi].reach * 3) / model.orbit[a.i].size) T.setFollowing(false);
    } else {
      const C = a.world ? za.copy(a.world) : za.copy(model.pos[a.i]).add(a.rel),
        d = cam.distanceTo(C),
        min = a.min();
      if (factor < 1 && d * factor < min) {
        factor = Math.min(1, min / Math.max(d, 1e-9));
        zoom.log = 0;
      }
      // Toward a body's centre the target converges faster than the camera, so the body drifts to the middle of the view.
      cam.sub(C).multiplyScalar(factor).add(C);
      tgt
        .sub(C)
        .multiplyScalar(a.center ? factor ** 3 : factor)
        .add(C);
    }
    if (cam.length() > model.extent * 4) {
      zb.subVectors(tgt, cam);
      cam.setLength(model.extent * 4);
      tgt.copy(cam).add(zb);
      zoom.log = 0;
    }
  }

  return { updateCruise, followShip };
}
