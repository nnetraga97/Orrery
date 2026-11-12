#!/usr/bin/env node
// The only edits made to files copied from codebase-viz: they swap the desktop app's loopback project API for the
// baked static files (galaxy/viewer/app/static-data.js), and let a host supply its own scene kit. Each edit replaces
// one exact piece of text. Running this
// twice is safe; it fails loudly if the copied code no longer contains the text it expects.
// Usage: node tools/migrate/apply-patches.mjs   (tools/migrate/copy-code.sh runs it for you)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PATCHES = [
  {
    file: 'galaxy/viewer/galaxy/constellation.js',
    why: 'a host may supply its own scene kit (the XR app; see src/galaxy-bridge/scene-kit.js)',
    find: `  const T = scene3D([0, 120, 160], { space: true }, host);`,
    replace: `  const T = host.sceneKit
    ? host.sceneKit([0, 120, 160], { space: true })
    : scene3D([0, 120, 160], { space: true }, host);`,
  },
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'the graph file is a static file',
    find: `export const dataFile = (name: string, kind: 'graph' | 'symbols', revision?: number | null) =>
  \`/api/projects/\${name}/data/\${kind}\${revision != null ? \`?rev=\${revision}\` : ''}\`;`,
    replace: `export const dataFile = (name: string, _kind: 'graph' | 'symbols', _revision?: number | null) => graphUrl(name);`,
  },
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'symbols come from baked shards',
    find: `  const query = new URLSearchParams();
  if (revision != null) query.set('rev', String(revision));
  paths.forEach(path => query.append('path', path));
  const res = await fetch(\`/api/projects/\${name}/data/symbols?\${query}\`);
  if (!res.ok) throw Object.assign(new Error(\`Could not load file symbols (\${res.status}).\`), { status: res.status });
  return res.json();`,
    replace: `  void revision; // A baked dataset has one revision.
  return symbolsFor(name, paths);`,
  },
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'import the static data helpers',
    find: `import type { DatasetGraph, DatasetSymbols, FileNode, ImportLink } from './types.ts';`,
    replace: `import type { DatasetGraph, DatasetSymbols, FileNode, ImportLink } from './types.ts';
import { graphUrl, symbolsFor } from './static-data.js';`,
  },
  {
    file: 'galaxy/viewer/planet/planet.js',
    why: 'source text is a static file, or the in-memory workspace\'s edited text (static-data.js, setSourceOverride)',
    find: `  const key = getDataset() + '/' + path;
  if (!sourceCache[key])
    sourceCache[key] = fetch(
      \`/api/projects/\${getDataset()}/source/\${path.split('/').map(encodeURIComponent).join('/')}\`,
    )
      .then(r => (r.ok ? r.text() : null))
      .catch(() => null)
      .then(text => {`,
    replace: `  // An edited file is read from the workspace every time; the baked text is cached.
  const own = sourceOverride(getDataset(), path);
  if (own != null) return Promise.resolve(own);
  const key = getDataset() + '/' + path;
  if (!sourceCache[key])
    sourceCache[key] = readSource(getDataset(), path)
      .then(text => {`,
  },
  {
    file: 'galaxy/viewer/planet/planet.js',
    why: 'import the static data helpers',
    find: `import { languageOf } from '../../source-model/languages.js';`,
    replace: `import { languageOf } from '../../source-model/languages.js';
import { readSource, sourceOverride } from '../app/static-data.js';`,
  },
  {
    file: 'galaxy/viewer/scene/rigged-assets.js',
    why: 'a host may ask for the light (-lod) model of every rig (the XR app, to keep within a headset budget)',
    find: `  function load(key, lod = false) {`,
    replace: `  // A host may ask for the light (-lod) model of every rig (the XR app does, for a headset's budget).
  let preferLod = false;
  function load(key, lod = preferLod) {`,
  },
  {
    file: 'galaxy/viewer/scene/rigged-assets.js',
    why: 'expose the light-model switch',
    find: `  return { proxy, create };
})();`,
    replace: `  return {
    proxy,
    create,
    preferLod(on) {
      preferLod = !!on;
    },
  };
})();`,
  },
  {
    file: 'galaxy/viewer/galaxy/constellation-fleet.js',
    why: 'a host may cap how many ship hulls are drawn at once',
    find: `// ---------- shared assets ----------
let shipGeometryPromise = null;`,
    replace: `// How many ship hulls are drawn at once; a host may lower it (the XR app does, for a headset's budget).
export const FleetLimits = { visible: 900 };

// ---------- shared assets ----------
let shipGeometryPromise = null;`,
  },
  {
    file: 'galaxy/viewer/galaxy/constellation-fleet.js',
    why: 'apply the hull cap',
    find: `      if (k >= MAX_SHIPS) break;`,
    replace: `      if (k >= Math.min(MAX_SHIPS, FleetLimits.visible)) break;`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'a host may build the island lighter: modelled buildings for the first landmark and the first house only',
    find: `import { glowTex } from '../scene/textures.js';`,
    replace: `import { glowTex } from '../scene/textures.js';

// A host may ask for a lighter island: only the first landmark and the first house use their modelled buildings, the
// rest are simple blocks (the XR app does, for a headset's budget).
export const IslandDetail = { full: true };`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'lighter island: landmarks after the first are blocks',
    find: `      const shell = (m.mesh && building(m.mesh, m.size)) || block(m.size, m.height, palette.wall, palette.roofs[i % 3]);`,
    replace: `      const shell =
        (m.mesh && (IslandDetail.full || i === 0) && building(m.mesh, m.size)) ||
        block(m.size, m.height, palette.wall, palette.roofs[i % 3]);`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'lighter island: houses after the first are blocks',
    find: `      const mesh = lot.mesh && building(lot.mesh, size);`,
    replace: `      const mesh = lot.mesh && (IslandDetail.full || i === 0) && building(lot.mesh, size);`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'lighter island: load only the building sheets the first landmark and first house use',
    find: `        [...L.landmarks, ...L.houses.lots]
          .map(m => m.mesh)`,
    replace: `        (IslandDetail.full ? [...L.landmarks, ...L.houses.lots] : [L.landmarks[0], L.houses.lots[0]].filter(Boolean))
          .map(m => m.mesh)`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'a still island: a host may stop the idle motions while the agent is not working',
    find: `export const IslandDetail = { full: true };`,
    replace: `export const IslandDetail = { full: true };

// A host may hold the island still while the agent is idle (the XR app does: at a seated user's scale the idle propellers,
// smoke, fans and lanterns read as noise). Waking still plays every motion.
export const IslandMotion = { idle: true };`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'a still island: no smoke at rest',
    find: `            const k = smoke ? 0.3 + 0.7 * l : l;`,
    replace: `            const k = smoke ? (IslandMotion.idle ? 0.3 : 0) + 0.7 * l : l;`,
  },
  {
    file: 'galaxy/viewer/agents/sky-island.js',
    why: 'a still island: once wound down, each motion takes one last step and stops',
    find: `      for (const a of anims) {
        if (state.awake) {
          if (t >= a.wakeAt) a.level = 1;
        } else a.level = Math.max(0, a.level - down);
        a.step(dt, a.level, t);
      }`,
    replace: `      const still = !IslandMotion.idle && !state.awake && state.level === 0;
      for (const a of anims) {
        if (state.awake) {
          if (t >= a.wakeAt) a.level = 1;
        } else a.level = Math.max(0, a.level - down);
        if (still && a.level === 0) {
          if (a.stilled) continue;
          a.stilled = true;
        } else a.stilled = false;
        a.step(dt, a.level, t);
      }`,
  },
  {
    file: 'galaxy/viewer/agents/agent-cannon-scene.js',
    why: 'a still island: the relay dish waits too',
    find: `import { createSkyIsland } from './sky-island.js';`,
    replace: `import { IslandMotion, createSkyIsland } from './sky-island.js';`,
  },
  {
    file: 'galaxy/viewer/agents/agent-cannon-scene.js',
    why: 'a still island: the relay dish scans only while the agent works',
    find: `    stationRig.step(dt);`,
    replace: `    stationRig.step(IslandMotion.idle || island.state.level > 0 ? dt : 0);`,
  },
  {
    file: 'galaxy/viewer/agents/agent-cannon-scene.js',
    why: 'a still island: the terminal moon idles only while the agent works or a command is open',
    find: `    moonRig.step(dt);`,
    replace: `    moonRig.step(IslandMotion.idle || island.state.level > 0 || moonRig.state.busy ? dt : 0);`,
  },
  {
    file: 'galaxy/viewer/traffic/road-vehicles.js',
    why: 'light road cars: a host may use the town kit cars instead of the detailed ones',
    find: `export const ROAD_CARS = Object.freeze(['courier', 'interceptor', 'utility', 'hauler']);`,
    replace: `export const ROAD_CARS = Object.freeze(['courier', 'interceptor', 'utility', 'hauler']);
// A host may ask for the town kit's cars (about 2,000-2,800 triangles each, wheels included) instead of the detailed
// ones (14,000-22,000 plus four wheel meshes): the XR app does, where a car is a few millimetres long on a globe.
export const RoadCars = { detailed: true };`,
  },
  {
    file: 'galaxy/viewer/traffic/road-vehicles.js',
    why: 'light road cars: skip the detailed models when the host asks',
    find: `      if (i < ROAD_CARS.length) {
        try {`,
    replace: `      if (i < ROAD_CARS.length && RoadCars.detailed) {
        try {`,
  },
  {
    file: 'galaxy/viewer/towns/town-placement.js',
    why: 'scale: kit trees stand shorter than the lots (they were about two lot-widths tall)',
    find: `      placeAt(choose('tree', tw.k + 'tr' + t), fr, x, y, s * 0.02, fp * 0.55, t);`,
    replace: `      // A kit tree is about 3.5 times as tall as it is wide: at 0.2 of a lot it stands 0.5-0.7 of a lot tall,
      // below most buildings.
      placeAt(choose('tree', tw.k + 'tr' + t), fr, x, y, s * 0.02, fp * 0.2, t);`,
  },
  {
    file: 'galaxy/viewer/towns/town-placement.js',
    why: 'scale: the town port is at most one and a half lots wide, not the whole apron',
    find: `      const width = Math.min(P.x1 - P.x0, P.y1 - P.y0) * 0.92,`,
    replace: `      const width = Math.min(Math.min(P.x1 - P.x0, P.y1 - P.y0) * 0.92, 1.5 * BUILD * s),`,
  },
  {
    file: 'galaxy/viewer/app/state.ts',
    why: 'folder suns: each top-level folder is one solar system (the files are its planets)',
    find: `  grouping: 'cluster',`,
    replace: `  grouping: 'folder',`,
  },
  {
    file: 'galaxy/viewer/planet/planet-scene.js',
    why: 'one function per globe: the surface build sees the landing request',
    find: `export async function buildPlanetSurface(ctx, sym, source, model, { previous, publish, bodyKind }) {`,
    replace: `// One function per globe: when enabled, a landed planet holds only one town (a function, or the group the semantic
// layout made), so its buildings are drawn large. The host turns it off to see the whole file.
export const OneTown = { enabled: true };
// A town's first and last source line, from its members.
export const townSpan = r => {
  const ms = r.members || [];
  return ms.length ? [Math.min(...ms.map(m => m.start)), Math.max(...ms.map(m => m.end))] : [r.start ?? 1, r.end ?? 1];
};
// Which town a landing shows: the one with this id, else the one holding this line, else the largest.
export function pickTown(regions, townId, line) {
  let k = townId ? regions.findIndex(r => r.id === townId) : -1;
  if (k < 0 && line != null)
    k = regions.findIndex(r => {
      const [a, b] = townSpan(r);
      return line >= a && line <= b;
    });
  if (k < 0) k = regions.reduce((best, r, i) => ((r.loc || 0) > (regions[best].loc || 0) ? i : best), 0);
  return k;
}
export async function buildPlanetSurface(ctx, sym, source, model, options) {
  const { previous, publish, bodyKind } = options;`,
  },
  {
    file: 'galaxy/viewer/planet/planet-scene.js',
    why: "one function per globe: keep only the chosen town, and list the file's other towns for stepping between them",
    find: `  const regions = model.regionsFor(sym, n.path);
  // Anchors hash persistent town keys`,
    replace: `  const allRegions = model.regionsFor(sym, n.path);
  const shown = OneTown.enabled && allRegions.length > 1 ? pickTown(allRegions, options.townId, options.focusLine) : -1;
  const regions = shown >= 0 ? [allRegions[shown]] : allRegions;
  ctl.towns = allRegions.map((r, k) => {
    const [start, end] = townSpan(r);
    return { id: r.id ?? null, name: r.name, start, end, shown: shown < 0 || k === shown };
  });
  // Anchors hash persistent town keys`,
  },
  {
    file: 'galaxy/viewer/galaxy/constellation-detail.js',
    why: 'one function per globe: a line or town on the landed planet but outside its town rebuilds the globe for it',
    find: `    if (lod.detail && lod.i === i) {
      lod.detail.focusLine(line, townId);
      return;
    }`,
    replace: `    const towns = lod.detail && lod.i === i ? lod.detail.towns : null,
      current = towns?.find(t => t.shown && towns.length > 1 && !towns.every(x => x.shown)),
      elsewhere =
        current &&
        ((townId && townId !== current.id && towns.some(t => t.id === townId)) ||
          (!townId && line != null && (line < current.start || line > current.end) &&
            towns.some(t => line >= t.start && line <= t.end)));
    if (lod.detail && lod.i === i && !elsewhere) {
      lod.detail.focusLine(line, townId);
      return;
    }`,
  },
  {
    file: 'galaxy/viewer/planet/planet-scene.js',
    why: 'one function per globe: a lone town may draw its buildings larger (townScaleCap, a share of the radius)',
    find: `        language: sym?.language,
        regions,`,
    replace: `        language: sym?.language,
        regions,
        townScaleCap: shown >= 0 ? 0.13 : 0.051,`,
  },
  {
    file: 'galaxy/viewer/towns/incremental-towns.js',
    why: 'one function per globe: the planet-wide building scale is capped by townScaleCap when the scene sets it',
    find: `          ctx.R * 0.051,`,
    replace: `          ctx.R * (ctx.townScaleCap ?? 0.051),`,
  },
  {
    file: 'galaxy/viewer/towns/town-preparation.js',
    why: 'one function per globe: the same cap when each town is packed',
    find: `          R * 0.051,`,
    replace: `          R * (ctx.townScaleCap ?? 0.051),`,
  },
  {
    file: 'galaxy/viewer/galaxy/constellation-detail.js',
    why: "one function per globe: the host reads the landed file's towns (one array per build) to step between them",
    find: `  Object.defineProperty(T, 'landed', { get: () => !!lod.detail });`,
    replace: `  Object.defineProperty(T, 'landed', { get: () => !!lod.detail });
  T.landedTowns = () => lod.detail?.towns ?? null;`,
  },
];

