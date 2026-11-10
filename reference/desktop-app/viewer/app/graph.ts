// The loaded dataset as an import graph: files, import clusters, grouping colours and cached layouts.
import * as d3 from 'd3';
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import { folderArms } from '../galaxy/galaxy-layout.js';
import { galaxyMemory, identitySeed, reconcileFileIdentities, saveGalaxyMemory } from './galaxy-memory.ts';
import { G, projects, state, update } from './state.ts';
import type { DatasetGraph, DatasetSymbols, FileNode, ImportLink } from './types.ts';

// A project's dataset files from the project API: one immutable revision each (the latest when none is named).
// The files are scripts that register themselves on window.DATASETS / window.SYMBOLS; they are fetched and parsed
// instead of run, so two revisions loading at once cannot overwrite each other's global.
export const dataFile = (name: string, kind: 'graph' | 'symbols', revision?: number | null) =>
  `/api/projects/${name}/data/${kind}${revision != null ? `?rev=${revision}` : ''}`;

export interface LoadedFile<T> {
  data: T;
  revision: number | null;
  generation: string | null;
}
// Rejects with `status` 410 once the asked-for revision has been dropped.
export async function fetchDataFile<T>(
  name: string,
  kind: 'graph' | 'symbols',
  revision?: number | null,
): Promise<LoadedFile<T>> {
  const res = await fetch(dataFile(name, kind, revision));
  if (!res.ok)
    throw Object.assign(new Error(`Could not load the project ${kind} (${res.status}).`), { status: res.status });
  const script = await res.text();
  return {
    data: JSON.parse(script.slice(script.indexOf('] = ') + 4).replace(/;\s*$/, '')),
    revision: Number(res.headers.get('X-Galaxy-Revision')),
    generation: res.headers.get('X-Galaxy-Generation'),
  };
}

// Named files' symbols from one revision (the latest when none is named): { [path]: symbols | null }.
export async function fetchSymbols(
  name: string,
  paths: string[],
  revision?: number | null,
): Promise<Record<string, DatasetSymbols[string] | null>> {
  const query = new URLSearchParams();
  if (revision != null) query.set('rev', String(revision));
  paths.forEach(path => query.append('path', path));
  const res = await fetch(`/api/projects/${name}/data/symbols?${query}`);
  if (!res.ok) throw Object.assign(new Error(`Could not load file symbols (${res.status}).`), { status: res.status });
  return res.json();
}

export async function loadDataset(name: string, revision?: number | null): Promise<LoadedFile<DatasetGraph>> {
  // Built-in datasets (the welcome map) are registered in place and have no revisions.
  const builtIn = !projects.has(name) && window.DATASETS?.[name];
  if (builtIn) return { data: builtIn, revision: null, generation: null };
  const loaded = await fetchDataFile<DatasetGraph>(name, 'graph', revision);
  (window.DATASETS ||= {})[name] = loaded.data;
  return loaded;
}

