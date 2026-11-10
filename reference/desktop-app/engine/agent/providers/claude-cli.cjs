// Private stdio connection to the user's installed Claude Code CLI in headless stream-json mode
// (the protocol the Claude Agent SDK speaks). One process serves one conversation. This module
// does not read credentials, choose approval answers, or retry turns.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { terminate } = require('../../shared/processes.cjs');

// Windows keeps the variable as `Path`, and a copied env object loses its case-insensitive lookup.
const envPath = env => env.PATH ?? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';

// npm installs Claude Code on Windows as a `claude.cmd` shim. Prefer a native executable or the
// package's JavaScript entry point beside it, either of which can be spawned without a shell.
function besideShim(shim) {
  const dir = path.join(path.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code');
  for (const candidate of [path.join(dir, 'bin', 'claude.exe'), path.join(dir, 'claude.exe'), path.join(dir, 'cli.js')])
    if (fs.existsSync(candidate)) return candidate;
  return null;
}

function resolveClaudeBinary(bin, env = process.env, platform = process.platform) {
  if (bin || env.GALAXY_CLAUDE_BIN) return bin || env.GALAXY_CLAUDE_BIN;
  const windows = platform === 'win32';
  const home = env.USERPROFILE || env.HOME || os.homedir();
  // On Windows an extensionless `claude` is npm's POSIX shell script, not an executable.
  const names = windows ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const directories = envPath(env)
    .split(windows ? ';' : path.delimiter)
    .filter(Boolean);
  // The native installer's location, which a GUI-launched app's PATH often lacks.
  directories.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'));
  if (windows && env.APPDATA) directories.push(path.join(env.APPDATA, 'npm'));
  if (platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const candidate of directories.flatMap(directory => names.map(name => path.join(directory, name)))) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      if (windows && /\.cmd$/i.test(candidate)) return besideShim(candidate) || candidate;
      return candidate;
    } catch {}
  }
  return windows ? 'claude.exe' : 'claude';
}

// How to start `bin`: a .js entry runs on Electron's own Node; a .cmd shim needs cmd.exe.
function command(bin, args) {
  if (/\.m?js$/i.test(bin)) return { file: process.execPath, args: [bin, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    // Only validated identifiers reach cmd.exe; refuse anything it could interpret.
    if (args.some(arg => !/^[\w.:=\-[\]/]+$/.test(arg))) throw new Error('Unsafe argument for the Claude CLI shim.');
    return { file: `"${bin}"`, args, shell: true };
  }
  return { file: bin, args };
}

// The parent app may itself run inside Claude Code; do not hand that session's identity to the child.
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_AGENT_SDK_VERSION'])
    delete env[key];
  return env;
}

/** `claude auth status --json`: { loggedIn, authMethod, email, ... }. Rejects when the CLI is missing. */
function claudeAuthStatus({ bin, env, timeoutMs = 15000 } = {}) {
  const resolved = resolveClaudeBinary(bin, { ...process.env, ...env });
  const run = command(resolved, ['auth', 'status', '--json']);
  return new Promise((resolve, reject) => {
    execFile(
      run.file,
      run.args,
      { env: childEnv({ ...env, ...run.env }), shell: run.shell, timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        let parsed = null;
        try {
          parsed = JSON.parse(String(stdout).trim());
        } catch {}
        // A signed-out CLI reports its state on stdout and exits nonzero.
        if (parsed && typeof parsed === 'object') return resolve(parsed);
        reject(
          Object.assign(
            new Error(
              error?.code === 'ENOENT'
                ? 'Claude Code was not found. Install it or set GALAXY_CLAUDE_BIN.'
                : 'Could not read Claude Code sign-in status.',
            ),
            { code: error?.code === 'ENOENT' ? 'CLAUDE_NOT_FOUND' : 'CLAUDE_STATUS_FAILED' },
          ),
        );
      },
    );
  });
}

/**
 * Starts `claude -p` with stream-json input and output. Messages other than control traffic go to
 * onMessage; tool permission prompts arrive at onControlRequest and must be answered with
 * respond()/reject(). request() sends a control request (initialize, interrupt) and awaits its answer.
 */
