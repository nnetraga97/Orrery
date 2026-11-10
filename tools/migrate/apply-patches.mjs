#!/usr/bin/env node
// The only edits made to files copied from codebase-viz: they swap the desktop app's loopback project API for the
// baked static files (galaxy/viewer/app/static-data.js). Each edit replaces one exact piece of text. Running this
// twice is safe; it fails loudly if the copied code no longer contains the text it expects.
// Usage: node tools/migrate/apply-patches.mjs   (tools/migrate/copy-code.sh runs it for you)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PATCHES = [
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'the graph file is a static file',
    find: `export const dataFile = (name: string, kind: 'graph' | 'symbols', revision?: number | null) =>
  \`/api/projects/\${name}/data/\${kind}\${revision != null ? \`?rev=\${revision}\` : ''}\`;`,
    replace: `export const dataFile = (name: string, _kind: 'graph' | 'symbols', _revision?: number | null) => graphUrl(name);`,
  },
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'symbols come from baked shards',
    find: `  const query = new URLSearchParams();
  if (revision != null) query.set('rev', String(revision));
  paths.forEach(path => query.append('path', path));
  const res = await fetch(\`/api/projects/\${name}/data/symbols?\${query}\`);
  if (!res.ok) throw Object.assign(new Error(\`Could not load file symbols (\${res.status}).\`), { status: res.status });
  return res.json();`,
    replace: `  void revision; // A baked dataset has one revision.
  return symbolsFor(name, paths);`,
  },
  {
    file: 'galaxy/viewer/app/graph.ts',
    why: 'import the static data helpers',
    find: `import type { DatasetGraph, DatasetSymbols, FileNode, ImportLink } from './types.ts';`,
    replace: `import type { DatasetGraph, DatasetSymbols, FileNode, ImportLink } from './types.ts';
import { graphUrl, symbolsFor } from './static-data.js';`,
  },
  {
    file: 'galaxy/viewer/planet/planet.js',
    why: 'source text is a static file',
    find: `    sourceCache[key] = fetch(
      \`/api/projects/\${getDataset()}/source/\${path.split('/').map(encodeURIComponent).join('/')}\`,
    )`,
    replace: `    sourceCache[key] = fetch(sourceUrl(getDataset(), path))`,
  },
  {
    file: 'galaxy/viewer/planet/planet.js',
    why: 'import the static data helpers',
    find: `import { languageOf } from '../../source-model/languages.js';`,
    replace: `import { languageOf } from '../../source-model/languages.js';
import { sourceUrl } from '../app/static-data.js';`,
  },
];

let applied = 0,
  present = 0;
for (const { file, why, find, replace } of PATCHES) {
  const target = path.join(repo, file);
  const text = fs.readFileSync(target, 'utf8');
  if (text.includes(replace)) {
    present++;
    continue;
  }
  const count = text.split(find).length - 1;
  if (count !== 1) {
    console.error(`Cannot patch ${file} (${why}): expected the original text once, found it ${count} times.`);
    console.error('The copied file differs from the version this plan was written against. Stop and report this.');
    process.exit(1);
  }
  fs.writeFileSync(target, text.replace(find, () => replace));
  applied++;
}
// Two ship rigs were keyed by car brand names in codebase-viz. Competition rules forbid brand names in the project,
// so the keys are renamed here and tools/assets/build-assets.mjs renames the matching model files.
const RENAMED_KEYS = { bugatti: 'arc', aventador: 'arrow' };
let renamed = 0;
for (const entry of fs.readdirSync(path.join(repo, 'galaxy/viewer'), { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !/\.(js|ts)$/.test(entry.name)) continue;
  const target = path.join(entry.parentPath, entry.name);
  const text = fs.readFileSync(target, 'utf8');
  const next = text.replace(/\b(bugatti|aventador)\b/gi, word => RENAMED_KEYS[word.toLowerCase()]);
  if (next !== text) {
    fs.writeFileSync(target, next);
    renamed++;
  }
}

const leftovers = ['galaxy/viewer', 'galaxy/source-model']
  .flatMap(dir =>
    fs
      .readdirSync(path.join(repo, dir), { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile() && /\.(js|ts)$/.test(entry.name))
      .map(entry => path.join(entry.parentPath, entry.name)),
  )
  .filter(file => fs.readFileSync(file, 'utf8').includes('/api/projects'));
if (leftovers.length) {
  console.error(`These copied files still call the desktop project API:\n${leftovers.join('\n')}`);
  process.exit(1);
}
console.log(`patches: ${applied} applied, ${present} already present; brand keys renamed in ${renamed} files`);