// Builds the file nodes, imports and clusters of a snapshot. With `after`, the previous snapshot's nodes of the same
// project: files that remain keep their relative order and new ones follow, so adding files never moves another
// file's index (only removals do).
export function prepare(data: DatasetGraph, { after }: { after?: readonly FileNode[] } = {}) {
  // Match renamed files first, so a renamed file keeps its order, cluster and look under its new path.
  const renamed = new Map(
    reconcileFileIdentities(data.f.map(([path, , , content = null, detail = null]) => ({ path, content, detail }))),
  );
  const rank = new Map((after || []).map((n, k) => [renamed.get(n.path) ?? n.path, k]));
  const order = data.f
    .map((_, row) => row)
    .sort((a, b) => (rank.get(data.f[a][0]) ?? Infinity) - (rank.get(data.f[b][0]) ?? Infinity) || a - b);
  const indexOf = new Array<number>(data.f.length);
  order.forEach((row, i) => (indexOf[row] = i));
  const nodes: FileNode[] = order.map((row, i) => {
    const [path, rloc, , , detail = null, regions = null, callables = null] = data.f[row];
    return {
      i,
      path,
      rloc: Math.max(1, rloc),
      name: path.split('/').pop()!,
      folder: path.includes('/') ? path.split('/')[0] : '(root)',
      seed: identitySeed(path),
      detail,
      regions,
      callables,
    };
  });
  const links: ImportLink[] = data.e.map(([s, t, ...use]) =>
    use.length
      ? { s: indexOf[s], t: indexOf[t], use: use as [number, number, number] }
      : { s: indexOf[s], t: indexOf[t] },
  );
  uses = new Map(links.map(l => [l.s * nodes.length + l.t, l]));
  const out: number[][] = nodes.map(() => []),
    inc: number[][] = nodes.map(() => []);
  links.forEach(l => {
    out[l.s].push(l.t);
    inc[l.t].push(l.s);
  });

  // Louvain communities over the undirected import graph; tiny ones fold into their best-connected neighbour. It runs
  // from scratch for every snapshot: about 6 ms at 700 files and 0.2 s at 60,000, so membership needs stickiness
  // (below), not an incremental algorithm.
  const g = new UndirectedGraph();
  nodes.forEach(n => g.addNode(n.i));
  links.forEach(l => g.mergeEdge(l.s, l.t));
  let seed = 7;
  const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const comm: Record<string, number> = nodes.length ? louvain(g, { resolution: 1.0, rng }) : {};
  const lab: (number | 'misc')[] = nodes.map(n => comm[n.i]);
  const minSize = Math.max(3, Math.round(nodes.length * 0.004));
  const sizes = d3.rollup(
    nodes,
    v => v.length,
    n => lab[n.i],
  );
  const large = (j: number) => (sizes.get(lab[j]) ?? 0) >= minSize;
  nodes.forEach(n => {
    if (large(n.i)) return;
    const c = new Map<number | 'misc', number>();
    [...out[n.i], ...inc[n.i]].forEach(j => {
      if (large(j)) c.set(lab[j], (c.get(lab[j]) || 0) + 1);
    });
    lab[n.i] = c.size ? [...c].sort((a, b) => b[1] - a[1])[0][0] : 'misc';
  });
  const names = new Map<number | 'misc', string>();
  for (const [l, m] of d3.group(nodes, n => lab[n.i])) {
    if (l === 'misc') {
      names.set(l, 'misc');
      continue;
    }
    const dir = d3.greatest(
      d3.rollups(
        m,
        v => v.length,
        n => n.path.split('/').slice(0, -1).slice(-2).join('/') || '(root)',
      ),
      d => d[1],
    )![0];
    const hub = d3.greatest(m, n => inc[n.i].length)!;
    names.set(l, `${dir} · ${hub.name.replace(/\.[jt]sx?$/, '')}`);
  }
  // Membership is sticky: a file keeps the black hole it was in. A new file (or one in misc) joins the black hole most
  // of its community already belongs to; a community of only new files, large enough to stand alone, becomes a new
  // black hole. Reorganizing forgets the memberships and starts again from the communities.
  const memory = galaxyMemory();
  const kept = (n: FileNode) => (memory.clusters[n.path] !== 'misc' && memory.clusters[n.path]) || null;
  const votes = new Map<number | 'misc', Map<string, number>>();
  nodes.forEach(n => {
    const name = kept(n);
    if (!name) return;
    if (!votes.has(lab[n.i])) votes.set(lab[n.i], new Map());
    const v = votes.get(lab[n.i])!;
    v.set(name, (v.get(name) || 0) + 1);
  });
  const live = new Set(nodes.map(kept).filter(Boolean));
  const born = new Map<number | 'misc', string>();
  nodes.forEach(n => {
    const v = votes.get(lab[n.i]);
    if (kept(n)) n.cluster = kept(n)!;
    else if (v) n.cluster = [...v].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    else if (!born.has(lab[n.i])) {
      let name = names.get(lab[n.i])!;
      for (let k = 2; name !== 'misc' && live.has(name); k++) name = `${names.get(lab[n.i])} (${k})`;
      live.add(name);
      born.set(lab[n.i], (n.cluster = name));
    } else n.cluster = born.get(lab[n.i]);
  });
  memory.clusters = Object.fromEntries(nodes.map(n => [n.path, n.cluster!]));
  saveGalaxyMemory();
  update({ nodes, links, out, inc, cache: {} });
}

