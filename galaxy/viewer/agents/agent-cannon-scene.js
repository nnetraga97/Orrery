// Owns the cannon rig, aiming, island, context district, station, moon and drones.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { planetBuildBudget } from '../shared/build-budget.js';
import { createCannonRig } from './cannon-rig.js';
import { createSatelliteRig } from './satellite-rig.js';
import { IslandMotion, createSkyIsland } from './sky-island.js';
import { createTerminalMoonRig } from './terminal-moon-rig.js';
import { createContextDistrict } from './context-district.js';

const DRONE_TINT = ['#c38bff', '#6be3e0', '#ffb3a0', '#a0e07c', '#f5b8d8'];

export function createCannonScene(ctx) {
  const { core, root, carry, T, scene, sprite, host, v1, now, stats, v2, u, disposeObj } = ctx.shared;
  const { state } = ctx;
  // ---------- the Meshy cannon: fixed base, yaw mount, pitch hinge, recoil slide and muzzle ----------
  const S = core * 0.3; // normalized platform width is 2.6 units
  const base = new THREE.Group();
  base.scale.setScalar(S);
  root.add(base);
  const restPitch = Math.atan(0.31);
  const motion = {
    shotAt: -10,
    strength: 0,
    recoil: 0,
    pitch: restPitch,
    pitchGoal: restPitch,
    shots: 0,
    ...carry?.motion,
  };
  // These large textured props can first enter the frustum during a landing flight.
  // Prepare one asset at a time so that first visibility does not upload the whole district in one draw.
  let preparation = Promise.resolve();
  const prepareVisual = (object, ready) => {
    object.visible = false;
    void ready
      .then(() => {
        preparation = preparation
          .then(async () => {
            if (state.stopped) return;
            await T.prepareDraw(object, T.camera, scene, planetBuildBudget());
            if (!state.stopped) object.visible = true;
          })
          .catch(error => {
            if (!state.stopped) {
              object.visible = true;
              console.warn('Scene preparation unavailable', error);
            }
          });
      })
      .catch(() => {
        if (!state.stopped) object.visible = true;
      });
  };
  const rig = createCannonRig(base, 2.6);
  prepareVisual(base, rig.ready);
  // The cannon stands on the crown of a sky island three times its old platform's width,
  // which wakes while the agent works and winds down at turn end.
  const island = createSkyIsland({ width: S * 2.6 * 3 });
  root.add(island.group);
  prepareVisual(island.group, island.ready);
  island.ready.catch(error => console.warn('Sky island unavailable', error));
  // On the island the cannon's own platform is hidden: its turning mount sits in the crown
  // socket, inside the island's brass collar.
  rig.ready.then(() => {
    if (state.stopped) return;
    const platform = base.getObjectByName('SM_Cannon_Base'),
      mount = base.getObjectByName('SM_Cannon_Mount'),
      yaw = base.getObjectByName('Cannon_Yaw');
    if (!platform || !mount || !yaw) return;
    platform.visible = false;
    root.updateWorldMatrix(true, true);
    // The barrel makes the full model's bounds asymmetric; seat its fixed turning axis instead.
    const axis = root.worldToLocal(yaw.getWorldPosition(new THREE.Vector3()));
    base.position.x -= axis.x;
    base.position.z -= axis.z;
    root.updateWorldMatrix(true, true);
    const seat = new THREE.Box3().setFromObject(mount);
    base.position.y -= seat.min.y - root.position.y + core * 0.02;
  });
  rig.ready.then(() => {
    if (state.stopped) return;
    if (state.previewButton) state.previewButton.disabled = !rig.state.ready;
    if (rig.state.error) ctx.ui.say(rig.state.error, 30);
  });
  const glbCache = ctx.shared.glbCache;
  const loadGlb = url =>
    glbCache.get(url) ||
    glbCache
      .set(
        url,
        new Promise(ok =>
          new GLTFLoader().load(
            url,
            g => ok(g.scene),
            undefined,
            () => ok(null),
          ),
        ),
      )
      .get(url);
  const kit = name =>
    loadGlb(`assets/kit/space/${name}.glb`).then(s => {
      if (!s) return null;
      const copy = s.clone(true);
      copy.traverse(o => {
        if (o.geometry) o.geometry = o.geometry.clone();
        if (o.material) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      });
      return copy;
    });
  // Kit origins are not centred: wrap a model so it is `width` across, centred on x/z and standing on y = floor.
  const fit = (obj, width, floor = 0) => {
    const box = new THREE.Box3().setFromObject(obj),
      size = box.getSize(new THREE.Vector3()),
      k = width / Math.max(size.x, size.z, 1e-6);
    const wrap = new THREE.Group();
    obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    wrap.add(obj);
    wrap.scale.setScalar(k);
    wrap.position.y = floor;
    wrap.userData.height = size.y * k;
    return wrap;
  };
  const coreGlow = sprite('#7cc4ff', core * 0.9, { opacity: 0.35 });
  coreGlow.position.y = S * 0.5;
  root.add(coreGlow);
  // Context gauge: an illuminated inlay in the dressed crown plaza.
  let gaugeRadius = core * 0.5;
  let gaugeWidth = core * 0.01;
  const gaugeGeometry = (fraction = 1) =>
    new THREE.RingGeometry(
      gaugeRadius - gaugeWidth,
      gaugeRadius + gaugeWidth,
      96,
      1,
      Math.PI / 2,
      -fraction * Math.PI * 2,
    );
  const gaugeBack = new THREE.Mesh(
    gaugeGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#253e46',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  gaugeBack.name = 'Context_Gauge_Track';
  gaugeBack.rotation.x = -Math.PI / 2;
  gaugeBack.position.y = core * 0.075;
  root.add(gaugeBack);
  const gauge = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: '#7cc4ff',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  gauge.name = 'Context_Gauge_Fill';
  gauge.rotation.x = -Math.PI / 2;
  gauge.position.y = gaugeBack.position.y + core * 0.002;
  root.add(gauge);
  island.ready
    .then(() => {
      if (state.stopped || !island.crownRadius) return;
      const inset = island.contextGauge;
      gaugeRadius = inset.radius;
      gaugeWidth = inset.width;
      gaugeBack.position.y = inset.height;
      gauge.position.y = inset.height + island.scale * 0.0004;
      gaugeBack.geometry.dispose();
      gaugeBack.geometry = gaugeGeometry();
      if (state.gaugeFrac >= 0) {
        gauge.geometry.dispose();
        gauge.geometry = gaugeGeometry(state.gaugeFrac);
      }
    })
    .catch(() => {});
  function setGauge(tokens, limit) {
    if (!Number.isFinite(tokens)) return;
    const scale = Number.isFinite(limit) && limit > 0 ? limit : null,
      f = scale ? Math.max(0.002, Math.min(1, tokens / scale)) : 0.002;
    if (Math.abs(f - state.gaugeFrac) < 0.002) return;
    state.gaugeFrac = f;
    gauge.geometry.dispose();
    gauge.geometry = gaugeGeometry(f);
    gauge.material.color.set(f > 0.8 ? '#ff7a5a' : f > 0.55 ? '#ffd66b' : '#7cc4ff');
    ctx.ui.status.context = `${Math.round(tokens / 1000)}k${scale ? ` / ${Math.round(scale / 1000)}k` : ''} context`;
  }
  const contextDistrict = createContextDistrict(root, core, {
    site: island.ready.then(() => island.contextDistrictSite),
    carry: carry?.contextDistrict,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    onChange: () => {
      if (host.windows.context.pinned?.key?.startsWith('context:')) host.windows.context.refresh();
    },
  });
  prepareVisual(contextDistrict.group, contextDistrict.ready);
  contextDistrict.ready.then(() => {
    if (!state.stopped && contextDistrict.state.ready) gauge.visible = gaugeBack.visible = false;
  });
  // Satellite station for MCP / browser tools, and the terminal moon for commands without a file target.
  const stationPos = new THREE.Vector3(core * 2.45, core * 0.6, -core * 0.8),
    moonPos = new THREE.Vector3(-core * 2.35, core * 0.35, core * 1.2);
  const station = new THREE.Group();
  station.position.copy(stationPos);
  station.scale.setScalar(S * 1.4);
  station.name = 'Satellite_Station';
  station.rotation.y = Math.atan2(-stationPos.x, -stationPos.z);
  root.add(station);
  const stationRig = createSatelliteRig(station, 1.4);
  prepareVisual(station, stationRig.ready);
  const stationPoint = new THREE.Vector3();
  const stationTarget = () => stationRig.target(root, stationPoint);
  stationRig.ready.then(() => {
    if (!state.stopped && stationRig.state.error) ctx.ui.say(stationRig.state.error, 30);
  });
  const moon = new THREE.Group();
  moon.name = 'Terminal_Moon';
  moon.position.copy(moonPos);
  moon.rotation.y = Math.atan2(-moonPos.x, -moonPos.z);
  root.add(moon);
  const moonRig = createTerminalMoonRig(moon, core * 0.56, carry?.moon);
  prepareVisual(moon, moonRig.ready);
  const moonPoint = new THREE.Vector3();
  const moonTarget = () => moonRig.target(root, moonPoint);
  moonRig.ready.then(() => {
    if (!state.stopped && moonRig.state.error) ctx.ui.say(moonRig.state.error, 30);
  });
  const muzzle = () =>
    rig.muzzle() ||
    v1
      .set(0, S * 1.6, 0)
      .addScaledVector(aim.dir, S * 0.9)
      .clone();

  // ---------- aim: the turret yaws toward the next target ----------
  const aim = { dir: new THREE.Vector3(0, 0, 1), goal: new THREE.Vector3(0, 0, 1), sweep: 0 };
  if (carry?.aim) {
    aim.dir.fromArray(carry.aim.dir);
    aim.goal.fromArray(carry.aim.goal);
  }
  const aimAt = (p, arc = 0) => {
    aim.goal.copy(p).setY(0);
    const distance = aim.goal.length();
    motion.pitchGoal = THREE.MathUtils.clamp(Math.atan2(p.y - S * 1.2, distance || 1) + arc * 0.65, -0.12, 0.65);
    if (aim.goal.lengthSq() < 1e-6) aim.goal.set(0, 0, 1);
    aim.goal.normalize();
  };

  // ---------- drones: one per subagent, parked on a ring around the cannon ----------
  const drones = new Map(); // spawning tool_use id -> { obj, slot, col, state, t0 }
  const droneIdentities = new Map(carry?.droneIdentities || []),
    droneShots = [];
  function launchDrone(toolId, text, activity = 'running', slotHint) {
    const existing = drones.get(toolId);
    if (existing) {
      if (text) existing.text = text;
      existing.activity = activity;
      Object.assign(droneIdentities.get(toolId) || {}, { text: existing.text, activity });
      existing.dockPending = false;
      if (existing.state === 'dock') {
        existing.state = 'launch';
        existing.t0 = now();
        existing.obj.scale.setScalar(1);
      }
      return existing;
    }
    const slot =
        droneIdentities.get(toolId)?.slot ?? (Number.isInteger(slotHint) && slotHint >= 0 ? slotHint : state.droneSlots++),
      col = DRONE_TINT[slot % DRONE_TINT.length],
      obj = new THREE.Group();
    state.droneSlots = Math.max(state.droneSlots, slot + 1);
    const glow = sprite(col, core * 0.25);
    obj.add(glow);
    kit('craft_speederA').then(m => {
      if (m && !state.stopped) {
        const f = fit(m, S * 0.9);
        f.position.y = -f.userData.height / 2;
        obj.add(f);
      }
    });
    obj.position.copy(muzzle());
    root.add(obj);
    const d = { obj, slot, col, state: 'launch', t0: now(), text, activity };
    drones.set(toolId, d);
    droneIdentities.set(toolId, { slot, col, text, activity });
    if (droneIdentities.size > 256) droneIdentities.delete(droneIdentities.keys().next().value);
    stats.drones++;
    ctx.ui.say(`Drone out · ${text || 'subagent'}`, 3);
    return d;
  }
  const parkOf = d =>
    v2
      .set(
        Math.cos(d.slot * 1.3 + 0.4) * core * 0.95,
        core * (0.35 + 0.08 * (d.slot % 3)),
        Math.sin(d.slot * 1.3 + 0.4) * core * 0.95,
      )
      .clone();
  function dockDrone(toolId, activity = 'completed') {
    const d = drones.get(toolId);
    const identity = droneIdentities.get(toolId);
    if (identity) identity.activity = activity;
    if (d) d.activity = activity;
    if (
      d &&
      (ctx.shots.pendingFire.some(e => e.agent === toolId) ||
        (!state.activeShot?.fired && state.activeShot?.events.some(e => e.agent === toolId)))
    ) {
      d.activity = activity;
      d.dockPending = true;
      return;
    }
    if (d && d.state !== 'dock') {
      d.dockPending = false;
      d.state = 'dock';
      d.activity = activity;
      d.dockFrom = d.obj.position.clone();
      d.t0 = now();
      stats.docked++;
    }
  }

  // The island, cannon and context district are a few hundred separate meshes. Seen from
  // across the galaxy most of them cover less than a pixel and only cost draw calls, so they
  // move to a layer the camera does not render (and rays do not test) until they grow again.
  const SUBPIXEL = 1.5,
    CULLED_LAYER = 1,
    cullBounds = new THREE.Sphere();
  function cullSubpixel() {
    const camera = T.camera;
    if (!camera.isPerspectiveCamera) return;
    const pxPerUnit = T.controls.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    root.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      const geometry = o.geometry;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      cullBounds.copy(geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      const px = (cullBounds.radius * pxPerUnit) / Math.max(1e-6, cullBounds.center.distanceTo(camera.position));
      // Invisible pick proxies stay testable at any size.
      const layer = px < SUBPIXEL && o.material.visible !== false ? CULLED_LAYER : 0;
      if (!o.layers.isEnabled(layer)) o.layers.set(layer);
    });
  }
  function stepAim(dt) {
    // Turret yaw.
    const yawNow = Math.atan2(aim.dir.x, aim.dir.z),
      yawGoal = Math.atan2(aim.goal.x, aim.goal.z);
    const yawDelta = THREE.MathUtils.euclideanModulo(yawGoal - yawNow + Math.PI, Math.PI * 2) - Math.PI;
    const yawNext = yawNow + yawDelta * (1 - Math.exp(-dt * 8));
    aim.dir.set(Math.sin(yawNext), 0, Math.cos(yawNext));
    motion.pitch += (motion.pitchGoal - motion.pitch) * (1 - Math.exp(-dt * 8));
  }

  function stepRig(dt, t, pose) {
    motion.recoil = pose.recoil;
    motion.power = pose.power;
    motion.fill = pose.fill;
    motion.phase = pose.phase;
    rig.step(dt, { ...pose, yaw: Math.atan2(aim.dir.x, aim.dir.z), pitch: motion.pitch });
    stationRig.step(IslandMotion.idle || island.state.level > 0 ? dt : 0);
    moonRig.step(IslandMotion.idle || island.state.level > 0 || moonRig.state.busy ? dt : 0);
    island.waiting(!!state.beacon);
    island.step(dt, t);
    if (ctx.ui.status.mode === 'thinking' && t < ctx.ui.status.until) {
      aim.sweep += dt;
      aim.goal.set(Math.sin(aim.sweep * 0.7), 0, Math.cos(aim.sweep * 0.7));
    }
    // Core glow: charges with orders and thinking, flickers when jammed or stalled.
    state.charge = Math.max(0, state.charge - dt * 0.35);
    state.jam = Math.max(0, state.jam - dt);
    state.stall = Math.max(0, state.stall - dt);
    const pulse = 0.5 + 0.5 * Math.sin(t * (ctx.ui.status.mode === 'thinking' ? 7 : 2.2));
    coreGlow.material.color.set(
      state.jam ? '#ff4d4d' : state.stall ? '#ffb347' : ctx.ui.status.mode === 'waiting' ? '#ffd66b' : '#7cc4ff',
    );
    coreGlow.material.opacity = state.jam
      ? 0.2 + 0.5 * Math.random()
      : 0.25 + 0.45 * state.charge * pulse + (ctx.ui.status.mode === 'firing' ? 0.15 : 0);
    coreGlow.scale.setScalar(core * (0.8 + 0.35 * state.charge));
    if (state.beacon) state.beacon.obj.material.opacity = 0.4 + 0.6 * pulse;
    return pulse;
  }

  function stepDrones(t) {
    // Drones: fly out to their parking slot, idle, and fly home to dock.
    drones.forEach((d, id) => {
      if (d.dockPending) dockDrone(id, d.activity);
      const park = parkOf(d),
        k = Math.min(1, (t - d.t0) / 1.2),
        e = k * k * (3 - 2 * k);
      if (d.state === 'launch') {
        d.obj.position.lerpVectors(v1.set(0, S * 0.75, 0), park, e);
        if (k >= 1) d.state = 'parked';
      } else if (d.state === 'parked') d.obj.position.copy(park).add(v1.set(0, Math.sin(t * 2 + d.slot) * 0.3 * u, 0));
      else {
        d.obj.position.lerpVectors(d.dockFrom || park, v1.set(0, S * 0.6, 0), e);
        d.obj.scale.setScalar(1 - 0.8 * e);
        if (k >= 1) {
          disposeObj(d.obj);
          drones.delete(id);
        }
      }
      d.obj.lookAt(v1.set(0, d.obj.position.y, 0));
    });
  }

  return {
    muzzle,
    motion,
    droneIdentities,
    drones,
    launchDrone,
    parkOf,
    aimAt,
    stationTarget,
    moonTarget,
    rig,
    island,
    droneShots,
    moonRig,
    stationRig,
    S,
    aim,
    contextDistrict,
    base,
    station,
    moon,
    dockDrone,
    setGauge,
    gauge,
    cullSubpixel,
    stepAim,
    stepRig,
    stepDrones,
  };
}
