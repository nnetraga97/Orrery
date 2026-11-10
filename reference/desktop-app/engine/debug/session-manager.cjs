const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const { createInstaller } = require('./adapters/install.cjs');
const java = require('./adapters/java.cjs');
const { scrubEnv, killProcess } = require('./adapters/common.cjs');
const { TYPES, describe, substitute, listConfigurations, readSettings } = require('../launch/configurations.cjs');
const MAX = 2 * 1024 * 1024;
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
const live = s => s && !s.ended && !s.controller.signal.aborted;
// js-debug puts the message in exceptionId; debugpy splits it into typeName and message.
function exceptionText(info, event) {
  const message = info?.details?.message || info?.description;
  const type = info?.details?.typeName?.trim().split(/\s{2,}/)[0];
  if (message) return type && !message.startsWith(type) ? `${type}: ${message}` : message;
  return info?.exceptionId || event.text || event.description || 'Exception';
}
function createDebugManager({
  rootOf,
  userData,
  onChange = () => {},
  personal = {},
  adapters = { js: require('./adapters/js.cjs'), python: require('./adapters/python.cjs'), java },
  installer = createInstaller({ userData }),
}) {
  const jdtls = java.createJdtlsManager({ userData });
  const configured = new Map();
  let current = null,
    generation = 0,
    configurationQueue = Promise.resolve(),
    probeReserved = false,
    launchesPending = 0;
  let state = { driver: 'user', handoff: null, status: 'idle', frames: [], output: '', breakpoints: [], trace: null };
  const publish = patch => {
    state = { ...state, ...patch };
    onChange(state);
    return state;
  };
  const update = (s, patch) => {
    if (current === s) publish(patch);
  };
  const settings = async () => (typeof personal === 'function' ? await personal() : personal);
  async function configurations(projectId, options = {}) {
    return listConfigurations(await fs.realpath(await rootOf(projectId)), await settings(), {
      ...options,
      jdtls,
      adapters: Object.values(adapters),
    });
  }
  async function resolveConfig(config) {
    if (!config || typeof config.projectId !== 'string') throw new Error('A project is required');
    const root = await fs.realpath(await rootOf(config.projectId));
    let entry;
    if (config.entry != null) {
      if (typeof config.entry !== 'string' || !config.entry || config.entry.length > 8192)
        throw new Error('Invalid debug entry');
      entry = await fs.realpath(path.resolve(root, config.entry));
      if (!inside(root, entry) || !(await fs.stat(entry)).isFile())
        throw new Error('Debug entry is outside the project');
    }
    let launch;
    if (typeof config.configuration === 'string') {
      launch = (await configurations(config.projectId, { file: entry })).find(c => c.name === config.configuration);
      if (!launch) throw new Error(`Unknown launch configuration: ${config.configuration}`);
    } else if (config.configuration && typeof config.configuration === 'object')
      launch = describe(substitute(config.configuration, root, { file: entry }), 'personal');
    else {
      if (!entry) throw new Error('Choose a debug entry or launch configuration');
      const adapterKey = Object.keys(adapters).find(key =>
        adapters[key].extensions.includes(path.extname(entry).toLowerCase()),
      );
      if (!adapterKey) throw new Error(`Unsupported debug entry: ${path.extname(entry)}`);
      launch = describe(
        {
          name: config.entry,
          type: { js: 'pwa-node', python: 'python', java: 'java' }[adapterKey],
          program: entry,
          args: config.args || [],
        },
        'detected',
      );
    }
    if (!launch.supported) throw new Error(launch.reason);
    if (config.args != null) launch.args = config.args;
    if (launch.program) {
      if (launch.program.includes('${'))
        throw new Error('Launch program has unresolved variables; supply an entry for ${file}');
      const program = await fs.realpath(path.resolve(root, launch.program));
      if (!inside(root, program) || !(await fs.stat(program)).isFile())
        throw new Error('Debug entry is outside the project');
      launch.program = program;
    }
    if (
      launch.args != null &&
      (!Array.isArray(launch.args) ||
        launch.args.length > 100 ||
        launch.args.some(arg => typeof arg !== 'string' || arg.length > 8192))
    )
      throw new Error('Invalid debug arguments');
    const mode = config.exceptionMode || 'failures';
    if (!['failures', 'all', 'uncaught', 'none'].includes(mode)) throw new Error('Invalid exception mode');
    return { root, launch, adapter: adapters[TYPES[launch.type]], mode };
  }
  async function validateBreakpoints(root, specs) {
    if (!Array.isArray(specs) || specs.length > 128) throw new Error('At most 128 breakpoints are supported');
    const result = [];
    let bytes = 0;
    for (const b of specs) {
      if (
        !b ||
        typeof b.file !== 'string' ||
        typeof b.text !== 'string' ||
        Buffer.byteLength(b.text) > MAX ||
        (bytes += Buffer.byteLength(b.text)) > 8 * MAX ||
        !Number.isInteger(b.line) ||
        b.line < 1 ||
        !Number.isInteger(b.column) ||
        b.column < 1 ||
        !['pause', 'trace'].includes(b.mode)
      )
        throw new Error('Invalid breakpoint');
      const lines = b.text.split('\n');
      if (b.line > lines.length || b.column > lines[b.line - 1].length + 1)
        throw new Error('Breakpoint is outside the supplied source');
      const file = await fs.realpath(path.resolve(root, b.file));
      if (!inside(root, file)) throw new Error('Breakpoint is outside the project');
      const name = relative(root, file),
        id = `${name}:${b.line}:${b.column}`;
      if (!result.some(b => b.id === id)) result.push({ ...b, id, file: name });
    }
    return result;
  }
  function breakpointState(s) {
    return s.breakpoints.map(spec => {
      const bindings = [...s.connections].flatMap(c => [...c.bindings.values()].filter(b => b.spec.id === spec.id));
      return {
        ...spec,
        status:
          s.rejected.get(spec.id) ||
          (bindings.some(b => b.verified) ? 'verified' : bindings.find(b => b.message)?.message || 'pending'),
        locations: bindings
          .filter(b => b.verified)
          .map(b => ({ file: spec.file, line: b.line || spec.line, column: b.column || spec.column })),
      };
    });
  }
  async function bind(s, c) {
    const files = new Set([...c.files, ...s.breakpoints.map(b => b.file)]);
    c.files = new Set(s.breakpoints.map(b => b.file));
    c.bindings.clear();
    for (const file of files) {
      const specs = [];
      for (const b of s.breakpoints.filter(b => b.file === file)) {
        try {
          const absolute = await fs.realpath(path.resolve(s.root, file));
          if (
            !inside(s.root, absolute) ||
            (await fs.stat(absolute)).size > MAX ||
            (await fs.readFile(absolute, 'utf8')) !== b.text
          ) {
            s.rejected.set(b.id, 'stale source');
            continue;
          }
          s.rejected.delete(b.id);
          specs.push(b);
        } catch {
          s.rejected.set(b.id, 'stale source');
        }
      }
      const reply = await c.client.request('setBreakpoints', {
        source: { path: path.resolve(s.root, file) },
        breakpoints: specs.map(b => ({
          // A column makes an inline breakpoint; java-debug then matches nothing on the line.
          line: b.line,
          ...(b.condition ? { condition: b.condition } : {}),
        })),
        sourceModified: false,
      });
      for (let i = 0; i < specs.length; i++) {
        const binding = reply.breakpoints?.[i] || {};
        c.bindings.set(binding.id ?? specs[i].id, {
          ...binding,
          ...c.breakpointUpdates.get(binding.id),
          spec: specs[i],
        });
      }
    }
    update(s, { breakpoints: breakpointState(s) });
  }
  function bindQueued(s, c) {
    const result = c.bindQueue.then(() => bind(s, c));
    c.bindQueue = result.catch(() => {});
    return result;
  }
  function setBreakpoints(projectId, specs, options = {}) {
    const result = configurationQueue.then(async () => {
      if (probeReserved) throw new Error('A debug probe is running');
      if (options.driver === 'agent' && live(current) && state.driver !== 'agent')
        throw new Error('The user is driving this session');
      const root = await fs.realpath(await rootOf(projectId));
      const next = await validateBreakpoints(root, specs);
      if (live(current) && current.projectId !== projectId) throw new Error('Stop the previous debug session first');
      configured.set(projectId, next);
      if (live(current)) {
        publish({ driver: options.driver === 'agent' ? 'agent' : 'user', handoff: null });
        const s = current;
        s.breakpoints = next;
        s.rejected.clear();
        await Promise.all([...s.connections].filter(c => c.ready && !c.terminated).map(c => bindQueued(s, c)));
      } else publish({ projectId, breakpoints: next.map(b => ({ ...b, status: 'pending', locations: [] })) });
      return state.breakpoints;
    });
    configurationQueue = result.catch(() => {});
    return result;
  }
  async function frame(s, c, call, depth, context) {
    let file = call.source?.path || call.source?.name || '(native)',
      text = null,
      local = false;
    try {
      if (file.startsWith('file:')) file = fileURLToPath(file);
      const absolute = await fs.realpath(path.resolve(s.root, file));
      if (inside(s.root, absolute)) {
        file = relative(s.root, absolute);
        const stat = await fs.stat(absolute);
        if (stat.isFile() && stat.size <= MAX) {
          text = await fs.readFile(absolute, 'utf8');
          local = true;
        }
      }
    } catch {}
    const id = `${s.id}:${s.pause}:${c.id}:${depth}`;
    s.frames.set(id, { c, frameId: call.id, file, text, line: call.line || 1 });
    return {
      id,
      name: call.name || '(anonymous)',
      file,
      line: call.line || 1,
      column: call.column || 1,
      depth,
      context,
      mapping: 'adapter',
      text,
      local,
    };
  }
  async function stack(s, c, threadId) {
    const result = await c.client.request('stackTrace', { threadId, startFrame: 0, levels: 256 });
    const frames = [];
    let context = 'sync',
      remaining = 8 * MAX;
    for (const call of result.stackFrames || []) {
      if (call.presentationHint === 'label') {
        context = `async: ${call.name || 'continuation'}`;
        continue;
      }
      const f = await frame(s, c, call, frames.length, context);
      if (f.text) {
        if (Buffer.byteLength(f.text) > remaining) {
          f.text = null;
          f.local = false;
        } else remaining -= Buffer.byteLength(f.text);
      }
      if (frames.length && frames.at(-1).context !== f.context) frames.at(-1).continues = f.id;
      frames.push(f);
    }
    return frames;
  }
  // Adapters spell a lambda's synthetic class as a bare address; it reads as a lambda.
  const typeOf = type => (/^0x[0-9a-f]+$/i.test(type || '') ? 'lambda' : type || '');
  function variable(s, c, value, kind) {
    const type = typeOf(value.type);
    let display = String(value.value ?? value.type ?? '').slice(0, 2000);
    if (type === 'lambda') display = display.replace(/^0x[0-9a-f]+/i, 'λ');
    // Expanding a lazy value runs debuggee code: js-debug's lazy values are getters, so browsing never invokes
    // them. java-debug marks objects whose toString it defers; those already have a value and expand on request.
    if (value.presentationHint?.lazy && !(s.adapter?.id === 'java-debug' && display))
      return { name: value.name || '', display: 'getter · not invoked', handle: null, type, kind };
    let handle = null;
    if (value.variablesReference > 0 && s.handles.size < 4096) {
      handle = randomUUID();
      s.handles.set(handle, { c, reference: value.variablesReference });
    }
    return { name: value.name || '', display, handle, type, kind };
  }
  function pausedSession(session, pause) {
    if (!live(current) || current.id !== session || current.pause !== pause || state.status !== 'paused')
      throw new Error('Pause expired');
    return current;
  }
  const RECEIVERS = new Set(['this', 'self']);
  const isLocalScope = scope =>
    !scope.expensive && (scope.presentationHint === 'locals' || /^(local|block)/i.test(scope.name));
  // A frame's variables, flattened like an IDE: the local scopes' values tagged parameter, local or receiver,
  // parameters first in declaration order; other scopes (closure, globals) stay expandable groups.
  async function scopes(session, pause, frameId) {
    const s = pausedSession(session, pause),
      f = s.frames.get(frameId);
    if (!f) throw new Error('Unknown debug frame');
    const result = await f.c.client.request('scopes', { frameId: f.frameId });
    pausedSession(session, pause);
    return (result.scopes || []).map(scope => variable(s, f.c, scope, 'scope'));
  }
  async function frameVariables(session, pause, frameId) {
    const s = pausedSession(session, pause),
      f = s.frames.get(frameId);
    if (!f) throw new Error('Unknown debug frame');
    const result = await f.c.client.request('scopes', { frameId: f.frameId });
    pausedSession(session, pause);
    const all = result.scopes || [],
      locals = all.filter(isLocalScope);
    const [params, lists] = await Promise.all([
      locals.length ? import('./parameters.mjs').then(m => m.parameterNames(f.file, f.text, f.line)) : null,
      Promise.all(
        locals.map(scope => f.c.client.request('variables', { variablesReference: scope.variablesReference })),
      ),
    ]);
    pausedSession(session, pause);
    const names = new Set(params || []),
      order = name => (params || []).indexOf(name);
    const values = lists.flatMap(list => list.variables || []).slice(0, 200);
    const kindOf = v => (RECEIVERS.has(v.name) ? 'receiver' : names.has(v.name) ? 'parameter' : 'local');
    const rank = { parameter: 0, local: 1, receiver: 2 };
    const flat = values
      .map((v, i) => ({ v, i, kind: kindOf(v) }))
      .sort(
        (a, b) =>
          rank[a.kind] - rank[b.kind] || (a.kind === 'parameter' ? order(a.v.name) - order(b.v.name) : a.i - b.i),
      )
      .map(({ v, kind }) => variable(s, f.c, v, kind));
    return [...flat, ...all.filter(scope => !locals.includes(scope)).map(scope => variable(s, f.c, scope, 'scope'))];
  }
  async function evaluate(session, pause, frameId, expression, options = {}) {
    const s = pausedSession(session, pause),
      f = s.frames.get(frameId);
    if (!f) throw new Error('Unknown debug frame');
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 100000)
      throw new Error('Invalid debug expression');
    // An observer (the agent asked about the user's pause) evaluates without taking over the session.
    if (options.driver === 'agent' && state.driver !== 'agent' && !options.observe)
      throw new Error('The user is driving this session');
    if (!options.observe) publish({ driver: options.driver === 'agent' ? 'agent' : 'user', handoff: null });
    const result = await f.c.client.request('evaluate', { frameId: f.frameId, expression, context: 'repl' });
    pausedSession(session, pause);
    const value = variable(s, f.c, { ...result, value: result.result });
    return { display: value.display, type: result.type, handle: value.handle };
  }
  function handoff(message) {
    pausedSession(state.session, state.pause);
    if (typeof message !== 'string' || !message.trim()) throw new Error('A hand-off message is required');
    return publish({ driver: 'user', handoff: { message: message.slice(0, 4000), time: Date.now() } });
  }
  async function properties(session, pause, handle) {
    const s = pausedSession(session, pause),
      value = s.handles.get(handle);
    if (!value) throw new Error('Unknown variable handle');
    const result = await value.c.client.request('variables', { variablesReference: value.reference });
    pausedSession(session, pause);
    return {
      values: (result.variables || [])
        .slice(0, 200)
        .map(v => variable(s, value.c, v, /^\[?\d+\]?$/.test(v.name || '') ? 'index' : 'field')),
      truncated: (result.variables || []).length > 200,
    };
  }
  async function locals(c, frameId) {
    const { scopes = [] } = await c.client.request('scopes', { frameId });
    const local =
      scopes.find(scope => scope.presentationHint === 'locals' || /local/i.test(scope.name)) ||
      scopes.find(scope => !scope.expensive);
    if (!local) return [];
    const { variables = [] } = await c.client.request('variables', { variablesReference: local.variablesReference });
    return variables.slice(0, 20).map(v => ({ name: v.name, value: String(v.value).slice(0, 300), type: v.type }));
  }
  async function resume(s, c, threadId, action = 'continue') {
    s.handles.clear();
    s.frames.clear();
    update(s, { status: 'running', frames: [], exception: null });
    await c.client.request(action, { threadId });
  }
  async function stopped(s, c, event) {
    if (!live(s) || current !== s) return;
    ++s.pause;
    s.handles.clear();
    s.frames.clear();
    s.active = c;
    c.threadId = event.threadId;
    if (!s.report?.timings.firstStopMs) {
      if (s.report) s.report.timings.firstStopMs = Date.now() - s.started;
    }
    const frames = await stack(s, c, event.threadId);
    if (!live(s) || current !== s) return;
    const top = frames[0],
      call = top && s.frames.get(top.id);
    let exceptionInfo = null;
    if (event.reason === 'exception') {
      try {
        exceptionInfo = await c.client.request('exceptionInfo', { threadId: event.threadId });
      } catch {}
    }
    const exception = event.reason === 'exception' ? exceptionText(exceptionInfo, event) : null;
    const hit = (event.hitBreakpointIds || []).map(id => c.bindings.get(id)?.spec).filter(Boolean);
    if (!hit.length && top)
      hit.push(...s.breakpoints.filter(b => b.file === top.file && b.line === top.line && !s.rejected.has(b.id)));
    const trace = top ? { ...top, sequence: ++s.traceSequence, time: Date.now() } : null;
    if (s.report) {
      // A probe never pauses for the user, but its ship still visits each stop so the run can be followed.
      if (top?.local) update(s, { trace, pause: s.pause });
      if (exception && !top?.local) s.report.externalExceptions++;
      else if (exception && !s.report.exception)
        s.report.exception = {
          message: exception,
          exceptionInfo,
          frames: frames.slice(0, 5),
          locals: call ? await locals(c, call.frameId) : [],
        };
      else if (!exception && hit.length && call) {
        const expressions = [];
        for (const expression of [...new Set(hit.flatMap(b => b.expressions || []))]) {
          try {
            const value = await c.client.request('evaluate', { expression, frameId: call.frameId, context: 'watch' });
            expressions.push({ expression, value: String(value.result).slice(0, 300), type: value.type });
          } catch (error) {
            expressions.push({ expression, value: null, type: null, error: error.message });
          }
        }
        s.report.hits.push({
          file: top.file,
          line: top.line,
          frames: frames.slice(0, 5),
          locals: await locals(c, call.frameId),
          expressions,
        });
        if (s.report.hits.length >= s.hitCap) {
          s.finish('hitCap');
          return;
        }
      }
      await resume(s, c, event.threadId);
      return;
    }
    if (!exception && hit.length && hit.every(b => b.mode === 'trace')) {
      update(s, { trace, pause: s.pause });
      await resume(s, c, event.threadId);
      return;
    }
    update(s, {
      status: 'paused',
      pause: s.pause,
      frames,
      exception,
      trace,
      reason: event.reason,
      selected: 0,
      hitBreakpoints: hit.map(b => b.id),
    });
  }
  function fail(s, error) {
    if (current !== s || !live(s)) return;
    update(s, { error: error.message, status: 'error' });
    s.failure = error;
    s.finish?.('error');
    void cleanup(s);
  }
  function maybeExited(s) {
    if (!live(s) || s.pendingChildren || !s.connections.size || ![...s.connections].every(c => c.terminated)) return;
    s.ended = true;
    update(s, {
      status: 'exited',
      frames: [],
      exception: null,
      ...(s.exitCode != null ? { exitCode: s.exitCode } : {}),
    });
    s.finish?.('exited');
    void cleanup(s);
  }
  async function attach(s, client, launch, request = 'launch') {
    if (!live(s)) {
      client.close();
      return;
    }
    const c = {
      id: randomUUID(),
      client,
      files: new Set(),
      bindings: new Map(),
      breakpointUpdates: new Map(),
      bindQueue: Promise.resolve(),
      ready: false,
      terminated: false,
    };
    s.connections.add(c);
    client.onRequest = async (command, args) => {
      if (command !== 'startDebugging' || !s.connect) throw new Error(`Unsupported reverse request: ${command}`);
      ++s.pendingChildren;
      return {
        afterResponse: () => {
          void (async () => {
            const child = await s.connect();
            await attach(s, child, args.configuration, args.request || 'launch');
          })()
            .catch(error => fail(s, error))
            .finally(() => {
              --s.pendingChildren;
              maybeExited(s);
            });
        },
      };
    };
    client.on('process', event => {
      const pid = event.systemProcessId;
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && !jdtls.pids().includes(pid))
        s.debuggeePids.add(pid);
    });
    client.on('output', event => {
      s.output = (s.output + (event.output || '')).slice(-32000);
      update(s, { output: s.output });
    });
    client.on('breakpoint', event => {
      if (event.breakpoint?.id != null) c.breakpointUpdates.set(event.breakpoint.id, event.breakpoint);
      const binding = c.bindings.get(event.breakpoint?.id);
      if (binding) {
        Object.assign(binding, event.breakpoint);
        update(s, { breakpoints: breakpointState(s) });
      }
    });
    client.on('stopped', event => {
      s.stopQueue = s.stopQueue.then(() => stopped(s, c, event)).catch(error => fail(s, error));
    });
    client.on('continued', () => {
      if (s.active === c && live(s)) {
        s.handles.clear();
        s.frames.clear();
        update(s, { status: 'running', frames: [], exception: null });
      }
    });
    client.on('exited', event => {
      if (Number.isInteger(event.exitCode)) s.exitCode = event.exitCode;
    });
    client.on('terminated', () => {
      c.terminated = true;
      maybeExited(s);
    });
    client.on('close', error => {
      if (!c.terminated && live(s)) fail(s, error);
    });
    // Adapters may send initialized in the same chunk as the initialize response, so listen first.
    const initialized = client.waitFor('initialized', 30000);
    initialized.catch(() => {});
    const capabilities = await client.request('initialize', {
      clientID: 'codebase-galaxy',
      adapterID: s.adapter.id,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false,
      supportsStartDebuggingRequest: true,
    });
    const launched = client.request(request, launch, 60000);
    // Observe both promises immediately; a launch can fail before initialized arrives.
    const launchFailure = launched.then(() => new Promise(() => {}));
    try {
      await Promise.race([initialized, launchFailure]);
      await bindQueued(s, c);
      await client.request('setExceptionBreakpoints', {
        filters: s.adapter.exceptionFilters(s.mode, capabilities.exceptionBreakpointFilters),
      });
      if (capabilities.supportsConfigurationDoneRequest !== false) await client.request('configurationDone');
      c.ready = true;
      await launched;
    } catch (error) {
      client.close();
      await Promise.allSettled([initialized, launched]);
      throw error;
    }
  }
  async function cleanup(s) {
    if (s.cleaning) return s.cleaning;
    s.controller.abort();
    s.cleaning = (async () => {
      await Promise.all(
        [...s.connections].map(async c => {
          try {
            if (!c.client.transport.closed) await c.client.request('disconnect', { terminateDebuggee: true }, 1000);
          } catch {}
          c.client.close();
        }),
      );
      await Promise.all([...s.processes].map(child => killProcess(child)));
      await Promise.all([...s.debuggeePids].map(pid => killProcess({ pid }, { group: 'auto' })));
      await Promise.all(s.startCleanups.map(clean => clean()));
    })();
    return s.cleaning;
  }
  async function stop() {
    ++generation;
    const s = current;
    if (s) {
      s.finish?.('timeout');
      await cleanup(s);
    }
    if (current === s) {
      current = null;
      publish({
        status: 'stopped',
        handoff: null,
        frames: [],
        exception: null,
        trace: null,
        breakpoints: (configured.get(state.projectId) || []).map(b => ({ ...b, status: 'pending', locations: [] })),
      });
    }
    return state;
  }
  async function launchInternal(config, probeOptions, options = {}) {
    if (options.driver === 'agent' && live(current) && state.driver !== 'agent')
      throw new Error('The user is driving this session');
    const token = ++generation;
    const previous = current;
    if (previous) {
      await cleanup(previous);
      if (current === previous) {
        current = null;
        publish({ status: 'stopped', frames: [], exception: null });
      }
    }
    await configurationQueue;
    const resolved = await resolveConfig(config);
    if (generation !== token) throw new Error('Debug launch cancelled');
    const s = {
      id: randomUUID(),
      projectId: config.projectId,
      ...resolved,
      pause: 0,
      traceSequence: 0,
      frames: new Map(),
      handles: new Map(),
      connections: new Set(),
      processes: new Set(),
      debuggeePids: new Set(),
      startCleanups: [],
      rejected: new Map(),
      pendingChildren: 0,
      stopQueue: Promise.resolve(),
      controller: new AbortController(),
      output: '',
      started: Date.now(),
      breakpoints: configured.get(config.projectId) || [],
    };
    current = s;
    if (probeOptions) {
      s.report = {
        hits: [],
        exception: null,
        externalExceptions: 0,
        output: '',
        exit: {},
        timings: { adapterStartMs: null, firstStopMs: null, totalMs: null },
        stopReason: null,
      };
      s.hitCap = probeOptions.hitCap;
      s.done = new Promise(resolve => {
        s.finish = reason => {
          if (!s.report.stopReason) {
            s.report.stopReason = reason;
            resolve();
          }
        };
      });
      s.timer = setTimeout(() => {
        s.finish('timeout');
        void cleanup(s);
      }, probeOptions.timeoutMs);
    }
    publish({
      status: 'starting',
      driver: options.driver === 'agent' ? 'agent' : 'user',
      // Which agent started the run (Nemotron, Codex, Claude), for the ship's label.
      agent: options.driver === 'agent' && typeof options.agent === 'string' ? options.agent.slice(0, 40) : null,
      handoff: null,
      session: s.id,
      projectId: s.projectId,
      entry: config.entry,
      adapter: s.adapter.id,
      configuration: s.launch.name,
      frames: [],
      output: '',
      error: null,
      exception: null,
      exitCode: undefined,
      pause: 0,
      trace: null,
      breakpoints: [],
    });
    try {
      if (probeOptions) {
        const specs = [];
        for (const probe of probeOptions.probes) {
          const file = await fs.realpath(path.resolve(s.root, probe.file));
          if (!inside(s.root, file) || !(await fs.stat(file)).isFile() || (await fs.stat(file)).size > MAX)
            throw new Error('Invalid probe source');
          specs.push({ ...probe, column: 1, mode: 'pause', text: await fs.readFile(file, 'utf8') });
        }
        s.breakpoints = await validateBreakpoints(s.root, specs);
      }
      const installed = await installer.status(s.adapter.id);
      if (!installed.installed) throw new Error(installed.reason || `${s.adapter.id} is not installed`);
      const projectSettings = await readSettings(path.join(s.root, '.galaxy', 'settings.json'));
      const personalSettings = await settings();
      s.controller.signal.throwIfAborted();
      const start = s.adapter.start({
        root: s.root,
        userData,
        // Galaxy's own bookkeeping fields are not launch arguments.
        configuration: (({ source, supported, reason, ...launch }) => launch)(s.launch),
        settings: {
          ...personalSettings,
          ...projectSettings,
          debug: { ...personalSettings.debug, ...projectSettings.debug },
        },
        env: scrubEnv(s.launch.env),
        installPath: installed.path,
        jdtls,
        signal: s.controller.signal,
        onCleanup: callback => s.startCleanups.push(callback),
        own: child => {
          s.processes.add(child);
          if (s.controller.signal.aborted) void killProcess(child);
          return child;
        },
        output: text => {
          s.output = (s.output + text).slice(-32000);
          update(s, { output: s.output });
        },
      });
      let abort;
      const aborted = new Promise((_, reject) => {
        abort = () => reject(new Error('Debug launch cancelled'));
        s.controller.signal.addEventListener('abort', abort, { once: true });
        if (s.controller.signal.aborted) abort();
      });
      start.then(
        connection => {
          if (!live(s)) connection.client.close();
        },
        () => {},
      );
      let connection;
      try {
        connection = await Promise.race([start, aborted]);
      } finally {
        s.controller.signal.removeEventListener('abort', abort);
      }
      if (!live(s)) {
        connection.client.close();
        throw new Error('Debug launch cancelled');
      }
      s.connect = connection.connect;
      if (s.report) s.report.timings.adapterStartMs = Date.now() - s.started;
      update(s, { interpreter: connection.interpreter, status: 'running' });
      await attach(s, connection.client, connection.launch);
      return s;
    } catch (error) {
      if (!s.report?.stopReason) {
        s.failure = error;
        update(s, { status: 'error', error: error.message });
      }
      await cleanup(s);
      if (s.report?.stopReason === 'timeout') return s;
      clearTimeout(s.timer);
      throw error;
    }
  }
  async function launch(config, options = {}) {
    if (probeReserved) throw new Error('A debug probe is running');
    ++launchesPending;
    try {
      await launchInternal(config, null, options);
      return state;
    } finally {
      --launchesPending;
    }
  }
  async function command(session, action, options = {}) {
    const s = current;
    if (!s || s.id !== session) throw new Error('Debug session changed');
    if (options.driver === 'agent' && action !== 'stop' && state.driver !== 'agent')
      throw new Error('The user is driving this session');
    publish({ driver: options.driver === 'agent' ? 'agent' : 'user', handoff: null });
    if (action === 'stop') return stop();
    if (!live(s)) throw new Error('Debug session ended');
    const commands = { continue: 'continue', pause: 'pause', over: 'next', into: 'stepIn', out: 'stepOut' };
    if (!commands[action]) throw new Error('Unknown debug command');
    let c = s.active || [...s.connections].reverse().find(c => c.ready && !c.terminated);
    if (!c) throw new Error('Debugger is not ready');
    if (action !== 'pause') pausedSession(session, s.pause);
    let threadId = c.threadId;
    if (threadId == null) threadId = (await c.client.request('threads')).threads?.[0]?.id;
    if (action === 'pause') await c.client.request('pause', { threadId });
    else await resume(s, c, threadId, commands[action]);
    return state;
  }
  async function probe(projectId, options = {}) {
    if (probeReserved || launchesPending || live(current))
      throw new Error('Stop the interactive debug session before running a probe');
    const { hitCap = 20, timeoutMs = 45000, probes = [] } = options;
    if (
      !Number.isInteger(hitCap) ||
      hitCap < 1 ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Array.isArray(probes) ||
      probes.some(p => !Array.isArray(p.expressions) || p.expressions.some(e => typeof e !== 'string'))
    )
      throw new Error('Invalid probe options');
    probeReserved = true;
    let s;
    try {
      s = await launchInternal(
        { ...options, projectId, exceptionMode: options.exceptionMode || 'failures' },
        { probes, hitCap, timeoutMs },
        { driver: 'agent', agent: options.agent },
      );
      await s.done;
      if (s.failure) throw s.failure;
      return s.report;
    } finally {
      if (s) {
        clearTimeout(s.timer);
        await cleanup(s);
        s.report.output = s.output.slice(-8000);
        s.report.exit = { terminated: s.ended === true, ...(s.exitCode != null ? { exitCode: s.exitCode } : {}) };
        s.report.timings.totalMs = Date.now() - s.started;
        if (current === s) {
          current = null;
          publish({ status: s.report.stopReason === 'exited' ? 'exited' : 'stopped', frames: [], exception: null });
        }
      }
      probeReserved = false;
    }
  }
  async function closeProject(projectId, root) {
    if (current?.projectId === projectId) {
      const root = current.root;
      await stop();
      await jdtls.close(root);
    } else {
      try {
        await jdtls.close(root || (await rootOf(projectId)));
      } catch {}
    }
    configured.delete(projectId);
  }
  async function close() {
    await stop();
    await jdtls.closeAll();
  }
  return {
    launch,
    command,
    stop,
    setBreakpoints,
    scopes,
    frameVariables,
    evaluate,
    handoff,
    properties,
    probe,
    state: () => state,
    configurations,
    adapterStatus: () => Promise.all(Object.values(adapters).map(adapter => installer.status(adapter.id))),
    installAdapter: (id, options) => installer.install(id, options),
    jdtls,
    closeProject,
    close,
  };
}
module.exports = { createDebugManager };
