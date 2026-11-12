// Where a baked dataset's files live (tools/bake-dataset.mjs writes them under public/data/<name>/).
// Replaces the desktop app's loopback project API.
const base = name => `data/${encodeURIComponent(name)}`;

export const graphUrl = name => `${base(name)}/graph.js`;

/** Each file's planets and the calls between them (tools/bake-functions.mjs). */
export const functionIndexUrl = name => `${base(name)}/functions.json`;

export const sourceUrl = (name, path) => `${base(name)}/source/${path.split('/').map(encodeURIComponent).join('/')}`;

const indexes = new Map();
function indexOf(name) {
  if (!indexes.has(name))
    indexes.set(
      name,
      fetch(`${base(name)}/symbols-index.json`).then(res => {
        if (!res.ok) throw Object.assign(new Error(`Could not load the symbols index (${res.status}).`), { status: res.status });
        return res.json();
      }),
    );
  return indexes.get(name);
}

// Named files' symbols: { [path]: symbols | null }, the shape the desktop project API returned.
export async function symbolsFor(name, paths) {
  const index = await indexOf(name);
  const entries = await Promise.all(
    paths.map(async path => {
      const shard = index[path];
      if (!shard) return [path, null];
      const res = await fetch(`${base(name)}/symbols/${shard}`);
      return [path, res.ok ? (await res.json()).symbols : null];
    }),
  );
  return Object.fromEntries(entries);
}

// The host's own text for a file (the XR app's in-memory workspace), consulted before the baked file: an edited file
// is read from there, so the scene always shows edited text. Returns a string, or null to read the baked file.
let override = null;
export function setSourceOverride(fn) {
  override = fn;
}
export const sourceOverride = (name, path) => (override ? override(name, path) : null);

/** A file's text: the override's when it has one, else the baked file's; null when neither has it. */
export function readSource(name, path) {
  const own = sourceOverride(name, path);
  if (own != null) return Promise.resolve(own);
  return fetch(sourceUrl(name, path))
    .then(r => (r.ok ? r.text() : null))
    .catch(() => null);
}
