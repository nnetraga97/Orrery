// Towns retain their own geometry, picking and motion state. Compatible instance
// streams share a draw across the planet; rebuilding one town leaves its peers intact.
import * as THREE from 'three';

const geometryKeys = new WeakMap(),
  keySources = new WeakMap();
// Per-town clones of a shared template differ only in instanced attributes, which the key ignores. They reuse
// the template's key instead of rehashing megabytes per town (seconds per planet otherwise).
export function shareGeometryKey(clone, source) {
  keySources.set(clone, source);
  return clone;
}
// Hashing every byte of a 58k-triangle asset blocked a planet build for ~50 ms. Past HASHED bytes an attribute is read
// at an even, odd stride (so it cycles through each element's bytes); with its layout and counts in the key, distinct
// meshes still cannot plausibly collide.
const HASHED = 1 << 18;
function geometryKey(geometry) {
  if (geometryKeys.has(geometry)) return geometryKeys.get(geometry);
  if (keySources.has(geometry)) {
    const key = geometryKey(keySources.get(geometry));
    geometryKeys.set(geometry, key);
    return key;
  }
  let hash = 2166136261,
    second = 5381;
  const attributes = Object.entries(geometry.attributes).filter(([, a]) => !a.isInstancedBufferAttribute);
  for (const [, attribute] of [...attributes, ['index', geometry.index]].filter(([, a]) => a)) {
    const bytes = new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength),
      step = bytes.length > HASHED ? Math.ceil(bytes.length / HASHED) | 1 : 1;
    for (let i = 0; i < bytes.length; i += step) {
      hash = Math.imul(hash ^ bytes[i], 16777619);
      second = Math.imul(second, 33) ^ bytes[i];
    }
  }
  const key = JSON.stringify([hash >>> 0, second >>> 0, attributes.map(([name, a]) => [name, a.itemSize, a.count])]);
  geometryKeys.set(geometry, key);
  return key;
}
function materialKey(m) {
  return JSON.stringify([
    m.type,
    m.color?.getHex(),
    m.emissive?.getHex(),
    m.emissiveIntensity,
    m.roughness,
    m.metalness,
    m.opacity,
    m.transparent,
    m.depthWrite,
    m.depthTest,
    m.side,
    m.vertexColors,
    m.toneMapped,
    m.map?.uuid,
    m.normalMap?.uuid,
    m.emissiveMap?.uuid,
    m.alphaTest,
    m.flatShading,
    m.blending,
    m.alphaMap?.uuid,
    m.roughnessMap?.uuid,
    m.metalnessMap?.uuid,
    m.aoMap?.uuid,
    m.normalScale?.toArray(),
    m.polygonOffset,
    m.polygonOffsetFactor,
    m.polygonOffsetUnits,
    m.userData.lotBatchKey ?? m.customProgramCacheKey(),
  ]);
}
export function batchTownInstances(units) {
  const group = new THREE.Group(),
    batches = new Map();
  group.name = 'shared-town-instances';
  for (const unit of units) {
    if (!unit.drawSources) {
      unit.drawSources = [];
      unit.renderer.group.traverse(mesh => {
        if (mesh.isInstancedMesh && !Array.isArray(mesh.material)) unit.drawSources.push({ mesh, parent: mesh.parent });
      });
      // Detached sources still serve exact picking and retained animation state.
      const dispose = unit.renderer.dispose;
      unit.renderer.dispose = () => {
        for (const { mesh, parent } of unit.drawSources) parent.add(mesh);
        dispose();
      };
      for (const { mesh } of unit.drawSources) mesh.removeFromParent();
    }
    for (const { mesh } of unit.drawSources) {
      const key = geometryKey(mesh.geometry) + materialKey(mesh.material);
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push({ unit, mesh });
    }
  }
  const streams = [...batches.values()].map(sources => {
    const first = sources[0].mesh,
      geometry = first.geometry.clone(),
      capacity = sources.reduce((n, s) => n + s.mesh.instanceMatrix.count, 0),
      material = first.material.clone();
    material.onBeforeCompile = first.material.onBeforeCompile;
    material.customProgramCacheKey = first.material.customProgramCacheKey;
    const attributes = Object.entries(first.geometry.attributes).filter(([, a]) => a.isInstancedBufferAttribute);
    for (const [name, a] of attributes)
      geometry.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(new a.array.constructor(capacity * a.itemSize), a.itemSize).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    mesh.frustumCulled = false;
    mesh.count = 0;
    const slots = [];
    mesh.userData.townBatchSlots = slots;
    group.add(mesh);
    return { mesh, sources, attributes, slots };
  });
  return {
    group,
    pickables: streams
      .filter(s => s.sources.some(({ unit, mesh }) => unit.renderer.pickables.includes(mesh)))
      .map(s => s.mesh),
    update(t = 0) {
      for (const { mesh, sources, attributes, slots } of streams) {
        mesh.count = 0;
        slots.length = 0;
        for (const { unit, mesh: source } of sources) {
          // The shader closure belongs to the first source, even if that town is culled.
          if (source.material.userData.lotTime) source.material.userData.lotTime.value = t;
          if (!unit.scene.visible || !source.visible) continue;
          const offset = mesh.count,
            count = source.count;
          mesh.instanceMatrix.array.set(source.instanceMatrix.array.subarray(0, count * 16), offset * 16);
          if (source.instanceColor)
            mesh.instanceColor.array.set(source.instanceColor.array.subarray(0, count * 3), offset * 3);
          for (const [name, a] of attributes)
            mesh.geometry.attributes[name].array.set(
              source.geometry.attributes[name].array.subarray(0, count * a.itemSize),
              offset * a.itemSize,
            );
          for (let i = 0; i < count; i++) slots.push({ object: source, instanceId: i });
          mesh.count += count;
        }
        mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = true;
        for (const [name] of attributes) mesh.geometry.attributes[name].needsUpdate = true;
        mesh.boundingSphere = null;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const { mesh } of streams) {
        mesh.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