function createClaudeProcess(options) {
  const { cwd, onMessage = () => {}, onControlRequest, onExit = () => {} } = options;
  const bin = resolveClaudeBinary(options.bin, { ...process.env, ...options.env });
  const maxFrameBytes = options.maxFrameBytes ?? 32 * 1024 * 1024;
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];
  args.push('--include-partial-messages', '--permission-prompt-tool', 'stdio');
  args.push(...(options.args || []));
  const run = command(bin, args);
  const grouped = process.platform !== 'win32';
  const pending = new Map(),
    incoming = new Set();
  let exited = false,
    failure = null,
    parts = [],
    frameBytes = 0;
  const child = spawn(run.file, run.args, {
    cwd,
    env: childEnv({ ...options.env, ...run.env }),
    detached: grouped,
    shell: !!run.shell,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let finishExit;
  const exitPromise = new Promise(resolve => (finishExit = resolve));

  function fail(error) {
    if (failure || exited) return;
    failure = error;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    terminate(child, { group: grouped, graceMs: 1500 });
  }
  function write(message) {
    if (exited || failure || !child.stdin.writable) throw new Error('Claude Code is not running.');
    child.stdin.write(JSON.stringify(message) + '\n', error => {
      if (error) fail(new Error('Could not write to Claude Code.'));
    });
  }
  function dispatch(line) {
    const text = line.toString('utf8').trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      // Hooks and plugins may print to stdout; ignore lines that are not protocol messages.
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.type === 'control_response') {
      const response = message.response || {};
      const entry = pending.get(response.request_id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(response.request_id);
      if (response.subtype === 'error')
        entry.reject(new Error(String(response.error || 'Claude Code request failed.')));
      else entry.resolve(response.response ?? {});
    } else if (message.type === 'control_request') {
      const id = message.request_id;
      if (typeof id !== 'string' || incoming.has(id)) return;
      incoming.add(id);
      if (!onControlRequest) return reject(id, 'This client does not handle that request.');
      Promise.resolve()
        .then(() => onControlRequest(message.request || {}, id))
        .catch(() => reject(id, 'Client could not handle this request.'));
    } else if (message.type === 'control_cancel_request') {
      incoming.delete(message.request_id);
      try {
        Promise.resolve(options.onControlCancel?.(message.request_id)).catch(() => {});
      } catch {}
    } else if (message.type !== 'keep_alive') {
      try {
        Promise.resolve(onMessage(message)).catch(() => {});
      } catch {}
    }
  }
  child.stdout.on('data', chunk => {
    let offset = 0;
    while (offset < chunk.length && !failure) {
      const newline = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, newline < 0 ? chunk.length : newline);
      frameBytes += part.length;
      if (frameBytes > maxFrameBytes) return fail(new Error('Claude Code sent a message over the size limit.'));
      if (part.length) parts.push(part);
      if (newline < 0) break;
      const line = Buffer.concat(parts, frameBytes);
      parts = [];
      frameBytes = 0;
      dispatch(line);
      offset = newline + 1;
    }
  });
  child.stdout.on('error', () => fail(new Error('Claude Code output closed unexpectedly.')));
  // Keep only the tail of stderr for an exit message; it never reaches the renderer verbatim.
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk).slice(-2000);
  });
  child.stderr.on('error', () => {});
  child.stdin.on('error', () => fail(new Error('Claude Code input closed.')));
  child.on('error', error =>
    fail(
      new Error(
        error.code === 'ENOENT'
          ? 'Claude Code was not found. Install it or set GALAXY_CLAUDE_BIN.'
          : 'Could not start Claude Code.',
      ),
    ),
  );
  child.on('close', (code, signal) => {
    exited = true;
    const error = failure || new Error(`Claude Code exited${signal ? ` (${signal})` : ` (code ${code})`}.`);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    incoming.clear();
    finishExit({ code, signal });
    try {
      Promise.resolve(onExit({ code, signal, error: failure, stderr })).catch(() => {});
    } catch {}
  });

  function request(payload, { timeoutMs = 30000 } = {}) {
    const id = `galaxy-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Claude Code request timed out: ${payload.subtype}.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        write({ type: 'control_request', request_id: id, request: payload });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  function respond(id, response) {
    if (!incoming.delete(id)) return false;
    write({ type: 'control_response', response: { subtype: 'success', request_id: id, response } });
    return true;
  }
  function reject(id, message) {
    if (!incoming.delete(id)) return false;
    write({ type: 'control_response', response: { subtype: 'error', request_id: id, error: String(message) } });
    return true;
  }
  return {
    pid: child.pid,
    get running() {
      return !exited && !failure;
    },
    request,
    respond,
    reject,
    /** Sends one user turn. `content` is an Anthropic content-block array. */
    send(content, sessionId = '') {
      write({ type: 'user', session_id: sessionId, parent_tool_use_id: null, message: { role: 'user', content } });
    },
    async close() {
      if (!exited) {
        try {
          child.stdin.end();
        } catch {}
        terminate(child, { group: grouped, graceMs: 1500 });
        await exitPromise;
      }
    },
  };
}

module.exports = { createClaudeProcess, claudeAuthStatus, resolveClaudeBinary };
