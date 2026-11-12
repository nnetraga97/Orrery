#!/usr/bin/env node
// Writes public/data/<name>/functions.json: which functions each file shows as planets around its star, the rest
// counted, and the calls between planets. The ranking is src/core/importance.ts; pins come from
// tools/function-pins.json. tools/bake-dataset.mjs runs this after a bake; run it alone to re-rank an existing dataset.
// Usage: node --experimental-strip-types tools/bake-functions.mjs <name> [<name> ...]   (no name: every dataset)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFunctionIndex } from '../src/core/importance.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(repo, 'public/data');
const pins = JSON.parse(fs.readFileSync(path.join(repo, 'tools/function-pins.json'), 'utf8'));
const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(data).filter(n => fs.existsSync(path.join(data, n, 'symbols-index.json')));
for (const name of names) {
  const dir = path.join(data, name);
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'symbols-index.json'), 'utf8'));
  const shards = Object.entries(index)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([file, shard]) => {
      const s = JSON.parse(fs.readFileSync(path.join(dir, 'symbols', shard), 'utf8')).symbols || {};
      return { path: file, decls: s.decls || [] };
    });
  const result = buildFunctionIndex(shards, pins[name] || []);
  fs.writeFileSync(path.join(dir, 'functions.json'), JSON.stringify(result));
  const planets = result.files.reduce((n, f) => n + f.planets.length, 0);
  const stars = result.files.filter(f => f.cls === 'star' || f.cls === 'test').length;
  console.log(`${name}: ${stars} stars, ${planets} planets, ${result.calls.length} calls between planets`);
}
