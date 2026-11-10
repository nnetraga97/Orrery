const fs = require('node:fs/promises');
const path = require('node:path');
const { DapClient } = require('../dap/client.cjs');
const { spawnOwned, filters } = require('./common.cjs');
async function pythonFor(root, configured) {
  if (configured) return Array.isArray(configured) ? configured[0] : configured;
  for (const name of ['.venv', 'venv']) {
    const candidate = path.join(root, name, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return 'python3';
}
async function detect(root) {
  const entries = await fs.readdir(root);
  const suggestions = [];
  if (entries.includes('__main__.py'))
    suggestions.push({ name: 'Python: __main__.py', type: 'python', program: path.join(root, '__main__.py') });
  else {
    const main = [];
    for (const file of entries.filter(file => file.endsWith('.py'))) {
      if (/if\s+__name__\s*==\s*['"]__main__['"]/.test(await fs.readFile(path.join(root, file), 'utf8')))
        main.push(file);
    }
    if (main.length === 1)
      suggestions.push({ name: `Python: ${main[0]}`, type: 'python', program: path.join(root, main[0]) });
  }
  let pytest = entries.some(name => ['pytest.ini', 'conftest.py', 'tests'].includes(name));
  if (!pytest && entries.includes('pyproject.toml'))
    pytest = /\[tool\.pytest[^\]]*\]/.test(await fs.readFile(path.join(root, 'pyproject.toml'), 'utf8'));
  if (pytest) suggestions.push({ name: 'Python: pytest', type: 'python', module: 'pytest' });
  return suggestions;
}
async function start(ctx) {
  const python = await pythonFor(
    ctx.root,
    ctx.configuration.python || ctx.settings?.debug?.python || ctx.settings?.python,
  );
  const env = { ...ctx.env, PYTHONPATH: [ctx.installPath, ctx.env.PYTHONPATH].filter(Boolean).join(path.delimiter) };
  const child = ctx.own(spawnOwned(python, ['-m', 'debugpy.adapter'], { cwd: ctx.root, env }));
  const client = new DapClient(child.stdout, child.stdin);
  child.once('error', error => client.transport.close(error));
  child.stderr.on('data', chunk => ctx.output(String(chunk)));
  return {
    client,
    interpreter: python,
    launch: {
      justMyCode: true,
      ...ctx.configuration,
      type: 'python',
      request: 'launch',
      cwd: ctx.configuration.cwd || ctx.root,
      python: [python],
      console: 'internalConsole',
      redirectOutput: true,
      env: ctx.env,
    },
  };
}
const exceptionFilters = (mode, advertised) =>
  filters(mode, advertised, {
    failures: ['uncaught', 'userUnhandled'],
    all: ['raised', 'uncaught'],
    uncaught: ['uncaught'],
    none: [],
  });
module.exports = { id: 'debugpy', label: 'Python', extensions: ['.py'], pythonFor, detect, start, exceptionFilters };
