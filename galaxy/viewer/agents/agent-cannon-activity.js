// Owns provider-neutral event ingestion and dispatch to the cannon subsystems.
import * as THREE from 'three';
import { AgentEvents } from './agent-events.js';
import { trace } from '../scene/diagnostics.js';

export function createCannonActivity(ctx) {
  const { codebase, T, v1, core, now, disposeObj, u } = ctx.shared;
  const { state } = ctx;
  function ingest(ev) {
    ev = { ...ev, viewerReceivedAt: ev.viewerReceivedAt || Date.now() };
    ev = AgentEvents?.toVisual(ev) || ev;
    trace('cannon-received', {
      eventId: ev.id,
      eventType: ev.type,
      projectId: codebase,
      kind: ev.kind,
      source: ev.source,
      confidence: ev.attribution?.confidence,
    });
    // Child control flow cannot reset the parent gun, context meter, or queued shots.
    if (
      ev.childAgent &&
      ['session', 'session-ended', 'prompt', 'turn-end', 'interrupt', 'usage', 'compact'].includes(ev.kind)
    ) {
      trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'child-control-flow' });
      return;
    }
    ctx.world.contextDistrict.ingest(ev);
    if (['prompt', 'fire', 'interrupt'].includes(ev.kind)) ctx.world.rig.cancelPreview();
    ctx.ui.remember(ev);
    if (ctx.jobs?.accept(ev)) {
      trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'represented-by-job-effect' });
      return;
    }
    if (['prompt', 'thinking', 'text', 'fire'].includes(ev.kind)) ctx.world.island.wake();
    if (ev.kind === 'turn-end' || ev.kind === 'interrupt') ctx.world.island.sleep();
    switch (ev.kind) {
      case 'evidence-update':
        ctx.ui.say(`Attribution updated · ${ev.path}`, 2);
        break;
      case 'job-update':
        if (ev.progress) ctx.ui.say(`${ev.label || ev.action} · ${ev.progress.completed}/${ev.progress.total}`, 2);
        break;
      case 'question-wait':
        ctx.shots.resolutions.set(ev.toolId, ev);
        break;
      case 'session':
        state.agentName = ev.displayName || ev.provider || 'Agent';
        break;
      case 'error':
        ctx.ui.say(ev.text || 'Agent error', 6, 'stalled');
        break;
      case 'workspace-change': {
        trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'bulk-or-non-source-workspace-change' });
        if (ev.created) {
          const birth = ctx.shots.births.reserve({
            ...ev,
            kind: ev.entity === 'directory' || !ev.files?.length ? 'entity-created' : 'file-change',
          });
          if (birth) ctx.shots.births.form(birth);
        }
        const i = ev.files?.length ? T.fileIndex(ev.files[0]) : null;
        if (i != null && !ev.deleted) {
          ctx.rounds.addHeat(ev.files[0], 0.2);
          ctx.ui.hitLabel(ctx.rounds.targetOf(i), 'Workspace change', '#cfe6ff');
        }
        break;
      }
      case 'prompt': {
        const from = new THREE.Vector3(-0.3, 1, 0.5).normalize().multiplyScalar(T.galaxyExtent * 2.2);
        ctx.rounds.beam(from, v1.set(0, ctx.world.S * 0.5, 0).clone(), '#e8f4ff', 1.0);
        state.charge = 1;
        ctx.ui.say(ev.queuedBehind ? 'Prompt queued' : 'New orders', 2.5, 'working');
        break;
      }
      case 'thinking':
        state.charge = Math.max(state.charge, 0.8);
        ctx.ui.say('Thinking…', 2.5, 'thinking');
        break;
      case 'text':
        ctx.rounds.shockwave(v1.set(0, ctx.world.S * 0.6, 0).clone(), '#cfe6ff', core * 0.6, 1.2);
        ctx.ui.say(ev.text.split(/(?<=[.!?])\s/)[0].slice(0, 70), 4);
        break;
      case 'fire':
        if (ev.viaDisk) {
          trace('cannon-skipped', { eventId: ev.id, projectId: codebase, reason: 'awaiting-disk-evidence' });
          ctx.shots.pendingPaths.set(ev.toolId, ev);
          if (ctx.shots.pendingPaths.size > 256) ctx.shots.pendingPaths.delete(ctx.shots.pendingPaths.keys().next().value);
        }
        // Native edit intent aims; only confirmed disk evidence launches a shell.
        if (ev.viaDisk) {
          const f = ctx.shots.files(ev).find(x => x.i != null);
          if (f) ctx.world.aimAt(T.bodyPos(f.i));
          ctx.ui.say(ev.label, 2.5, 'firing');
          break;
        }
        ctx.shots.queueFire(ev);
        break;
      case 'entity-created':
        ctx.shots.queueCreation(ev);
        break;
      case 'entity-deleted':
        ctx.shots.births.forget(ev.path);
        break;
      case 'file-change': {
        const intent = ctx.shots.pendingPaths.get(ev.toolId) || ctx.shots.resolutions.get(ev.toolId);
        ev = {
          ...ev,
          operationFiles: intent?.files?.length || ev.operationFiles,
          operationLines: intent?.changed || ev.operationLines,
        };
        if (ev.deleted) ctx.shots.births.forget(ev.files[0]);
        ctx.shots.queueFire({
          ...ev,
          birth: ev.created ? ctx.shots.reserveBirth(ev) : null,
          ammo: ev.created ? 'siege' : 'shell',
          label: `${ev.workspace ? 'Workspace · ' : ''}${ev.files[0]}`,
        });
        break;
      }
      case 'resolve': {
        // A failed edit changes nothing on disk, so show its misfire here.
        if (ev.viaDisk && !ev.ok) {
          const f = ctx.shots.files(ev)[0] || ctx.shots.files(ctx.shots.pendingPaths.get(ev.toolId) || {})[0];
          ctx.shots.pendingPaths.delete(ev.toolId);
          ctx.shots.queueFire({
            ...ev,
            kind: 'fire',
            ammo: 'shell',
            files: f ? [f.p] : [],
            failure: { ...ev },
            label: 'Failed edit',
          });
          break;
        }
        ctx.shots.resolutions.set(ev.toolId, ev);
        ctx.world.moonRig.finish(ev.toolId, ev.ok);
        if (ctx.shots.resolutions.size > 512) ctx.shots.resolutions.delete(ctx.shots.resolutions.keys().next().value);
        ctx.shots.pendingPaths.delete(ev.toolId);
        const round = ctx.rounds.rounds.find(x => x.toolId === ev.toolId && x.phase !== 'done');
        if (ev.ok && ev.created && !ev.viaDisk) {
          const birth = ctx.shots.reserveBirth(ev);
          if (birth) {
            const queued =
              ctx.shots.pendingFire.find(x => x.toolId === ev.toolId) ||
              (!state.activeShot?.fired && state.activeShot?.events.find(x => x.toolId === ev.toolId));
            if (round) {
              round.opts.birth = birth;
              round.target = ctx.shots.births.target(birth);
              round.col = birth.profile.color;
              round.head.material.color.set(round.col);
              round.trail.material.color.set(round.col);
              ctx.shots.births.launch(birth, round);
            } else if (queued) queued.birth = birth;
            else {
              birth.claimed = false;
              ctx.shots.queueCreation(ev);
            }
          }
        }
        if (round?.phase === 'pending') ctx.rounds.finish(round, ev);
        const b = ctx.shots.beamsByTool.get(ev.toolId);
        if (b) {
          b.hold.done = true;
          b.t0 = now() - b.growTime;
          ctx.shots.beamsByTool.delete(ev.toolId);
        }
        if (state.beacon?.toolId === ev.toolId) {
          disposeObj(state.beacon.obj);
          state.beacon = null;
          ctx.ui.say(state.agentName, 0.1, 'working');
        }
        if (ev.ammo === 'drone' && !ev.background) ctx.world.dockDrone(ev.toolId); // background subagents dock on their task notification
        if (ev.denied) ctx.rounds.shockwave(ctx.world.muzzle(), '#7cc4ff', core * 0.35, 0.8); // shield plate in front of the barrel
        if (((ev.action === 'repository' && ev.revision) || (ev.action === 'command' && ev.commit)) && ev.ok)
          ctx.rounds.heat.forEach((_, path) => {
            const i = T.fileIndex(path);
            if (i != null) ctx.rounds.flash(T.bodyPos(i).clone(), '#ffffff', T.bodySize(i) * 3, 1.2, { follow: ctx.rounds.targetOf(i) });
          });
        break;
      }
      case 'drone-launch':
        if (ev.subagent && ev.toolId) ctx.world.launchDrone(ev.toolId, ev.label, ev.state, ev.ordinal);
        break;
      case 'drone-dock':
        ctx.world.dockDrone(ev.toolId, ev.state);
        break;
      case 'usage':
        ctx.world.setGauge(ev.context, ev.contextLimit);
        break;
      case 'compact':
        ctx.rounds.shockwave(v1.set(0, ctx.world.S * 0.5, 0).clone(), '#ffffff', core * 1.2, 1.6);
        ctx.rounds.smoke(v1.set(0, ctx.world.S, 0).clone(), '#cfd8ea', 2 * u);
        if (Number.isFinite(ev.post)) ctx.world.setGauge(ev.post, ctx.world.contextDistrict.snapshot().limit);
        ctx.ui.say('Compacting memory', 3);
        break;
      case 'stall':
        state.stall = 3;
        ctx.ui.say(ev.error ? `Stalled · ${ev.error.slice(0, 60)}` : `Retrying (${ev.attempt}/${ev.max})`, 5, 'stalled');
        break;
      case 'interrupt':
        state.activeShot?.events.forEach(e => {
          if (e.birth) ctx.shots.births.form(e.birth);
        });
        state.activeShot = null;
        state.jam = 2;
        ctx.shots.pendingFire.forEach(ev => {
          if (ev.birth) ctx.shots.births.form(ev.birth);
        });
        ctx.shots.pendingFire.length = 0;
        ctx.rounds.rounds.forEach(ctx.rounds.dropRound);
        ctx.rounds.rounds.length = 0;
        ctx.shots.resolutions.clear();
        if (state.beacon) {
          disposeObj(state.beacon.obj);
          state.beacon = null;
        }
        ctx.rounds.smoke(ctx.world.muzzle(), '#8a8f9c', 1.5 * u);
        ctx.ui.say('Interrupted', 3, 'idle');
        break;
      case 'turn-end':
        clearTimeout(state.homeTimer);
        state.homeTimer = setTimeout(() => {
          if (!state.stopped && !ctx.jobs?.following() && !state.beacon) ctx.ui.goHome();
        }, 3500);
        state.charge = 0;
        ctx.ui.say(
          state.beacon ? 'Waiting for you' : ev.ok ? 'Turn complete' : `Turn ended · ${ev.subtype}`,
          state.beacon ? 60 : 3,
          state.beacon ? 'waiting' : 'idle',
        );
        break;
      case 'rebuild-start':
        ctx.ui.say('Reshaping the galaxy…', 30);
        break;
    }
  }

  return { ingest };
}
