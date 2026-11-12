// Which functions become planets. A file is a star; its most important functions orbit it as planets, and the rest
// are counted in a belt. The score uses only what the symbol shards already hold, and each term is one sentence to
// explain: big, branchy, called from other files, called in its own file, orchestrates others, public.
// The data bake (tools/bake-functions.mjs) and the app share this module.

/** The parts of a symbol shard member this module reads. */
export interface ShardMember {
  id: string;
  name: string;
  kind: string;
  owner?: string | null;
  start: number;
  end: number;
  branches?: number;
  exported?: boolean;
  vis?: string;
  roles?: { id: string }[];
  callTargets?: { id?: string | null }[];
}
export interface ShardDecl extends ShardMember {
  members?: ShardMember[];
}
export interface Shard {
  path: string;
  decls: ShardDecl[];
}

export type FileClass = 'star' | 'test' | 'library' | 'types-only' | 'trivial';

export interface PlanetFunction {
  id: string;
  /** `Owner.name` for a method, the bare name for a function. */
  name: string;
  kind: string;
  start: number;
  end: number;
  score: number;
  pinned: boolean;
}
export interface StarFile {
  path: string;
  cls: FileClass;
  planets: PlanetFunction[];
  /** Callables not shown as planets (trivial or below the cut). */
  hidden: number;
}
export interface FunctionIndex {
  version: 1;
  files: StarFile[];
  /** Calls between planets, by function id: [caller, callee]. */
  calls: [string, string][];
}

export const PLANETS_PER_FILE = 10;
export const MIN_SCORE = 6;
/** A short function called from this many other files still becomes a planet. */
export const HUB_CALLERS = 5;

interface Fn {
  m: ShardMember;
  file: string;
  name: string;
  exported: boolean;
  loc: number;
  branches: number;
  roles: Set<string>;
  callers: number;
  localCallers: number;
  callees: number;
}

const lg = (n: number) => Math.log2(1 + n);

/** Getters, setters, one-to-three-line bodies, small accessors and plain constructors: never planets on their own. */
export function isTrivial(f: Pick<Fn, 'm' | 'loc' | 'branches' | 'roles'>): boolean {
  const kind = f.m.kind;
  return (
    kind === 'get' ||
    kind === 'set' ||
    (f.loc <= 3 && f.branches === 0) ||
    (f.roles.has('accessor') && f.loc <= 5) ||
    (kind === 'ctor' && f.branches === 0 && f.loc <= 12)
  );
}

export function scoreOf(f: Omit<Fn, 'm' | 'file' | 'name'>): number {
  return (
    lg(f.loc) +
    lg(f.branches) +
    1.5 * lg(f.callers) +
    0.75 * lg(f.localCallers) +
    0.5 * lg(f.callees) +
    (f.exported ? 1 : 0) -
    (f.roles.has('delegation') && f.loc <= 6 ? 1 : 0)
  );
}

export function classifyPath(path: string): 'library' | 'test' | null {
  if (/(^|\/)(node_modules|vendor|third_party|dist|build)\//.test(path) || /\.min\.|\.generated\.|\.d\.ts$/.test(path))
    return 'library';
  if (/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\./.test(path)) return 'test';
  return null;
}

/** Planets a file may show: grows with the square root of its callables, at most PLANETS_PER_FILE. */
export const planetCap = (callables: number) => Math.min(PLANETS_PER_FILE, Math.ceil(2 + Math.sqrt(callables)));

/** Ranks every callable in the project and picks each file's planets. `pins` are `path:Owner.name` keys that are
 * always planets (a demo's bug, for instance). */
export function buildFunctionIndex(shards: Shard[], pins: string[] = []): FunctionIndex {
  const pinned = new Set(pins);
  const byId = new Map<string, Fn>();
  const perFile = new Map<string, Fn[]>();
  for (const shard of shards) {
    const list: Fn[] = [];
    for (const d of shard.decls || []) {
      const members =
        d.kind === 'class'
          ? (d.members || []).map(m => ({
              m,
              exported: !!(m.exported || (d.exported && (m.vis ?? 'public') === 'public')),
            }))
          : d.kind === 'function'
            ? [{ m: d as ShardMember, exported: !!d.exported }]
            : [];
      for (const { m, exported } of members) {
        const f: Fn = {
          m,
          file: shard.path,
          name: m.owner ? `${m.owner}.${m.name}` : m.name,
          exported,
          loc: m.end - m.start + 1,
          branches: m.branches || 0,
          roles: new Set((m.roles || []).map(r => r.id)),
          callers: 0,
          localCallers: 0,
          callees: 0,
        };
        list.push(f);
        byId.set(m.id, f);
      }
    }
    perFile.set(shard.path, list);
  }
  // Resolved calls only: each distinct callee once per caller.
  const edges: [Fn, Fn][] = [];
  for (const f of byId.values()) {
    const seen = new Set<string>();
    for (const c of f.m.callTargets || []) {
      const t = c.id ? byId.get(c.id) : undefined;
      if (!t || t === f || seen.has(t.m.id)) continue;
      seen.add(t.m.id);
      if (t.file === f.file) t.localCallers++;
      else t.callers++;
      edges.push([f, t]);
    }
    f.callees = seen.size;
  }
  const shown = new Set<Fn>();
  const files: StarFile[] = [];
  for (const shard of shards) {
    const fns = perFile.get(shard.path) || [];
    const isPinned = (f: Fn) => pinned.has(`${f.file}:${f.name}`);
    const eligible = (f: Fn) => isPinned(f) || !isTrivial(f) || f.callers >= HUB_CALLERS;
    const scored = fns.map(f => ({ f, s: scoreOf(f) }));
    let cls: FileClass = classifyPath(shard.path) ?? 'star';
    if (cls !== 'library') {
      if (!fns.length) cls = 'types-only';
      else if (!fns.some(eligible)) cls = 'trivial';
    }
    let planets: { f: Fn; s: number }[] = [];
    if (cls === 'star' || cls === 'test') {
      const ranked = scored.filter(x => eligible(x.f)).sort((a, b) => b.s - a.s);
      const pins = ranked.filter(x => isPinned(x.f));
      const best = ranked
        .filter(x => !isPinned(x.f) && x.s >= MIN_SCORE)
        .slice(0, Math.max(0, planetCap(fns.length) - pins.length));
      planets = [...pins, ...best];
      if (!planets.length && ranked.length) planets = [ranked[0]];
      planets.sort((a, b) => a.f.m.start - b.f.m.start);
    }
    planets.forEach(p => shown.add(p.f));
    files.push({
      path: shard.path,
      cls,
      planets: planets.map(({ f, s }) => ({
        id: f.m.id,
        name: f.name,
        kind: f.m.kind,
        start: f.m.start,
        end: f.m.end,
        score: Math.round(s * 10) / 10,
        pinned: isPinned(f),
      })),
      hidden: fns.length - planets.length,
    });
  }
  const calls = edges
    .filter(([a, b]) => shown.has(a) && shown.has(b))
    .map(([a, b]) => [a.m.id, b.m.id] as [string, string]);
  return { version: 1, files, calls };
}
