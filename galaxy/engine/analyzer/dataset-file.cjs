// A dataset is the import graph plus each file's symbols:
//   <name>.js         a browser script holding the graph and the overview a galaxy needs:
//                     { f: [[path, loc, inDegree, content, detail, regions, callables], ...], e: [[from, to, uses...], ...],
//                     analysis }
//                     assigned into a window namespace: (window.DATASETS = window.DATASETS || {})["name"] = {...};
//   <name>.symbols/   one JSON shard per file, { path, symbols: { lines, decls, calls, refs } }, named by a hash of the
//                     path, so a reader loads the files it shows rather than the whole project's symbols.
// A row's path is the file's identity. `content` hashes the text the analyzer read and `detail` hashes that file's
// symbols, so a reader can tell an edit that moves the galaxy from one that only changes a planet. `regions` is the
// planet's region count and `callables` its function and method count (0: a file with no executable bodies). An import's uses are [runtime refs, type refs, re-exports] when the importer has a reference
// index (all zero: the import is not classified); a bare [from, to] means it has none.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { writeFileAtomic } = require('../shared/files.cjs');

const KINDS = {
  graph: { suffix: '.js', empty: () => ({ f: [], e: [] }) },
  symbols: { suffix: '.symbols', empty: () => ({}) },
};
const DATASET_KINDS = Object.keys(KINDS);

function kindOf(kind) {
  if (!KINDS[kind]) throw new Error(`Unknown dataset file kind: ${kind}`);
  return KINDS[kind];
}

const digest = text => crypto.createHash('sha1').update(text).digest('base64url').slice(0, 16);
const contentHash = text => digest(text);
const detailHash = value => (value == null ? null : digest(JSON.stringify(value)));
// One analyzer row; the detail hash and region count are filled in once the file's symbols exist.
const fileRow = (rel, loc, hash) => [rel, loc, 0, hash, null, null];

const datasetFile = (outDir, dataset, kind) => path.join(outDir, dataset + kindOf(kind).suffix);
// The shard holding one file's symbols inside a symbols directory.
const symbolShard = (dir, rel) => path.join(dir, digest('path:' + rel) + '.json');

async function writeShards(dir, symbols) {
  const entries = Object.entries(symbols);
  for (let i = 0; i < entries.length; i += 64)
    await Promise.all(
      entries
        .slice(i, i + 64)
        .map(([rel, value]) => fsp.writeFile(symbolShard(dir, rel), JSON.stringify({ path: rel, symbols: value }))),
    );
}

// The graph file's text: a script that registers the graph on window.DATASETS.
const graphScript = (dataset, value) =>
  `(window.DATASETS = window.DATASETS || {})[${JSON.stringify(dataset)}] = ${JSON.stringify(value)};\n`;

async function writeDatasetFile(outDir, dataset, kind, value) {
  const target = datasetFile(outDir, dataset, kind);
  if (kind === 'symbols') {
    // Written beside the old directory, then swapped in.
    const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
    await fsp.mkdir(temp, { recursive: true });
    await writeShards(temp, value);
    await fsp.rm(target, { recursive: true, force: true });
    await fsp.rename(temp, target);
    return;
  }
  return writeFileAtomic(target, graphScript(dataset, value));
}
// Adds files' symbols to an existing dataset's symbols (a second front end's files).
async function addSymbols(outDir, dataset, symbols) {
  const dir = datasetFile(outDir, dataset, 'symbols');
  await fsp.mkdir(dir, { recursive: true });
  await writeShards(dir, symbols);
}
// Some files' symbols from a symbols directory: { [path]: symbols | null }.
async function readSymbols(dir, paths) {
  const out = {};
  await Promise.all(
    paths.map(async rel => {
      try {
        const shard = JSON.parse(await fsp.readFile(symbolShard(dir, rel), 'utf8'));
        out[rel] = shard.path === rel ? shard.symbols : null;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        out[rel] = null;
      }
    }),
  );
  return out;
}

async function readDatasetFile(outDir, dataset, kind) {
  const target = datasetFile(outDir, dataset, kind);
  if (kind === 'symbols') {
    const out = {};
    for (const name of await fsp.readdir(target)) {
      const shard = JSON.parse(await fsp.readFile(path.join(target, name), 'utf8'));
      out[shard.path] = shard.symbols;
    }
    return out;
  }
  const script = await fsp.readFile(target, 'utf8');
  return JSON.parse(script.slice(script.indexOf('] = ') + 4).replace(/;\s*$/, ''));
}

async function writeEmptyDataset(outDir, dataset) {
  for (const kind of DATASET_KINDS) await writeDatasetFile(outDir, dataset, kind, KINDS[kind].empty());
}

const datasetExists = (outDir, dataset) =>
  DATASET_KINDS.every(kind => fs.existsSync(datasetFile(outDir, dataset, kind)));

module.exports = {
  DATASET_KINDS,
  datasetFile,
  symbolShard,
  graphScript,
  writeDatasetFile,
  addSymbols,
  readSymbols,
  readDatasetFile,
  writeEmptyDataset,
  datasetExists,
  digest,
  contentHash,
  detailHash,
  fileRow,
};
