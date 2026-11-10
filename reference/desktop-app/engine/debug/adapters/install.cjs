const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const PINS = Object.freeze({
  'typescript-language-server': {
    version: '6.0.2',
    url: 'https://registry.npmjs.org/typescript-language-server/-/typescript-language-server-6.0.2.tgz',
    sha256: 'd225b223a8a4764ecbd94bdba85d2ef185eaa7b9842a1a31c38c2bbe7f2fe9b9',
    entry: 'package/lib/cli.mjs',
  },
  pyright: {
    version: '1.1.414',
    url: 'https://registry.npmjs.org/pyright/-/pyright-1.1.414.tgz',
    sha256: 'bf5f473f6167c0d14175492c3263d783b4489a6956e1c06c18e15228e3a3fa42',
    entry: 'package/langserver.index.js',
  },
  'js-debug': {
    version: '1.140.0',
    url: 'https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/js-debug-dap-v1.140.0.tar.gz',
    sha256: '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968',
    entry: 'js-debug/src/dapDebugServer.js',
  },
  debugpy: {
    version: '1.8.22',
    url: 'https://files.pythonhosted.org/packages/56/3d/c7dc9f35bc9e22cdb53679f844bee40fd5cff871862f60595869a433400d/debugpy-1.8.22-py2.py3-none-any.whl',
    sha256: 'a9e9d3550e15ca479c59333e90845029190531f0cacfedab3b815a57bd913947',
    entry: 'debugpy/adapter/__main__.py',
  },
  'java-debug': {
    version: '0.53.2',
    url: 'https://open-vsx.org/api/vscjava/vscode-java-debug/0.60.0/file/vscjava.vscode-java-debug-0.60.0.vsix',
    sha256: 'f09ebe358a7b08b3c17b21b8d8207b0649acad120eb6f1604dc4f15379f59d66',
    entry: 'extension/server/com.microsoft.java.debug.plugin-0.53.2.jar',
  },
});
async function javaStatus() {
  let jdtls = null,
    javaMajor = null;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of process.platform === 'win32' ? ['jdtls.exe', 'jdtls.cmd', 'jdtls'] : ['jdtls']) {
      const file = path.join(dir, name);
      try {
        await fs.access(file, process.platform === 'win32' ? 0 : 1);
        jdtls = file;
        break;
      } catch {}
    }
    if (jdtls) break;
  }
  try {
    const result = await exec('java', ['-version'], { timeout: 5000 });
    const match = /version\s+"(?:1\.)?(\d+)/.exec(result.stderr + result.stdout);
    javaMajor = match ? +match[1] : null;
  } catch {}
  return { jdtls, javaMajor, available: !!jdtls && javaMajor >= 21 };
}
async function extractVerified(source, destination, sha256) {
  const bytes = await fs.readFile(source);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Adapter SHA-256 mismatch');
  const { stdout } = await exec('tar', ['-tf', source], { maxBuffer: 16 * 1024 * 1024 });
  for (const entry of stdout.split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replaceAll('\\', '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').includes('..'))
      throw new Error(`Unsafe archive entry: ${entry}`);
  }
  const verbose = await exec('tar', ['-tvf', source], { maxBuffer: 16 * 1024 * 1024 });
  if (verbose.stdout.split('\n').some(line => /^[lhbcps]/.test(line)))
    throw new Error('Unsafe archive entry: links and special files are not supported');
  await exec('tar', ['-xf', source, '-C', destination], { maxBuffer: 16 * 1024 * 1024 });
}
function createInstaller({ userData }) {
  if (!userData) throw new Error('Adapter installer requires userData');
  const root = () => path.resolve(process.env.GALAXY_DEBUG_ADAPTERS || path.join(userData, 'debug-adapters'));
  const inFlight = new Map();
  function pin(id) {
    if (!Object.hasOwn(PINS, id)) throw new Error(`Unknown debug adapter: ${id}`);
    return PINS[id];
  }
  async function status(id) {
    const artifact = pin(id),
      dir = path.join(root(), `${id}-${artifact.version}`);
    let installed = false;
    try {
      const stamp = JSON.parse(await fs.readFile(path.join(dir, '.galaxy-install.json'), 'utf8'));
      installed = stamp.sha256 === artifact.sha256 && (await fs.stat(path.join(dir, artifact.entry))).isFile();
    } catch {}
    return {
      id,
      installed,
      version: artifact.version,
      path: dir,
      ...(!installed
        ? { reason: `${id} ${artifact.version} is not installed; install it explicitly in Debug adapters` }
        : {}),
      ...(id === 'java-debug' ? await javaStatus() : {}),
    };
  }
  async function perform(id, { source } = {}) {
    const artifact = pin(id),
      existing = await status(id);
    if (existing.installed) return existing;
    await fs.mkdir(root(), { recursive: true });
    const temporary = await fs.mkdtemp(path.join(root(), `.${id}-`));
    try {
      const archive = path.join(temporary, 'archive');
      if (source) await fs.copyFile(path.resolve(source), archive);
      else {
        const response = await fetch(artifact.url, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`Adapter download failed: HTTP ${response.status}`);
        await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
      }
      const unpacked = path.join(temporary, 'unpacked');
      await fs.mkdir(unpacked);
      await extractVerified(archive, unpacked, artifact.sha256);
      if (!(await fs.stat(path.join(unpacked, artifact.entry))).isFile())
        throw new Error(`Missing adapter entry: ${artifact.entry}`);
      await fs.writeFile(
        path.join(unpacked, '.galaxy-install.json'),
        JSON.stringify({ sha256: artifact.sha256, version: artifact.version }),
      );
      try {
        await fs.rename(unpacked, existing.path);
      } catch (error) {
        if (!(await status(id)).installed) throw error;
      }
      return status(id);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  function install(id, options) {
    pin(id);
    if (!inFlight.has(id))
      inFlight.set(
        id,
        perform(id, options).finally(() => inFlight.delete(id)),
      );
    return inFlight.get(id);
  }
  return { status, install };
}
function status(id, { userData = process.env.GALAXY_DEBUG_ADAPTERS } = {}) {
  return createInstaller({ userData }).status(id);
}
function install(id, { userData = process.env.GALAXY_DEBUG_ADAPTERS, source } = {}) {
  return createInstaller({ userData }).install(id, { source });
}
module.exports = { PINS, createInstaller, status, install, javaStatus, extractVerified };
