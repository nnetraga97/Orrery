// What the viewer remembers about a project's galaxy, so a new revision or a restart keeps its shape: the black hole
// each file belongs to, each group's colour, where each system sits, the order of its bodies, each body's kind and the
// scale, plus each file's and town's layout identity (so renames keep their place and look). Kept beside the project's
// data through the desktop bridge. Missing or unreadable memory means a fresh layout;
// "Regroup files" forgets it on purpose.
import { desktop, reportError } from './project-store.ts';
import type { Grouping } from './state.ts';
import { reconcileFiles, reconcileTowns, townPrint, townSketch } from '../../source-model/layout-identity.js';
import { validLayoutMemory } from '../../source-model/layout-memory.js';
import { planetCatalog, planetProfile } from '../galaxy/planet-profiles.js';

export type BodyKind = 'planet' | 'asteroid' | 'comet';
export interface SystemMemory {
  at: [number, number];
  order: string[]; // member paths, first-seen order: new files join at the end, so earlier orbits stay put
}
export interface LayoutMemory {
  unit?: number;
  core?: number;
  systems: Record<string, SystemMemory>;
  kinds: Record<string, BodyKind>;
}
// A file's layout identity (layout-identity.js): its key survives renames, and its appearance is chosen once.
export interface FileIdentity {
  path: string;
  content: string | null;
  detail: string | null;
  gone?: number;
  world?: string; // planet library entry id
}
export interface TownIdentity {
  id: string; // analyzer id without the file prefix
  print: string | null;
  sketch?: number[] | null; // sampled line hashes, for splits, merges and edited renames
  from?: { file: string; id: string }; // moved here from another file (layout key and town id there)
  born?: number; // age order within the file; the oldest member anchors a district
  gone?: number;
}
export interface GalaxyMemory {
  version: 1;
  layoutVersion?: 1;
  clusters: Record<string, string>; // path -> import cluster
  colors: Partial<Record<Grouping, Record<string, string>>>; // group -> colour
  layouts: Partial<Record<Grouping, LayoutMemory>>;
  files?: Record<string, FileIdentity>; // layout key -> file
  towns?: Record<string, Record<string, TownIdentity>>; // file layout key -> town key -> town
}

const fresh = (): GalaxyMemory => ({
  version: 1,
  layoutVersion: 1,
  clusters: {},
  colors: {},
  layouts: {},
  files: {},
  towns: {},
});
let current: { project: string | null; memory: GalaxyMemory } = { project: null, memory: fresh() };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let layoutNotice: string | null = null;
export const galaxyLayoutNotice = () => layoutNotice;
let keyOfPath = new Map<string, string>(); // this revision's path -> file layout key

const bridge = desktop as unknown as {
  getGalaxyMemory?(project: string): Promise<GalaxyMemory | null>;
  setGalaxyMemory?(project: string, value: GalaxyMemory | null): Promise<void>;
};

// Before a project's first prepare(): its remembered galaxy, or a fresh one. Built-in datasets remember nothing.
export async function loadGalaxyMemory(project: string | null) {
  flushGalaxyMemory();
  layoutNotice = null;
  let memory: GalaxyMemory | null = null;
  if (project && bridge.getGalaxyMemory)
    try {
      memory = await bridge.getGalaxyMemory(project);
    } catch (error) {
      layoutNotice = `Could not read the galaxy layout; using fresh placements: ${(error as Error).message}`;
      reportError(layoutNotice);
    }
  if (memory && !validLayoutMemory(memory)) {
    layoutNotice = 'Saved planet layout was invalid; using fresh placements.';
    reportError(layoutNotice);
    memory = null;
  }
  current = { project, memory: memory ?? fresh() };
  current.memory.layoutVersion = 1;
  keyOfPath = new Map();
}
export const galaxyMemory = () => current.memory;
export const layoutMemory = (grouping: Grouping): LayoutMemory =>
  (current.memory.layouts[grouping] ??= { systems: {}, kinds: {} });

// ---------- layout identity ----------

