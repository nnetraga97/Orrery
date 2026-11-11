#!/usr/bin/env node
// Renders models from public/assets in headless Chromium, for reviewing their look (docs/reviews/asset-review/).
// Usage: node tools/asset-review/render-models.mjs --out=<dir> [--mode=grid|hero|close] [--t=0.8] [--wire] [--lod]
//        <path relative to public/assets> ...
// grid: front, 3/4, side and high 3/4 in one 960 px image; hero: one large 3/4; close: a tight 3/4 at mid height.
// --lod also draws the distant mesh some models carry (extras.lod); by default only the full model is drawn.
// No server is started: the page and files are served through Playwright's request interception.
// CHROMIUM_PATH names a browser binary when Playwright's own download is absent (cloud sessions: /opt/pw-browsers/chromium).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = name => process.argv.includes(`--${name}`);
const out = path.resolve(option('out', 'screenshots/asset-review'));
const mode = option('mode', 'grid');
const t = Number(option('t', '0.8'));
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!files.length) {
  console.error('Name at least one model, e.g. buildings/tower/tower.glb');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const { chromium } = createRequire(import.meta.url)('playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png', '.webp': 'image/webp' };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 960 } });
page.on('console', m => m.type() === 'error' && console.error('page:', m.text()));
await page.route('http://review.local/**', route => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname);
  const file = p.startsWith('/repo/') ? path.join(repo, p.slice(6)) : path.join(here, p);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ status: 200, body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
});
await page.goto('http://review.local/viewer.html');
await page.waitForFunction('window.ready');

for (const file of files) {
  const name = `${mode}__${file.replace(/\.glb$/, '').replaceAll('/', '__')}${flag('wire') ? '__wire' : ''}.png`;
  try {
    const info = await page.evaluate(([url, opts]) => window.render(url, opts), [
      `/repo/public/assets/${file}`,
      { t, wire: flag('wire'), mode, showLod: flag('lod') },
    ]);
    await page.locator('canvas').screenshot({ path: path.join(out, name) });
    console.log(name, JSON.stringify(info));
  } catch (error) {
    console.error('failed:', file, error.message);
  }
}
await browser.close();
