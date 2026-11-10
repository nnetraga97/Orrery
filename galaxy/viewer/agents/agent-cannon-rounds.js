// Owns projectile flight, trails, impacts, one-shot effects and file heat.
import * as THREE from 'three';
import { CannonMotion } from './cannon-motion.js';
import { AMMO_STYLE } from './agent-cannon-shots.js';
import { canvasTexture } from '../scene/textures.js';
import { trace } from '../scene/diagnostics.js';

const MAX_ROUNDS = 40,
  MAX_TRAILS = 64,
  PENDING_MAX = 30,
  HEAT_TAU = 75;

// Deposit the travelled path in world space: moving targets cannot drag an old wake around.
// Fixed buffers bound memory; a final tip keeps the line attached at any frame rate.
function createCannonTrail(scene, from, color, time, duration = 10) {
  const capacity = 192,
    history = capacity - 1,
    interval = 1 / 60;
  const samples = new Float32Array(history * 3),
    times = new Float64Array(history);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  geometry.setDrawRange(0, 0);
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  line.name = 'cannon-shot-trail';
  scene.add(line);
  const tip = from.clone();
  let first = 0,
    count = 0,
    lastSample = -Infinity,
    tipAt = time,
    disposed = false;
  const trail = {
    line,
    done: false,
    record(position, t) {
      if (disposed || trail.done) return;
      tip.copy(position);
      tipAt = t;
      if (t - lastSample < interval) return;
      if (count === history) {
        first = (first + 1) % history;
        count--;
      }
      const i = (first + count++) % history;
      samples.set([position.x, position.y, position.z], i * 3);
      times[i] = lastSample = t;
    },
    finish() {
      trail.done = true;
    },
    update(t) {
      if (disposed || (trail.done && t - tipAt >= duration)) return false;
      while (count && t - times[first] >= duration) {
        first = (first + 1) % history;
        count--;
      }
      const positions = geometry.attributes.position,
        colors = geometry.attributes.color;
      let n = 0;
      const write = (x, y, z, born) => {
        const fade = Math.max(0, 1 - (t - born) / duration) ** 0.65;
        positions.setXYZ(n, x, y, z);
        colors.setXYZ(n++, fade, fade, fade);
      };
      for (let q = 0; q < count; q++) {
        const i = (first + q) % history;
        write(samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2], times[i]);
      }
      if (count && tipAt > lastSample) write(tip.x, tip.y, tip.z, tipAt);
      geometry.setDrawRange(0, n);
      positions.needsUpdate = colors.needsUpdate = true;
      if (n) geometry.computeBoundingSphere();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(line);
      geometry.dispose();
      line.material.dispose();
    },
  };
  trail.record(from, time);
  return trail;
}

