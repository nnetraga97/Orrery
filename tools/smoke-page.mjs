#!/usr/bin/env node
// Loads one built page in headless Chromium, fails on page errors and missing files, saves a screenshot, and can
// read state the page exposes for tests. It never enters an immersive session: it checks the page as a browser tab.
// Usage: npm run build && node tools/smoke-page.mjs --page=index.html [--query=a=b] [--wait=<js expression>]
//        [--read=<js expression returning JSON-safe data>] [--settle=<ms>] [--size=1440x900]
//        [--out=screenshots/page.png] [--ignore=<regex of error text to tolerate>]
// --wait is polled until it is truthy (60 s limit). --settle is an extra pause before the screenshot.
// --read is evaluated last and printed as JSON, so a caller can compare it with what it expects.
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const pageName = option('page', 'index.html'),
  query = option('query', ''),
  wait = option('wait', ''),
  read = option('read', ''),
  settle = Number(option('settle', '4000')),
  ignore = option('ignore', '') ? new RegExp(option('ignore', '')) : null,
  out = path.resolve(repo, option('out', `screenshots/${pageName.replace(/\.html$/, '')}.png`)),
  [width, height] = option('size', '1440x900').split('x').map(Number);

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
  '.woff2': 'font/woff2',
};
const dist = path.join(repo, 'dist');
if (!fs.existsSync(path.join(dist, pageName))) {
  console.error(`dist/${pageName} does not exist. Run: npm run build`);
  process.exit(2);
}
const server = http.createServer((request, response) => {
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
const origin = `http://127.0.0.1:${server.address().port}`;

const softwareGL = process.env.SMOKE_GL ? process.env.SMOKE_GL === 'software' : process.platform === 'linux';
const executablePath =
  process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  executablePath,
  args: [
    '--ignore-gpu-blocklist',
    ...(softwareGL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--enable-gpu']),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
  ],
});
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
const note = text => {
  if (!ignore?.test(text)) errors.push(text);
};
page.on('pageerror', error => note(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') note(`console: ${message.text()}`);
});
page.on('response', response => {
  // Only this site's own files count; a failed request to another origin shows up as a console error instead.
  if (response.status() >= 400 && response.url().startsWith(origin))
    note(`${response.status()} ${new URL(response.url()).pathname}`);
});

let result = null;
try {
  await page.goto(`${origin}/${pageName}${query ? `?${query}` : ''}`, { waitUntil: 'load' });
  if (wait) await page.waitForFunction(wait, null, { timeout: 60000 });
  await page.waitForTimeout(settle);
  if (read) result = await page.evaluate(read);
  const summary = await page.evaluate(() => ({
    title: document.title,
    canvases: document.querySelectorAll('canvas').length,
    webgl: !!document.createElement('canvas').getContext('webgl2'),
  }));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ ...summary, read: result }, null, 2));
  console.log(`screenshot: ${path.relative(repo, out)}`);
  if (!summary.webgl) note(`WebGL is unavailable in this browser; rerun with SMOKE_GL=${softwareGL ? 'gpu' : 'software'}`);
  if (!summary.canvases) note('the page drew no canvas');
} catch (error) {
  note(`smoke: ${error.message}`);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) console.error(`errors (${errors.length}):\n${[...new Set(errors)].join('\n')}`);
console.log(errors.length ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(errors.length ? 1 : 0);
