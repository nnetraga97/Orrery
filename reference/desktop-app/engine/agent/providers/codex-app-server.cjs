// Private stdio connection to the Codex app-server. This module does not read
// credentials, open login URLs, choose approval answers, or retry mutations.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { terminate } = require('../../shared/processes.cjs');

// Windows keeps the variable as `Path`, and a copied env object loses its case-insensitive lookup.
const envPath = env => env.PATH ?? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';

// npm installs Codex on Windows as a `codex.cmd` shim next to its package. Prefer the
// package's native executable, which can be spawned without a shell.
function nativeBesideShim(shim, arch = process.arch) {
  const triple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const candidate = path.join(
    path.dirname(shim),
    'node_modules',
    '@openai',
    'codex',
    'vendor',
    triple,
    'codex',
    'codex.exe',
  );
  return fs.existsSync(candidate) ? candidate : null;
}

function resolveCodexBinary(bin, env = process.env, platform = process.platform) {
  if (bin || env.GALAXY_CODEX_BIN) return bin || env.GALAXY_CODEX_BIN;
  const windows = platform === 'win32';
  // On Windows an extensionless `codex` is npm's POSIX shell script, not an executable.
  const names = windows ? ['codex.exe', 'codex.cmd'] : ['codex'];
  const directories = envPath(env)
    .split(windows ? ';' : path.delimiter)
    .filter(Boolean);
  if (windows && env.APPDATA) directories.push(path.join(env.APPDATA, 'npm'));
  // An existing terminal does not pick up PATH entries added by the Codex installer.
  // Find its per-user Windows installation directly, as we do for app installs on macOS.
  if (windows) {
    const localAppData = env.LOCALAPPDATA || (env.USERPROFILE && path.join(env.USERPROFILE, 'AppData', 'Local'));
    if (localAppData) directories.push(path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'));
  }
  const candidates = directories.flatMap(directory => names.map(name => path.join(directory, name)));
  if (platform === 'darwin')
    candidates.push(
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      '/Applications/Codex.app/Contents/Resources/codex',
    );
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (!fs.statSync(candidate).isFile()) continue;
      if (windows && /\.cmd$/i.test(candidate)) return nativeBesideShim(candidate) || candidate;
      return candidate;
    } catch {}
  }
  return windows ? 'codex.exe' : 'codex';
}

function transportError(message, code = 'CODEX_TRANSPORT_ERROR') {
  return Object.assign(new Error(message), { code });
}