export function createCannonRounds(ctx) {
  const {
    codebase,
    T,
    sprite,
    scene,
    shotSpeed,
    now,
    stats,
    u,
    trailDuration,
    v1,
    host,
    v2,
    disposeObj,
  } = ctx.shared;
  const { state } = ctx;
  const creationImpacts = [];
  // ---------- heat: hit files glow and cool ----------
  // Keyed by path: a file keeps its glow when the snapshot changes and its index moves.
  const heat = new Map(); // path -> { h, glow }
  const carried = ctx.shared.heatCarry[codebase] || {};
  for (const [path, h] of Object.entries(carried)) if (T.fileIndex(path) != null) addHeat(path, h, true);
  function addHeat(path, amount, restoring = false) {
    let e = heat.get(path);
    if (!e) {
      e = { h: 0, glow: sprite('#ff7a2a', 1) };
      e.glow.renderOrder = 5;
      scene.add(e.glow);
      heat.set(path, e);
    }
    e.h = Math.min(1.4, e.h + amount * (restoring ? 1 : 2.2));
  }
  const heatSnapshot = () => Object.fromEntries([...heat].map(([path, e]) => [path, e.h]));

  // ---------- one-shot effects: flashes, shockwaves, smoke ----------
  const effects = []; // { obj, t0, dur, update(k) }
  function flash(at, col, size, dur = 0.9, { grow = 2.2, follow = null } = {}) {
    dur /= shotSpeed;
    const s = sprite(col, size);
    s.position.copy(at);
    s.renderOrder = 8;
    scene.add(s);
    effects.push({
      obj: s,
      t0: now(),
      dur,
      update: k => {
        if (follow) s.position.copy(follow());
        s.scale.setScalar(size * (0.5 + grow * Math.sqrt(k)));
        s.material.opacity = (1 - k) ** 1.6;
      },
    });
    stats.bursts++;
  }
  const ringTex = canvasTexture(x => {
    x.strokeStyle = '#fff';
    x.lineWidth = 5;
    x.beginPath();
    x.arc(64, 64, 56, 0, 7);
    x.stroke();
  });
  function shockwave(at, col, size, dur = 1.1) {
    dur /= shotSpeed;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ringTex,
        color: col,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    s.position.copy(at);
    scene.add(s);
    effects.push({
      obj: s,
      t0: now(),
      dur,
      update: k => {
        s.scale.setScalar(size * (0.3 + 3 * k));
        s.material.opacity = (1 - k) ** 2;
      },
    });
  }
  function smoke(at, col = '#ff4d4d', size = 1.2 * u) {
    for (let q = 0; q < 5; q++) {
      const s = sprite(col, size, { blending: THREE.NormalBlending, opacity: 0.6 }),
        drift = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random() * 0.5, Math.random() - 0.5).multiplyScalar(
          2.5 * u,
        );
      const p0 = at.clone();
      scene.add(s);
      effects.push({
        obj: s,
        t0: now() + (q * 0.06) / shotSpeed,
        dur: 1.6 / shotSpeed,
        update: k => {
          s.position.copy(p0).addScaledVector(drift, k);
          s.scale.setScalar(size * (0.6 + 1.4 * k));
          s.material.opacity = 0.55 * (1 - k);
        },
      });
    }
  }
  // Long straight beam (prompt in, web out): a line that grows, holds and fades.
  function beam(from, to, col, dur = 1.2, hold = null) {
    const growTime = (dur / shotSpeed) * 0.45;
    dur = growTime + trailDuration;
    const geo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: col,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(line);
    const head = sprite(col, 1.6 * u);
    scene.add(head);
    const e = {
      obj: line,
      extra: head,
      t0: now(),
      dur,
      growTime,
      hold,
      update: k => {
        const elapsed = k * e.dur,
          grow = Math.min(1, elapsed / growTime),
          fade = e.hold && !e.hold.done ? 1 : Math.max(0, 1 - Math.max(0, elapsed - growTime) / trailDuration) ** 0.65;
        const tip = v1.lerpVectors(from, to, grow);
        geo.attributes.position.setXYZ(1, tip.x, tip.y, tip.z);
        geo.attributes.position.needsUpdate = true;
        head.position.copy(tip);
        line.material.opacity = 0.85 * fade;
        head.material.opacity = fade;
      },
    };
    effects.push(e);
    return e;
  }

  // ---------- rounds ----------
  const rounds = [],
    trails = [];
  // A target follows its file by path across snapshots. If the file goes away mid-flight, the round lands where it last
  // was.
  const targetOf = i => {
    const path = host.data.nodes()[i].path,
      last = T.bodyPos(i).clone();
    return () => {
      const j = T.fileIndex(path);
      return j == null ? last : last.copy(T.bodyPos(j));
    };
  };
  // Unmapped writes aim near their folder until a confirmed creation supplies its stable birth position.
  function spotFor(path) {
    const dir = path.split('/').slice(0, -1).join('/'),
      sib = host.data.nodes().find(n => n.path.startsWith(dir + '/'));
    if (sib) {
      const p = T.bodyPos(sib.i).clone(),
        off = new THREE.Vector3(Math.random() - 0.5, 0.3, Math.random() - 0.5)
          .normalize()
          .multiplyScalar(T.bodySize(sib.i) * 3 + 2 * u);
      return () => p.clone().add(off);
    }
    const a = Math.random() * Math.PI * 2,
      p = new THREE.Vector3(Math.cos(a), 0.15, Math.sin(a)).multiplyScalar(T.galaxyExtent * 0.55);
    return () => p;
  }
  const offMap = () => {
    const a = Math.random() * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a)).multiplyScalar(T.galaxyExtent * 1.8);
    return () => p;
  };

  function spawn(ammo, target, ev, opts = {}) {
    if (rounds.length >= MAX_ROUNDS) {
      trace('cannon-skipped', { eventId: ev?.id, projectId: codebase, reason: 'round-cap', pending: rounds.length });
      stats.merged = (stats.merged || 0) + 1;
      if (opts.birth) ctx.shots.births.form(opts.birth);
      return null;
    }
    const style = AMMO_STYLE[ammo] || AMMO_STYLE.station,
      power = state.firingProfile?.power ?? CannonMotion.profile(ev || { ammo }).power;
    const st = { ...style, size: style.size * (0.48 + power * 0.9) },
      from = opts.from || ctx.world.muzzle();
    const col = opts.col || st.col,
      head = sprite(col, st.size * u * 1.6);
    head.renderOrder = 9;
    scene.add(head);
    if (trails.length >= MAX_TRAILS) {
      const old = trails.findIndex(trail => trail.done);
      trails.splice(old >= 0 ? old : 0, 1)[0].dispose();
    }
    const wake = createCannonTrail(scene, from, col, now(), trailDuration);
    trails.push(wake);
    const dist = from.distanceTo(target()),
      dur = Math.min(2.2, Math.max(0.3, st.speed * (0.55 + (dist / (T.galaxyExtent || 100)) * 0.9))) / shotSpeed;
    const r = {
      ammo,
      ev,
      st,
      col,
      from: from.clone(),
      target,
      head,
      trail: wake.line,
      wake,
      t0: now(),
      dur,
      phase: 'flying',
      toolId: ev?.toolId,
      opts,
      filePath: opts.file != null ? host.data.nodes()[opts.file]?.path : null,
    };
    rounds.push(r);
    stats.fired[ammo] = (stats.fired[ammo] || 0) + 1;
    ctx.shots.recordShot(ev, ammo);
    if (opts.birth) ctx.shots.births.launch(opts.birth, r);
    // Only rounds fired by the main gun kick its barrel. Flak fragments and drones have their own emitters.
    if (!opts.from) {
      ctx.world.motion.shotAt = now();
      ctx.world.motion.strength = power;
      ctx.world.motion.shots++;
      flash(from, '#b4f4ff', st.size * u * 0.9, 0.1, { grow: 0.6 });
      if (['shell', 'siege', 'mortar'].includes(ammo)) smoke(from, '#8291a6', st.size * u * 0.32);
    }
    return r;
  }
  function pointOn(r, k, out) {
    const B = r.target(),
      mid = v2.copy(r.from).add(B).multiplyScalar(0.5);
    mid.y += r.from.distanceTo(B) * r.st.arc + (r.st.arc > 0.3 ? 2 * u : 0);
    const a = (1 - k) * (1 - k),
      b = 2 * (1 - k) * k,
      c = k * k;
    return out.set(
      a * r.from.x + b * mid.x + c * B.x,
      a * r.from.y + b * mid.y + c * B.y,
      a * r.from.z + b * mid.z + c * B.z,
    );
  }

  // What a round does when it lands (or is decided while hovering at its target).
  function land(r) {
    r.wake.finish();
    const res = r.opts.res || (r.toolId ? ctx.shots.resolutions.get(r.toolId) : null);
    if (r.toolId && !res && !r.opts.noResolve) {
      r.phase = 'pending';
      r.pendingAt = now();
      return;
    }
    finish(r, res);
  }
  function finish(r, res) {
    r.phase = 'done';
    const at = r.target().clone();
    if (r.opts.birth) {
      const path = r.opts.birth.path,
        i = T.fileIndex(path),
        body = i == null ? null : T.bodyPos(i);
      const point = r.head.position.clone(),
        targetError = body ? point.distanceTo(body) : point.distanceTo(at);
      creationImpacts.push({ path, point: point.toArray(), body: body?.toArray() || null, targetError });
      if (creationImpacts.length > 16) creationImpacts.shift();
      trace('creation-impact', {
        projectId: codebase,
        eventId: r.ev?.id,
        reason: body ? 'analyzed-body' : 'marker',
        targetError,
      });
    }
    if (res && !res.ok) {
      if (res.denied) {
        stats.blocked++;
      } else stats.misfires++;
      // Misfire: ricochet off at an angle and trail red smoke.
      const off = new THREE.Vector3(Math.random() - 0.5, 0.8, Math.random() - 0.5).normalize().multiplyScalar(6 * u),
        from = at.clone(),
        head = r.head;
      effects.push({
        obj: head,
        t0: now(),
        dur: 0.8 / shotSpeed,
        update: k => {
          head.position.copy(from).addScaledVector(off, k);
          head.material.color.set('#ff4d4d');
          head.material.opacity = 1 - k;
        },
      });
      r.head = null;
      smoke(at);
      ctx.ui.say(`${res.denied ? 'Blocked' : 'Misfire'} · ${res.tool}`, 3);
    } else {
      if (!r.ev?.preview) stats.impacts++;
      const size =
        r.st.size *
        u *
        (r.ammo === 'shell'
          ? 2.4 + Math.min(3, (res?.changed || 4) / 25)
          : r.ammo === 'siege'
            ? 4.5
            : r.ammo === 'tracer'
              ? 1.6
              : 2.2);
      flash(at, r.col, size, r.ammo === 'tracer' ? 0.6 : 1.0, { follow: r.target });
      const file = r.filePath != null ? T.fileIndex(r.filePath) : null;
      if (r.ammo === 'siege' && !res?.created && file != null) shockwave(at, '#ffb0c0', T.bodySize(file) * 2.2);
      if (r.ammo === 'mortar' && res?.test) flash(at, res.ok ? '#6bff9a' : '#ff5a5a', 5 * u, 1.3, { follow: r.target });
      if (res?.ok && ['shell', 'siege'].includes(r.ammo))
        ctx.ui.hitLabel(
          r.target,
          `${(r.opts.path || res?.files?.[0] || '').split('/').pop()}${res?.added != null ? `  +${res.added} −${res.removed}` : res?.deleted ? '  deleted' : ''}`,
          r.col,
        );
      if (file != null) {
        addHeat(
          r.filePath,
          { shell: 0.35 + Math.min(0.5, (res?.changed || 0) / 80), siege: 0.8, mortar: 0.15, tracer: 0.06, flak: 0.04 }[
            r.ammo
          ] ?? 0.05,
        );
        const det = T.landedDetail?.();
        if (det && T.landedIndex === file) {
          const line = res?.lines?.[0] ?? r.ev?.lines?.[0];
          det.agentFlash?.(line, r.col, r.ammo === 'tracer' ? 0.6 : 1.4);
          if (res?.lines) det.agentMark?.(res.lines[0], res.lines[1]);
        }
      }
      if (r.opts.birth) ctx.shots.births.form(r.opts.birth);
    }
    if (r.opts.onLand) r.opts.onLand(at, res);
  }
  function dropRound(r) {
    if (r.head) disposeObj(r.head);
    r.wake.finish();
  }
  function clearTrails() {
    trails.forEach(trail => trail.dispose());
    trails.length = 0;
  }

  const tmp = new THREE.Vector3();
  function step(t, dt, pulse) {
    // Rounds.
    if (state.settling && !rounds.some(r => r.phase === 'flying')) state.settling();
    for (let q = rounds.length - 1; q >= 0; q--) {
      const r = rounds[q];
      if (r.opts.birth && ctx.shots.births.readiness(r.opts.birth) === 'deleted') {
        dropRound(r);
        rounds.splice(q, 1);
        continue;
      }
      if (r.phase === 'flying') {
        const k = Math.min(1, (t - r.t0) / r.dur);
        pointOn(r, k, tmp);
        r.head.position.copy(tmp);
        // Keep shells readable when zoomed out: grow with camera distance beyond the galaxy's scale.
        r.head.scale.setScalar(
          r.st.size * u * 1.6 * Math.max(1, T.camera.position.distanceTo(tmp) / (T.galaxyExtent * 0.8)),
        );
        r.wake.record(tmp, t);
        if (k >= 1) land(r);
      } else if (r.phase === 'pending') {
        // Hovering at the target with a pulsing glow until the tool result arrives.
        r.head.position.copy(r.target());
        r.head.scale.setScalar(r.st.size * u * (1.4 + 0.6 * pulse));
        if (t - r.pendingAt > PENDING_MAX) finish(r, null);
      }
      if (r.phase === 'done') {
        dropRound(r);
        rounds.splice(q, 1);
      }
    }
    // Wakes outlive their shells, fading segment by segment on wall-clock time.
    for (let q = trails.length - 1; q >= 0; q--) {
      if (!trails[q].update(t)) {
        trails[q].dispose();
        trails.splice(q, 1);
      }
    }
    // Effects.
    for (let q = effects.length - 1; q >= 0; q--) {
      const e = effects[q],
        k = (t - e.t0) / e.dur;
      if (k < 0) continue;
      if (k >= 1 && !(e.hold && !e.hold.done)) {
        if (e.obj) disposeObj(e.obj);
        if (e.extra) disposeObj(e.extra);
        effects.splice(q, 1);
        continue;
      }
      e.update(Math.min(k, 0.999));
    }
    // Heat decays over several minutes; the glow follows the orbiting body.
    heat.forEach((e, path) => {
      const i = T.fileIndex(path);
      e.h *= Math.exp(-dt / (i == null ? 1 : HEAT_TAU)); // a deleted file's glow fades out quickly where it was
      if (e.h < 0.02) {
        disposeObj(e.glow);
        heat.delete(path);
        return;
      }
      if (i == null) return;
      e.glow.position.copy(T.bodyPos(i));
      e.glow.scale.setScalar(T.bodySize(i) * (2.6 + 3 * e.h));
      e.glow.material.opacity = Math.min(0.95, e.h);
    });
  }

  return {
    spotFor,
    offMap,
    targetOf,
    spawn,
    flash,
    beam,
    shockwave,
    rounds,
    addHeat,
    finish,
    heat,
    smoke,
    dropRound,
    heatSnapshot,
    clearTrails,
    effects,
    ringTex,
    creationImpacts,
    trails,
    step,
  };
}
