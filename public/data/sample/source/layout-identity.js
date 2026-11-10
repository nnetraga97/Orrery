// Layout identities: a file or town keeps one key across renames and moves, so the world does not reshuffle when
// code is renamed. Analyzer identities (code-model.js) still name the code; these keys only decide where it is drawn
// and what it looks like. Matching is conservative: only a unique match carries a key over. An ambiguous one gets a
// fresh key and is never guessed.

const GONE_KEPT = 256; // removed files remembered, so an undone delete or a later rename back keeps its identity

const fresh = (taken, base) => {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}~${n}`;
  return key;
};

// Pairs each added item with the one removed item sharing its fingerprint, when that pairing is unique both ways.
function uniquePairs(gone, added, printOf) {
  const byPrint = (list, side) => {
    const map = new Map();
    for (const item of list) {
      const print = printOf(item, side);
      if (print == null) continue;
      (map.get(print) || map.set(print, []).get(print)).push(item);
    }
    return map;
  };
  const goneBy = byPrint(gone, 'gone'),
    addedBy = byPrint(added, 'added'),
    pairs = [];
  for (const [print, candidates] of addedBy)
    if (candidates.length === 1 && goneBy.get(print)?.length === 1) pairs.push([goneBy.get(print)[0], candidates[0]]);
  return pairs;
}

/**
 * Reconciles one revision's files with the remembered ones.
 * files: { [key]: { path, content, detail, gone? } }, mutated in place.
 * rows: [{ path, content, detail }] for every file in the revision.
 * @returns {{ keyOf: Map<string, string>, renames: [string, string][] }} path → key, and [oldPath, newPath] pairs.
 */
export function reconcileFiles(files, rows, { now = Date.now() } = {}) {
  const live = new Map(),
    /** @type {Map<string, string>} */ keyOf = new Map(),
    /** @type {[string, string][]} */ renames = [];
  for (const [key, file] of Object.entries(files)) if (!file.gone) live.set(file.path, key);
  const current = new Set(rows.map(row => row.path));
  const added = [];
  for (const row of rows) {
    const key = live.get(row.path);
    if (key) {
      keyOf.set(row.path, key);
      Object.assign(files[key], { content: row.content ?? null, detail: row.detail ?? null });
    } else added.push(row);
  }
  // Files that left this revision, plus those that left earlier and may come back.
  const claimed = new Set(keyOf.values());
  let gone = Object.entries(files)
    .filter(([key, file]) => !claimed.has(key) && (file.gone || !current.has(file.path)))
    .map(([key, file]) => ({ key, ...file }));
  // Identical text first; then identical symbols, for a rename that also rewrote the file's own import paths.
  let open = added;
  for (const field of ['content', 'detail']) {
    const pairs = uniquePairs(gone, open, item => item[field] ?? null);
    for (const [from, to] of pairs) {
      if (from.path !== to.path && !from.gone) renames.push([from.path, to.path]);
      files[from.key] = { ...files[from.key], path: to.path, content: to.content ?? null, detail: to.detail ?? null };
      delete files[from.key].gone;
      keyOf.set(to.path, from.key);
    }
    open = open.filter(row => !keyOf.has(row.path));
    gone = gone.filter(g => !pairs.some(([from]) => from.key === g.key));
  }
  const taken = new Set(Object.keys(files));
  for (const row of open) {
    const key = fresh(taken, 'f:' + row.path);
    taken.add(key);
    files[key] = { path: row.path, content: row.content ?? null, detail: row.detail ?? null };
    keyOf.set(row.path, key);
  }
  const used = new Set(keyOf.values());
  for (const [key, file] of Object.entries(files)) if (!used.has(key) && !file.gone) file.gone = now;
  const removed = Object.entries(files)
    .filter(([, file]) => file.gone)
    .sort((a, b) => b[1].gone - a[1].gone);
  for (const [key] of removed.slice(GONE_KEPT)) delete files[key];
  return { keyOf, renames };
}

// An analyzer id without its file prefix, so a file rename leaves every town's id unchanged.
export function relativeId(id, file) {
  const prefix = file + '::';
  return String(id).split(prefix).join('');
}

const hash = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36) + ':' + text.length;
};

/** A body fingerprint that survives renaming the callable and moving it: its source lines, with the declared name
 * blanked and whitespace removed. Null when the source is unavailable. */
export function townPrint(lines, region) {
  if (!lines || !region?.start || !region?.end || region.kind === 'file') return null;
  const body = lines.slice(region.start - 1, region.end).join('\n');
  if (!body.trim()) return null;
  const name = String(region.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return hash((name ? body.replace(new RegExp(`\\b${name}\\b`), '§') : body).replace(/\s+/g, ''));
}

const SKETCH = 64; // line hashes kept per town: enough to tell which part of a split carries most of the old body

const hash32 = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** A bounded sample of a body's lines (the smallest distinct line hashes, name blanked, whitespace removed), so
 * partly matching bodies can be compared: a split, a merge, or a rename that also edited the body. */
export function townSketch(lines, region) {
  if (!lines || !region?.start || !region?.end || region.kind === 'file') return null;
  const name = String(region.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    seen = new Set();
  for (let i = region.start - 1; i < Math.min(region.end, lines.length); i++) {
    let line = lines[i];
    if (i === region.start - 1 && name) line = line.replace(new RegExp(`\\b${name}\\b`), '§');
    line = line.replace(/\s+/g, '');
    // Braces and other one-token lines say nothing about which body this is.
    if (line.length >= 4) seen.add(hash32(line));
  }
  return seen.size ? [...seen].sort((a, b) => a - b).slice(0, SKETCH) : null;
}

// How much of two bodies is shared, compared below the smaller sketch's horizon so a long body's cut-off sample
// does not count against a short one. Returns the shared count, or 0 unless it is most of the smaller body.
function overlap(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) return 0;
  const horizon = Math.min(a[a.length - 1], b[b.length - 1]);
  let shared = 0,
    na = 0,
    nb = 0;
  for (const v of a) if (v <= horizon) na++;
  for (const v of b) if (v <= horizon) nb++;
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) (shared++, i++, j++);
    else if (a[i] < b[j]) i++;
    else j++;
  return shared >= 2 && shared >= 0.5 * Math.min(na, nb) ? shared : 0;
}

// The single best of a list of [item, score], or null when nothing scores or the top score is tied (ambiguous).
function best(scored) {
  const sorted = scored.filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]);
  return sorted.length && (sorted.length === 1 || sorted[0][1] > sorted[1][1]) ? sorted[0][0] : null;
}

/**
 * Gives every region of one file a town key that survives method renames, moves between owners and file renames.
 * towns: { [townKey]: { id, print, sketch, born } } for this file, mutated in place. `born` orders towns by age: a
 * district or neighborhood is anchored by its oldest member, so a newcomer never re-anchors the towns already there.
 * regions: buildRegions() output; file: the current path; prints: Map<region.id, print|null>.
 * sketches: Map<region.id, townSketch()|null>, for splits, merges and edited renames.
 * elsewhere: [{ file, towns, key }] removed towns of other files, for a town moved here from another file.
 * @returns {Map<string, string>} region.id → town key.
 */
export function reconcileTowns(
  towns,
  regions,
  file,
  prints,
  {
    now = Date.now(),
    sketches = new Map(),
    elsewhere = /** @type {{ file: string, towns: Record<string, any>, key: string }[]} */ ([]),
  } = {},
) {
  const /** @type {Map<string, string>} */ keyOf = new Map(),
    byId = new Map(Object.entries(towns).map(([key, town]) => [town.id, key]));
  const added = [];
  for (const region of regions) {
    const key = byId.get(relativeId(region.id, file));
    if (key && ![...keyOf.values()].includes(key)) {
      keyOf.set(region.id, key);
      towns[key] = {
        ...towns[key],
        id: towns[key].id,
        print: prints.get(region.id) ?? towns[key].print ?? null,
        sketch: sketches.get(region.id) ?? towns[key].sketch ?? null,
        born: towns[key].born,
      };
      delete towns[key].gone;
    } else added.push(region);
  }
  // Removed towns stay remembered for a while, so an undone delete or a rename keeps the key.
  const used = new Set(keyOf.values());
  const gone = Object.entries(towns)
    .filter(([key]) => !used.has(key))
    .map(([key, town]) => ({ key, ...town }));
  for (const [from, region] of uniquePairs(gone, added, (item, side) =>
    side === 'gone' ? item.print : prints.get(item.id),
  )) {
    keyOf.set(region.id, from.key);
    towns[from.key] = {
      ...towns[from.key],
      id: relativeId(region.id, file),
      print: prints.get(region.id) ?? from.print,
      sketch: sketches.get(region.id) ?? from.sketch ?? null,
      born: from.born,
    };
    delete towns[from.key].gone;
  }
  // Splits and merges (§6): a removed town passes to the new town holding most of its body; a new town holding
  // several removed ones keeps the earliest. Each removed town has at most one heir, so a placement is never
  // duplicated, and a tie is ambiguous and inherits nothing.
  const open = added.filter(region => !keyOf.has(region.id)),
    left = gone.filter(g => ![...keyOf.values()].includes(g.key)),
    heirs = new Map();
  for (const g of left) {
    const heir = best(open.map(region => [region, overlap(g.sketch, sketches.get(region.id))]));
    if (heir) (heirs.get(heir) || heirs.set(heir, []).get(heir)).push(g);
  }
  for (const [region, parents] of heirs) {
    // Several identical removed bodies and one new one: which it is cannot be told, so none is inherited.
    if (new Set(parents.map(g => g.print)).size < parents.length) continue;
    const from = parents.reduce((a, b) => ((b.born ?? Infinity) < (a.born ?? Infinity) ? b : a));
    keyOf.set(region.id, from.key);
    towns[from.key] = {
      ...towns[from.key],
      id: relativeId(region.id, file),
      print: prints.get(region.id) ?? null,
      sketch: sketches.get(region.id) ?? null,
      born: from.born,
    };
    delete towns[from.key].gone;
  }
  // A town moved here from another file keeps its logical identity but not its site: it is placed afresh among
  // this file's towns (I-3), and the old record is retired so it cannot come back in two places.
  const moved = new Map();
  for (const entry of elsewhere) {
    const print = entry.towns[entry.key]?.print;
    if (print) (moved.get(print) || moved.set(print, []).get(print)).push(entry);
  }
  const arriving = new Map();
  for (const region of added) {
    const print = !keyOf.has(region.id) && prints.get(region.id);
    if (print) (arriving.get(print) || arriving.set(print, []).get(print)).push(region);
  }
  const origins = new Map();
  for (const [print, regionsHere] of arriving)
    if (regionsHere.length === 1 && moved.get(print)?.length === 1) origins.set(regionsHere[0].id, moved.get(print)[0]);
  const taken = new Set(Object.keys(towns));
  let born = Math.max(-1, ...Object.values(towns).map(town => town.born ?? -1)) + 1;
  // New towns are born in id order, so the same source gives the same ages on every machine.
  for (const region of [...added].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (keyOf.has(region.id)) continue;
    const id = relativeId(region.id, file),
      key = fresh(taken, 't:' + id);
    taken.add(key);
    towns[key] = { id, print: prints.get(region.id) ?? null, sketch: sketches.get(region.id) ?? null, born: born++ };
    const origin = origins.get(region.id);
    if (origin) {
      towns[key].from = { file: origin.file, id: origin.towns[origin.key].id };
      delete origin.towns[origin.key];
    }
    keyOf.set(region.id, key);
  }
  const claimed = new Set(keyOf.values());
  for (const [key, town] of Object.entries(towns)) if (!claimed.has(key)) town.gone ??= now;
  const removed = Object.entries(towns)
    .filter(([, town]) => town.gone)
    .sort((a, b) => b[1].gone - a[1].gone);
  for (const [key] of removed.slice(GONE_KEPT / 4)) delete towns[key];
  return keyOf;
}
