// A lot represents a source statement. Its main structure describes the operation;
// small, static roof fixtures retain assignment, return and await semantics.
// Classification deliberately uses parser evidence, never guesses from method names.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';


export const INDUSTRIAL_STYLES = {
  office: 'assembler',
  library: 'library',
  plant: 'plant',
  tower: 'tower',
  house: 'storage',
  block: 'depot',
  dataStore: 'dataStore',
  network: 'network',
  relay: 'relay',
  interface: 'interface',
  constructor: 'constructor',
  effectReturn: 'effectReturn',
  effectWrite: 'effectWrite',
  effectAwait: 'effectAwait',
  effectThrow: 'effectThrow',
};
function buildIndustrialKit(disposables) {
  const steel = '#a9c5ca',
    dark = '#294452',
    orange = '#e8a045',
    cyan = '#40d7dc',
    violet = '#b29be6';
  const build = kind => {
    const parts = [];
    const add = (geometry, color, x = 0, y = 0, z = 0, rotation = null) => {
      if (rotation) geometry.rotateX(rotation);
      geometry.translate(x, y, z);
      const geo = geometry.index ? geometry.toNonIndexed() : geometry;
      if (geo !== geometry) geometry.dispose();
      geo.deleteAttribute('uv');
      const c = new THREE.Color(color),
        colors = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(geo);
    };
    const box = (w, h, d, c, x, y, z) => add(new THREE.BoxGeometry(w, h, d), c, x, y, z);
    const cylinder = (r, h, c, x, y, z) => add(new THREE.CylinderGeometry(r, r, h, 12), c, x, y, z);
    const ring = (r, c, y) => add(new THREE.TorusGeometry(r, 0.035, 5, 20), c, 0, y, 0, Math.PI / 2);
    if (!kind.startsWith('effect')) box(1, 0.1, 1, dark, 0, 0.05, 0);
    if (kind === 'effectReturn') {
      box(0.1, 0.28, 0.1, cyan, 0, 0.14, 0);
      add(new THREE.ConeGeometry(0.18, 0.22, 4), cyan, 0, 0.35, 0);
    } else if (kind === 'effectWrite') {
      for (let i = 0; i < 3; i++) box(0.38, 0.065, 0.26, orange, 0, 0.07 + i * 0.12, 0);
      box(0.07, 0.32, 0.07, steel, -0.21, 0.18, 0);
    } else if (kind === 'effectAwait') {
      box(0.36, 0.055, 0.28, violet, 0, 0.028, 0);
      box(0.36, 0.055, 0.28, violet, 0, 0.49, 0);
      add(new THREE.ConeGeometry(0.14, 0.2, 4), violet, 0, 0.17, 0);
      add(new THREE.ConeGeometry(0.14, 0.2, 4), violet, 0, 0.36, 0, Math.PI);
      for (const x of [-0.16, 0.16]) box(0.035, 0.45, 0.035, steel, x, 0.25, 0);
    } else if (kind === 'effectThrow') {
      box(0.07, 0.36, 0.07, '#ef826d', 0, 0.18, 0);
      box(0.18, 0.065, 0.12, '#ef826d', 0, 0.46, 0);
    } else if (kind === 'tower') {
      cylinder(0.35, 0.2, steel, 0, 0.2, 0);
      cylinder(0.18, 1.35, steel, 0, 0.85, 0);
      for (const y of [0.45, 0.98, 1.46]) {
        cylinder(0.32, 0.13, dark, 0, y, 0);
        ring(0.4, cyan, y + 0.07);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        box(0.075, 1.24, 0.075, steel, Math.cos(a) * 0.29, 0.9, Math.sin(a) * 0.29);
      }
      cylinder(0.25, 0.17, orange, 0, 1.64, 0);
    } else if (kind === 'plant') {
      for (const x of [-0.25, 0.25]) {
        cylinder(0.2, 0.64, steel, x, 0.46, 0);
        cylinder(0.205, 0.08, orange, x, 0.4, 0);
        cylinder(0.14, 0.1, cyan, x, 0.83, 0);
      }
      box(0.74, 0.08, 0.1, cyan, 0, 0.21, 0.33);
      box(0.14, 0.94, 0.14, dark, 0, 0.57, -0.3);
      box(0.25, 0.08, 0.24, orange, 0, 1.05, -0.3);
    } else if (kind === 'dataStore') {
      cylinder(0.35, 0.82, steel, 0, 0.55, 0);
      for (const y of [0.21, 0.48, 0.75, 0.98]) {
        cylinder(0.39, 0.085, dark, 0, y, 0);
        ring(0.39, cyan, y + 0.043);
      }
      box(0.1, 0.6, 0.08, orange, 0.31, 0.54, 0.28);
    } else if (kind === 'network') {
      box(0.68, 0.34, 0.62, steel, 0, 0.28, 0);
      cylinder(0.07, 0.77, dark, 0, 0.76, 0);
      add(new THREE.ConeGeometry(0.34, 0.23, 12, 1, true), steel, 0, 1.14, 0, Math.PI);
      ring(0.34, cyan, 1.25);
      cylinder(0.035, 0.25, orange, 0, 1.31, 0);
      for (const x of [-0.24, 0.24]) box(0.09, 0.14, 0.08, cyan, x, 0.45, 0.32);
    } else if (kind === 'relay') {
      for (const x of [-0.32, 0.32]) {
        box(0.12, 0.83, 0.12, steel, x, 0.54, 0);
        for (const y of [0.68, 0.84]) cylinder(0.12, 0.055, violet, x, y, 0);
      }
      box(0.76, 0.1, 0.13, cyan, 0, 1.01, 0);
      for (const x of [-0.23, 0, 0.23]) box(0.14, 0.32, 0.39, dark, x, 0.3, 0.13);
      box(0.8, 0.065, 0.065, orange, 0, 0.25, 0.38);
    } else if (kind === 'interface') {
      box(0.82, 0.14, 0.56, steel, 0, 0.19, 0);
      for (const x of [-0.31, 0.31]) box(0.08, 0.5, 0.1, steel, x, 0.49, -0.1);
      box(0.83, 0.61, 0.13, dark, 0, 0.85, -0.1);
      box(0.68, 0.45, 0.025, cyan, 0, 0.86, -0.02);
      box(0.46, 0.035, 0.035, steel, -0.05, 1.0, 0.001);
      box(0.23, 0.035, 0.035, steel, -0.17, 0.9, 0.001);
      box(0.2, 0.035, 0.035, orange, 0.13, 0.75, 0.001);
    } else if (kind === 'constructor') {
      for (const x of [-0.39, 0.39]) box(0.1, 1.04, 0.13, steel, x, 0.62, -0.11);
      box(0.89, 0.13, 0.17, orange, 0, 1.2, -0.11);
      box(0.065, 0.43, 0.065, dark, 0, 0.95, -0.11);
      box(0.47, 0.34, 0.45, steel, 0, 0.29, 0.06);
      box(0.3, 0.16, 0.3, cyan, 0, 0.54, 0.06);
      for (const x of [-0.38, 0.38]) box(0.08, 0.05, 0.68, orange, x, 0.14, 0);
    } else if (kind === 'library') {
      // Placeholder until a modelled building exists: stacked vendor crates under a violet band.
      box(0.78, 0.3, 0.7, steel, 0, 0.25, 0);
      box(0.82, 0.07, 0.74, violet, 0, 0.43, 0);
      box(0.5, 0.24, 0.46, dark, -0.1, 0.59, 0.04);
      box(0.3, 0.2, 0.3, steel, 0.16, 0.81, -0.06);
      box(0.32, 0.04, 0.32, violet, 0.16, 0.93, -0.06);
      for (const x of [-0.3, 0.3]) box(0.08, 0.16, 0.06, cyan, x, 0.22, 0.37);
    } else if (kind === 'storage') {
      for (const x of [-0.24, 0.24]) {
        box(0.34, 0.45, 0.72, steel, x, 0.33, 0);
        box(0.35, 0.06, 0.74, dark, x, 0.59, 0);
        for (const z of [-0.24, 0, 0.24]) box(0.27, 0.025, 0.17, cyan, x, 0.64, z);
      }
      box(0.08, 0.12, 0.82, orange, 0, 0.23, 0);
    } else if (kind === 'depot') {
      box(0.82, 0.4, 0.74, steel, 0, 0.31, 0);
      box(0.88, 0.06, 0.8, dark, 0, 0.54, 0);
      for (const x of [-0.28, 0, 0.28]) box(0.19, 0.03, 0.58, cyan, x, 0.59, 0);
      box(0.54, 0.26, 0.025, dark, 0, 0.29, 0.38);
      box(0.58, 0.045, 0.045, orange, 0, 0.45, 0.4);
    } else {
      box(0.75, 0.35, 0.7, steel, 0, 0.3, 0);
      box(0.82, 0.09, 0.76, orange, 0, 0.53, 0);
      box(0.43, 0.22, 0.45, dark, 0, 0.69, 0);
      box(0.47, 0.035, 0.49, cyan, 0, 0.82, 0);
      for (const x of [-0.35, 0.35]) {
        cylinder(0.065, 0.7, steel, x, 0.46, -0.3);
        box(0.07, 0.12, 0.1, cyan, x, 0.8, -0.3);
      }
      box(0.58, 0.05, 0.12, cyan, 0, 0.27, 0.39);
    }
    const geo = BufferGeometryUtils.mergeGeometries(parts);
    parts.forEach(g => g.dispose());
    geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.48,
      metalness: 0.3,
      emissive: '#123d45',
      emissiveIntensity: 0.18,
    });
    disposables.push(geo, mat);
    return { geo, mat, h: geo.boundingBox.max.y, url: 'procedural/' + kind };
  };
  return Object.fromEntries(Object.entries(INDUSTRIAL_STYLES).map(([role, style]) => [role, [build(style)]]));
}

// Every town uses the same rigid silhouettes. Share their immutable geometry,
// but keep materials local (town focus and motion uniforms must not cross owners).
// Leases cover visible and staged revisions; cancellation cannot dispose a
// retained town's buffers. The last owner releases the prototypes as well.
let sharedKit = null;
let sharedResources = [];
let owners = 0;
export function industrialKit(disposables) {
  sharedKit ??= buildIndustrialKit(sharedResources);
  owners++;
  let released = false;
  disposables.push({
    dispose() {
      if (released) return;
      released = true;
      if (--owners === 0) {
        sharedResources.forEach(resource => resource.dispose());
        sharedResources = [];
        sharedKit = null;
      }
    },
  });
  return Object.fromEntries(
    Object.entries(sharedKit).map(([role, models]) => [
      role,
      models.map(model => {
        const mat = model.mat.clone();
        disposables.push(mat);
        return { ...model, mat };
      }),
    ]),
  );
}
