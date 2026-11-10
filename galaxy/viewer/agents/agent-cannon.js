// Owns cannon assembly, shared session state, frame ordering, carry-over and disposal.
// Agent activity as a cannon at the heart of the galaxy. Provider-neutral work becomes visual rounds:
// tracer rounds for reads, flak for searches, heavy shells for edits, siege shells for writes, mortars for commands,
// turret drones for subagents, long-range beams for the web, and rounds at a satellite station for MCP tools.
// Actions charge the gun before firing. Native edits require disk confirmation; other tool outcomes
// (hit, misfire, blocked) are decided when the result arrives.
// Hit files glow and cool over several minutes. Events come from the project UI or VS Code host.
// Evidence -> simulation -> presentation, as in docs/planet-loading.md: events only enqueue work; the frame step
// advances rounds on wall-clock time and draws them; camera and level-of-detail changes never alter the queue.

import * as THREE from 'three';
import { CannonMotion } from './cannon-motion.js';
import { createAgentJobs } from './agent-jobs.js';
import { glowTex } from '../scene/textures.js';
import { createCannonScene } from './agent-cannon-scene.js';
import { createCannonRounds } from './agent-cannon-rounds.js';
import { createCannonShots } from './agent-cannon-shots.js';
import { createCannonLabels, createCannonUI } from './agent-cannon-ui.js';
import { createCannonActivity } from './agent-cannon-activity.js';

let agentHeatCarry = {}; // dataset -> { path: heat }, so a rebuild keeps the glow
const agentMotionCarry = new Map(); // Keep an in-flight recoil across a dataset refresh.