let applied = 0,
  present = 0;
for (const { file, why, find, replace } of PATCHES) {
  const target = path.join(repo, file);
  const text = fs.readFileSync(target, 'utf8');
  if (text.includes(replace)) {
    present++;
    continue;
  }
  const count = text.split(find).length - 1;
  if (count !== 1) {
    console.error(`Cannot patch ${file} (${why}): expected the original text once, found it ${count} times.`);
    console.error('The copied file differs from the version this plan was written against. Stop and report this.');
    process.exit(1);
  }
  fs.writeFileSync(target, text.replace(find, () => replace));
  applied++;
}
// Two ship rigs were keyed by car brand names in codebase-viz. Competition rules forbid brand names in the project,
// so the keys are renamed here and tools/assets/build-assets.mjs renames the matching model files.
const RENAMED_KEYS = { bugatti: 'arc', aventador: 'arrow' };
let renamed = 0;
for (const entry of fs.readdirSync(path.join(repo, 'galaxy/viewer'), { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !/\.(js|ts)$/.test(entry.name)) continue;
  const target = path.join(entry.parentPath, entry.name);
  const text = fs.readFileSync(target, 'utf8');
  const next = text.replace(/\b(bugatti|aventador)\b/gi, word => RENAMED_KEYS[word.toLowerCase()]);
  if (next !== text) {
    fs.writeFileSync(target, next);
    renamed++;
  }
}

const leftovers = ['galaxy/viewer', 'galaxy/source-model']
  .flatMap(dir =>
    fs
      .readdirSync(path.join(repo, dir), { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile() && /\.(js|ts)$/.test(entry.name))
      .map(entry => path.join(entry.parentPath, entry.name)),
  )
  .filter(file => fs.readFileSync(file, 'utf8').includes('/api/projects'));
if (leftovers.length) {
  console.error(`These copied files still call the desktop project API:\n${leftovers.join('\n')}`);
  process.exit(1);
}
console.log(`patches: ${applied} applied, ${present} already present; brand keys renamed in ${renamed} files`);
