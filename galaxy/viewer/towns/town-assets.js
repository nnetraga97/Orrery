// Owns parser and model loading, shared asset caches, and detail-owned kit materials.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INDUSTRIAL_STYLES, industrialKit } from './industrial-kit.js';
import { loadLotRig } from './lot-motion.js';
import { RiggedAssets } from '../scene/rigged-assets.js';

let tsPromise = null;
export function loadTypeScript() {
  if (window.ts) return Promise.resolve(window.ts);
  if (!tsPromise)
    tsPromise = new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'vendor/runtime/typescript.js';
      s.onload = () => ok(window.ts);
      s.onerror = fail;
      document.head.appendChild(s);
    });
  return tsPromise;
}

// Other languages are parsed with tree-sitter: Java by source-model/java.js, the rest by source-model/syntax.js.
// JavaScript and TypeScript keep the TypeScript compiler path. Each grammar loads on first use.
const treeSitterBase = () => new URL('source-model/vendor/tree-sitter/', document.baseURI);
const syntaxFrontEnds = new Map();
export function loadTreeSitter(language) {
  if (!syntaxFrontEnds.has(language.id))
    syntaxFrontEnds.set(
      language.id,
      language.frontEnd === 'java'
        ? import('../../source-model/java.js').then(async m => {
            const parser = await m.createJavaParser(treeSitterBase());
            return { parse: parser.parse, flow: m.extractJavaFlow, tokens: m.javaTokens };
          })
        : import('../../source-model/syntax.js').then(async m => {
            const parser = await m.createSyntaxParser(language.id, treeSitterBase());
            return {
              parse: parser.parse,
              flow: (tree, source, member) => m.extractSyntaxFlow(tree, source, member, language.id),
              tokens: m.syntaxTokens,
            };
          }),
    );
  return syntaxFrontEnds.get(language.id);
}

// ---------- 3. asset kit (Kenney CC0 packs, normalized to a 1×1 footprint) ----------
export const KIT = {
  house: 'suburban/building-type-a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u',
  block: 'industrial/building-k,l,m,n,o,p,q,r,s,t', // plain statements: depots and warehouses
  tower: 'commercial/building-skyscraper-a,b,c,d,e',
  plant: 'industrial/building-a,b,c,d,e,f,g,h,i,j', // state writes: factories
  office: 'commercial/building-a,b,c,d,e,f,g,h,i,j,k,l,m,n', // calls out of the method: offices
  gate: 'space/gate_simple',
  crater: 'space/craterLarge',
  barrels: 'space/barrels',
  padLarge: 'space/platform_large',
  padSmall: 'space/platform_small',
  hangar: 'space/hangar_smallA',
  hangarLarge: 'space/hangar_largeA',
  ctrlTower: 'space/structure_detailed',
  stationDeck: 'space/platform_high',
  parked: 'space/craft_cargoA,craft_speederA',
  rocketBase: 'space/rocket_baseA',
  rocketFuel: 'space/rocket_fuelA',
  rocketTop: 'space/rocket_topA',
  tree: 'suburban/tree-large,tree-small',
  waterTower: 'industrial/water-tower',
  tank: 'industrial/detail-tank-large',
  chimney: 'industrial/chimney-large',
};
const GENERATED_LOTS = [
  'tower',
  'house',
  'block',
  'plant',
  'gate',
  'crater',
  'barrels',
  'network',
  'relay',
  'interface',
  'constructor',
];
const kitCache = new Map();
function kitNames() {
  const all = [];
  for (const [role, spec] of Object.entries(KIT)) {
    if (Object.hasOwn(INDUSTRIAL_STYLES, role)) continue; // Procedural roles need no GLB download or upload.
    const [pack, list] = spec.split('/');
    const names = list.split(',');
    const prefix = names[0].replace(/-[a-z]$/, '-');
    names.forEach((n, k) =>
      all.push({ role, url: `assets/kit/${pack}/${k === 0 || !/^[a-z]$/.test(n) ? n : prefix + n}.glb` }),
    );
  }
  return all;
}
export function loadModel(url) {
  if (kitCache.has(url)) return kitCache.get(url);
  const p = new Promise(ok =>
    new GLTFLoader().load(
      url,
      gltf => {
        gltf.scene.updateMatrixWorld(true);
        const parts = [];
        gltf.scene.traverse(o => {
          if (o.isMesh) parts.push(o);
        });
        let geo, mat;
        if (parts.length === 1 && parts[0].material.map) {
          geo = parts[0].geometry.clone().applyMatrix4(parts[0].matrixWorld);
          mat = parts[0].material;
        } else if (
          parts.length &&
          parts[0].material.map &&
          parts.every(o => o.material.map === parts[0].material.map)
        ) {
          // Several parts sharing one texture atlas: merge them and keep the atlas.
          const geos = parts.map(o => {
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
            for (const name of Object.keys(g.attributes))
              if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
            return g;
          });
          geo = BufferGeometryUtils.mergeGeometries(geos);
          mat = parts[0].material;
        } else {
          // Bake each part's flat colour into vertex colours and merge, so the model is one geometry / one draw call.
          const geos = parts.map(o => {
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld).toNonIndexed();
            const c = o.material.color || new THREE.Color('#ccc');
            const col = new Float32Array(g.attributes.position.count * 3);
            for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
            g.setAttribute('color', new THREE.BufferAttribute(col, 3));
            ['uv', 'uv2', 'tangent'].forEach(a => g.deleteAttribute(a));
            return g;
          });
          geo = BufferGeometryUtils.mergeGeometries(geos);
          mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
        }
        geo.computeBoundingBox();
        const b = geo.boundingBox.clone(),
          w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
        geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        geo.scale(1 / w, 1 / w, 1 / w);
        ok({ geo, mat, h: (b.max.y - b.min.y) / w });
      },
      undefined,
      () => ok(null),
    ),
  );
  kitCache.set(url, p);
  return p;
}
export async function loadKit() {
  const entries = kitNames(),
    models = await Promise.all(entries.map(e => loadModel(e.url)));
  const kit = {};
  entries.forEach((e, k) => {
    if (models[k]) (kit[e.role] = kit[e.role] || []).push({ ...models[k], url: e.url });
  });
  return kit;
}