export function createAgentCannon(T, host) {
  const codebase = host.data.dataset(); // stop may run after the user has selected a different project
  const carry = agentMotionCarry.get(codebase);
  agentMotionCarry.delete(codebase);
  const u = T.unit,
    core = T.coreRadius || 7 * u,
    scene = T.scene;
  const shotSpeed = CannonMotion.defaultSpeed;
  const trailDuration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 1.2 : 10;
  const root = new THREE.Group();
  root.name = 'agent-cannon';
  scene.add(root);
  const v1 = new THREE.Vector3(),
    v2 = new THREE.Vector3();
  const sprite = (col, size, opts = {}) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: col,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        ...opts,
      }),
    );
    s.scale.setScalar(size);
    return s;
  };
  const disposeObj = o => {
    scene.remove(o);
    o.parent?.remove(o);
    o.traverse?.(c => {
      c.geometry?.dispose();
      (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m?.dispose?.());
    });
  };
  const stats = { fired: {}, impacts: 0, misfires: 0, blocked: 0, drones: 0, docked: 0, placeholders: 0, bursts: 0 };
  if (carry?.stats) Object.assign(stats, carry.stats, { fired: { ...carry.stats.fired } });
  // Mutable values shared by the modules live here; containers stay with their owning module.
  const state = {
    agentName: carry?.agentName || 'Agent',
    sessionKey: carry?.sessionKey || null,
    stopped: false,
    settling: null,
    homeTimer: null,
    activeShot: null,
    firingProfile: null,
    beacon: null,
    charge: 0,
    jam: 0,
    stall: 0,
    droneSlots: carry?.droneSlots || 0,
    previewButton: null,
    gaugeFrac: -1,
  };
  const now = () => performance.now() / 1000;
  const ctx = {
    shared: {
      T,
      host,
      codebase,
      carry,
      u,
      core,
      scene,
      root,
      v1,
      v2,
      shotSpeed,
      trailDuration,
      now,
      sprite,
      disposeObj,
      stats,
      heatCarry: agentHeatCarry,
      glbCache: createAgentCannon.cache || (createAgentCannon.cache = new Map()),
    },
    state,
  };
  ctx.world = createCannonScene(ctx);
  // Register the status label before creation effects can restore their labels.
  ctx.ui = createCannonLabels(ctx);
  ctx.rounds = createCannonRounds(ctx);
  ctx.shots = createCannonShots(ctx);
  Object.assign(ctx.ui, createCannonUI(ctx));
  ctx.jobs =
    typeof createAgentJobs === 'function' ? createAgentJobs(T, { core, say: ctx.ui.say, carry: carry?.jobs }) : null;
  ctx.activity = createCannonActivity(ctx);

  // Frame phases retain their original order, including aiming before firing and drones after impacts.
  let prev = performance.now() / 1000;
  T.onFrame.push(() => {
    if (state.stopped) return;
    ctx.world.cullSubpixel();
    const t = now(),
      dt = Math.min(0.1, t - prev);
    prev = t;
    ctx.jobs?.frame(dt);
    ctx.world.contextDistrict.step(dt, T.camera);
    ctx.ui.step(t);
    ctx.shots.stepQueue(t);
    ctx.world.stepAim(dt);
    const pose = ctx.shots.stepCharge(dt);
    const pulse = ctx.world.stepRig(dt, t, pose);
    ctx.ui.stepStatus(t);
    ctx.rounds.step(t, dt, pulse);
    ctx.world.stepDrones(t);
  });

  function stop() {
    ctx.ui.removePicker?.();
    const jobCarry = ctx.jobs?.save();
    ctx.jobs?.dispose();
    if (T.navigationRevision !== ctx.ui.follow.rev) ctx.ui.follow.userAt = now();
    const saveEvent = e => ({
      ...e,
      ...(e.birth
        ? { birth: { path: e.birth.path, entity: e.birth.entity, bytes: e.birth.bytes, preview: e.birth.preview } }
        : {}),
    });
    agentMotionCarry.set(codebase, {
      jobs: jobCarry,
      agentName: state.agentName,
      sessionKey: state.sessionKey,
      droneSlots: state.droneSlots,
      droneIdentities: [...ctx.world.droneIdentities],
      drones: [...ctx.world.drones].map(([id, d]) => ({
        id,
        text: d.text,
        activity: d.activity,
        state: d.state,
        dockPending: d.dockPending,
      })),
      pendingPaths: [...ctx.shots.pendingPaths],
      resolutions: [...ctx.shots.resolutions],
      pendingFire: ctx.shots.pendingFire.filter(e => !e.preview).map(saveEvent),
      activeShot: state.activeShot?.events.some(e => !e.preview)
        ? { ...state.activeShot, events: state.activeShot.events.filter(e => !e.preview).map(saveEvent) }
        : null,
      stats: { ...stats, fired: { ...stats.fired } },
      timing: { ...ctx.shots.timing },
      motion: { ...ctx.world.motion },
      moon: ctx.world.moonRig.capture(),
      contextDistrict: ctx.world.contextDistrict.capture(),
      follow: { last: ctx.ui.follow.last, userAt: ctx.ui.follow.userAt },
      aim: { dir: ctx.world.aim.dir.toArray(), goal: ctx.world.aim.goal.toArray() },
    });
    if (agentMotionCarry.size > 16) agentMotionCarry.delete(agentMotionCarry.keys().next().value);
    state.stopped = true;
    ctx.world.rig.stop();
    ctx.world.stationRig.stop();
    ctx.world.moonRig.stop();
    ctx.world.contextDistrict.stop();
    ctx.shots.births.stop();
    clearTimeout(state.homeTimer);
    agentHeatCarry[codebase] = ctx.rounds.heatSnapshot();
    ctx.ui.removeLabel();
    ctx.ui.hitLabels.forEach(h => h.remove());
    ctx.ui.follow.button?.remove();
    ctx.rounds.rounds.forEach(ctx.rounds.dropRound);
    ctx.rounds.clearTrails();
    ctx.rounds.effects.forEach(e => {
      if (e.obj) disposeObj(e.obj);
      if (e.extra) disposeObj(e.extra);
    });
    ctx.rounds.heat.forEach(e => disposeObj(e.glow));
    ctx.world.drones.forEach(d => disposeObj(d.obj));
    ctx.world.island.dispose();
    disposeObj(root);
    ctx.rounds.ringTex.dispose();
  }
  function setSession(name, key) {
    state.agentName = name || 'Agent';
    if (state.sessionKey === key) return;
    ctx.jobs?.clear();
    state.sessionKey = key;
    ctx.ui.status.context = '';
    state.gaugeFrac = -1;
    ctx.world.gauge.geometry.dispose();
    ctx.world.gauge.geometry = new THREE.BufferGeometry();
    ctx.ui.status.text = state.agentName;
    ctx.ui.status.until = 0;
    ctx.ui.status.mode = 'idle';
    state.activeShot?.events.forEach(e => {
      if (e.birth) ctx.shots.births.form(e.birth);
    });
    state.activeShot = null;
    ctx.world.rig.cancelPreview();
    ctx.world.stationRig.reset();
    ctx.world.moonRig.reset();
    ctx.world.contextDistrict.reset();
    ctx.rounds.rounds.forEach(ctx.rounds.dropRound);
    ctx.rounds.rounds.length = 0;
    ctx.rounds.clearTrails();
    ctx.shots.pendingFire.forEach(e => {
      if (e.birth) ctx.shots.births.form(e.birth);
    });
    ctx.shots.pendingFire.length = 0;
    ctx.shots.resolutions.clear();
    ctx.shots.pendingPaths.clear();
    ctx.ui.recent.length = 0;
    for (const b of ctx.shots.beamsByTool.values()) b.hold.done = true;
    ctx.shots.beamsByTool.clear();
    ctx.world.drones.forEach(d => disposeObj(d.obj));
    ctx.world.drones.clear();
    ctx.world.droneIdentities.clear();
    ctx.world.droneShots.length = 0;
    if (state.beacon) {
      disposeObj(state.beacon.obj);
      state.beacon = null;
    }
    clearTimeout(state.homeTimer);
    ctx.ui.follow.home = false;
  }
  // Before a rebuild replaces this cannon: let rounds in the air land (at most `limit` ms) and hold new ones in the
  // queue, which carries over to the next cannon.
  function settle(limit = 4000) {
    return new Promise(done => {
      const finish = () => {
        clearTimeout(timer);
        state.settling = null;
        done();
      };
      const timer = setTimeout(finish, limit);
      state.settling = finish;
    });
  }
  // A dataset rebuild replaces meshes, not active agent identities or their tint.
  for (const saved of carry?.drones || []) {
    const d = ctx.world.launchDrone(saved.id, saved.text, saved.activity);
    stats.drones--;
    d.state = saved.state === 'dock' ? 'dock' : 'parked';
    d.obj.position.copy(ctx.world.parkOf(d));
    d.dockFrom = d.obj.position.clone();
    d.dockPending = saved.dockPending;
  }
  const api = {
    ingest: ctx.activity.ingest,
    island: ctx.world.island,
    settle,
    stop,
    setSession,
    heatSnapshot: ctx.rounds.heatSnapshot,
    frameWorkspace: ctx.ui.frameWorkspace,
    focusCannon: () => ctx.ui.focusObject(ctx.world.island.group, new THREE.Vector3(0, core * 0.1, 0)),
    contextSnapshot: () => ctx.world.contextDistrict.snapshot(),
    previewContext: id => ctx.world.contextDistrict.preview(id),
    preview: () => ctx.world.rig.preview(),
    previewCreation: ctx.shots.previewCreation,
    randomFire: on => (on === undefined ? ctx.shots.randomFire.on : ctx.shots.setRandomFire(on)),
    rigSnapshot: () => ctx.world.rig.snapshot(),
    stationSnapshot: () => ctx.world.stationRig.snapshot(),
    previewStation: name => ctx.world.stationRig.preview(name),
    moonSnapshot: () => ctx.world.moonRig.snapshot(),
    previewMoon: name => ctx.world.moonRig.preview(name),
    muzzle: () => ctx.world.muzzle(),
    droneSnapshot: () =>
      [...ctx.world.drones].map(([id, d]) => {
        const world = d.obj.getWorldPosition(new THREE.Vector3()),
          screen = world.clone().project(T.camera);
        const rect = T.controls.domElement.getBoundingClientRect();
        return {
          id,
          label: d.text,
          state: d.state,
          activity: d.activity,
          slot: d.slot,
          color: d.col,
          position: world.toArray(),
          screen: {
            x: rect.left + ((screen.x + 1) * rect.width) / 2,
            y: rect.top + ((1 - screen.y) * rect.height) / 2,
          },
        };
      }),
    stats: () => ({
      ...stats,
      creationImpacts: [...ctx.rounds.creationImpacts],
      timing: {
        samples: ctx.shots.timing.count,
        receivedAverageMs: ctx.shots.timing.count ? ctx.shots.timing.receivedTotalMs / ctx.shots.timing.count : null,
        queueAverageMs: ctx.shots.timing.count ? ctx.shots.timing.queueTotalMs / ctx.shots.timing.count : null,
        eventAverageMs: ctx.shots.timing.eventCount ? ctx.shots.timing.eventTotalMs / ctx.shots.timing.eventCount : null,
        actionSamples: ctx.shots.timing.actionCount,
        actionAverageMs: ctx.shots.timing.actionCount ? ctx.shots.timing.actionTotalMs / ctx.shots.timing.actionCount : null,
        maxReceivedMs: ctx.shots.timing.maxReceivedMs,
      },
      jobs: ctx.jobs?.snapshot(),
      waiting: !!state.beacon,
      creations: ctx.shots.births.stats(),
      live: ctx.rounds.rounds.length,
      pending: ctx.rounds.rounds.filter(r => r.phase === 'pending').length,
      queued: ctx.shots.pendingFire.length + (state.activeShot && !state.activeShot.fired ? state.activeShot.events.length : 0),
      trails: ctx.rounds.trails.length,
      fadingTrails: ctx.rounds.trails.filter(trail => trail.done).length,
      hot: [...ctx.rounds.heat.keys()],
      drones: ctx.world.drones.size,
      launched: stats.drones,
      droneShots: [...ctx.world.droneShots],
      label: ctx.ui.label.text,
      motion: {
        ready: ctx.world.rig.state.ready,
        shots: ctx.world.motion.shots,
        power: ctx.world.motion.power,
        fill: ctx.world.motion.fill,
        phase: ctx.world.motion.phase,
        recoil: ctx.world.motion.recoil,
        pitch: ctx.world.motion.pitch,
        yaw: Math.atan2(ctx.world.aim.dir.x, ctx.world.aim.dir.z),
      },
    }),
  };
  return api;
}
