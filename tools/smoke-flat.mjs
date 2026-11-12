#!/usr/bin/env node
// Loads the built flat reference view in headless Chromium and fails on page errors or missing files.
// Usage: npm run build && node tools/smoke-flat.mjs [--dataset=sample] [--land=<path>] [--line=<n>] [--settle=<ms>]
//        [--size=1440x900] [--query=cannon=off] [--out=screenshots/flat.png] [--base=https://host/path/]
//        [--function=<name>]
// --function, with --land: selects the file's star, lands on its planet with that name (functions.json) and checks
// that the globe shows exactly that function.
// Without --base it serves dist/ itself, on a free local port. With --base it tests an already deployed site.
// --settle is how long to let the overview load; with --land it is the longest to wait for the planet to finish.
// Prints the asset files the page requested, which is the list the app needs under public/assets/.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dataset = option('dataset', 'sample'),
  land = option('land', ''),
  line = option('line', ''),
  extra = option('query', ''),
  [width, height] = option('size', '1440x900').split('x').map(Number),
  out = path.resolve(repo, option('out', 'screenshots/flat.png')),
  settle = Number(option('settle', '6000')),
  base = option('base', ''),
  fn = option('function', '');

const require = createRequire(import.meta.url);
let chromium;
for (const name of ['playwright', 'playwright-core']) {
  try {
    ({ chromium } = require(name));
    break;
  } catch {
    // Try the next package name.
  }
}
if (!chromium) {
  console.error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(2);
}

// A minimal static file server for dist/, so the test does not depend on the build tool's preview server.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};
const dist = path.join(repo, 'dist');
let server = null,
  origin = base ? base.replace(/\/?$/, '/') : '';
if (!base) {
  if (!fs.existsSync(path.join(dist, 'flat.html'))) {
    console.error('dist/flat.html does not exist. Run: npm run build');
    process.exit(2);
  }
  server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.join(dist, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
    if (!file.startsWith(dist + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}/`;
}
const stop = () => server?.close();

// CHROMIUM_PATH names a browser binary when Playwright's own download is absent (cloud sessions: /opt/pw-browsers/chromium).
const executablePath =
  process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
// Linux servers have no GPU, so WebGL runs in software there. Elsewhere the real GPU is used, which is far faster.
// SMOKE_GL=software or SMOKE_GL=gpu overrides the choice.
const softwareGL = process.env.SMOKE_GL ? process.env.SMOKE_GL === 'software' : process.platform === 'linux';
const browser = await chromium.launch({
  executablePath,
  args: [
    '--ignore-gpu-blocklist',
    ...(softwareGL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu']),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ],
});
const page = await browser.newPage({ viewport: { width, height } });
const errors = [],
  missing = [],
  assets = new Set();
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.pathname.includes('/assets/') && response.status() < 400)
    assets.add(url.pathname.replace(/^\//, ''));
  if (response.status() >= 400) missing.push(`${response.status()} ${url.pathname}`);
});

let failed = false;
try {
  const url = `${origin}flat.html?dataset=${encodeURIComponent(dataset)}${land ? `&land=${encodeURIComponent(land)}` : ''}${line ? `&line=${encodeURIComponent(line)}` : ''}${extra ? `&${extra}` : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flat || window.__flatError, null, { timeout: 60000 });
  const startError = await page.evaluate(() => window.__flatError || null);
  if (startError) errors.push(`start: ${startError}`);
  if (land) {
    // A landing is finished when the loading notice has been gone, and the camera at rest, for eight seconds; --settle is the longest wait.
    const deadline = Date.now() + settle;
    let quietSince = 0;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      const ready = await page.evaluate(
        () =>
          !!window.__flat?.view.landed &&
          !window.__flat.view.flying &&
          document.getElementById('busy').hidden &&
          document.querySelectorAll('#labels > div').length > 20,
      );
      quietSince = ready ? quietSince || Date.now() : 0;
      if (quietSince && Date.now() - quietSince >= 8000) break;
    }
  } else await page.waitForTimeout(settle);
  if (land && fn) {
    // Select the star, find the named planet, land on it, and wait for the globe to show that function.
    await page.evaluate(path => {
      const f = window.__flat;
      f.actions.exitPlanet();
      f.actions.selectFile(f.state.nodes.findIndex(n => n.path === path));
    }, land);
    await page.waitForTimeout(8000);
    const want = await page.evaluate(name => {
      const f = window.__flat,
        p = f.view.functionPlanets?.().find(x => x.name === name || x.name.endsWith('.' + name));
      if (!p) return null;
      f.actions.enterPlanet(p.file, { line: p.start, townId: p.id });
      return p.id;
    }, fn);
    if (!want) errors.push(`no planet named ${fn} around ${land}`);
    else {
      const deadline = Date.now() + settle;
      let got = null;
      while (Date.now() < deadline && got !== want) {
        await page.waitForTimeout(2000);
        got = await page.evaluate(() => (window.__flat.view.landedTowns?.() || []).find(t => t.shown)?.id ?? null);
      }
      if (got !== want) errors.push(`landed on ${got}, not the function ${want}`);
      else console.log(`landed on the function ${want}`);
      await page.waitForTimeout(6000);
    }
  }
  const summary = await page.evaluate(() => ({
    files: window.__flat?.state.nodes.length ?? 0,
    canvases: document.querySelectorAll('#stage canvas').length,
    webgl: !!document.createElement('canvas').getContext('webgl2'),
    labels: document.querySelectorAll('#labels > div').length,
    landed: !!window.__flat?.view.landed,
    sceneError: !document.getElementById('sceneError').hidden,
    info: document.getElementById('info').textContent,
    loading: document.getElementById('busy').hidden ? '' : document.getElementById('sceneLoadingDetail').textContent,
  }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(JSON.stringify(summary, null, 2));
  console.log(`screenshot: ${path.relative(repo, out)}`);
  console.log(`requested assets (${assets.size}):\n${[...assets].sort().join('\n')}`);
  if (!summary.webgl)
    errors.push(`WebGL is unavailable in this browser; rerun with SMOKE_GL=${softwareGL ? 'gpu' : 'software'}`);
  if (!summary.files) errors.push('no files were loaded');
  if (summary.canvases !== 1) errors.push(`expected one canvas, found ${summary.canvases}`);
  if (summary.sceneError) errors.push('the scene reported a render error');
  if (land && !summary.landed) errors.push(`did not land on ${land}`);
} catch (error) {
  errors.push(`smoke: ${error.message}`);
} finally {
  await browser.close();
  stop();
}
if (missing.length) console.error(`missing files (${missing.length}):\n${[...new Set(missing)].join('\n')}`);
if (errors.length) console.error(`errors (${errors.length}):\n${errors.join('\n')}`);
failed = errors.length > 0 || missing.length > 0;
console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(failed ? 1 : 0);