export async function prepareTownKit(build, kit) {
  const { ctx, disposables } = build;
  // Preparation needs no statement assets or generated rigs.
  if (!ctx.prepareOnly) {
    // Materials belong to this detail; shared cached kit assets retain their original appearance.
    const materials = new Map();
    for (const list of Object.values(kit))
      for (const model of list) {
        if (!materials.has(model.mat)) {
          const mat = model.mat.clone();
          mat.roughness = 0.62;
          mat.metalness = 0.12;
          materials.set(model.mat, mat);
          disposables.push(mat);
        }
        model.mat = materials.get(model.mat);
      }
    Object.assign(kit, industrialKit(disposables));
    // One inexpensive instanced silhouette for every external-call lot. The full
    // rig is loaded only for the currently inspected factory.
    try {
      const model = await RiggedAssets.proxy('factory');
      if (ctx.signal?.aborted) throw new DOMException('Planet build cancelled', 'AbortError');
      const mat = model.mat.clone();
      disposables.push(mat);
      kit.office = [{ ...model, mat }];
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      console.warn('Using procedural factory fallback', error);
    }
    // Generated, rigged lots replace their procedural model once scripts/prepare-building.py
    // has exported them; a missing file keeps the procedural model.
    const rigs = await Promise.all(GENERATED_LOTS.map(role => loadLotRig(`assets/buildings/${role}/${role}.glb`)));
    if (ctx.signal?.aborted) throw new DOMException('Planet build cancelled', 'AbortError');
    GENERATED_LOTS.forEach((role, k) => {
      const rig = rigs[k];
      if (rig)
        kit[role] = [
          {
            geo: rig.bodies[0].geo,
            mat: rig.bodies[0].mat,
            h: ctx.surface ? rig.h : rig.envelopeHeight,
            url: rig.url,
            rig,
          },
        ];
    });
  }
}
