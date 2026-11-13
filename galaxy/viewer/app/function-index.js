// A baked dataset's function index (public/data/<name>/functions.json, written by tools/bake-functions.mjs from
// src/core/importance.ts): which files are stars, each star's planets (its most important functions), how many
// functions it hides, and the calls between planets. A dataset without the file draws as before.
import { functionIndexUrl } from './static-data.js';

const loads = new Map();
let current = { name: null, byPath: new Map(), byId: new Map(), calls: [], gradeNames: [] };

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
    current = { name, byPath, byId, calls: index?.calls || [], gradeNames: index?.gradeNames || [] };
    return index;
  });
}

/** The current dataset's entry for a file: { path, cls, planets, hidden, grades, rest }, or null. */
export const starOf = path => current.byPath.get(path) ?? null;
/** A planet by function id: { id, name, kind, start, end, score, pinned, path } and its measures (branches, depth,
 * params, callers, callees, grade), or null. */
export const planetById = id => current.byId.get(id) ?? null;
/** Calls between planets: [callerId, calleeId]. */
export const planetCalls = () => current.calls;
/** Whether the current dataset has an index (stars and planets) at all. */
export const hasFunctionIndex = () => current.byPath.size > 0;
/**
 * How tangled a landed function is (0 to 3), or null when the dataset does not say. `key` is a planet's function id,
 * or `belt:<path>` for a function without a planet, which is then found by `line` among the file's graded hidden
 * functions; one that is not listed there is straightforward. Without a line a hidden function cannot be told from its
 * neighbours: the answer is then null (not known), never a guess, unless the file has no graded hidden function at
 * all, when every one of them is straightforward.
 */
export function gradeOfKey(key, line = null) {
  if (!key) return null;
  if (!key.startsWith('belt:')) return planetById(key)?.grade ?? null;
  const star = starOf(key.slice(5));
  if (!star?.rest) return null;
  if (line == null) return star.rest.length ? null : 0;
  return star.rest.find(([start, end]) => line >= start && line <= end)?.[2] ?? 0;
}
/** A grade in words ("Tangled"), or null when the dataset has no grades. */
export const gradeName = grade => (grade == null ? null : (current.gradeNames[grade] ?? null));
/** The planet holding a line of a file: an exact span first, else null. */
export function planetAtLine(path, line) {
  const star = starOf(path);
  return star?.planets.find(p => line >= p.start && line <= p.end) ?? null;
}
