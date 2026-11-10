// Shared by the Electron viewer and other viewer hosts. Cache immutable asset resources;
// clones own only their hierarchy/mixer. Route motion belongs to the outer root.
// Hull size follows the smaller endpoint body, never the galaxy's layout spacing.
// Values describe the entire model's longest axis (5–8% of a body's diameter).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const ShipScale = Object.freeze({
  routeSpan(radii, kind = 'ambient', fallbackRadius = 1) {
    const known = radii.filter(radius => Number.isFinite(radius) && radius > 0);
    const radius = known.length ? Math.min(...known) : fallbackRadius;
    return radius * ({ ambient: 0.1, out: 0.14, in: 0.14, probe: 0.16 }[kind] || 0.1);
  },
  padSpan(padScale, radius) {
    return Math.min(padScale * 0.9, radius * 0.09);
  },
});
export const RiggedAssets = (() => {
  const cache = new Map();
  const keys = new Set(['arc', 'arrow', 'cargo', 'factory']);
  function load(key, lod = false) {
    if (!keys.has(key)) return Promise.reject(new Error('Unknown rig: ' + key));
    const url = `assets/rigged/${key}/${key}${lod ? '-lod' : ''}.glb`;
    if (!cache.has(url)) {
      const pending = new GLTFLoader().loadAsync(url).catch(error => {
        cache.delete(url);
        throw error;
      });
      cache.set(url, pending);
    }
    return cache.get(url);
  }
  async function proxy(key) {
    const gltf = await load(key, true);
    if (!gltf.proxy) {
      gltf.scene.updateMatrixWorld(true);
      let mesh;
      gltf.scene.traverse(o => {
        if (o.isMesh && !mesh) mesh = o;
      });
      if (!mesh) throw new Error('No proxy mesh for ' + key);
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const b = geo.boundingBox.clone(),
        width = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      const factor = (key === 'factory' ? 1 : 2.7) / width;
      geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
      geo.scale(factor, factor, factor);
      geo.computeBoundingBox();
      gltf.proxy = {
        geo,
        mat: mesh.material,
        h: (b.max.y - b.min.y) * factor,
        span: Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * factor,
        url: `rigged/${key}`,
      };
    }
    return gltf.proxy;
  }
  async function create(key, length = key === 'factory' ? 1 : 2.7) {
    const gltf = await load(key),
      model = gltf.scene.clone(true),
      root = new THREE.Group(),
      fitted = new THREE.Group();
    root.name = 'rigged-' + key;
    root.userData.asset = key;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model),
      size = box.getSize(new THREE.Vector3());
    const factor = length / Math.max(size.x, size.z, 0.001);
    fitted.scale.setScalar(factor);
    fitted.position.set(
      (-(box.min.x + box.max.x) / 2) * factor,
      -box.min.y * factor,
      (-(box.min.z + box.max.z) / 2) * factor,
    );
    fitted.add(model);
    root.add(fitted);
    const mixer = new THREE.AnimationMixer(model),
      clips = new Map(gltf.animations.map(c => [c.name, c]));
    let action = null,
      current = null,
      disposed = false;
    return {
      root,
      key,
      length: size.z * factor,
      height: size.y * factor,
      span: Math.max(size.x, size.y, size.z) * factor,
      clips,
      sample(name, seconds, loop = false) {
        if (disposed) return;
        const clip = clips.get(name);
        if (!clip) return;
        if (current !== name) {
          mixer.stopAllAction();
          action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.reset().play();
          current = name;
        }
        action.paused = false;
        action.time = loop
          ? Math.max(0, seconds) % clip.duration
          : Math.max(0, Math.min(clip.duration - 1e-6, seconds));
        mixer.update(0);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        mixer.stopAllAction();
        mixer.uncacheRoot(model);
        root.removeFromParent();
      },
    };
  }
  return { proxy, create };
})();