// Matches this revision's files to remembered ones before anything path-keyed is read. A recognised rename carries
// the old path's cluster, body kind and orbit order over to the new path. Returns the renames as [old, new].
export function reconcileFileIdentities(rows: { path: string; content: string | null; detail: string | null }[]) {
  const memory = current.memory;
  const { keyOf, renames } = reconcileFiles((memory.files ??= {}), rows);
  keyOfPath = keyOf;
  const renamed = new Map(renames);
  if (renamed.size) {
    const move = <T>(record: Record<string, T>) => {
      for (const [from, to] of renamed)
        if (from in record && !(to in record)) {
          record[to] = record[from];
          delete record[from];
        }
    };
    move(memory.clusters);
    for (const layout of Object.values(memory.layouts)) {
      if (!layout) continue;
      move(layout.kinds);
      for (const system of Object.values(layout.systems))
        system.order = system.order.map(path => renamed.get(path) ?? path);
    }
  }
  saveGalaxyMemory();
  return renames;
}
// The file's layout key, stable across renames. Built-in datasets have no memory; their path is their key.
export const fileKey = (path: string) => keyOfPath.get(path) ?? 'f:' + path;
// The path a file had when it first appeared: the seed for everything hashed about it (orbit, rotation, colour).
export const identitySeed = (path: string) => {
  const key = fileKey(path);
  return key.startsWith('f:') ? key.slice(2) : path;
};
// The planet library entry a file wears: chosen once and remembered, so renames and catalog changes keep it.
// Gas giants are for files with no functions or methods: the choice is made once, when the file's analysis first says
// whether it has any, and kept. New callables use that world's palette on code-shaped terrain.
export function fileAppearance(path: string, callables: number | null = null) {
  const record = current.memory.files?.[fileKey(path)];
  const saved = record?.world && planetCatalog.find(entry => entry.id === record.world);
  if (saved) return saved;
  const entry = planetProfile(identitySeed(path), { kind: callables === 0 ? 'gas' : 'terrestrial' });
  // Before analysis the count is unknown: draw a provisional world, and choose for good once it is known.
  if (record && callables != null) {
    record.world = entry.id;
    saveGalaxyMemory();
  }
  return entry;
}
// Town layout keys for one file's regions, matched by id and by body fingerprint when source is available.
export function townKeys(path: string, regions: { id: string }[], source: string | null) {
  const key = fileKey(path),
    lines = source ? source.split('\n') : null;
  const towns = ((current.memory.towns ??= {})[key] ??= {});
  const prints = new Map(regions.map(region => [region.id, townPrint(lines, region)])),
    sketches = new Map(regions.map(region => [region.id, townSketch(lines, region)]));
  // Towns that left other files, or whose file is gone: one of them may have been moved here.
  const elsewhere: { file: string; towns: Record<string, TownIdentity>; key: string }[] = [];
  for (const [other, list] of Object.entries(current.memory.towns!))
    if (other !== key)
      for (const [townKey, town] of Object.entries(list))
        if (town.print && (town.gone || current.memory.files?.[other]?.gone))
          elsewhere.push({ file: other, towns: list, key: townKey });
  const keys = reconcileTowns(towns, regions, path, prints, { sketches, elsewhere });
  saveGalaxyMemory();
  return {
    keyOf: (region: { id: string }) => key + '#' + keys.get(region.id),
    ageOf: (region: { id: string }) => towns[keys.get(region.id)!]?.born ?? 0,
  };
}

// Writes are coalesced; a project switch or quit flushes the pending one.
export function saveGalaxyMemory() {
  if (!current.project || !bridge.setGalaxyMemory) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushGalaxyMemory, 800);
}
function flushGalaxyMemory() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const { project, memory } = current;
  bridge.setGalaxyMemory!(project!, memory).catch(error =>
    reportError(`Could not save the galaxy layout: ${(error as Error).message}`),
  );
}
// Reorganize: the next prepare() and layout start from scratch.
export function forgetGalaxyMemory() {
  current = { project: current.project, memory: fresh() };
  saveGalaxyMemory();
}
addEventListener('beforeunload', flushGalaxyMemory);
