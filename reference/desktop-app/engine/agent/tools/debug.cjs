const fs = require('node:fs/promises');
const path = require('node:path');
const string = { type: 'string' },
  strings = { type: 'array', items: string };
const location = { file: string, line: { type: 'integer', minimum: 1 }, condition: string };
const launch = { configuration: string, entry: string, args: strings };
const frame = { type: 'integer', minimum: 0 };
const definitions = [
  [
    'debug_probe',
    'Run the program once under the debugger. Each probe records its expressions every time its line runs; caught or uncaught exceptions are reported with their stack (exception_mode all also stops on exceptions the code catches and hides). One call replaces adding prints, re-running and removing them.',
    {
      ...launch,
      probes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { ...location, expressions: strings },
          required: ['file', 'line', 'expressions'],
          additionalProperties: false,
        },
      },
      exception_mode: { type: 'string', enum: ['failures', 'all', 'uncaught', 'none'] },
    },
    ['probes'],
  ],
  [
    'debug_start',
    'Start an interactive debug session that pauses at breakpoints or at an exception (exception_mode all includes exceptions the code catches), then wait for a pause or exit. Follow with debug_inspect, debug_evaluate and debug_step.',
    {
      ...launch,
      exception_mode: { type: 'string', enum: ['failures', 'all', 'uncaught', 'none'] },
      breakpoints: {
        type: 'array',
        items: { type: 'object', properties: location, required: ['file', 'line'], additionalProperties: false },
      },
    },
    [],
  ],
  [
    'debug_step',
    'Continue or step the paused agent session.',
    { action: { type: 'string', enum: ['continue', 'over', 'into', 'out'] } },
    ['action'],
  ],
  [
    'debug_inspect',
    "Read the paused session's stack, exception, source line and variables, or expand a dotted variable path one level. Also reads the user's own paused session without taking control.",
    { frame, expand: string },
    [],
  ],
  [
    'debug_evaluate',
    "Evaluate an expression in the paused debuggee; may have side effects. On the user's session it does not take control.",
    { expression: string, frame },
    ['expression'],
  ],
  ['debug_stop', 'Stop the agent session, including after hand-off.', {}, []],
  ['debug_handoff', 'Hand a paused session to the user with an explanation.', { message: string }, ['message']],
];
const live = state => ['starting', 'running', 'paused'].includes(state.status);
const observing = (debug, name, state) =>
  ['debug_inspect', 'debug_evaluate'].includes(name) &&
  state.status === 'paused' &&
  state.projectId === debug.projectId &&
  state.driver !== 'agent';
