// Bounded semantic job presentation. Completed-only records are a labeled retrospective preview.
// Ships require explicit endpoints; a test result alone never invents an execution trace.
import * as THREE from 'three';
import { RiggedAssets, ShipScale } from '../scene/rigged-assets.js';

export function createAgentJobs(T, { core, say, carry = [] }) {
  const jobs = new Map(),
    root = new THREE.Group();
  root.name = 'agent-jobs';
  T.scene.add(root);
  let restore = carry,
    disposed = false,
    selected = null,
    epoch = 0,
    grouped = 0;
  const bodyRadius = ref => {
    const i = ref?.path ? T.fileIndex(ref.path) : null;
    return i != null ? T.bodySize?.(i) : null;
  };
  const followDistance = job =>
    job.key === 'factory' ? core * 0.7 : Math.max(job.span * 14, (T.camera?.near || 0.5) * 3);
  const anchor = ref => {
    const i = ref?.path ? T.fileIndex(ref.path) : null;
    return i != null
      ? T.bodyPos(i)
          .clone()
          .add(new THREE.Vector3(0, (T.bodySize?.(i) || 0) * 1.3 + core * 0.1, 0))
      : new THREE.Vector3(core * 1.7, core * 0.3, -core * 0.6);
  };
  const label = job =>
    `${job.event.label || job.event.action}${job.event.completionOnly ? ' · completion preview' : ''}${job.result ? (job.result.ok ? ' · complete' : ' · failed') : ' · running'}`;
  async function load(job) {
    try {
      const rig = await RiggedAssets.create(job.key, job.key === 'factory' ? core * 0.65 : 1);
      if (disposed || job.epoch !== epoch || jobs.get(job.id) !== job) {
        rig.dispose();
        return;
      }
      if (job.key !== 'factory') rig.root.scale.setScalar(job.span / rig.span);
      job.rig = rig;
      root.add(rig.root);
      if (job.key === 'factory') rig.root.position.set(core * (1.55 + job.slot * 0.8), 0, core * 0.65);
      else rig.root.position.copy(job.from);
    } catch {
      if (jobs.get(job.id) === job) {
        job.unavailable = true;
        say('Job recorded · model unavailable', 3);
      }
    }
  }
  function accept(ev) {
    const existing = jobs.get(ev.toolId);
    if (existing && ['resolve', 'job-update'].includes(ev.kind)) {
      existing.event = { ...existing.event, ...ev };
      if (ev.kind === 'resolve') {
        existing.result = ev;
        if (!ev.ok) existing.failedAt = existing.fraction || 0;
      }
      say(label(existing), 3);
      return true;
    }
    if (ev.kind !== 'fire') return false;
    const factory = ['artifact', 'build'].includes(ev.action),
      ship = ['transfer', 'debug'].includes(ev.action) && ev.from && ev.to;
    if (!factory && !ship) return false;
    if (jobs.has(ev.toolId)) return true;
    // Keep the selected ship at its destination. Reuse completed, unselected slots first.
    if (jobs.size >= 4) {
      const old = [...jobs.values()].find(j => j !== selected && j.result && j.elapsed > 3);
      if (old) {
        disposeJob(old);
        jobs.delete(old.id);
      } else {
        grouped++;
        say(`${grouped} additional jobs in Activity`, 2);
        return true;
      }
    }
    const job = {
      id: ev.toolId,
      slot: [0, 1, 2, 3].find(slot => ![...jobs.values()].some(j => j.slot === slot)),
      key: factory ? 'factory' : ev.action === 'debug' ? 'arrow' : 'arc',
      event: ev,
      epoch,
      elapsed: 0,
      result: null,
      from: anchor(ev.from),
      to: anchor(ev.to),
      revision: T.navigationRevision,
      span: ShipScale.routeSpan(
        [bodyRadius(ev.from), bodyRadius(ev.to)],
        ev.action === 'debug' ? 'probe' : 'out',
        T.unit || 1,
      ),
    };
    // Separate parallel production jobs on the platform.
    jobs.set(job.id, job);
    void load(job);
    say(label(job), 3);
    return true;
  }
  function frame(dt) {
    if (restore?.length) {
      const saved = restore;
      restore = null;
      for (const state of saved) {
        accept({ ...state.event, kind: 'fire' });
        const job = jobs.get(state.event.toolId);
        if (job) {
          Object.assign(job, {
            result: state.result,
            elapsed: state.elapsed,
            restored: true,
            failedAt: state.failedAt,
          });
          if (state.following) selected = job;
        }
      }
    }
    for (const job of jobs.values()) {
      if (!job.rig) continue;
      job.elapsed += dt;
      if (job.key === 'factory') {
        const working = !job.result || job.elapsed < 3;
        job.rig.sample(working ? 'Production cycle' : 'Standby', job.elapsed, true);
        if (job.result && !job.shown && job.elapsed >= 3) {
          job.shown = true;
          if (job.result.ok && job.result.outputs?.length) {
            const count = Math.min(8, job.result.outputs.length),
              geo = new THREE.BoxGeometry(core * 0.065, core * 0.065, core * 0.065),
              mat = new THREE.MeshStandardMaterial({ color: '#b69aff', emissive: '#432c75', roughness: 0.45 });
            job.artifacts = new THREE.InstancedMesh(geo, mat, count);
            job.artifacts.name = 'job-artifacts';
            for (let i = 0; i < count; i++)
              job.artifacts.setMatrixAt(
                i,
                new THREE.Matrix4().makeTranslation((i - (count - 1) / 2) * core * 0.09, core * 0.08, core * 0.45),
              );
            job.rig.root.add(job.artifacts);
          }
          say(
            `${label(job)}${job.result.outputs?.length ? ' · ' + job.result.outputs.map(r => r.path || r.uri).join(', ') : ''}`,
            5,
          );
        }
      } else {
        // Travel is illustrative pacing, not a percentage of an opaque operation.
        const measured = job.event.progress,
          fraction =
            job.result?.ok === false
              ? job.failedAt
              : measured
                ? measured.completed / measured.total
                : Math.min(job.result ? 1 : 0.85, job.elapsed / 3);
        job.fraction = fraction;
        job.rig.root.position.lerpVectors(job.from, job.to, fraction);
        job.rig.root.position.y += Math.sin(fraction * Math.PI) * core * 0.3;
        if (job.from.distanceToSquared(job.to) > 0.001) job.rig.root.lookAt(job.to);
        job.rig.sample(fraction === 1 ? 'Docking' : 'Hover', fraction === 1 ? 0 : job.elapsed, true);
        if (selected === job && T.navigationRevision === job.revision) {
          const at = job.rig.root.position,
            distance = followDistance(job),
            camera = at.clone().add(new THREE.Vector3(distance * 0.6, distance * 0.5, distance * 0.6));
          T.setView(T.controls.target.clone().lerp(at, 0.12), T.camera.position.clone().lerp(camera, 0.12));
        }
      }
    }
  }
  const unpick = T.addPicker?.({
    objects: () => [...jobs.values()].flatMap(j => (j.rig ? [j.rig.root] : [])),
    describe(hit) {
      const job = [...jobs.values()].find(j => {
        for (let n = hit.object || hit; n; n = n.parent) if (n === j.rig?.root) return true;
        return false;
      });
      if (!job) return null;
      return {
        key: 'agent-job:' + job.id,
        kind: 'Agent ' + job.event.action,
        title: label(job),
        color: '#87d9f5',
        preview: [
          job.event.progress
            ? `${job.event.progress.completed}/${job.event.progress.total}`
            : 'No measured progress supplied',
          job.key === 'factory'
            ? `${job.result?.outputs?.length || 0} declared outputs · inspect Activity for paths`
            : 'Click to follow · stays at destination',
        ],
        anchor: () => job.rig.root.position.clone(),
        onClick() {
          selected = job;
          job.revision = T.navigationRevision;
          T.flyTo(job.rig.root.position.clone(), followDistance(job), { duration: 650 });
          job.revision = T.navigationRevision;
        },
      };
    },
  });
  function disposeJob(job) {
    job.artifacts?.geometry.dispose();
    job.artifacts?.material.dispose();
    job.rig?.dispose();
  }
  function clear() {
    restore = null;
    epoch++;
    jobs.forEach(disposeJob);
    jobs.clear();
    selected = null;
  }
  return {
    accept,
    frame,
    clear,
    save: () =>
      [...jobs.values()].map(j => ({
        event: j.event,
        result: j.result,
        elapsed: j.elapsed,
        failedAt: j.failedAt,
        following: selected === j && j.revision === T.navigationRevision,
      })),
    following: () => !!selected && selected.key !== 'factory' && selected.revision === T.navigationRevision,
    snapshot: () => ({
      active: jobs.size,
      grouped,
      jobs: [...jobs.values()].map(j => ({
        id: j.id,
        model: j.key,
        ready: !!j.rig,
        completionOnly: !!j.event.completionOnly,
        complete: !!j.result,
        outputs: j.result?.outputs || [],
      })),
    }),
    dispose() {
      disposed = true;
      clear();
      unpick?.();
      root.removeFromParent();
    },
  };
}
