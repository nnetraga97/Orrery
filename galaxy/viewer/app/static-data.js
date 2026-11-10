// Where a baked dataset's files live (tools/bake-dataset.mjs writes them under public/data/<name>/).
// Replaces the desktop app's loopback project API.
const base = name => `data/${encodeURIComponent(name)}`;

export const graphUrl = name => `${base(name)}/graph.js`;

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