const PALETTE = [
  '#7cc4ff',
  '#ff9f6b',
  '#8be0a4',
  '#d9a6ff',
  '#ffd66b',
  '#ff7a9a',
  '#6be3e0',
  '#c9d36b',
  '#9fa8ff',
  '#e0a37c',
  '#80d0ff',
  '#f5b8d8',
  '#a0e07c',
  '#ffb3a0',
];
// Groups under the current grouping, largest first, with a colour each. Every folder arm (groupArms) gets a palette
// colour and its groups shades of it, so groups from one folder read as one family in every view.
export function regroup() {
  const groups = [...d3.rollup(state.nodes, v => v.length, G)].sort((a, b) => b[1] - a[1]).map(d => d[0]);
  update({ groups, groupIndex: new Map(groups.map((g, k) => [g, k])) });
  const pal: string[] = [];
  groupArms().forEach((arm, q) => {
    const base = d3.hsl(armColor(q));
    arm.members.forEach((gi, j) => {
      const t = arm.members.length > 1 ? j / (arm.members.length - 1) - 0.5 : 0;
      pal[gi] = d3.hsl(base.h + t * 40, base.s, Math.min(0.84, Math.max(0.56, base.l + t * 0.18))).formatHex();
    });
  });
  // A group keeps the colour it first had; only new groups take the shade their arm gives them now.
  const colors = galaxyMemory().colors,
    kept = colors[state.grouping] || {};
  groups.forEach((g, gi) => (pal[gi] = kept[g] || pal[gi]));
  colors[state.grouping] = Object.fromEntries(groups.map((g, gi) => [g, pal[gi]]));
  saveGalaxyMemory();
  update({ color: d3.scaleOrdinal(groups, pal) });
}
// The constellation's spiral arms: folders that hold the groups (galaxy-layout.js), largest first, and their colours.
export const groupArms = (): { name: string; members: number[] }[] =>
  cached('arms' + state.grouping, () => folderArms(membersOf().map(m => m.map(n => n.path))));
export const armColor = (q: number) =>
  q < PALETTE.length ? PALETTE[q] : d3.hsl((q * 137.508) % 360, 0.65, 0.68).formatHex();

export interface ImportUse {
  kind: 'runtime' | 'type' | 'reexport' | 'unknown';
  refs: number;
  types: number;
}
// How file s uses file t, from the graph's overview. 'unknown' when the import did not resolve to a reference;
// null when the importer has no reference index.
let uses = new Map<number, ImportLink>();
export function importUse(s: number, t: number): ImportUse | null {
  const use = uses.get(s * state.nodes.length + t)?.use;
  if (!use) return null;
  const [refs, types, pass] = use;
  return { kind: refs ? 'runtime' : pass ? 'reexport' : types ? 'type' : 'unknown', refs, types };
}
// Whether the dataset classifies its imports at all (a reference index exists).
export const importsIndexed = () => state.links.some(l => l.use);
// The node for a path in the current snapshot.
export const nodeOf = (path: string): FileNode | undefined =>
  cached('byPath', () => new Map(state.nodes.map(n => [n.path, n])) as Map<string, FileNode>).get(path);
export const USE_TAG: Record<ImportUse['kind'], (u: ImportUse) => string> = {
  runtime: u => `${u.refs} ref${u.refs === 1 ? '' : 's'}`,
  type: () => 'types only',
  reexport: () => 're-export',
  unknown: () => 'unresolved',
};

export function search(query: string): FileNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const subseq = (s: string, t: string) => {
    let k = 0;
    for (const c of s) if (c === t[k]) k++;
    return k === t.length;
  };
  const scored: [number, FileNode][] = [];
  for (const n of state.nodes) {
    const name = n.name.toLowerCase(),
      path = n.path.toLowerCase();
    let sc = 0;
    if (name === q) sc = 120;
    else if (name.startsWith(q)) sc = 100;
    else if (name.includes(q)) sc = 70;
    else if (path.includes(q)) sc = 45;
    else if (q.length > 2 && subseq(name, q)) sc = 20;
    else continue;
    scored.push([sc + Math.min(10, Math.sqrt(state.inc[n.i].length)) - path.length / 200, n]);
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, 12)
    .map(d => d[1]);
}

// Files inside a group, biggest hubs first.
export const membersOf = (): FileNode[][] =>
  state.groups.map(g =>
    state.nodes
      .filter(n => G(n) === g)
      .sort((a, b) => state.inc[b.i].length - state.inc[a.i].length || b.rloc - a.rloc),
  );

function cached<T>(key: string, build: () => T): T {
  return (state.cache[key] ??= build()) as T;
}
