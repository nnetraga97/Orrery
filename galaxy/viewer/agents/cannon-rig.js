// Meshy's fused source mesh is split into rigid parts in scripts/rig-meshy-cannon.py.
// Named pivots drive the real geometry. Muzzle effects use the exported anchor in world space.
// Bind an already loaded model so the studio and live view share exactly the same rig and materials.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CannonMotion } from './cannon-motion.js';

export function bindCannonModel(model) {
  const yaw = model.getObjectByName('Cannon_Yaw'),
    pitch = model.getObjectByName('Cannon_Pitch');
  const recoil = model.getObjectByName('Cannon_Recoil'),
    muzzle = model.getObjectByName('Cannon_Muzzle');
  if (!yaw || !pitch || !recoil || !muzzle) throw new Error('Meshy cannon is missing its mechanical pivots.');
  const rest = {
    recoil: recoil.position.clone(),
    yaw: yaw.position.clone(),
    pitch: THREE.MathUtils.degToRad(pitch.userData.rest_barrel_elevation_degrees || 17.2234),
  };
  const a = recoil.userData.axis || [-1, 0, 0.31],
    axis = new THREE.Vector3(a[0], a[2], -a[1]).normalize();
  const uniforms = { cannonFill: { value: 0 }, cannonPower: { value: 0 }, cannonFlash: { value: 0 } };
  model.updateWorldMatrix(true, true);
  const inverse = recoil.matrixWorld.clone().invert(),
    position = new THREE.Vector3();
  recoil.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.uv) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
      vertices = mesh.geometry.attributes.position;
    const travel = new Float32Array(vertices.count);
    for (let i = 0; i < vertices.count; i++) {
      position.fromBufferAttribute(vertices, i).applyMatrix4(matrix);
      // Chamber bounds in the supplied Meshy model, measured along the exported barrel axis.
      travel[i] = THREE.MathUtils.clamp((position.dot(axis) - 0.22) / 0.66, 0, 1);
    }
    mesh.geometry.setAttribute('cannonTravel', new THREE.BufferAttribute(travel, 1));
    // glTF shares its material across the base, mount and barrel. Isolate only the barrel.
    const decorate = original => {
      const material = original.clone();
      if (!material.map) return material;
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = 'attribute float cannonTravel; varying float vCannonTravel;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvCannonTravel = cannonTravel;',
        );
        shader.fragmentShader =
          'uniform float cannonFill; uniform float cannonPower; uniform float cannonFlash; varying float vCannonTravel;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          // Select the existing cyan texture, keeping the original white armor and brass untouched.
          float cyanMask = smoothstep(.035, .18, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r);
          float loaded = (1.0 - smoothstep(cannonFill - .018, cannonFill + .018, vCannonTravel)) * step(.001, cannonFill);
          float front = max(0.0, 1.0 - abs(vCannonTravel - cannonFill) / .035) * step(.001, cannonFill);
          diffuseColor.rgb *= mix(1.0, .20 + loaded * .80, cyanMask);
          vec3 cannonEmission = vec3(.025, .68, 1.0) * cyanMask * (loaded * (1.1 + cannonPower * 2.0) + front * 1.4 + cannonFlash * 3.5);
        `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cannonEmission;',
        );
      };
      material.customProgramCacheKey = () => 'cannon-charge-v1';
      return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(decorate) : decorate(mesh.material);
  });
  // Reused muzzle effects: no per-frame geometry, textures, lights or particle allocations.
  const fx = new THREE.Group();
  fx.name = 'Cannon_Discharge';
  muzzle.add(fx);
  fx.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  const material = () =>
    new THREE.MeshBasicMaterial({
      color: '#8aefff',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
  const flare = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material());
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40), material());
  flare.name = 'Cannon_MuzzleFlash';
  ring.name = 'Cannon_PressureRing';
  fx.add(flare, ring);
  fx.visible = false;
  let lastPose = {};
  function step(pose = {}) {
    lastPose = pose;
    yaw.rotation.y = pose.yaw || 0;
    yaw.position.copy(rest.yaw);
    yaw.position.y -= pose.compression || 0;
    pitch.rotation.z = -((pose.pitch ?? rest.pitch) + (pose.pitchOffset || 0) - rest.pitch);
    recoil.position.copy(rest.recoil).addScaledVector(axis, -(pose.recoil || 0) * 0.4);
    uniforms.cannonFill.value = pose.fill || 0;
    uniforms.cannonPower.value = pose.power || 0;
    uniforms.cannonFlash.value = pose.flash || 0;
    const power = pose.power || 0,
      flash = pose.flash || 0,
      blast = pose.blast ?? -1;
    fx.visible = flash > 0 || blast >= 0;
    flare.visible = flash > 0;
    flare.scale.set(0.04 + 0.09 * power, 0.04 + 0.09 * power, 0.08 + 0.26 * power);
    flare.material.opacity = flash;
    ring.visible = blast >= 0;
    ring.scale.setScalar(0.04 + Math.max(0, blast) * (0.22 + 0.32 * power));
    ring.position.z = Math.max(0, blast) * (0.3 + 0.6 * power);
    ring.material.opacity = blast >= 0 ? (1 - blast) ** 2 * (0.35 + 0.65 * power) : 0;
    model.updateWorldMatrix(true, true);
  }
  step();
  return {
    step,
    restPitch: rest.pitch,
    yaw,
    pitch,
    recoil,
    muzzle,
    axis,
    snapshot: () => ({ ...lastPose, fill: uniforms.cannonFill.value }),
    reset: () => step(),
    stop: () => {
      fx.removeFromParent();
      fx.traverse(o => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    },
  };
}

export function createCannonRig(parent, width) {
  const url = 'assets/cannon/meshy/agent-cannon.glb';
  const state = { ready: false, error: null, previewing: false, height: 0, triangles: 0 };
  let stopped = false,
    model,
    wrapper,
    yaw,
    pitch,
    recoil,
    muzzle,
    mixer,
    clip,
    action,
    binding;
  let restPitch = Math.atan(0.31),
    previewTime = 0;
  const recoilRest = new THREE.Vector3(),
    recoilAxis = new THREE.Vector3(-1, 0.31, 0).normalize();
  const cache = createCannonRig.cache || (createCannonRig.cache = new Map());
  let promise = cache.get(url);
  if (!promise) {
    promise = new Promise((ok, fail) => new GLTFLoader().load(url, ok, undefined, fail));
    cache.set(url, promise);
    promise.catch(() => cache.delete(url));
  }
  const ready = promise
    .then(gltf => {
      if (stopped) return;
      model = gltf.scene.clone(true);
      model.traverse(o => {
        if (o.geometry) {
          o.geometry = o.geometry.clone();
          state.triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
        }
        if (o.material) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      });
      yaw = model.getObjectByName('Cannon_Yaw');
      pitch = model.getObjectByName('Cannon_Pitch');
      recoil = model.getObjectByName('Cannon_Recoil');
      muzzle = model.getObjectByName('Cannon_Muzzle');
      if (!yaw || !pitch || !recoil || !muzzle) throw new Error('Meshy cannon is missing its mechanical pivots.');
      recoilRest.copy(recoil.position);
      const axis = recoil.userData.axis; // source Blender coordinates; extras are not converted by glTF
      if (axis?.length === 3) recoilAxis.set(axis[0], axis[2], -axis[1]).normalize();
      restPitch = THREE.MathUtils.degToRad(pitch.userData.rest_barrel_elevation_degrees || 17.2234);
      model.rotation.y = Math.PI / 2; // downloaded -X forward -> viewer +Z forward
      const box = new THREE.Box3().setFromObject(model),
        size = box.getSize(new THREE.Vector3());
      const scale = width / Math.max(size.x, size.z);
      model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      wrapper = new THREE.Group();
      wrapper.name = 'Cannon_Asset';
      wrapper.scale.setScalar(scale);
      wrapper.add(model);
      parent.add(wrapper);
      state.height = size.y * scale;
      binding = bindCannonModel(model);
      mixer = new THREE.AnimationMixer(model);
      clip = gltf.animations.find(c => c.name === 'AN_Cannon_Demo');
      if (clip) action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      state.ready = true;
    })
    .catch(e => {
      state.error = e.message || 'Could not load Meshy cannon.';
    });
  function cancelPreview() {
    if (state.previewing) {
      action?.stop();
      binding?.reset();
    }
    state.previewing = false;
  }
  function preview() {
    if (!state.ready || !action) return false;
    cancelPreview();
    previewTime = 0;
    state.previewing = true;
    action.reset().play();
    return true;
  }
  function step(dt, pose) {
    if (!state.ready || stopped) return;
    if (state.previewing) {
      const elapsed = dt * CannonMotion.defaultSpeed;
      previewTime += elapsed;
      mixer.update(elapsed);
      if (previewTime < clip.duration) return;
      cancelPreview();
    }
    binding.step(pose);
    parent.updateWorldMatrix(true, true);
  }
  function snapshot() {
    parent.updateWorldMatrix(true, true);
    const joint = obj =>
      obj
        ? {
            position: obj.position.toArray(),
            rotation: obj.quaternion.toArray(),
            world: obj.getWorldPosition(new THREE.Vector3()).toArray(),
          }
        : null;
    return {
      ...state,
      asset: url,
      clip: clip?.name || null,
      restPitch,
      energy: binding?.snapshot(),
      joints: { yaw: joint(yaw), pitch: joint(pitch), recoil: joint(recoil), muzzle: joint(muzzle) },
    };
  }
  return {
    ready,
    state,
    step,
    preview,
    cancelPreview,
    snapshot,
    muzzle: () => (state.ready ? muzzle.getWorldPosition(new THREE.Vector3()) : null),
    direction: () =>
      state.ready
        ? recoilAxis.clone().applyQuaternion(muzzle.getWorldQuaternion(new THREE.Quaternion())).normalize()
        : null,
    stop: () => {
      stopped = true;
      cancelPreview();
      binding?.stop();
      mixer?.uncacheRoot(model);
    },
  };
}
