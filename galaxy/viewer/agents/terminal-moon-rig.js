// Meshy moon: static cratered body with rigid sensor, shutter and hatch joints.
// Live command state controls the command clip; previews never submit commands.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let cached;
const URL = 'assets/rigged/terminal-moon/terminal-moon.glb';
const JOINTS = ['CTRL_Sensor_Head', 'CTRL_Terminal_Shutter', 'CTRL_Roof_Hatch'];
const CLIPS = ['Outpost standby', 'Command cycle', 'Service hatch'];
export function createTerminalMoonRig(parent, diameter, carry) {
  const state = {
    ready: false,
    error: null,
    animation: CLIPS[0],
    triangles: 0,
    commands: carry?.commands || 0,
    completed: carry?.completed || 0,
    failed: carry?.failed || 0,
    busy: !!carry?.pending?.length,
  };
  let stopped = false,
    model,
    wrapper,
    anchor,
    mixer,
    current,
    clock = 0,
    resultUntil = 0,
    outcome = true;
  const actions = new Map(),
    pending = new Map(
      (carry?.pending || []).map(([id, remaining]) => [
        id,
        Math.max(0, remaining - (Date.now() - carry.savedAt) / 1000),
      ]),
    ),
    energy = new Set();
  const point = new THREE.Vector3();
  function play(name) {
    const next = actions.get(name);
    if (stopped || !next) return false;
    if (next === current && name === 'Command cycle') return true;
    const previous = current,
      once = name !== CLIPS[0];
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous && previous !== next) {
      previous.fadeOut(0.2);
      next.fadeIn(0.2);
    }
    current = next;
    state.animation = name;
    return true;
  }
  if (!cached)
    cached = new GLTFLoader().loadAsync(URL).catch(error => {
      cached = null;
      throw error;
    });
  const ready = cached
    .then(gltf => {
      if (stopped) return;
      for (const name of [...JOINTS, 'CTRL_Command_Anchor'])
        if (!gltf.scene.getObjectByName(name)) throw new Error('Moon is missing joint ' + name);
      if (!CLIPS.every(name => gltf.animations.some(c => c.name === name)))
        throw new Error('Moon animation clips are incomplete.');
      model = gltf.scene.clone(true);
      model.traverse(o => {
        if (o.geometry) {
          o.geometry = o.geometry.clone();
          state.triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
        }
        if (o.material) {
          const own = material => {
            const m = material.clone();
            if (m.name === 'MAT_Terminal_Command_Energy') {
              m.emissiveIntensity = 0.08;
              energy.add(m);
            }
            return m;
          };
          o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
        }
      });
      const box = new THREE.Box3().setFromObject(model),
        size = box.getSize(new THREE.Vector3());
      model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-1);
      wrapper = new THREE.Group();
      wrapper.name = 'Terminal_Moon_Asset';
      wrapper.scale.setScalar(diameter / Math.max(size.x, size.y, size.z, 0.001));
      wrapper.add(model);
      parent.add(wrapper);
      anchor = model.getObjectByName('CTRL_Command_Anchor');
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      mixer.addEventListener('finished', event => {
        if (event.action === current && state.animation !== CLIPS[0]) play(CLIPS[0]);
      });
      state.ready = true;
      play(pending.size ? 'Command cycle' : CLIPS[0]);
      if (pending.size) current.time = Math.min(carry?.animationTime || 0, current.getClip().duration * 0.5);
      mixer.update(0);
    })
    .catch(error => {
      state.error = error.message || 'Could not load the terminal moon.';
      release();
    });
  function finish(id, ok) {
    if (!pending.delete(id)) return false;
    if (ok === true || ok === false) state.completed++;
    if (ok === false) state.failed++;
    state.busy = pending.size > 0;
    outcome = ok !== false;
    resultUntil = ok === true || ok === false ? clock + 1.5 : 0;
    return true;
  }
  function release() {
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    wrapper?.removeFromParent();
    model?.traverse(o => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    pending.clear();
    actions.clear();
    energy.clear();
    model = wrapper = anchor = mixer = current = null;
    state.ready = false;
    state.busy = false;
  }
  return {
    ready,
    state,
    step(dt) {
      if (stopped || !state.ready) return;
      dt = Math.max(0, Math.min(0.1, dt));
      clock += dt;
      for (const [id, until] of pending) if (clock >= until) finish(id);
      mixer.update(dt);
      // Keep the shutter open while the actual command is unresolved.
      if (state.busy && state.animation === 'Command cycle' && current.time >= current.getClip().duration * 0.5) {
        current.time = current.getClip().duration * 0.5;
        mixer.update(0);
      }
      const active = state.busy || state.animation === 'Command cycle' || clock < resultUntil;
      const color = !state.busy && clock < resultUntil && !outcome ? '#ff635b' : '#b7ff6b';
      for (const m of energy) {
        m.color.set(color);
        m.emissive.set(color);
        m.emissiveIntensity = active ? 1.3 : 0.08;
      }
      parent.updateWorldMatrix(true, true);
    },
    command(id) {
      if (stopped || !state.ready || pending.has(id)) return false;
      state.commands++;
      pending.set(id, clock + 30);
      state.busy = true;
      return play('Command cycle');
    },
    finish,
    preview(name = 'Command cycle') {
      return !state.busy && play(name);
    },
    reset() {
      if (stopped) return;
      pending.clear();
      mixer?.stopAllAction();
      current = null;
      resultUntil = 0;
      Object.assign(state, { busy: false, commands: 0, completed: 0, failed: 0 });
      play(CLIPS[0]);
      mixer?.update(0);
    },
    target(relativeTo, out = new THREE.Vector3()) {
      parent.updateWorldMatrix(true, true);
      if (anchor) anchor.getWorldPosition(point);
      else parent.getWorldPosition(point);
      return out.copy(relativeTo ? relativeTo.worldToLocal(point) : point);
    },
    snapshot: () => ({
      ...state,
      pending: pending.size,
      joints: model
        ? JOINTS.map(name => {
            const joint = model.getObjectByName(name);
            return { name, position: joint.position.toArray(), rotation: joint.quaternion.toArray() };
          })
        : [],
    }),
    capture: () => ({
      commands: state.commands,
      completed: state.completed,
      failed: state.failed,
      pending: [...pending].map(([id, until]) => [id, Math.max(0, until - clock)]),
      savedAt: Date.now(),
      animationTime: current?.time || 0,
    }),
    stop() {
      if (stopped) return;
      stopped = true;
      release();
    },
  };
}
