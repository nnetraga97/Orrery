// Animated lots: a generated building is a static body plus rigid parts. Every part
// is one InstancedMesh across the whole planet and moves in its vertex shader, so a
// town of hundreds of lots costs a time uniform per frame. CPU work happens only for
// lots whose state is changing.
//
// A lot's level eases between 0 idle, 1 active and 2 hot. Each lot also has its own
// motion clock (uTime * rate + offset); a rate change rebases the offset so spinning
// parts accelerate smoothly instead of jumping.
//
// Part metadata comes from glTF extras written by scripts/prepare-building.py:
//   motion  'spin' | 'slide' | 'hinge' | 'swing' | 'shake' (default 'static')
//   axis    model-space axis in glTF (Y-up) coordinates
//   amount  radians for spin/hinge/swing, model units for slide/shake
//   speed   cycles per clock second; phase offsets parts of the same lot
//   gain    [idle, active, hot] amplitude multipliers
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { shareGeometryKey } from './town-batches.js';

const MOTIONS = { static: 0, spin: 1, slide: 2, hinge: 3, swing: 4, shake: 5 };
export const LOT_RATE = [1, 3.2, 6.5]; // clock rate per level
const HOT = new THREE.Color('#ff6a3d');

const cache = new Map();
// → { h, bodies: [{ geo, mat }], parts: [{ geo, mat, pivot: Vector3, motion }], lod: { geo, mat } | null }
// or null when absent.
export function loadLotRig(url) {
  if (cache.has(url)) return cache.get(url);
  const p = new GLTFLoader()
    .loadAsync(url)
    .then(gltf => {
      gltf.scene.updateMatrixWorld(true);
      const meshes = [];
      gltf.scene.traverse(o => o.isMesh && meshes.push(o));
      if (!meshes.length) return null;
      const box = new THREE.Box3();
      // The distant mesh is a coarse approximation; it must not change the detailed lot's fit.
      meshes.filter(o => !(o.userData?.lod || o.parent?.userData?.lod)).forEach(o => box.expandByObject(o));
      const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1,
        // Same normalization as kit models: unit footprint, centered, base on the ground.
        fit = new THREE.Matrix4()
          .makeScale(1 / w, 1 / w, 1 / w)
          .multiply(
            new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2),
          );
      const bodies = [],
        parts = [];
      let lod = null;
      for (const o of meshes) {
        // A multi-material node becomes a group; its extras then sit on the parent.
        const x = o.userData?.motion || o.userData?.lod ? o.userData : o.parent?.userData || {};
        if (x.lod) {
          lod = { geo: o.geometry.clone().applyMatrix4(fit.clone().multiply(o.matrixWorld)), mat: o.material };
          continue;
        }
        if (!x.motion || x.motion === 'static') {
          bodies.push({ geo: o.geometry.clone().applyMatrix4(fit.clone().multiply(o.matrixWorld)), mat: o.material });
          continue;
        }
        // Part geometry stays in its pivot's frame, scaled to the lot; the pivot moves to lot space.
        const pivot = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(fit),
          local = new THREE.Matrix4()
            .makeScale(1 / w, 1 / w, 1 / w)
            .multiply(new THREE.Matrix4().extractRotation(o.matrixWorld).scale(o.getWorldScale(new THREE.Vector3())));
        const axis = new THREE.Vector3(...(x.axis || [0, 1, 0])).normalize();
        parts.push({
          geo: o.geometry.clone().applyMatrix4(local),
          mat: o.material,
          pivot,
          motion: {
            kind: MOTIONS[x.motion] ?? 0,
            axis,
            amount: x.motion === 'slide' || x.motion === 'shake' ? (x.amount ?? 0.1) / w : (x.amount ?? Math.PI / 2),
            speed: x.speed ?? 0.25,
            phase: x.phase ?? 0,
            gain: new THREE.Vector3(...(x.gain || [0.25, 1, 1.2])),
          },
        });
      }
      if (!bodies.length) return null;
      const bounds = new THREE.Box3();
      for (const b of bodies) (b.geo.computeBoundingBox(), bounds.union(b.geo.boundingBox));
      // Fit the animated envelope too: rotating drums and sliding panels must
      // not spill into the neighbouring lot when a debugger marker heats them.
      const envelope = bounds.clone();
      if (lod) {
        lod.geo.computeBoundingBox();
        envelope.union(lod.geo.boundingBox);
      }
      for (const part of parts) {
        part.geo.computeBoundingBox();
        const b = part.geo.boundingBox,
          m = part.motion,
          gain = Math.max(m.gain.x, m.gain.y, m.gain.z);
        for (let i = 0; i <= 32; i++) {
          const phase = i / 32,
            angle = m.kind === 1 ? phase * Math.PI * 2 : m.amount * gain * (m.kind === 4 ? phase * 2 - 1 : phase),
            offset = m.amount * gain * (m.kind === 5 ? phase * 2 - 1 : phase);
          for (const x of [b.min.x, b.max.x])
            for (const y of [b.min.y, b.max.y])
              for (const z of [b.min.z, b.max.z]) {
                const p = new THREE.Vector3(x, y, z);
                if ([1, 3, 4].includes(m.kind)) p.applyAxisAngle(m.axis, angle);
                if ([2, 5].includes(m.kind)) p.addScaledVector(m.axis, offset);
                envelope.expandByPoint(p.add(part.pivot));
              }
        }
      }
      const footprint = Math.max(
        1,
        ...[envelope.min.x, envelope.max.x, envelope.min.z, envelope.max.z].map(v => Math.abs(v) * 2),
      );
      return { h: bounds.max.y, footprint, envelopeHeight: envelope.max.y, bodies, parts, lod, url };
    })
    .catch(error => {
      console.warn('Using procedural lot fallback for', url, error);
      return null;
    });
  cache.set(url, p);
  return p;
}
// One material per (source material, motion) pair; the shader reads per-instance level and clock.
function motionMaterial(source, motion, time, distant = false, merged = false) {
  const mat = source.clone();
  // Match the town's kit materials: no environment map lights metal here.
  mat.roughness = 0.62;
  mat.metalness = Math.min(mat.metalness, 0.12);
  const glow = !!mat.emissiveMap || mat.emissive?.getHex() > 0;
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime = time;
    shader.uniforms.uKind = { value: motion?.kind ?? 0 };
    shader.uniforms.uAxis = { value: motion?.axis ?? new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uAmount = { value: motion?.amount ?? 0 };
    shader.uniforms.uSpeed = { value: motion?.speed ?? 0 };
    shader.uniforms.uPhase = { value: motion?.phase ?? 0 };
    shader.uniforms.uGain = { value: motion?.gain ?? new THREE.Vector3() };
    shader.uniforms.uHot = { value: HOT };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aLot; // level, rate, clock offset
        ${distant ? 'attribute float aNear; // drawn in detail instead' : ''}
        uniform float uTime;
        ${
          merged
            ? `attribute vec4 aMotion;
        attribute vec3 aAxis, aGain, aPivot;
        #define uKind int(aMotion.x)
        #define uAmount aMotion.y
        #define uSpeed aMotion.z
        #define uPhase aMotion.w
        #define uAxis aAxis
        #define uGain aGain`
            : `uniform float uAmount, uSpeed, uPhase;
        uniform int uKind;
        uniform vec3 uAxis, uGain;`
        }
        varying float vLevel, vClock;
        vec3 lotRotate(vec3 p, vec3 a, float r) { return p * cos(r) + cross(a, p) * sin(r) + a * dot(a, p) * (1.0 - cos(r)); }
        float lotGain(float l) { return l < 1.0 ? mix(uGain.x, uGain.y, l) : mix(uGain.y, uGain.z, l - 1.0); }
        // Machines dwell, move, dwell and return rather than oscillating sinusoidally.
        float lotCycle(float f) { f = fract(f); return smoothstep(0.0, 0.3, f) - smoothstep(0.55, 0.85, f); }
        float lotAngle(float clock, float level) {
          float g = lotGain(level), f = clock * uSpeed + uPhase;
          if (uKind == 1) return 6.2831853 * f;
          if (uKind == 3) return uAmount * g * lotCycle(f);
          if (uKind == 4) return uAmount * g * sin(6.2831853 * f);
          return 0.0;
        }
        vec3 lotOffset(float clock, float level) {
          float g = lotGain(level), f = clock * uSpeed + uPhase;
          if (uKind == 2) return uAxis * uAmount * g * lotCycle(f);
          if (uKind == 5) return uAxis * uAmount * g * max(level - 1.0, 0.0) * sin(f * 97.0) * sin(f * 41.0);
          return vec3(0.0);
        }`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        vLevel = aLot.x;
        vClock = uTime * aLot.y + aLot.z;
        float lotTurn = lotAngle(vClock, vLevel);
        objectNormal = lotRotate(objectNormal, uAxis, lotTurn);`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed = lotRotate(transformed ${merged ? '- aPivot' : ''}, uAxis, lotTurn) + lotOffset(vClock, vLevel) ${merged ? '+ aPivot' : ''};
        ${distant ? 'if (aNear > 0.5) transformed = vec3(0.0); // degenerate: not rasterized' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uHot;
        varying float vLevel, vClock;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        (glow
          ? `#include <emissivemap_fragment>
        // Energy channels breathe when idle, run when active and flicker hot.
        float lotPulse = 0.55 + 0.45 * sin(vClock * 2.4);
        float lotHot = clamp(vLevel - 1.0, 0.0, 1.0);
        float lotFlicker = mix(1.0, 0.7 + 0.3 * step(0.4, fract(sin(floor(vClock * 9.0)) * 43758.5)), lotHot);
        float lotLuma = dot(totalEmissiveRadiance, vec3(0.3, 0.59, 0.11));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, uHot * lotLuma * 1.8, lotHot)
          * (0.35 + 0.9 * min(vLevel, 1.0) + 0.6 * lotHot) * lotPulse * lotFlicker;`
          : '#include <emissivemap_fragment>') +
          `
        // Hot lots carry a pulsing orange rim over the whole building, readable from the overview.
        float lotHeat = clamp(vLevel - 1.0, 0.0, 1.0);
        float lotRim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
        totalEmissiveRadiance += uHot * lotHeat * (0.4 + 1.4 * lotRim) * (0.65 + 0.35 * sin(vClock * 5.0));`,
      );
  };
  mat.userData.lotTime = time;
  mat.userData.lotBatchKey = JSON.stringify([motion, distant, glow, merged]);
  mat.customProgramCacheKey = () =>
    'lot-motion:' + (motion?.kind ?? 0) + (glow ? ':glow' : '') + (distant ? ':far' : '') + (merged ? ':merged' : '');
  return mat;
}

