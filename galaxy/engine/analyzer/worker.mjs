// A project's resident analyzer: one child process per open workspace. It keeps the JS/TS project model between
// analyses (project-model.mjs, which re-analyzes only what a change can affect) and re-runs a tree-sitter front end
// (Java, the shared-model languages) only when one of its files, or a non-source input, changed. It writes the dataset
// in place: the symbol shards whose detail changed, then the graph. A crash or restart loses only speed: a new worker
// starts with a full analysis.
// Usage: worker.mjs <root> <dataset> <outDir>, over IPC:
//   { id, type: 'analyze', changes: { paths: [root-relative] } | null, languages: [front ends] }
//   -> { id, ok: true, result: { files, fileCount, inputs, digest, stats } } | { id, ok: false, error }
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { languageOf } from '../../source-model/languages.js';
import { datasetFile, digest, graphScript, symbolShard } from './dataset-file.cjs';
import { buildJavaDataset } from './java-dataset.mjs';
import { mergeSources } from './merge.mjs';
import { createProjectModel } from './project-model.mjs';
import { buildSyntaxDataset } from './syntax-dataset.mjs';
import { writeFileAtomic } from '../shared/files.cjs';

const [root, dataset, outDir] = process.argv.slice(2);
const graphFile = datasetFile(outDir, dataset, 'graph'),
  symbolsDir = datasetFile(outDir, dataset, 'symbols'),
  // Present while shards are being rewritten: if it survives a crash, no shard on disk is trusted.
  writing = `${symbolsDir}.writing`;

let model = null,
  languages = new Set();
const parts = { java: null, syntax: null }; // each front end's last { rows, edges, stats, languages }
let shards = null; // path -> detail hash of its shard on disk

// What the current shards hold, from the graph that was written after them.
function readShards() {
  const known = new Map();
  if (fs.existsSync(writing) || !fs.existsSync(graphFile)) return known;
  try {
    const script = fs.readFileSync(graphFile, 'utf8');
    for (const [rel, , , , detail] of JSON.parse(script.slice(script.indexOf('] = ') + 4).replace(/;\s*$/, '')).f)
      if (detail && fs.existsSync(symbolShard(symbolsDir, rel))) known.set(rel, detail);
  } catch {
    known.clear();
  }
  return known;
}

async function analyze(changes, wanted) {
  const started = performance.now();
  const full = !changes || !model;
  wanted = new Set(wanted);
  // A path no front end parses is an input (a configuration or manifest): every front end re-runs.
  const touches = front =>
    full ||
    !languages.has(front) ||
    changes.paths.some(rel => {
      const own = languageOf(rel)?.frontEnd;
      return own === front || !own;
    });
  const stats = { full };
  let graph = { f: [], e: [] },
    symbols = {};
  if (wanted.has('typescript')) {
    model ||= createProjectModel({ root, scan: root, outDir, symbols: true });
    const result = model.update(full || !languages.has('typescript') ? null : changes);
    graph = result.graph;
    symbols = result.symbols;
    stats.typescript = result.stats;
  } else model = null;
  const merged = [];
  for (const [front, build, label, engine] of [
    ['java', () => buildJavaDataset([root], { symbols: true }), ['Java'], 'java-source'],
    ['syntax', () => buildSyntaxDataset(path.resolve(root), { symbols: true }), null, 'tree-sitter'],
  ]) {
    if (!wanted.has(front)) {
      parts[front] = null;
      continue;
    }
    if (touches(front) || !parts[front]) {
      const part = await build();
      Object.assign(symbols, part.symbols);
      parts[front] = { rows: part.rows, edges: part.edges, stats: part.stats, languages: part.languages };
      stats[front] = part.rows.length;
    }
    // Rows are copied: the merge renumbers edges and the graph keeps in-degrees per snapshot.
    const part = parts[front];
    merged.push({
      part: { rows: part.rows.map(row => [...row]), edges: part.edges, stats: part.stats },
      languages: label || part.languages,
      key: front,
      engine,
    });
  }
  languages = wanted;
  graph = mergeSources(graph, merged);

  // Shards: rewrite those whose detail changed, remove the rest.
  shards ??= readShards();
  await fsp.mkdir(symbolsDir, { recursive: true });
  await fsp.writeFile(writing, '');
  const present = new Set();
  let written = 0;
  const writes = [];
  for (const [rel, , , , detail] of graph.f) {
    if (!detail) continue;
    present.add(rel);
    if (shards.get(rel) === detail) continue;
    if (!symbols[rel]) throw new Error(`No symbols for ${rel}, whose detail changed.`);
    writes.push([rel, detail]);
  }
  for (let i = 0; i < writes.length; i += 64)
    await Promise.all(
      writes.slice(i, i + 64).map(async ([rel, detail]) => {
        const target = symbolShard(symbolsDir, rel),
          temp = `${target}.${process.pid}.tmp`;
        await fsp.writeFile(temp, JSON.stringify({ path: rel, symbols: symbols[rel] }));
        await fsp.rename(temp, target);
        shards.set(rel, detail);
        written++;
      }),
    );
  for (const rel of [...shards.keys()])
    if (!present.has(rel)) {
      await fsp.rm(symbolShard(symbolsDir, rel), { force: true });
      shards.delete(rel);
    }
  if (full) {
    // Anything else in the directory (a previous worker's leftovers) is not part of this dataset.
    const expected = new Set([...present].map(rel => path.basename(symbolShard(symbolsDir, rel))));
    for (const name of await fsp.readdir(symbolsDir))
      if (!expected.has(name)) await fsp.rm(path.join(symbolsDir, name), { force: true });
  }
  const script = graphScript(dataset, graph);
  await writeFileAtomic(graphFile, script);
  await fsp.rm(writing, { force: true });
  return {
    files: graph.f.map(([rel]) => rel),
    fileCount: graph.f.length,
    inputs: graph.analysis?.inputs || [],
    digest: digest(script),
    stats: { ...stats, written, ms: Math.round(performance.now() - started) },
  };
}

let queue = Promise.resolve();
process.on('message', message => {
  if (message?.type !== 'analyze') return;
  queue = queue.then(async () => {
    try {
      process.send({ id: message.id, ok: true, result: await analyze(message.changes, message.languages) });
    } catch (error) {
      // The model may be half-updated: the next analysis starts afresh.
      model = null;
      shards = null;
      process.send({ id: message.id, ok: false, error: error.stack || String(error) });
    }
  });
});
process.on('disconnect', () => process.exit(0));
