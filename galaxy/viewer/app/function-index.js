// A baked dataset's function index (public/data/<name>/functions.json, written by tools/bake-functions.mjs from
// src/core/importance.ts): which files are stars, each star's planets (its most important functions), how many
// functions it hides, and the calls between planets. A dataset without the file draws as before.
import { functionIndexUrl } from './static-data.js';

const loads = new Map();
let current = { name: null, byPath: new Map(), byId: new Map(), calls: [] };

/** Loads (once) and makes current the named dataset's index; resolves to null when it has none. */
export function loadFunctionIndex(name) {
  if (!loads.has(name))
    loads.set(
      name,
      fetch(functionIndexUrl(name))
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null),
    );
  return loads.get(name).then(index => {
    const byPath = new Map(),
      byId = new Map();
    for (const file of index?.files || []) {
      byPath.set(file.path, file);
      for (const p of file.planets) byId.set(p.id, { ...p, path: file.path });
    }
    current = { name, byPath, byId, calls: index?.calls || [] };
    return index;
  });
}

/** The current dataset's entry for a file: { path, cls, planets, hidden }, or null. */
export const starOf = path => current.byPath.get(path) ?? null;
/** A planet by function id: { id, name, kind, start, end, score, pinned, path }, or null. */
export const planetById = id => current.byId.get(id) ?? null;
/** Calls between planets: [callerId, calleeId]. */
export const planetCalls = () => current.calls;
/** Whether the current dataset has an index (stars and planets) at all. */
export const hasFunctionIndex = () => current.byPath.size > 0;
/** The planet holding a line of a file: an exact span first, else null. */
export function planetAtLine(path, line) {
  const star = starOf(path);
  return star?.planets.find(p => line >= p.start && line <= p.end) ?? null;
}