// Lots closer than NEAR footprints draw every animated part; farther lots draw the
// static distant mesh. Hysteresis keeps a lot from flickering at the boundary.
const NEAR = 24,
  FAR = 28;

// Builds instanced meshes for one rig. placements: [{ matrix }] in placement order.
// Stable per-lot state (level and clock, colors, matrices) lives here; near lots are
// copied into the detail meshes, which only ever draw their first `count` instances.
// Returns { meshes, pickMesh, lots: [handle], focus, update(camera) }.
export function instanceLotRig(rig, placements, time, disposables, mergeParts = false) {
  const n = placements.length,
    lot = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3),
    colors = new Float32Array(n * 3).fill(1);
  lot.setUsage(THREE.DynamicDrawUsage);
  const seed = i => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 50;
  };
  for (let i = 0; i < n; i++) lot.setXYZ(i, 0, LOT_RATE[0], seed(i));
  const origins = placements.map(p => new THREE.Vector3().setFromMatrixPosition(p.matrix)),
    scales = placements.map(p => new THREE.Vector3().setFromMatrixScale(p.matrix).x || 1);
  const state = { dirty: true },
    tmp = new THREE.Matrix4();

  // Detail meshes keep compact copies of the near lots' state.
  const nearLot = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  nearLot.setUsage(THREE.DynamicDrawUsage);
  const details = [];
  const detail = (geo, source, motion, pivot) => {
    const geometry = shareGeometryKey(geo.clone(), geo);
    geometry.setAttribute('aLot', nearLot);
    const mat = motionMaterial(source, motion, time, false, mergeParts),
      mesh = new THREE.InstancedMesh(geometry, mat, n);
    mesh.frustumCulled = false; // its instances change as the camera moves
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    const offset = pivot ? new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z) : null,
      matrices = new Float32Array(n * 16);
    placements.forEach((p, i) =>
      (offset ? tmp.multiplyMatrices(p.matrix, offset) : p.matrix).toArray(matrices, i * 16),
    );
    disposables.push(geometry, mat);
    details.push({ mesh, matrices });
  };
  if (mergeParts) {
    // Motion parameters are constant per vertex, allowing all parts sharing an
    // atlas to move independently in a single instanced draw.
    if (!rig.merged) {
      const byMaterial = new Map();
      for (const part of [...rig.bodies, ...rig.parts]) {
        const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone(),
          pivot = part.pivot ?? new THREE.Vector3(),
          motion = part.motion,
          count = geo.attributes.position.count;
        geo.translate(pivot.x, pivot.y, pivot.z);
        const values = {
          aMotion: [motion?.kind ?? 0, motion?.amount ?? 0, motion?.speed ?? 0, motion?.phase ?? 0],
          aAxis: motion?.axis.toArray() ?? [0, 1, 0],
          aGain: motion?.gain.toArray() ?? [0, 0, 0],
          aPivot: pivot.toArray(),
        };
        for (const [name, value] of Object.entries(values)) {
          const data = new Float32Array(count * value.length);
          for (let i = 0; i < count; i++) data.set(value, i * value.length);
          geo.setAttribute(name, new THREE.BufferAttribute(data, value.length));
        }
        if (!byMaterial.has(part.mat)) byMaterial.set(part.mat, []);
        byMaterial.get(part.mat).push(geo);
      }
      rig.merged = [...byMaterial].map(([mat, geos]) => {
        const geo = mergeGeometries(geos);
        geos.forEach(g => g.dispose());
        return { geo, mat };
      });
    }
    rig.merged.forEach(b => detail(b.geo, b.mat, null, null));
  } else {
    rig.bodies.forEach(b => detail(b.geo, b.mat, null, null));
    rig.parts.forEach(part => detail(part.geo, part.mat, part.motion, part.pivot));
  }

  // The distant mesh holds every lot in stable order, so picking indices never change.
  let far = null,
    nearFlag = null;
  if (rig.lod) {
    const geometry = shareGeometryKey(rig.lod.geo.clone(), rig.lod.geo);
    nearFlag = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    nearFlag.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aLot', lot);
    geometry.setAttribute('aNear', nearFlag);
    const mat = motionMaterial(rig.lod.mat, null, time, true);
    far = new THREE.InstancedMesh(geometry, mat, n);
    placements.forEach((p, i) => far.setMatrixAt(i, p.matrix));
    far.setColorAt(0, new THREE.Color(1, 1, 1));
    disposables.push(geometry, mat);
  }

  let near = rig.lod ? [] : placements.map((_, i) => i); // without a distant mesh every lot is near
  const isNear = new Uint8Array(n).fill(rig.lod ? 0 : 1);
  const sync = changed => {
    const k = near.length;
    for (const { mesh, matrices } of details) {
      if (changed) {
        near.forEach((i, j) =>
          mesh.instanceMatrix.array.set(semantic[i] ? matrices.subarray(i * 16, i * 16 + 16) : hidden.elements, j * 16),
        );
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = k;
      }
      near.forEach((i, j) => mesh.instanceColor.array.set(colors.subarray(i * 3, i * 3 + 3), j * 3));
      mesh.instanceColor.needsUpdate = true;
    }
    near.forEach((i, j) => nearLot.array.set(lot.array.subarray(i * 3, i * 3 + 3), j * 3));
    nearLot.needsUpdate = true;
    if (far) {
      far.instanceColor.array.set(colors);
      far.instanceColor.needsUpdate = true;
      if (changed) {
        for (let i = 0; i < n; i++) nearFlag.array[i] = !semantic[i] || isNear[i] ? 1 : 0;
        nearFlag.needsUpdate = true;
      }
    }
    state.dirty = false;
  };
  const camera = new THREE.Vector3();
  const semantic = new Uint8Array(n).fill(1),
    hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const update = (view, visible = () => true) => {
    let changed = false;
    for (let i = 0; i < n; i++) {
      const next = visible(i) ? 1 : 0;
      if (next !== semantic[i]) {
        semantic[i] = next;
        changed = true;
        if (far) {
          far.setMatrixAt(i, next ? placements[i].matrix : hidden);
          far.instanceMatrix.needsUpdate = true;
          far.boundingSphere = null;
        }
      }
    }
    if (far && view) {
      camera.setFromMatrixPosition(view.matrixWorld);
      for (let i = 0; i < n; i++) {
        const d = camera.distanceTo(origins[i]) / scales[i],
          next = isNear[i] ? d < FAR : d < NEAR;
        if (next !== !!isNear[i]) ((isNear[i] = next ? 1 : 0), (changed = true));
      }
    }
    if (changed) near = placements.map((_, i) => i).filter(i => !far || (semantic[i] && isNear[i]));
    if (changed || state.dirty) sync(changed);
  };
  update(null);
  sync(true);

  // Focus dimming writes colors by stable lot index.
  const color = new THREE.Color();
  const focus = {
    setColorAt(i, c) {
      color.copy(c).toArray(colors, i * 3);
      state.dirty = true;
    },
    instanceColor: { needsUpdate: false },
  };
  const meshes = [...details.map(d => d.mesh), ...(far ? [far] : [])],
    lots = placements.map((_, i) => ({ attribute: lot, index: i, level: 0, target: 0, state }));
  return { meshes, pickMesh: far || details[0].mesh, lots, focus, update };
}

// Eases changing lots toward their target level. Call once per frame with seconds.
export function lotMotionDriver(time) {
  const moving = new Set();
  const rateAt = l =>
    l < 1 ? THREE.MathUtils.lerp(LOT_RATE[0], LOT_RATE[1], l) : THREE.MathUtils.lerp(LOT_RATE[1], LOT_RATE[2], l - 1);
  return {
    set(handle, target) {
      if (!handle || handle.target === target) return;
      handle.target = target;
      moving.add(handle);
    },
    step(dt) {
      const t = time.value;
      for (const h of moving) {
        const { attribute: a, index: i } = h,
          clock = t * a.getY(i) + a.getZ(i);
        h.level += Math.sign(h.target - h.level) * Math.min(Math.abs(h.target - h.level), dt * 1.6);
        const rate = rateAt(h.level);
        a.setXYZ(i, h.level, rate, clock - t * rate); // same clock now, new rate from here
        a.needsUpdate = true;
        h.state.dirty = true;
        if (h.level === h.target) moving.delete(h);
      }
    },
  };
}