function owned(debug, name) {
  const state = debug.manager.state();
  // Reading the user's own paused session is allowed; acting on it (stepping, launching, handing off) is not.
  if (observing(debug, name, state)) return state;
  if (live(state) && (state.projectId !== debug.projectId || state.driver !== 'agent')) {
    if (name !== 'debug_stop' || state.session !== debug.session || state.projectId !== debug.projectId)
      throw new Error('The user is driving this session');
  }
  if (
    !['debug_start', 'debug_probe'].includes(name) &&
    (!live(state) || state.projectId !== debug.projectId || (debug.session && debug.session !== state.session))
  )
    throw new Error('No live agent debug session');
  if (name === 'debug_probe' && live(state))
    throw new Error('Stop the interactive debug session before running a probe');
  return state;
}
function prepare(name, input, debug) {
  owned(debug, name);
  for (const key of ['configuration', 'entry', 'expression', 'message', 'expand'])
    if (input[key] != null && (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100000))
      throw new Error(`Invalid ${key}`);
  if (input.frame != null && (!Number.isInteger(input.frame) || input.frame < 0))
    throw new Error('Invalid frame index');
  if (input.args != null && (!Array.isArray(input.args) || input.args.some(a => typeof a !== 'string')))
    throw new Error('args must be strings');
  if (['debug_start', 'debug_probe'].includes(name) && !input.configuration && !input.entry)
    throw new Error('Choose a configuration or entry');
  if (name === 'debug_step' && !['continue', 'over', 'into', 'out'].includes(input.action))
    throw new Error('Invalid step action');
  if (name === 'debug_evaluate' && !input.expression) throw new Error('An expression is required');
  if (name === 'debug_handoff' && !input.message) throw new Error('A hand-off message is required');
  const specs = input.probes ?? input.breakpoints ?? [];
  if (
    !Array.isArray(specs) ||
    specs.length > 128 ||
    specs.some(
      p =>
        !p ||
        typeof p.file !== 'string' ||
        !Number.isInteger(p.line) ||
        p.line < 1 ||
        (p.condition != null && typeof p.condition !== 'string') ||
        (name === 'debug_probe' && (!Array.isArray(p.expressions) || p.expressions.some(e => typeof e !== 'string'))),
    )
  )
    throw new Error('Invalid probe or breakpoint locations');
  if (name === 'debug_probe' && !Array.isArray(input.probes)) throw new Error('probes is required');
  if (input.exception_mode != null && !['failures', 'all', 'uncaught', 'none'].includes(input.exception_mode))
    throw new Error('Invalid exception mode');
  const summary =
    name === 'debug_evaluate'
      ? `Evaluate in debuggee: ${input.expression}`
      : `${name === 'debug_probe' ? 'Debug probe' : 'Debug start'}: run ${input.configuration || input.entry} with ${name === 'debug_probe' ? 'probes' : 'breakpoints'} at ${specs.map(p => `${p.file}:${p.line}${p.expressions ? ` [${p.expressions.join(', ')}]` : ''}`).join(', ') || '(none)'}`;
  return {
    action: name === 'debug_inspect' ? 'read' : 'command',
    files: specs.map(p => p.file),
    approval: summary.replace(/[\r\n]+/g, ' '),
  };
}
function stateSummary(state) {
  const frames = (state.frames || []).slice(0, 5);
  const top = frames[0];
  return [
    state.status,
    ...frames.map(f => `${f.file}:${f.line} ${f.name}`),
    state.exception && `Exception: ${state.exception}`,
    state.error && `Error: ${state.error}`,
    top?.text && `Source: ${top.text.split('\n')[top.line - 1] || ''}`,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 6000);
}
function reportSummary(report) {
  return [
    ...(report.hits || []).map(
      hit =>
        `${hit.file}:${hit.line} ${(hit.expressions || []).map(v => `${v.expression} = ${String(v.error || v.value).slice(0, 300)}`).join(', ')}`,
    ),
    report.exception &&
      `Exception: ${report.exception.message}\n${(report.exception.frames || [])
        .slice(0, 5)
        .map(f => `${f.file}:${f.line} ${f.name}`)
        .join('\n')}\n${(report.exception.locals || [])
        .slice(0, 20)
        .map(v => `${v.name} = ${String(v.value).slice(0, 300)}`)
        .join(', ')}`,
    `Stop: ${report.stopReason}`,
    `Timings: ${JSON.stringify(report.timings)}`,
    report.output && `Output:\n${report.output.slice(-2000)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
async function wait(debug, signal, session, previousPause) {
  const until = Date.now() + (debug.waitMs ?? 30000);
  while (true) {
    signal?.throwIfAborted();
    const state = debug.manager.state();
    if (state.session !== session) throw new Error('Debug session changed');
    if (state.driver !== 'agent' && live(state)) throw new Error('The user is driving this session');
    if (
      ['exited', 'error', 'stopped'].includes(state.status) ||
      (state.status === 'paused' && state.pause !== previousPause)
    )
      return stateSummary(state);
    if (Date.now() >= until) return `${stateSummary(state)}\nTimed out waiting for a pause or exit after 30 seconds.`;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function execute(name, input, prepared, { debug, root, signal, permission, approve }) {
  signal?.throwIfAborted();
  if (permission === 'read-only') return { ok: false, denied: true, output: 'This chat is read-only.' };
  if (
    ['debug_probe', 'debug_start', 'debug_evaluate'].includes(name) &&
    permission !== 'full-access' &&
    !(await approve(prepared.approval))
  )
    return { ok: false, denied: true, output: 'The user denied this debug action' };
  signal?.throwIfAborted();
  let state = owned(debug, name),
    output;
  const manager = debug.manager;
  if (name === 'debug_probe')
    output = reportSummary(
      await manager.probe(debug.projectId, { ...input, exceptionMode: input.exception_mode, agent: debug.agent }),
    );
  if (name === 'debug_start') {
    const specs = [];
    const realRoot = await fs.realpath(root);
    for (const b of input.breakpoints || []) {
      if (path.isAbsolute(b.file) || b.file.includes('\\') || b.file.split('/').includes('..'))
        throw new Error('Breakpoint must be inside the project');
      const absolute = await fs.realpath(path.resolve(realRoot, b.file));
      if (
        !absolute.startsWith(realRoot + path.sep) ||
        !(await fs.stat(absolute)).isFile() ||
        (await fs.stat(absolute)).size > 2 * 1024 * 1024
      )
        throw new Error('Invalid breakpoint source');
      specs.push({ ...b, column: 1, mode: 'pause', text: await fs.readFile(absolute, 'utf8') });
    }
    owned(debug, name);
    await manager.setBreakpoints(debug.projectId, specs, { driver: 'agent' });
    state = await manager.launch(
      {
        projectId: debug.projectId,
        configuration: input.configuration,
        entry: input.entry,
        args: input.args,
        exceptionMode: input.exception_mode,
      },
      { driver: 'agent', agent: debug.agent },
    );
    debug.session = state.session;
    output = await wait(debug, signal, state.session);
  }
  if (name === 'debug_step') {
    await manager.command(state.session, input.action, { driver: 'agent' });
    output = await wait(debug, signal, state.session, state.pause);
  }
  if (name === 'debug_stop') {
    await manager.command(state.session, 'stop', { driver: 'agent' });
    output = 'Debug session stopped';
    debug.session = null;
  }
  if (name === 'debug_handoff') {
    manager.handoff(input.message);
    debug.session = state.session;
    output = 'Handed off to the user';
  }
  if (['debug_inspect', 'debug_evaluate'].includes(name)) {
    const selected = state.frames?.[input.frame ?? 0];
    if (!selected || state.status !== 'paused') throw new Error('Choose a frame in a paused session');
    if (name === 'debug_evaluate') {
      const result = await manager.evaluate(state.session, state.pause, selected.id, input.expression, {
        driver: 'agent',
        observe: observing(debug, name, state),
      });
      output = `${result.display}${result.type ? ` (${result.type})` : ''}`;
    } else {
      const scopes = await manager.scopes(state.session, state.pause, selected.id);
      const values = [];
      for (const scope of scopes)
        if (scope.handle) values.push(...(await manager.properties(state.session, state.pause, scope.handle)).values);
      let expanded = values;
      if (input.expand)
        for (const part of input.expand.split('.')) {
          const value = expanded.find(v => v.name === part);
          if (!value) throw new Error(`Unknown variable: ${part}`);
          expanded = value.handle
            ? (await manager.properties(state.session, state.pause, value.handle)).values
            : [value];
        }
      output = [
        !input.expand && state.driver !== 'agent' && "The user's session (read only):",
        !input.expand && stateSummary(state),
        !input.expand && `Scopes: ${scopes.map(s => s.name).join(', ')}`,
        ...expanded.map(v => `${v.name} = ${v.display}${v.handle ? ' […]' : ''}`),
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);
    }
  }
  return { ok: true, output };
}
module.exports = { definitions, prepare, execute, stateSummary, reportSummary };
