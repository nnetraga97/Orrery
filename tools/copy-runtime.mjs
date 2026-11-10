#!/usr/bin/env node
// Copies the TypeScript compiler the browser loads on demand (galaxy/viewer/towns/town-assets.js fetches
// vendor/runtime/typescript.js to parse a file whose baked symbols are stale). Runs after every npm install.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(repo, 'node_modules/typescript/lib');
const to = path.join(repo, 'public/vendor/runtime');
if (!fs.existsSync(path.join(from, 'typescript.js'))) {
  console.error('typescript is not installed; run npm install first.');
  process.exit(1);
}
fs.mkdirSync(to, { recursive: true });
fs.copyFileSync(path.join(from, 'typescript.js'), path.join(to, 'typescript.js'));
fs.copyFileSync(path.join(from, '../LICENSE.txt'), path.join(to, 'typescript.LICENSE'));
console.log('Copied the TypeScript runtime to public/vendor/runtime/.');
