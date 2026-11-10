const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { LspClient } = require('../lsp/client.cjs');
const { spawnOwned, killProcess, connect, filters, scrubEnv } = require('./common.cjs');
const { javaStatus } = require('./install.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function javaFiles(root, limit = 1000) {
  const result = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (result.length >= limit) return;
      if (
        entry.isDirectory() &&
        !['.git', '.galaxy', 'node_modules', 'target', 'build', 'dist', 'out', '.venv', 'venv', '__pycache__'].includes(
          entry.name,
        )
      )
        await walk(path.join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith('.java')) result.push(path.join(dir, entry.name));
    }
  }
  await walk(root);
  return result;
}
function createJdtlsManager({ userData }) {
  const projects = new Map();
  const subscribers = new Set();
  async function start(root, bundle, { signal } = {}) {
    root = await fs.realpath(root);
    signal?.throwIfAborted();
    if (projects.has(root)) {
      const existing = await projects.get(root).ready;
      if (!bundle || existing.bundle === bundle) return existing;
      await close(root);
    }
    const entry = { root, bundle, closed: false, mains: [], diagnostics: new Map() };
    projects.set(root, entry);
    entry.ready = (async () => {
      const available = await javaStatus();
      if (!available.available) throw new Error('Java debugging requires jdtls on PATH and Java 21 or newer');
      const dir = path.join(userData, 'jdtls', createHash('sha256').update(root).digest('hex').slice(0, 20));
      await fs.mkdir(dir, { recursive: true });
      const run = await fs.mkdtemp(path.join(dir, 'server-'));
      entry.run = run;
      await fs.mkdir(path.join(run, 'configuration'));
      if (entry.closed) throw new Error('jdtls project closed');
      const child = (entry.child = spawnOwned(
        available.jdtls,
        ['-data', path.join(run, 'data'), '-configuration', path.join(run, 'configuration')],
        { cwd: root, env: scrubEnv() },
      ));
      child.stderr.on('data', chunk => {
        entry.output = ((entry.output || '') + chunk).slice(-8000);
      });
      const rootUri = pathToFileURL(root).href;
      const workspaceFolders = [{ uri: rootUri, name: path.basename(root) }];
      const settings = {
        java: {
          project: { sourcePaths: ['.'], outputPath: '.galaxy/bin', referencedLibraries: [] },
          configuration: { updateBuildConfiguration: 'automatic' },
          // Gradle and Maven import run project build scripts and the Gradle wrapper jar; jdtls also serves passive
          // Problems, so sources are imported as a plain project instead.
          import: { gradle: { enabled: false, wrapper: { enabled: false } }, maven: { enabled: false } },
        },
      };
      const client = (entry.client = new LspClient(child.stdout, child.stdin, {
        workspaceFolders,
        onRequest: async (method, params) => {
          if (method === 'workspace/configuration')
            return (params.items || []).map(item =>
              item.section ? (item.section.split('.').reduce((obj, key) => obj?.[key], settings) ?? null) : settings,
            );
          if (method === 'workspace/workspaceFolders') return workspaceFolders;
          if (method === 'workspace/applyEdit') return { applied: false };
          return null;
        },
      }));
      child.once('error', error => client.transport.close(error));
      client.on('textDocument/publishDiagnostics', params => {
        entry.diagnostics.set(params.uri, params);
        for (const listener of subscribers) listener(root, params);
      });
      entry.capabilities =
        (
          await client.request('initialize', {
            processId: process.pid,
            rootUri,
            rootPath: root,
            workspaceFolders,
            capabilities: {
              workspace: { configuration: true, workspaceFolders: true },
              window: { workDoneProgress: true },
            },
            initializationOptions: {
              bundles: bundle ? [bundle] : [],
              workspaceFolders: [rootUri],
              settings,
              extendedClientCapabilities: { progressReportProvider: true },
            },
          })
        ).capabilities || {};
      client.notify('initialized');
      client.notify('workspace/didChangeConfiguration', { settings });
      for (const file of await javaFiles(root)) {
        const real = await fs.realpath(file).catch(() => null);
        if (!real?.startsWith(root + path.sep)) continue;
        const stat = await fs.stat(real);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
        const bytes = await fs.readFile(real);
        if (bytes.length > 2 * 1024 * 1024) continue;
        client.notify('textDocument/didOpen', {
          textDocument: { uri: pathToFileURL(real).href, languageId: 'java', version: 1, text: bytes.toString('utf8') },
        });
      }
      entry.execute = (command, args = []) => client.request('workspace/executeCommand', { command, arguments: args });
      return entry;
    })().catch(async error => {
      await dispose(entry);
      if (projects.get(root) === entry) projects.delete(root);
      throw error;
    });
    return entry.ready;
  }
  async function dispose(entry) {
    entry.closed = true;
    if (entry.client && !entry.client.transport.closed) {
      try {
        await entry.client.request('shutdown', null, 1000);
        entry.client.notify('exit');
      } catch {}
      entry.client.close();
    }
    await killProcess(entry.child);
    if (entry.run) await fs.rm(entry.run, { recursive: true, force: true });
  }
  async function close(root) {
    root = await fs.realpath(root).catch(() => root);
    const entry = projects.get(root);
    if (!entry) return;
    projects.delete(root);
    await dispose(entry);
    await entry.ready.catch(() => {});
  }
  async function closeAll() {
    await Promise.all([...projects.keys()].map(close));
  }
  return {
    start,
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    close,
    closeAll,
    peek: root => projects.get(root),
    pids: () => [...projects.values()].map(entry => entry.child?.pid).filter(Boolean),
  };
}
async function detect(root, { jdtls } = {}) {
  const entry = jdtls?.peek(await fs.realpath(root));
  if (!entry?.mains?.length || !(await javaStatus()).available || !(await javaFiles(root, 1)).length) return [];
  const entries = await fs.readdir(root);
  const build = entries.includes('pom.xml')
    ? 'Maven'
    : entries.some(name => /^build\.gradle/.test(name))
      ? 'Gradle'
      : 'Java';
  return entry.mains.map(main => ({
    name: `${build}: ${main.mainClass}`,
    type: 'java',
    mainClass: main.mainClass,
    projectName: main.projectName,
  }));
}
const commandLine = value =>
  Array.isArray(value) ? value.map(arg => (/[\s"]/.test(arg) ? JSON.stringify(arg) : arg)).join(' ') : value || '';
async function start(ctx) {
  let importing = !ctx.jdtls.peek(ctx.root);
  ctx.onCleanup?.(() => (importing ? ctx.jdtls.close(ctx.root) : Promise.resolve()));
  const project = await ctx.jdtls.start(
    ctx.root,
    path.join(ctx.installPath, 'extension/server/com.microsoft.java.debug.plugin-0.53.2.jar'),
    { signal: ctx.signal },
  );
  importing = false;
  ctx.signal?.throwIfAborted();
  const until = Date.now() + 90000;
  while (!project.mains.length && Date.now() < until && !project.closed) {
    ctx.signal?.throwIfAborted();
    try {
      project.mains = (await project.execute('vscode.java.resolveMainClass', [pathToFileURL(ctx.root).href])) || [];
    } catch (error) {
      if (project.client.transport.closed) throw error;
    }
    if (!project.mains.length) await delay(500);
  }
  const config = ctx.configuration;
  const main = config.mainClass
    ? project.mains.find(
        main => main.mainClass === config.mainClass && (!config.projectName || main.projectName === config.projectName),
      )
    : project.mains.find(main => config.program && path.resolve(main.filePath) === path.resolve(config.program)) ||
      project.mains[0];
  if (!main) throw new Error(`No Java main class found for ${config.mainClass || config.program}`);
  const built = await project.execute('vscode.java.buildWorkspace', [
    JSON.stringify({ mainClass: main.mainClass, projectName: main.projectName, isFullBuild: true }),
  ]);
  if (built !== 1 && built !== 'SUCCEED') throw new Error(`Java workspace build failed: ${JSON.stringify(built)}`);
  const [modulePaths, classPaths] = await project.execute('vscode.java.resolveClasspath', [
    main.mainClass,
    main.projectName,
  ]);
  const port = await project.execute('vscode.java.startDebugSession');
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Java debug session failed: ${port}`);
  return {
    client: await connect(port),
    launch: {
      ...config,
      // java-debug takes args and vmArgs as single command-line strings.
      args: commandLine(config.args),
      vmArgs: commandLine(config.vmArgs),
      type: 'java',
      request: 'launch',
      mainClass: main.mainClass,
      projectName: main.projectName,
      modulePaths,
      classPaths,
      cwd: config.cwd || ctx.root,
      console: 'internalConsole',
      env: ctx.env,
    },
  };
}
const exceptionFilters = (mode, advertised) =>
  filters(mode, advertised, { failures: ['uncaught'], all: ['caught', 'uncaught'], uncaught: ['uncaught'], none: [] });
module.exports = {
  id: 'java-debug',
  label: 'Java',
  extensions: ['.java'],
  detect,
  start,
  exceptionFilters,
  createJdtlsManager,
};
