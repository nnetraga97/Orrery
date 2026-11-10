const showTools = require('../tools/show.cjs');
const debugTools = require('../tools/debug.cjs');
const problemsTools = require('../tools/problems.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { privateEnv } = require('../../debug/adapters/common.cjs');
const { spawn } = require('node:child_process');

const clip = (value, limit = 8192) => {
  const bytes = Buffer.from(String(value ?? ''));
  return bytes.length > limit ? bytes.subarray(0, limit).toString('utf8') + '\n[Output clipped]' : bytes.toString();
};
const string = description => ({ type: 'string', description });
const definitions = [
  [
    'semantic_search',
    'Find functions by intent using the project atlas.',
    { query: string('Question about the codebase') },
    ['query'],
  ],
  [
    'list_files',
    'List up to 400 entries, excluding .git and node_modules.',
    { path: string('Relative directory; defaults to .') },
    [],
  ],
  [
    'read_file',
    'Read numbered lines, at most 400. Page with start_line and end_line.',
    {
      path: string('Relative file'),
      start_line: { type: 'integer', minimum: 1 },
      end_line: { type: 'integer', minimum: 1 },
    },
    ['path'],
  ],
  [
    'search',
    'Search files using a regular expression.',
    { pattern: string('Regular expression'), path: string('Relative file or directory; defaults to .') },
    ['pattern'],
  ],
  [
    'replace_in_file',
    'Replace text only when old_text occurs exactly once.',
    { path: string('Relative file'), old_text: string('Exact nonempty text'), new_text: string('Replacement') },
    ['path', 'old_text', 'new_text'],
  ],
  [
    'write_file',
    'Create or overwrite a file.',
    { path: string('Relative file'), content: string('File contents') },
    ['path', 'content'],
  ],
  [
    'run_command',
    'Run a shell command in the repository, with a 120 second timeout.',
    { command: string('Shell command') },
    ['command'],
  ],
];
const names = definitions.map(([name]) => name);
function toolsFor(permission, semanticSearch = false, debug = false, show = false) {
  return [
    ...definitions,
    ...(show ? showTools.definitions : []),
    ...(debug ? [...debugTools.definitions, ...problemsTools.definitions] : []),
  ]
    .filter(
      ([name]) =>
        (name !== 'semantic_search' || semanticSearch) &&
        (permission !== 'read-only' ||
          ['semantic_search', 'list_files', 'read_file', 'search', 'problems', 'show_user'].includes(name)),
    )
    .map(([name, description, properties, required]) => ({
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', properties, required, additionalProperties: false },
      },
    }));
}

async function resolvePath(root, relative = '.', create = false) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.length > 1024 ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.split('/').includes('..')
  )
    throw new Error('Paths must be relative to the project root without .. traversal.');
  const target = path.resolve(root, relative);
  let current = root;
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const real = await fs.realpath(current);
      if (real !== root && !real.startsWith(root + path.sep))
        throw new Error('Path resolves outside the project root.');
      // Use canonical file paths in events, including for in-root links.
      current = real;
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      // A dangling link is not a missing path that can safely be created.
      const stat = await fs.lstat(current).catch(e => {
        if (e.code !== 'ENOENT') throw e;
      });
      if (stat?.isSymbolicLink()) throw new Error('Cannot write through a dangling symlink.');
    }
  }
  return { absolute: current, relative: path.relative(root, current).split(path.sep).join('/') };
}

function runProcess(bin, args, { root, signal, env = process.env }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !privateEnv(name)));
    const child = spawn(bin, args, {
      cwd: root,
      env: childEnv,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      timedOut = false;
    const kill = () => {
      if (process.platform === 'win32') {
        if (child.pid)
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
      } else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    };
    const aborted = () => kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, 120000);
    const collect = data => {
      output = clip(output + data.toString());
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) kill();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
    };
    child.on('error', error => {
      cleanup();
      reject(error);
    });
    child.on('close', code => {
      cleanup();
      if (signal.aborted) return reject(signal.reason);
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        output: clip(output + (timedOut ? '\nCommand timed out after 120 seconds.' : '')),
      });
    });
  });
}

