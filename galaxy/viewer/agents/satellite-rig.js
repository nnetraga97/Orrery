// The relay uses real rigid joints and exported clips from scripts/rig-satellite.py.
// Cache the source asset; each instance owns its geometry, materials and mixer.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let cached;
const URL = 'assets/rigged/satellite/satellite.glb';
export function createSatelliteRig(parent, width = 1.4) {
  const state = { ready: false, error: null, animation: 'Relay scan', triangles: 0, received: 0 };
  let stopped = false,
    model,
    wrapper,
    mixer,
    anchor,
    current,
    oneShot = false;
  const actions = new Map();
  const point = new THREE.Vector3();
  const yaw = () => model?.getObjectByName('CTRL_Dish_Yaw');
  function play(name, once = false) {
    const next = actions.get(name);
    if (stopped || !next) return false;
    if (current === next && oneShot) return true;
    const previous = current;
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous && previous !== next) {
      previous.fadeOut(0.25);
      next.fadeIn(0.25);
    }
    current = next;
    oneShot = once;
    state.animation = name;
    return true;
  }
  if (!cached) {
    cached = new GLTFLoader().loadAsync(URL).catch(error => {
      cached = null;
      throw error;
    });
  }
  const ready = cached
    .then(gltf => {
      if (stopped) return;
      model = gltf.scene.clone(true);
      for (const name of [
        'CTRL_Dish_Yaw',
        'CTRL_Dish_Pitch',
        'CTRL_Panel_Port',
        'CTRL_Panel_Starboard',
        'CTRL_Receiver_Anchor',
      ])
        if (!model.getObjectByName(name)) throw new Error('Satellite is missing joint ' + name);
      model.traverse(o => {
        if (o.geometry) {
          o.geometry = o.geometry.clone();
          state.triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
        }
        if (o.material) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      });
      // Tripo's +X facing becomes the viewer's +Z facing, with Y up after export.
      model.rotation.y = -Math.PI / 2;
      const box = new THREE.Box3().setFromObject(model),
        size = box.getSize(new THREE.Vector3());
      const scale = width / Math.max(size.x, size.y, size.z, 0.001);
      wrapper = new THREE.Group();
      wrapper.name = 'Satellite_Asset';
      wrapper.scale.setScalar(scale);
      model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      wrapper.add(model);
      parent.add(wrapper);
      anchor = model.getObjectByName('CTRL_Receiver_Anchor');
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      if (!['Relay scan', 'Receive tool call', 'Solar panels'].every(name => actions.has(name)))
        throw new Error('Satellite animation clips are incomplete.');
      mixer.addEventListener('finished', event => {
        if (event.action === current && oneShot) play('Relay scan');
      });
      state.ready = true;
      play('Relay scan');
      mixer.update(0);
    })
    .catch(error => {
      state.error = error.message || 'Could not load the satellite station.';
      release();
    });
  function release() {
    mixer?.stopAllAction();
    if (model) mixer?.uncacheRoot(model);
    wrapper?.removeFromParent();
    model?.traverse(o => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    actions.clear();
    model = wrapper = mixer = anchor = current = null;
    state.ready = false;
  }
  return {
    ready,
    state,
    step(dt) {
      if (stopped || !state.ready) return;
      mixer.update(Math.max(0, Math.min(dt, 0.1)));
      parent.updateWorldMatrix(true, true);
    },
    receive() {
      if (!state.ready) return false;
      state.received++;
      return play('Receive tool call', true);
    },
    preview: (name = 'Receive tool call') => play(name, name !== 'Relay scan'),
    reset() {
      if (stopped) return;
      mixer?.stopAllAction();
      current = null;
      oneShot = false;
      state.received = 0;
      play('Relay scan');
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
      yaw: yaw()?.rotation.y || 0,
      joints: model
        ? ['CTRL_Dish_Yaw', 'CTRL_Dish_Pitch', 'CTRL_Panel_Port', 'CTRL_Panel_Starboard'].map(name => {
            const joint = model.getObjectByName(name);
            return { name, rotation: joint.quaternion.toArray() };
          })
        : [],
    }),
    stop() {
      if (stopped) return;
      stopped = true;
      release();
    },
  };
}
