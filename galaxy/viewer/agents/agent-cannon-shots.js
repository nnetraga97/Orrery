// Owns shot queues, salvos, creation readiness, previews and firing diagnostics.
import * as THREE from 'three';
import { CannonMotion } from './cannon-motion.js';
import { createCreationEffects } from './creation-effects.js';
import { trace } from '../scene/diagnostics.js';

export const AMMO_STYLE = {
  tracer: { col: '#9fe8ff', size: 0.55, speed: 0.45, arc: 0.04 },
  flak: { col: '#ffd66b', size: 0.9, speed: 0.55, arc: 0.1 },
  shell: { col: '#ff8a3d', size: 1.25, speed: 1.0, arc: 0.32 },
  siege: { col: '#ff4d6d', size: 1.9, speed: 1.3, arc: 0.5 },
  genesis: { col: '#ffd36b', size: 1.4, speed: 1.1, arc: 0.42 },
  mortar: { col: '#b7ff6b', size: 1.0, speed: 1.15, arc: 0.85 },
  station: { col: '#c7b8ff', size: 0.6, speed: 0.4, arc: 0.15 },
  drone: { col: '#c38bff', size: 0.9, speed: 0.9, arc: 0.2 },
};

export function createCannonShots(ctx) {
  const { carry, codebase, T, host, stats, u, root, core, now, v1, disposeObj, sprite, shotSpeed } = ctx.shared;
  const { state } = ctx;
  const timing = {
    count: 0,
    eventCount: 0,
    eventTotalMs: 0,
    receivedTotalMs: 0,
    queueTotalMs: 0,
    actionCount: 0,
    actionTotalMs: 0,
    maxReceivedMs: 0,
    ...carry?.timing,
  };
  function recordShot(ev, ammo) {
    if (!ev || ev.preview) return;
    const firedAt = Date.now(),
      receivedAt = ev.viewerReceivedAt || ev.queuedAt || firedAt;
    const receivedMs = Math.max(0, firedAt - receivedAt),
      queueMs = Math.max(0, firedAt - (ev.queuedAt || receivedAt));
    const eventAt = ev.timestamp || ev.t;
    const eventMs = Number.isFinite(eventAt) ? firedAt - eventAt : null;
    const actionMs =
      ['provider', 'duration'].includes(ev.timingSource) && Number.isFinite(ev.startedAt)
        ? firedAt - ev.startedAt
        : null;
    timing.count++;
    timing.receivedTotalMs += receivedMs;
    timing.queueTotalMs += queueMs;
    timing.maxReceivedMs = Math.max(timing.maxReceivedMs, receivedMs);
    if (eventMs !== null && eventMs >= 0) {
      timing.eventCount++;
      timing.eventTotalMs += eventMs;
    }
    if (actionMs !== null && actionMs >= 0) {
      timing.actionCount++;
      timing.actionTotalMs += actionMs;
    }
    trace('cannon-fired', {
      eventId: ev.id,
      operationId: ev.operationId,
      projectId: codebase,
      ammo,
      source: ev.source,
      firedAt,
      receivedAt,
      queuedAt: ev.queuedAt,
      eventAt,
      eventMs,
      receivedMs,
      queueMs,
      actionMs,
      timingSource: ev.timingSource,
    });
  }
  const pendingFire = [],
    resolutions = new Map(carry?.resolutions || []); // toolId -> resolve event that arrived before its round
  const waitingPaths = new Set(
    [...(carry?.pendingFire || []), ...(carry?.activeShot && !carry.activeShot.fired ? carry.activeShot.events : [])]
      .filter(e => e.birth)
      .map(e => e.birth.path),
  );
  const births = createCreationEffects(T, codebase, { waitingPaths, getNodes: host.data.nodes });
  const restoreEvent = e => ({ ...e, ...(e.birth ? { birth: births.reserve(e.birth) } : {}) });
  pendingFire.push(...(carry?.pendingFire || []).map(restoreEvent));
  if (carry?.activeShot) state.activeShot = { ...carry.activeShot, events: carry.activeShot.events.map(restoreEvent) };

  // ---------- events -> work ----------
  const files = ev => (ev.files || []).map(p => ({ p, i: T.fileIndex(p) }));
  function reserveBirth(ev) {
    const r = births.reserve(ev);
    if (!r || r.claimed) return null;
    r.claimed = true;
    if (r.entity === 'file' && !r.counted) {
      stats.placeholders++;
      r.counted = true;
    }
    return r;
  }
  function queueCreation(ev) {
    const birth = reserveBirth(ev);
    if (!birth) return null;
    queueFire({
      ...ev,
      birth,
      ammo: 'genesis',
      files: [birth.path],
      label: `${ev.preview ? 'Local preview' : 'Created'} · ${birth.profile.title.toLowerCase()}`,
    });
    return birth;
  }
  function previewCreation(kind = 'directory') {
    const examples = {
      directory: 'src/new-feature',
      code: 'src/new-feature/module.ts',
      test: 'tests/module.test.ts',
      config: 'settings.yaml',
      data: 'data/records.json',
      asset: 'assets/model.glb',
      document: 'docs/guide.md',
    };
    const path = '__creation_preview__/' + (examples[kind] || examples.code);
    births.forget(path);
    const birth = queueCreation({
      kind: 'entity-created',
      entity: kind === 'directory' ? 'directory' : 'file',
      path,
      preview: true,
    });
    if (birth && !T.landedDetail?.()) T.flyTo(births.target(birth)(), u * 28, { duration: 750 });
    ctx.ui.say('Local creation preview', 3, 'preview');
  }
  function emitterOf(ev) {
    const known = ctx.world.droneIdentities.get(ev.agent);
    const d = ev.agent
      ? ctx.world.drones.get(ev.agent) ||
        (known && !['running', 'pendingInit'].includes(known.activity) ? null : ctx.world.launchDrone(ev.agent))
      : null;
    if (!d && known) return { from: ctx.world.parkOf(known).add(root.position), col: known.col };
    return d ? { from: d.obj.position.clone().add(root.position), col: d.col } : {};
  }
  function aimEvent(ev) {
    const f = files(ev).find(f => f.i != null);
    if (ev.birth) ctx.world.aimAt(births.target(ev.birth)(), AMMO_STYLE[ev.ammo]?.arc || 0);
    else if (f) ctx.world.aimAt(T.bodyPos(f.i), AMMO_STYLE[ev.ammo]?.arc || 0);
    else if (ev.ammo === 'station') ctx.world.aimAt(ctx.world.stationTarget());
    else if (ev.ammo === 'mortar') ctx.world.aimAt(ctx.world.moonTarget(), AMMO_STYLE.mortar.arc);
    else {
      const target = ev.aimPoint
        ? new THREE.Vector3().fromArray(ev.aimPoint)
        : ev.ammo === 'flak'
          ? new THREE.Vector3(0.4, 1.2, 0.3).normalize().multiplyScalar(core * 1.6)
          : ev.files?.length && ev.ammo === 'siege'
            ? ctx.rounds.spotFor(ev.files[0])()
            : ctx.rounds.offMap()();
      ev.aimPoint = target.toArray();
      ctx.world.aimAt(target, AMMO_STYLE[ev.ammo]?.arc || 0);
    }
  }
  // Random fire: a local preview that keeps the gun turning and shooting at random planets.
  // Its shots warm the planets they hit like real work, but carry `preview`: they count no hits and are never saved.
  const randomFire = { on: false, next: 0, shots: 0 };
  const RANDOM_AMMO = ['tracer', 'shell', 'siege', 'mortar'];
  function setRandomFire(on) {
    randomFire.on = !!on;
    randomFire.next = 0;
    ctx.ui.say(randomFire.on ? 'Random fire · local preview' : 'Random fire off', 2.5, 'preview');
    return randomFire.on;
  }
  function fireRandomly(t) {
    if (!randomFire.on || t < randomFire.next || pendingFire.length || state.activeShot) return;
    randomFire.next = t + 0.8 + Math.random() * 1.4;
    const nodes = host.data.nodes() || [];
    if (!nodes.length) return;
    const node = nodes[Math.floor(Math.random() * nodes.length)];
    const ammo = RANDOM_AMMO[Math.floor(Math.random() * RANDOM_AMMO.length)];
    randomFire.shots++;
    queueFire({
      kind: 'fire',
      preview: true,
      ammo,
      files: [node.path],
      label: `Random fire · ${String(node.path).split('/').pop()}`,
    });
  }
  function queueFire(ev) {
    ctx.world.rig.cancelPreview();
    if (pendingFire.length >= 128) {
      trace('cannon-skipped', {
        eventId: ev.id,
        projectId: codebase,
        reason: 'queue-cap',
        pending: pendingFire.length,
      });
      stats.merged = (stats.merged || 0) + 1;
      if (ev.birth) births.form(ev.birth);
      return;
    }
    const queuedAt = Date.now();
    pendingFire.push({ ...ev, queuedAt, readyAt: now() + 0.06 });
    trace('cannon-queued', {
      eventId: ev.id,
      projectId: codebase,
      ammo: ev.ammo,
      queuedAt,
      pending: pendingFire.length,
    });
  }
  function doFire(ev) {
    if (ev.birth && births.readiness(ev.birth) !== 'ready') {
      trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'creation-deleted-before-shot' });
      return;
    }
    ctx.world.island.ripple();
    const em = ev.workspace ? { col: '#cfe6ff' } : emitterOf(ev),
      fs = files(ev),
      hit = fs.find(f => f.i != null);
    if (ev.agent && em.from) {
      ctx.world.droneShots.push({ agent: ev.agent, toolId: ev.toolId, ammo: ev.ammo, color: em.col, from: em.from.toArray() });
      if (ctx.world.droneShots.length > 32) ctx.world.droneShots.shift();
    }
    switch (ev.ammo) {
      case 'tracer':
      case 'shell':
      case 'siege':
      case 'genesis': {
        const target = ev.birth
          ? births.target(ev.birth)
          : hit
            ? ctx.rounds.targetOf(hit.i)
            : ev.aimPoint
              ? () => new THREE.Vector3().fromArray(ev.aimPoint)
              : fs.length && ev.ammo === 'siege'
                ? ctx.rounds.spotFor(fs[0].p)
                : ctx.rounds.offMap();
        // A change seen on disk arrives already decided: it lands as a hit with its line counts.
        const res =
          ev.kind === 'file-change'
            ? {
                ok: true,
                tool: 'change',
                files: ev.files,
                lines: ev.lines,
                added: ev.added,
                removed: ev.removed,
                changed: (ev.added || 0) + (ev.removed || 0),
                created: ev.created,
              }
            : null;
        ctx.world.aimAt(target(), AMMO_STYLE[ev.ammo].arc);
        ctx.rounds.spawn(ev.ammo, target, ev, {
          ...em,
          file: hit?.i ?? null,
          path: fs[0]?.p,
          birth: ev.birth,
          ...(ev.birth && !em.col ? { col: ev.birth.profile.color } : {}),
          ...(ev.failure
            ? { res: ev.failure, noResolve: true }
            : res
              ? { res, noResolve: true }
              : ev.ammo === 'genesis'
                ? { noResolve: true }
                : {}),
        });
        if (ev.ammo !== 'tracer' && hit) ctx.ui.focusOn(hit.i);
        ctx.ui.say(ev.label, 2.5, 'firing');
        break;
      }
      case 'mortar': {
        const target = hit ? ctx.rounds.targetOf(hit.i) : ctx.world.moonTarget;
        ctx.world.aimAt(target(), AMMO_STYLE.mortar.arc);
        const round = ctx.rounds.spawn('mortar', target, ev, {
          ...em,
          file: hit?.i ?? null,
          ...(!hit ? { onLand: (_at, result) => ctx.world.moonRig.finish(ev.toolId, result?.ok) } : {}),
        });
        if (!hit && round) {
          ctx.world.moonRig.command(ev.toolId);
          const result = resolutions.get(ev.toolId);
          if (result) ctx.world.moonRig.finish(ev.toolId, result.ok);
        }
        ctx.ui.say(ev.label, 2.5, 'firing');
        break;
      }
      case 'flak': {
        // A shell that bursts over the core; fragments fly to every match once the result is known.
        const burstAt = ev.aimPoint
          ? new THREE.Vector3().fromArray(ev.aimPoint)
          : new THREE.Vector3(0.4, 1.2, 0.3).normalize().multiplyScalar(core * 1.6);
        ctx.world.aimAt(burstAt);
        ctx.rounds.spawn('flak', () => burstAt, ev, {
          ...em,
          onLand: (at, res) => {
            ctx.rounds.flash(at, '#ffd66b', 3 * u, 0.7);
            if (!res?.ok) return;
            const hits = files(res)
              .filter(f => f.i != null)
              .slice(0, 24);
            hits.forEach(f =>
              ctx.rounds.spawn('tracer', ctx.rounds.targetOf(f.i), null, { from: at, col: em.col || '#ffe9a3', file: f.i, noResolve: true }),
            );
            if (!hits.length) ctx.ui.say(`${res.tool}: ${res.matches ?? 0} matches, none on the map`, 3);
          },
        });
        ctx.ui.say(ev.label, 2.5, 'firing');
        break;
      }
      case 'drone':
        ctx.world.launchDrone(ev.toolId, ev.label);
        break;
      case 'beam': {
        const far = ev.aimPoint
          ? new THREE.Vector3().fromArray(ev.aimPoint)
          : new THREE.Vector3(0.4, 0.9, -0.4).normalize().multiplyScalar(T.galaxyExtent * 2.6);
        ctx.world.aimAt(far);
        beamsByTool.set(ev.toolId, ctx.rounds.beam(em.from || ctx.world.muzzle(), far, em.col || '#9fd0ff', 1.6, { done: false }));
        recordShot(ev, 'beam');
        ctx.ui.say(ev.label, 3);
        break;
      }
      case 'station':
        ctx.world.aimAt(ctx.world.stationTarget());
        ctx.world.stationRig.receive();
        ctx.rounds.spawn('station', ctx.world.stationTarget, ev, em);
        ctx.ui.say(ev.label, 2);
        break;
      case 'belt':
        ctx.ui.say(ev.label, 2);
        ctx.rounds.flash(ctx.world.muzzle(), '#ffd66b', 1.5 * u, 0.5);
        break;
      case 'load':
        ctx.ui.say(ev.label, 2);
        ctx.rounds.shockwave(v1.set(0, ctx.world.S * 0.5, 0).clone(), '#6be3e0', core * 0.5, 0.8);
        break;
      case 'beacon':
        if (resolutions.has(ev.toolId) && !resolutions.get(ev.toolId).awaitingAnswer) break;
        if (state.beacon) disposeObj(state.beacon.obj);
        state.beacon = { toolId: ev.toolId, obj: sprite('#ffd66b', core * 0.3) };
        state.beacon.obj.position.set(0, core * 0.75, 0);
        root.add(state.beacon.obj);
        ctx.ui.say('Waiting for you', 60, 'waiting');
        break;
    }
  }
  const pendingPaths = new Map(carry?.pendingPaths || []); // viaDisk tool id -> its fire event (to aim a failed edit's misfire)
  const beamsByTool = new Map();
  function stepQueue(t) {
    fireRandomly(t);
    // One bounded charge cycle; files from one operation or a workspace burst share a salvo.
    // Only presentation time accelerates under backlog. Every retained event still reaches its target.
    for (let q = pendingFire.length - 1; q >= 0; q--) {
      const ev = pendingFire[q];
      if (ev.birth && births.readiness(ev.birth) === 'deleted') {
        pendingFire.splice(q, 1);
        trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'creation-deleted-before-shot' });
      }
    }
    const ready = ev => t >= ev.readyAt && (!ev.birth || births.readiness(ev.birth) === 'ready');
    const nextReady = pendingFire.findIndex(ready);
    if (ctx.world.rig.state.ready && !state.settling && !state.activeShot && nextReady >= 0) {
      const first = pendingFire.splice(nextReady, 1)[0];
      if (
        first.agent ||
        !['tracer', 'flak', 'shell', 'siege', 'genesis', 'mortar', 'station', 'beam'].includes(first.ammo)
      )
        doFire(first);
      else {
        const events = [first];
        if ((first.toolId || first.workspace) && ['file-change', 'entity-created'].includes(first.kind)) {
          for (let q = 0; q < pendingFire.length && events.length < 16;) {
            const next = pendingFire[q];
            if (
              (first.workspace ? next.workspace : !next.workspace && next.toolId === first.toolId) &&
              next.agent === first.agent &&
              (!next.birth || births.readiness(next.birth) === 'ready') &&
              ['file-change', 'entity-created'].includes(next.kind)
            )
              events.push(...pendingFire.splice(q, 1));
            else q++;
          }
        }
        const measured = {
          ...first,
          operationFiles: Math.max(first.operationFiles || 0, events.length),
          changed: events.reduce((sum, e) => sum + Math.max(e.changed || 0, (e.added || 0) + (e.removed || 0)), 0),
          created: events.some(e => e.created || e.kind === 'entity-created'),
          entity: events.some(e => e.entity !== 'directory') ? 'file' : 'directory',
          bytes: events.reduce((n, e) => n + (e.created || e.kind === 'entity-created' ? e.bytes || 0 : 0), 0),
        };
        state.activeShot = {
          events,
          profile: CannonMotion.profile(measured),
          elapsed: 0,
          fired: false,
          tempo: Math.min(3, 1 + pendingFire.length * 0.12),
        };
        aimEvent(first);
        ctx.ui.say(
          `Charging · ${first.label || first.files?.[0] || 'action'}`,
          state.activeShot.profile.duration / shotSpeed,
          'charging',
        );
      }
    }
    // Keep a charging gun aimed at the moving body it will actually hit.
    if (state.activeShot && !state.activeShot.fired) aimEvent(state.activeShot.events[0]);
  }

  function stepCharge(dt) {
    let pose = { phase: 'idle', recoil: 0, fill: 0, power: 0 };
    if (ctx.world.rig.state.ready && state.activeShot) {
      state.activeShot.elapsed += dt * state.activeShot.tempo * shotSpeed;
      pose = CannonMotion.sample(state.activeShot.profile, state.activeShot.elapsed);
      // Sample the charged muzzle before recoil, so the projectile starts at the actual exit.
      if (!state.activeShot.fired && state.activeShot.elapsed >= state.activeShot.profile.fireAt) {
        ctx.world.rig.step(0, { yaw: Math.atan2(ctx.world.aim.dir.x, ctx.world.aim.dir.z), pitch: ctx.world.motion.pitch });
        state.firingProfile = state.activeShot.profile;
        state.activeShot.events.forEach(doFire);
        state.firingProfile = null;
        state.activeShot.fired = true;
      }
      if (pose.done) state.activeShot = null;
    }
    return pose;
  }

  return {
    pendingFire,
    births,
    recordShot,
    resolutions,
    previewCreation,
    randomFire,
    setRandomFire,
    pendingPaths,
    files,
    queueFire,
    queueCreation,
    reserveBirth,
    beamsByTool,
    timing,
    stepQueue,
    stepCharge,
  };
}
