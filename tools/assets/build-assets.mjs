#!/usr/bin/env node
// Builds public/assets/ from a codebase-viz checkout: copies only the files the app loads at run time and shrinks the
// textures inside each model (at most 1024 px, WebP). Geometry, node names and animations are left exactly as they are,
// because the rigs find their joints by name. Blender sources, raw downloads and 4K planet maps are never copied.
// Usage: node tools/assets/build-assets.mjs /absolute/path/to/codebase-viz [--max-mb=120]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = process.argv[2] && path.resolve(process.argv[2], 'viewer/assets');
const maxMb = Number(process.argv.find(a => a.startsWith('--max-mb='))?.slice(9) ?? 120);
if (!source || !fs.existsSync(path.join(source, 'planets/library.json'))) {
  console.error('usage: node tools/assets/build-assets.mjs /absolute/path/to/codebase-viz [--max-mb=120]');
  process.exit(1);
}
const out = path.join(repo, 'public/assets');

// What the scene code loads, relative to viewer/assets. A directory is copied whole unless `only` filters its files.
const INCLUDE = [
  { dir: 'planets', only: f => !/(^|\/)(close|tripo)\//.test(f) && !/\.md$/.test(f) },
  { dir: 'island', only: f => /^(island-base\.glb|architecture\.glb|parts\.glb|layout\.json)$/.test(f) },
  { dir: 'island/meshy', only: f => /^landmarks-[a-z]\.glb$/.test(f) },
  { dir: 'island/trellis', only: f => /^houses-\d+\.glb$/.test(f) },
  { dir: 'cannon/meshy', only: f => /\.glb$/.test(f) },
  { dir: 'rigged', only: f => /\.glb$/.test(f) },
  { dir: 'buildings', only: f => /^([a-z]+)\/\1\.glb$/.test(f) },
  { dir: 'kit', only: f => /\.(glb|png)$/.test(f) },
  { dir: 'vehicles/road-v1', only: f => /\.glb$/.test(f) },
];

// Two ship rigs were named after car brands. They are published under neutral names; tools/migrate/apply-patches.mjs
// renames the same keys in the code.
const RENAMED_KEYS = { bugatti: 'arc', aventador: 'arrow' };
const publishedPath = file => file.replace(/\b(bugatti|aventador)\b/g, word => RENAMED_KEYS[word]);

const walk = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function shrinkModel(from, to) {
  const document = await io.read(from);
  // Two models carry a car brand in their node, image and scene names. The code finds joints by their Joint_/CTRL_
  // prefixes and never by these names, so they are renamed in the published file.
  const root = document.getRoot();
  for (const property of [...root.listNodes(), ...root.listTextures(), ...root.listScenes(), ...root.listMeshes(), ...root.listMaterials()]) {
    const name = property.getName();
    const clean = name.replace(/bug+at+i/gi, 'Arc').replace(/aventador/gi, 'Arrow');
    if (clean !== name) property.setName(clean);
  }
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
  await io.write(to, document);
}

fs.rmSync(out, { recursive: true, force: true });
let before = 0,
  after = 0,
  count = 0;
const failures = [];
for (const { dir, only } of INCLUDE) {
  const base = path.join(source, dir);
  if (!fs.existsSync(base)) {
    failures.push(`missing source directory: viewer/assets/${dir}`);
    continue;
  }
  for (const file of walk(base).filter(only).sort()) {
    const from = path.join(base, file),
      to = path.join(out, dir, publishedPath(file));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (file.endsWith('.glb')) {
      try {
        await shrinkModel(from, to);
        // Keep the original when shrinking did not help (models that are already small or untextured).
        if (fs.statSync(to).size >= fs.statSync(from).size) fs.copyFileSync(from, to);
      } catch (error) {
        fs.copyFileSync(from, to);
        console.warn(`copied without shrinking (${error.message}): ${dir}/${file}`);
      }
    } else fs.copyFileSync(from, to);
    before += fs.statSync(from).size;
    after += fs.statSync(to).size;
    count++;
  }
}
const mb = bytes => (bytes / 1048576).toFixed(1);
console.log(`${count} files: ${mb(before)} MB in codebase-viz -> ${mb(after)} MB in public/assets`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
if (after / 1048576 > maxMb) {
  console.error(`public/assets is ${mb(after)} MB, over the ${maxMb} MB budget.`);
  process.exit(1);
}
