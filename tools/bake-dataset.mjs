#!/usr/bin/env node
// Bakes one project into public/data/<name>/ so the app can load it as static files, with no server:
//   graph.js             the import graph, exactly as the analyzer writes it
//   symbols/<id>.json    one shard per analyzed file
//   symbols-index.json   { "<path>": "<id>.json" } so the browser can find a file's shard
//   source/<path>        the text of every analyzed file
//   manifest.json        { name, files, sizes, bakedAt, and the source repository's remote and commit when it has them }
//   LICENSE.txt          the project's licence file, when it has one (open-source licences require it to travel with copies)
// Usage: node tools/bake-dataset.mjs <name> <projectRoot> [scanDir]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [name, projectRoot, scanDir = '.'] = process.argv.slice(2);
if (!name || !projectRoot || !/^[a-z0-9-]+$/.test(name)) {
  console.error('usage: node tools/bake-dataset.mjs <name: a-z 0-9 -> <projectRoot> [scanDir]');
  process.exit(1);
}
const root = path.resolve(projectRoot);
const sourceRoot = path.resolve(root, scanDir);
if (!fs.statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`not a directory: ${sourceRoot}`);
  process.exit(1);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-'));
try {
  const analyzer = path.join(repo, 'galaxy/engine/analyzer/analyze.mjs');
  const log = execFileSync(process.execPath, [analyzer, name, root, scanDir, '--symbols', `--out=${temporary}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(log);

  const script = fs.readFileSync(path.join(temporary, `${name}.js`), 'utf8');
  const graph = JSON.parse(script.slice(script.indexOf('] = ') + 4).replace(/;\s*$/, ''));
  if (!graph.f.length) throw new Error('The analyzer found no source files; check projectRoot and scanDir.');

  const out = path.join(repo, 'public/data', name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'symbols'), { recursive: true });
  fs.writeFileSync(path.join(out, 'graph.js'), script);

  const index = {};
  const shards = path.join(temporary, `${name}.symbols`);
  for (const shard of fs.readdirSync(shards)) {
    const text = fs.readFileSync(path.join(shards, shard), 'utf8');
    index[JSON.parse(text).path] = shard;
    fs.writeFileSync(path.join(out, 'symbols', shard), text);
  }
  fs.writeFileSync(path.join(out, 'symbols-index.json'), JSON.stringify(index));

  let bytes = 0;
  for (const [relative] of graph.f) {
    const from = path.resolve(sourceRoot, relative);
    if (!from.startsWith(sourceRoot + path.sep)) throw new Error(`path escapes the project: ${relative}`);
    const to = path.join(out, 'source', relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    bytes += fs.statSync(to).size;
  }
  const missing = graph.f.filter(([relative]) => !index[relative]).map(([relative]) => relative);
  if (missing.length) throw new Error(`files without a symbols shard: ${missing.slice(0, 5).join(', ')}`);

  const size = dir =>
    fs
      .readdirSync(dir, { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile())
      .reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
  // Where the code came from, so a baked dataset can be traced and rebuilt.
  const git = (...args) => {
    try {
      return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const licence = ['LICENSE.txt', 'LICENSE', 'LICENSE.md', 'License.txt'].find(file => fs.existsSync(path.join(root, file)));
  if (licence) fs.copyFileSync(path.join(root, licence), path.join(out, 'LICENSE.txt'));
  const manifest = {
    name,
    files: graph.f.length,
    scanDir,
    sourceRemote: git('remote', 'get-url', 'origin'),
    sourceCommit: git('rev-parse', 'HEAD'),
    licence: licence ? 'LICENSE.txt' : null,
    sourceBytes: bytes,
    totalBytes: size(out),
    bakedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`baked ${manifest.files} files into public/data/${name} (${(manifest.totalBytes / 1048576).toFixed(1)} MB)`);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
