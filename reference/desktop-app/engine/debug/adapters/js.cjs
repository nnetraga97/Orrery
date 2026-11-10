const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnOwned, connect, filters } = require('./common.cjs');
const id = 'js-debug';
async function detect(root) {
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const suggestions = [];
  for (const program of new Set(
    [pkg.main, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))].filter(
      x => typeof x === 'string',
    ),
  )) {
    suggestions.push({
      name: `Node: ${program}`,
      type: 'pwa-node',
      request: 'launch',
      program: path.resolve(root, program),
    });
  }
  if (/\bnode\s+--test\b/.test(pkg.scripts?.test || ''))
    suggestions.push({ name: 'Node tests', type: 'pwa-node', request: 'launch', runtimeArgs: ['--test'] });
  return suggestions;
}
async function start(ctx) {
  const env = { ...ctx.env };
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const child = ctx.own(
    spawnOwned(
      process.execPath,
      // js-debug listens on TCP, so nothing would end it if Galaxy died without cleaning up; the guard does.
      [path.join(__dirname, 'parent-guard.cjs'), path.join(ctx.installPath, 'js-debug/src/dapDebugServer.js'), '0', '127.0.0.1'],
      {
        cwd: ctx.root,
        env,
      },
    ),
  );
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const clean = () => {
      clearTimeout(timer);
      child.stdout.off('data', data);
      child.stderr.off('data', data);
      child.off('error', fail);
      child.off('exit', exited);
      ctx.signal?.removeEventListener('abort', abort);
    };
    const fail = error => {
      clean();
      reject(error);
    };
    const exited = () => fail(new Error(`js-debug exited before listening: ${output}`));
    const abort = () => fail(new Error('Debug launch cancelled'));
    const data = chunk => {
      output = (output + chunk).slice(-8000);
      const match = /Debug server listening at 127\.0\.0\.1:(\d+)/.exec(output);
      if (match) {
        clean();
        resolve(+match[1]);
      }
    };
    const timer = setTimeout(() => fail(new Error(`js-debug startup timed out: ${output}`)), 15000);
    child.stdout.on('data', data);
    child.stderr.on('data', data);
    child.once('error', fail);
    child.once('exit', exited);
    ctx.signal?.addEventListener('abort', abort, { once: true });
    if (ctx.signal?.aborted) abort();
  });
  child.stdout.resume();
  child.stderr.on('data', chunk => ctx.output(String(chunk)));
  // The standalone server has no workspace folder, so name the compiled output explicitly, and pause new
  // scripts until their source maps load so TypeScript breakpoints bind before the first statement runs.
  const glob = ctx.root.split(path.sep).join('/');
  const launch = {
    outFiles: [`${glob}/**/*.(m|c|)js`, '!**/node_modules/**'],
    resolveSourceMapLocations: [`${glob}/**`, '!**/node_modules/**'],
    sourceMaps: true,
    pauseForSourceMap: true,
    autoAttachChildProcesses: true,
    skipFiles: ['<node_internals>/**'],
    ...ctx.configuration,
    type: 'pwa-node',
    request: 'launch',
    cwd: ctx.configuration.cwd || ctx.root,
    console: 'internalConsole',
    outputCapture: 'std',
    env: { ...ctx.env, ELECTRON_RUN_AS_NODE: null },
  };
  // Node launched by an Electron adapter must use a real Node runtime, not the GUI executable.
  launch.runtimeExecutable ||= process.versions.electron ? 'node' : process.execPath;
  return { client: await connect(port), launch, connect: () => connect(port) };
}
const exceptionFilters = (mode, advertised) =>
  filters(mode, advertised, { failures: ['all'], all: ['all'], uncaught: ['uncaught'], none: [] });
module.exports = {
  id,
  label: 'JavaScript / TypeScript',
  extensions: ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'],
  detect,
  start,
  exceptionFilters,
};
