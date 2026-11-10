// Shared geometry/atlas, independent exported animation poses, eight instanced
// draws at most across a planet. Dock reservations belong to this planet lifetime.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let cached;
export function loadTownPortAsset() {
  if (!cached)
    cached = new GLTFLoader()
      .loadAsync('assets/rigged/town-port/town-port.glb')
      .then(gltf => {
        gltf.scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3();
        gltf.scene.traverse(o => {
          if (o.isMesh && !o.userData.lod) bounds.expandByObject(o);
        });
        const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
        const fit = new THREE.Matrix4()
          .makeScale(1 / span, 1 / span, 1 / span)
          .multiply(
            new THREE.Matrix4().makeTranslation(
              -(bounds.min.x + bounds.max.x) / 2,
              -bounds.min.y,
              -(bounds.min.z + bounds.max.z) / 2,
            ),
          );
        for (const name of ['Dock_01', 'Dock_02', 'Dock_03', 'Road_Access'])
          if (!gltf.scene.getObjectByName(name)) throw new Error('Town port missing ' + name);
        for (const name of ['Radar scan', 'Dock 01', 'Dock 02', 'Dock 03'])
          if (!gltf.animations.some(c => c.name === name)) throw new Error('Town port missing animation ' + name);
        const access = gltf.scene
          .getObjectByName('Road_Access')
          .getWorldPosition(new THREE.Vector3())
          .applyMatrix4(fit);
        return { gltf, fit, span, access, height: (bounds.max.y - bounds.min.y) / span };
      })
      .catch(error => {
        cached = null;
        throw error;
      });
  return cached;
}

export function createTownPortFleet(asset, parent, placements) {
  const { gltf, fit, span } = asset;
  const batch = [],
    materialCache = new Map(),
    matrix = new THREE.Matrix4(),
    point = new THREE.Vector3();
  let stopped = false,
    elapsed = 0;
  const ports = placements.map(p => {
    const pose = gltf.scene.clone(true),
      mixer = new THREE.AnimationMixer(pose);
    const actions = new Map(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
    const radar = actions.get('Radar scan');
    radar.play();
    radar.paused = true;
    pose.updateMatrixWorld(true);
    const docks = [1, 2, 3].map(i => {
      const node = pose.getObjectByName('Dock_0' + i),
        approach = pose.getObjectByName('Approach_0' + i);
      const world = p.matrix.clone().multiply(fit);
      return {
        k: p.k,
        index: i - 1,
        occupied: false,
        token: null,
        point: node.getWorldPosition(new THREE.Vector3()).applyMatrix4(world),
        approach: approach.getWorldPosition(new THREE.Vector3()).applyMatrix4(world),
        normal: new THREE.Vector3(0, 1, 0).transformDirection(p.matrix),
        width: ((2 * node.userData.radius) / span) * p.width,
      };
    });
    return { ...p, pose, mixer, actions, docks, cursor: 0, preview: null, near: true };
  });
  const byRegion = new Map(ports.map(p => [p.k, p]));
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    let material = materialCache.get(o.material);
    if (!material) {
      material = o.material.clone();
      materialCache.set(o.material, material);
    }
    const geometry = o.geometry;
    const mesh = new THREE.InstancedMesh(geometry, material, ports.length);
    mesh.name = o.userData.lod ? 'town-port-distant' : 'town-port-' + o.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.userData.portRegions = [];
    parent.add(mesh);
    batch.push({ mesh, name: o.name, distant: !!o.userData.lod });
  });
  function poseDock(k, index, seconds) {
    const port = byRegion.get(k);
    if (!port || stopped) return false;
    const action = port.actions.get('Dock 0' + (index + 1));
    action.play();
    action.paused = true;
    action.time = THREE.MathUtils.clamp(seconds, 0, action.getClip().duration);
    return true;
  }
  function release(dock) {
    if (!dock || stopped) return;
    const original = byRegion.get(dock.k)?.docks[dock.index];
    if (original?.token !== dock.token) return;
    original.occupied = false;
    original.token = null;
    poseDock(dock.k, dock.index, 4);
  }
  function reserve(k) {
    const p = byRegion.get(k);
    if (!p || stopped) return null;
    for (let j = 0; j < 3; j++) {
      const index = (p.cursor + j) % 3,
        dock = p.docks[index];
      if (dock.occupied) continue;
      dock.occupied = true;
      dock.token = Symbol('dock');
      p.cursor = (index + 1) % 3;
      return { ...dock };
    }
    return null;
  }
  function step(dt, camera, focused = -1) {
    if (stopped) return;
    elapsed += dt;
    for (const p of ports) {
      point.setFromMatrixPosition(p.matrix);
      p.near = !camera || camera.position.distanceTo(point) < p.width * (p.near ? 22 : 19);
      if (p.preview) {
        p.preview.time += dt;
        poseDock(p.k, p.preview.index, p.preview.time);
        if (p.preview.time >= 4) {
          release(p.preview.dock);
          p.preview = null;
        }
      }
      if (!p.near) continue;
      p.actions.get('Radar scan').time = elapsed % 8;
      p.mixer.update(0);
      p.pose.updateMatrixWorld(true);
    }
    for (const b of batch) {
      b.mesh.count = 0;
      b.mesh.userData.portRegions.length = 0;
      for (const p of ports) {
        if (b.distant === p.near) continue;
        const o = p.pose.getObjectByName(b.name),
          slot = b.mesh.count++;
        matrix.copy(p.matrix).multiply(fit).multiply(o.matrixWorld);
        b.mesh.setMatrixAt(slot, matrix);
        b.mesh.setColorAt(slot, new THREE.Color(focused < 0 || focused === p.k ? '#ffffff' : '#bfd1c5'));
        b.mesh.userData.portRegions.push(p.k);
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
    }
  }
  step(0, null);
  return {
    meshes: batch.map(b => b.mesh),
    reserve,
    release,
    poseDock,
    step,
    docks: k => byRegion.get(k)?.docks || [],
    preview(k, index) {
      const p = byRegion.get(k);
      if (!p || p.preview || p.docks.some(d => d.occupied)) return false;
      const dock = p.docks[index];
      dock.occupied = true;
      dock.token = Symbol('preview');
      p.preview = { index, time: 0, dock: { ...dock } };
      return true;
    },
    snapshot: () =>
      ports.map(p => ({
        k: p.k,
        near: p.near,
        docks: p.docks.map(d => ({ index: d.index, occupied: d.occupied, point: d.point.toArray() })),
      })),
    dispose() {
      if (stopped) return;
      stopped = true;
      for (const p of ports) {
        p.mixer.stopAllAction();
        p.mixer.uncacheRoot(p.pose);
      }
      for (const b of batch) {
        b.mesh.removeFromParent();
        b.mesh.dispose();
      }
      for (const m of materialCache.values()) m.dispose();
    },
  };
}