function createCodexAppServer(options = {}) {
  const env = { ...process.env, ...options.env };
  const requestTimeoutMs = options.requestTimeoutMs ?? 60000;
  const initializeTimeoutMs = options.initializeTimeoutMs ?? 15000;
  const maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024;
  const maxPending = options.maxPending ?? 256;
  let state = 'idle',
    current = null,
    startPromise = null,
    closePromise = null;
  let closed = false,
    nextId = 0,
    lastError = null,
    serverInfo = null;
  const pending = new Map(),
    incoming = new Map();

  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    incoming.clear();
  }

  function stopRun(run) {
    if (run && !run.exited) terminate(run.child, { group: run.grouped, graceMs: 1500 });
  }

  function fail(run, error) {
    if (current !== run || run.failure) return;
    run.failure = error;
    lastError = error.message;
    options.trace?.('codex-connection-failed', { code: error.code });
    if (!closed) state = 'failed';
    rejectPending(error);
    stopRun(run);
  }

  function write(message) {
    if (closed) throw transportError('Codex app-server connection is closed.', 'CODEX_CLOSED');
    const run = current;
    if (!run || run.exited || run.failure || !run.child.stdin.writable)
      throw transportError('Codex app-server is not connected.', 'CODEX_DISCONNECTED');
    const line = JSON.stringify(message) + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > maxFrameBytes)
      throw transportError('Codex request exceeds the message size limit.', 'CODEX_FRAME_TOO_LARGE');
    if (run.child.stdin.writableLength + bytes > maxFrameBytes * 2)
      throw transportError('Codex request queue is full.', 'CODEX_BACKPRESSURE');
    run.child.stdin.write(line, error => {
      if (error) fail(run, transportError('Could not write to Codex app-server.', 'CODEX_WRITE_FAILED'));
    });
  }

  function rawRequest(method, params, timeoutMs) {
    if (pending.size >= maxPending)
      return Promise.reject(transportError('Too many Codex requests are pending.', 'CODEX_BACKPRESSURE'));
    const id = `galaxy-${++nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(id);
          // A timeout is an unknown result, never a reason to resend a mutation.
          reject(transportError(`Codex request timed out: ${method}.`, 'CODEX_TIMEOUT'));
        },
        Math.max(1, timeoutMs),
      );
      pending.set(id, { resolve, reject, timer });
      try {
        write({ id, method, params: params ?? {} });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function respond(id, result) {
    if (!incoming.has(id)) return false;
    write({ id, result: result ?? null });
    incoming.delete(id);
    return true;
  }

  function reject(id, error = {}) {
    if (!incoming.has(id)) return false;
    const detail = {
      code: Number.isInteger(error.code) ? error.code : -32603,
      message: error.message || 'Client could not handle this request.',
    };
    if (error.data !== undefined) detail.data = error.data;
    write({ id, error: detail });
    incoming.delete(id);
    return true;
  }

  function callbackFailure(run, id, token) {
    // Do not forward callback exception text: it can contain provider payloads.
    if (current !== run || run.exited || run.failure || incoming.get(id) !== token) return;
    try {
      reject(id, { code: -32603, message: 'Client could not handle this request.' });
    } catch {}
  }

  function dispatch(run, line) {
    if (current !== run || run.failure || !line.length) return;
    const text = line.toString('utf8').trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      fail(run, transportError('Codex app-server sent invalid JSON.', 'CODEX_PROTOCOL_ERROR'));
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      fail(run, transportError('Codex app-server sent an invalid message.', 'CODEX_PROTOCOL_ERROR'));
      return;
    }
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && typeof message.id !== 'string' && typeof message.id !== 'number') {
      fail(run, transportError('Codex app-server sent an invalid request identifier.', 'CODEX_PROTOCOL_ERROR'));
      return;
    }
    if (typeof message.method === 'string') {
      if (hasId) {
        if (incoming.has(message.id) || incoming.size >= maxPending) {
          fail(run, transportError('Codex app-server exceeded pending request limits.', 'CODEX_PROTOCOL_ERROR'));
          return;
        }
        const token = {};
        incoming.set(message.id, token);
        if (!options.onRequest) {
          try {
            reject(message.id, { code: -32601, message: 'This client does not support that request.' });
          } catch {
            fail(run, transportError('Could not respond to Codex app-server.', 'CODEX_WRITE_FAILED'));
          }
          return;
        }
        const responder = Object.create(api);
        responder.respond = (id, result) =>
          current === run && !run.exited && !run.failure && incoming.get(id) === token ? respond(id, result) : false;
        responder.reject = (id, error) =>
          current === run && !run.exited && !run.failure && incoming.get(id) === token ? reject(id, error) : false;
        try {
          Promise.resolve(options.onRequest(message, responder)).catch(() => callbackFailure(run, message.id, token));
        } catch {
          callbackFailure(run, message.id, token);
        }
      } else {
        // Turn interruption or another connected client may resolve an
        // approval before this client answers it. Such answers are now stale.
        if (message.method === 'serverRequest/resolved') incoming.delete(message.params?.requestId);
        // Listener bugs must not interrupt RPC decoding or lose a later response.
        try {
          Promise.resolve(options.onNotification?.(message)).catch(() => {});
        } catch {}
      }
    } else if (hasId && (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))) {
      const entry = pending.get(message.id);
      if (!entry) return; // Late response to a timed-out request; do not replay it.
      clearTimeout(entry.timer);
      pending.delete(message.id);
      if (message.error) {
        const error = transportError(
          typeof message.error.message === 'string' ? message.error.message : 'Codex request failed.',
          message.error.code ?? 'CODEX_RPC_ERROR',
        );
        if (message.error.data !== undefined) error.data = message.error.data;
        entry.reject(error);
      } else entry.resolve(message.result);
    } else fail(run, transportError('Codex app-server sent an unrecognized message.', 'CODEX_PROTOCOL_ERROR'));
  }

  function consume(run, chunk) {
    // Work one line at a time so multiple valid messages in a chunk do not hit
    // the per-message limit. Partial UTF-8 bytes stay intact until JSON parse.
    let offset = 0;
    while (offset < chunk.length && !run.failure) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      run.frameBytes += part.length;
      if (run.frameBytes > maxFrameBytes) {
        fail(run, transportError('Codex response exceeds the message size limit.', 'CODEX_FRAME_TOO_LARGE'));
        return;
      }
      if (part.length) run.parts.push(part);
      if (newline < 0) break;
      const line = Buffer.concat(run.parts, run.frameBytes);
      run.parts = [];
      run.frameBytes = 0;
      dispatch(run, line);
      offset = newline + 1;
    }
  }

  function ensure() {
    if (closed) return Promise.reject(transportError('Codex app-server connection is closed.', 'CODEX_CLOSED'));
    if (state === 'ready') return Promise.resolve(serverInfo);
    if (startPromise) return startPromise;
    if (current && !current.exited)
      return Promise.reject(
        transportError('Codex app-server is stopping. Try again after it exits.', 'CODEX_DISCONNECTED'),
      );
    state = 'starting';
    lastError = null;
    startPromise = (async () => {
      const startedAt = Date.now();
      let child;
      const grouped = process.platform !== 'win32';
      try {
        // Resolve on each connection attempt so Retry can find a newly installed CLI.
        const bin = resolveCodexBinary(options.bin, env);
        options.trace?.('codex-connection-starting', { executable: bin });
        // Node only runs .cmd/.bat files through cmd.exe. The arguments are fixed, so only the
        // (quoted) path reaches the shell.
        const script = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
        child = spawn(script ? `"${bin}"` : bin, ['app-server', '--listen', 'stdio://'], {
          cwd: options.cwd,
          env,
          detached: grouped,
          shell: script,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        state = 'failed';
        throw transportError(
          'Could not start Codex CLI. Check its installation and configured path.',
          'CODEX_SPAWN_FAILED',
        );
      }
      let finishExit;
      const run = (current = {
        child,
        grouped,
        parts: [],
        frameBytes: 0,
        stderrBytes: 0,
        exited: false,
        failure: null,
        exitPromise: new Promise(resolve => {
          finishExit = resolve;
        }),
      });
      child.stdout.on('data', chunk => consume(run, chunk));
      child.stdout.on('error', () =>
        fail(run, transportError('Codex app-server output closed unexpectedly.', 'CODEX_READ_FAILED')),
      );
      child.stdout.on('end', () => {
        if (run.frameBytes && !run.failure) {
          const line = Buffer.concat(run.parts, run.frameBytes);
          run.parts = [];
          run.frameBytes = 0;
          dispatch(run, line);
        }
      });
      // Drain stderr, retaining no text (it may include account/login material).
      child.stderr.on('data', chunk => {
        run.stderrBytes = Math.min(Number.MAX_SAFE_INTEGER, run.stderrBytes + chunk.length);
      });
      child.stderr.on('error', () => {});
      child.stdin.on('error', () => fail(run, transportError('Codex app-server input closed.', 'CODEX_WRITE_FAILED')));
      child.on('error', error =>
        fail(
          run,
          transportError(
            error.code === 'ENOENT'
              ? 'Codex CLI was not found. Install Codex or set GALAXY_CODEX_BIN.'
              : 'Could not start Codex CLI. Check its installation and configured path.',
            'CODEX_SPAWN_FAILED',
          ),
        ),
      );
      child.on('close', (code, signal) => {
        options.trace?.('codex-connection-exited', { code, signal, intentional: closed });
        run.exited = true;
        run.parts = [];
        run.frameBytes = 0;
        if (current === run) {
          if (!closed && !run.failure) {
            const error = transportError(
              `Codex app-server exited${signal ? ` (${signal})` : ` (code ${code})`}.`,
              'CODEX_EXITED',
            );
            lastError = error.message;
            rejectPending(error);
          }
          state = closed ? 'closed' : 'failed';
        }
        finishExit({ code, signal });
        try {
          Promise.resolve(options.onExit?.({ code, signal, error: run.failure || undefined })).catch(() => {});
        } catch {}
      });
      try {
        serverInfo = await rawRequest(
          'initialize',
          {
            clientInfo: options.clientInfo || { name: 'codebase_viz', title: 'Codebase Galaxy', version: '0.1.0' },
            capabilities: options.capabilities ?? { experimentalApi: false, requestAttestation: false },
          },
          initializeTimeoutMs,
        );
        if (closed) throw transportError('Codex app-server connection is closed.', 'CODEX_CLOSED');
        write({ method: 'initialized' });
        state = 'ready';
        options.trace?.('codex-connection-ready', { durationMs: Date.now() - startedAt });
        return serverInfo;
      } catch (error) {
        fail(run, error);
        throw error;
      }
    })().finally(() => {
      startPromise = null;
    });
    return startPromise;
  }

  async function request(method, params, requestOptions = {}) {
    if (typeof method !== 'string' || !method || method.length > 256)
      throw new TypeError('Codex request method must be a nonempty string.');
    if (method === 'initialize' || method === 'initialized')
      throw new TypeError('The transport manages the Codex initialization handshake.');
    await ensure();
    return rawRequest(method, params, requestOptions.timeoutMs ?? requestTimeoutMs);
  }

  function close() {
    if (closePromise) return closePromise;
    closed = true;
    state = 'closing';
    rejectPending(transportError('Codex app-server connection closed.', 'CODEX_CLOSED'));
    closePromise = (async () => {
      const run = current;
      if (run && !run.exited) {
        stopRun(run);
        await run.exitPromise;
      }
      state = 'closed';
    })();
    return closePromise;
  }

  const api = {
    ensure,
    start: ensure,
    request,
    respond,
    reject,
    close,
    get status() {
      return {
        state,
        pid: current && !current.exited ? current.child.pid : null,
        lastError,
        pendingRequests: pending.size,
        pendingApprovals: incoming.size,
      };
    },
  };
  return api;
}

module.exports = { createCodexAppServer, resolveCodexBinary };