async function prepareTool(root, name, input, permission, semanticSearch, signal, debug, show) {
  if (name === 'show_user' && show) return showTools.prepare(input, { root, resolvePath });
  if (debug && [...debugTools.definitions, ...problemsTools.definitions].some(d => d[0] === name)) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Tool arguments must be an object.');
    if (permission === 'read-only' && name !== 'problems') throw new Error('This chat is read-only.');
    return name === 'problems' ? problemsTools.prepare(input) : debugTools.prepare(name, input, debug);
  }
  if (!names.includes(name))
    throw new Error(
      `Unknown tool ${name}. Available tools: ${toolsFor(permission, !!semanticSearch)
        .map(t => t.function.name)
        .join(', ')}`,
    );
  if (name === 'semantic_search' && !semanticSearch) throw new Error('Build the atlas first.');
  if (!toolsFor(permission, !!semanticSearch).some(t => t.function.name === name))
    throw new Error('This chat is read-only.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be an object.');
  const definition = definitions.find(d => d[0] === name);
  for (const key of definition[3]) if (typeof input[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (name === 'semantic_search') {
    if (!input.query.trim() || input.query.length > 4000) throw new Error('Enter a query of 1 to 4000 characters.');
    const { results } = await semanticSearch(input.query, signal);
    signal?.throwIfAborted();
    return { action: 'search', files: [...new Set(results.map(r => r.file))], results };
  }
  if (name === 'run_command') {
    if (!input.command.trim() || input.command.length > 100000)
      throw new Error('Command must contain 1 to 100,000 characters.');
    return { action: 'command', files: [], command: input.command };
  }
  const file = await resolvePath(root, input.path ?? '.', name === 'write_file');
  // Git metadata and hook folders run code outside the command approval, so edits never reach them.
  if (
    (name === 'write_file' || name === 'replace_in_file') &&
    file.relative
      .toLowerCase()
      .split('/')
      .some(part => ['.git', '.husky', '.githooks'].includes(part))
  )
    throw new Error('Editing git metadata or hook folders is not allowed.');
  const exists = await fs.stat(file.absolute).then(
    () => true,
    error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  return {
    ...file,
    files: file.relative ? [file.relative] : [],
    action:
      name === 'write_file'
        ? exists
          ? 'edit'
          : 'create'
        : name === 'replace_in_file'
          ? 'edit'
          : name === 'search'
            ? 'search'
            : 'read',
  };
}

async function executeTool(name, input, prepared, { root, signal, permission, approve, env, debug, show }) {
  if (name === 'show_user' && show) return showTools.execute(input, prepared, { root, resolvePath, show, signal });
  if (debug && (name === 'problems' || debugTools.definitions.some(d => d[0] === name))) {
    if (permission === 'read-only' && name !== 'problems')
      return { ok: false, denied: true, output: 'This chat is read-only.' };
    return name === 'problems'
      ? problemsTools.execute(input, { debug, signal })
      : debugTools.execute(name, input, prepared, { debug, root, signal, permission, approve });
  }
  signal.throwIfAborted();
  const file = prepared.absolute;
  switch (name) {
    case 'semantic_search':
      return {
        ok: true,
        output:
          prepared.results.map(r => `${r.file}:${r.line} ${r.name} — ${r.summary} (${r.role}, ${r.risk})`).join('\n') ||
          'No matching functions.',
      };
    case 'list_files': {
      const entries = [];
      async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          signal.throwIfAborted();
          if (['.git', 'node_modules'].includes(entry.name) || entry.isSymbolicLink()) continue;
          if (entries.length >= 400) return;
          const full = path.join(dir, entry.name);
          entries.push(path.relative(root, full).split(path.sep).join('/') + (entry.isDirectory() ? '/' : ''));
          if (entry.isDirectory()) await walk(full);
        }
      }
      await walk(file);
      return {
        ok: true,
        output:
          entries.join('\n') + (entries.length === 400 ? '\n[400 entry limit; list a subdirectory to continue]' : ''),
      };
    }
    case 'read_file': {
      const start = input.start_line ?? 1;
      const end = input.end_line ?? start + 399;
      if (!Number.isInteger(start) || start < 1 || !Number.isInteger(end) || end < start)
        throw new Error('Use positive line numbers with end_line >= start_line.');
      const lines = (await fs.readFile(file, 'utf8')).split('\n');
      const stop = Math.min(end, start + 399, lines.length);
      const output = [];
      let next = start,
        bytes = 0;
      while (next <= stop) {
        const line = `${next}: ${clip(lines[next - 1], 7000)}`;
        if (bytes + Buffer.byteLength(line) > 7600) break;
        output.push(line);
        bytes += Buffer.byteLength(line) + 1;
        next++;
      }
      return {
        ok: true,
        output: output.join('\n') + (next <= lines.length ? `\nContinue with start_line: ${next}.` : ''),
      };
    }
    case 'search': {
      const relative = prepared.relative || '.';
      let result;
      try {
        result = await runProcess(
          'rg',
          [
            '-n',
            '--no-config',
            '--no-follow',
            '--glob',
            '!.git/**',
            '--glob',
            '!node_modules/**',
            '--glob',
            '!**/.git/**',
            '--glob',
            '!**/node_modules/**',
            '--',
            input.pattern,
            relative,
          ],
          { root, signal, env },
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        result = await runProcess(
          'grep',
          ['-rnE', '--exclude-dir=.git', '--exclude-dir=node_modules', '--', input.pattern, relative],
          { root, signal, env },
        );
      }
      return { ...result, ok: result.ok || result.exitCode === 1 };
    }
    case 'replace_in_file': {
      if (!input.old_text) throw new Error('old_text must be nonempty (match count is undefined for empty text).');
      const before = await fs.readFile(file, 'utf8');
      let count = 0,
        at = 0;
      while ((at = before.indexOf(input.old_text, at)) !== -1) {
        count++;
        at++;
      }
      if (count !== 1) throw new Error(`old_text matched ${count} times; expected exactly 1.`);
      signal.throwIfAborted();
      await fs.writeFile(
        file,
        before.replace(input.old_text, () => input.new_text),
      );
      await debug?.problems.fileChanged({ projectId: debug.projectId, path: prepared.relative });
      return { ok: true, output: 'File edited.' };
    }
    case 'write_file':
      await fs.mkdir(path.dirname(file), { recursive: true });
      signal.throwIfAborted();
      await fs.writeFile(file, input.content);
      await debug?.problems.fileChanged({ projectId: debug.projectId, path: prepared.relative });
      return { ok: true, output: prepared.action === 'create' ? 'File created.' : 'File edited.' };
    case 'run_command':
      if (permission !== 'full-access' && !(await approve(input.command)))
        return { ok: false, denied: true, output: 'the user denied this command' };
      signal.throwIfAborted();
      return runProcess(
        env.SHELL || (process.platform === 'win32' ? env.ComSpec || 'cmd.exe' : '/bin/sh'),
        process.platform === 'win32' ? ['/d', '/s', '/c', input.command] : ['-c', input.command],
        { root, signal, env },
      );
  }
}
module.exports = { clip, toolsFor, resolvePath, prepareTool, executeTool };
