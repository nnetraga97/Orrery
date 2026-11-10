#!/usr/bin/env node
// Loads the built flat reference view in headless Chromium and fails on page errors or missing files.
// Usage: npm run build && node tools/smoke-flat.mjs [--dataset=sample] [--land=<path>] [--line=<n>] [--settle=<ms>]
//        [--size=1440x900] [--query=cannon=off] [--out=screenshots/flat.png] [--base=https://host/path/]
// Without --base it serves dist/ with `vite preview`. With --base it tests an already deployed site.
// Prints the asset files the page requested, which is the list the app needs under public/assets/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
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
  port = 4173 + Math.floor(Math.random() * 500);

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(2);
}

const base = option('base', '');
const server = base
  ? null
  : spawn(
      process.execPath,
      [path.join(repo, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
      { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] },
    );
const stop = () => server?.kill('SIGTERM');
process.on('exit', stop);
if (server)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not start in 20 s')), 20000);
    server.stdout.on('data', chunk => {
      if (String(chunk).includes(String(port))) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.on('exit', code => reject(new Error(`vite preview exited with code ${code}`)));
  });

// CHROMIUM_PATH names a browser binary when Playwright's own download is absent (cloud sessions: /opt/pw-browsers/chromium).
const executablePath =
  process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
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
  const origin = base ? base.replace(/\/?$/, '/') : `http://127.0.0.1:${port}/`;
  const url = `${origin}flat.html?dataset=${encodeURIComponent(dataset)}${land ? `&land=${encodeURIComponent(land)}` : ''}${line ? `&line=${encodeURIComponent(line)}` : ''}${extra ? `&${extra}` : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__flat || window.__flatError, null, { timeout: 60000 });
  const startError = await page.evaluate(() => window.__flatError || null);
  if (startError) errors.push(`start: ${startError}`);
  await page.waitForTimeout(settle);
  const summary = await page.evaluate(() => ({
    files: window.__flat?.state.nodes.length ?? 0,
    canvases: document.querySelectorAll('#stage canvas').length,
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
