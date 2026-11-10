// Observed debugging evidence (docs/design/planet-towns.md §6, I-7, I-8). A record says what was observed, where, in
// which source revision and by whom. It is kept apart from static structure: a throw site is not an exception, and a
// call route is not an invocation. Records are resolved against a file's source index; they never pick a location
// for themselves.

export const EVIDENCE = Object.freeze({
  breakpoint: 'breakpoint',
  execution: 'execution', // the current execution position
  frame: 'frame', // one stack frame of a paused or captured stack
  exception: 'exception', // an exception actually observed
  testFailure: 'test-failure',
  log: 'log',
  coverage: 'coverage', // covered: true | false; absent coverage is unknown, never "not covered"
  hotPath: 'hot-path', // measured, with a sample count or duration
  gitChange: 'git-change',
});
const KINDS = new Set(Object.values(EVIDENCE));

/**
 * Validates and normalizes one record. Required: type, file, line, revision (the source revision it was observed
 * against) and source (its provenance: an adapter, test runner, profiler or git). Frames carry an invocation id and a
 * depth, so recursive frames stay separate; async continuations name the invocation they continue.
 */
export function createDebugRecord(fields) {
  if (!fields || typeof fields !== 'object') throw new TypeError('A debug record must be an object');
  const problems = [];
  if (!KINDS.has(fields.type)) problems.push(`unknown evidence type ${JSON.stringify(fields.type)}`);
  if (typeof fields.file !== 'string' || !fields.file) problems.push('file is required');
  if (!(Number.isInteger(fields.line) && fields.line >= 1)) problems.push('line must be a 1-based integer');
  if (!['string', 'number'].includes(typeof fields.revision))
    problems.push('revision is required: evidence belongs to one source revision');
  if (fields.column != null && (!Number.isInteger(fields.column) || fields.column < 1))
    problems.push('column must be a 1-based integer');
  if (fields.offset != null && (!Number.isInteger(fields.offset) || fields.offset < 0))
    problems.push('offset must be a non-negative integer');
  for (const key of ['session', 'context', 'continues'])
    if (fields[key] != null && !['string', 'number'].includes(typeof fields[key]))
      problems.push(key + ' must be a string or number');
  if (typeof fields.source !== 'string' || !fields.source) problems.push('source (provenance) is required');
  if (
    fields.type === EVIDENCE.frame &&
    (!['string', 'number'].includes(typeof fields.invocation) || !Number.isInteger(fields.depth) || fields.depth < 0)
  )
    problems.push('a frame needs an invocation id and an integer depth');
  if (fields.type === EVIDENCE.coverage && typeof fields.covered !== 'boolean')
    problems.push('coverage needs covered: true or false (unknown coverage is no record)');
  if (fields.type === EVIDENCE.hotPath && !(Number.isFinite(fields.samples) && fields.samples > 0))
    problems.push('a hot path needs a positive sample count');
  if (fields.change != null && !['added', 'modified', 'removed'].includes(fields.change))
    problems.push('change must be added, modified or removed');
  if (fields.mode != null && !['pause', 'trace'].includes(fields.mode)) problems.push('mode must be pause or trace');
  if (fields.verified != null && typeof fields.verified !== 'boolean') problems.push('verified must be a boolean');
  if (fields.message != null && typeof fields.message !== 'string') problems.push('message must be a string');
  if (problems.length) throw new TypeError('Invalid debug record: ' + problems.join('; '));
  return Object.freeze({
    type: fields.type,
    file: fields.file,
    line: fields.line,
    column: fields.column ?? null,
    offset: fields.offset ?? null,
    revision: fields.revision,
    source: fields.source,
    session: fields.session ?? null,
    context: fields.context ?? null, // thread, worker, test name
    time: fields.time ?? null,
    invocation: fields.invocation ?? null,
    continues: fields.continues ?? null, // the invocation an async continuation resumes
    depth: fields.depth ?? null,
    covered: fields.covered ?? null,
    samples: fields.samples ?? null,
    message: fields.message == null ? null : fields.message.slice(0, 500),
    change: fields.change ?? null, // git: added, modified or removed
    mode: fields.mode ?? null, // breakpoint: pause or trace
    verified: fields.verified ?? null, // breakpoint: confirmed by the runtime at an executable position
  });
}

/** Where a record lands in the world, with the index's own verdict: exact, approximate, stale or unmapped. */
export function resolveDebugRecord(record, index) {
  if (index.file !== record.file) return { record, location: null, status: 'unmapped' };
  const location = index.locate({
    line: record.line,
    column: record.column ?? undefined,
    offset: record.offset ?? undefined,
    revision: record.revision,
  });
  return { record, location, status: location.status };
}

/** A captured stack, innermost first, as numbered frames with their resolved locations. Recursion keeps one entry
 * per frame; the same callable twice is two frames. */
export function resolveStack(frames, indexOf) {
  return [...frames]
    .sort((a, b) => a.depth - b.depth)
    .map((frame, n) => {
      const index = indexOf(frame.file);
      return {
        n: n + 1,
        frame,
        ...(index ? resolveDebugRecord(frame, index) : { location: null, status: 'unmapped' }),
      };
    });
}

/** Directed invocation edges, caller to callee. Never join unrelated sessions or guess an async parent. */
export function stackPaths(frames, indexOf) {
  if (!Array.isArray(frames) || frames.length > 512) throw new TypeError('A capture must contain at most 512 frames');
  const records = frames.map(frame => createDebugRecord(frame));
  if (records.some(record => record.type !== EVIDENCE.frame))
    throw new TypeError('A stack contains frame records only');
  const identity = record => JSON.stringify([record.source, record.session, record.invocation]);
  const unique = new Set(records.map(identity));
  if (unique.size !== records.length) throw new TypeError('Each captured invocation must have a distinct identity');
  const rows = resolveStack(records, indexOf);
  const edges = [];
  for (const row of rows) {
    const r = row.frame;
    let parent;
    if (r.continues != null) {
      parent = rows.find(
        p => p.frame.source === r.source && p.frame.session === r.session && p.frame.invocation === r.continues,
      );
    } else {
      const candidates = rows.filter(
        p =>
          p.frame.source === r.source &&
          p.frame.session === r.session &&
          p.frame.context === r.context &&
          p.frame.depth === r.depth + 1,
      );
      if (candidates.length === 1) parent = candidates[0];
    }
    if (parent && parent !== row) edges.push({ from: parent.n, to: row.n, async: r.continues != null });
  }
  return { rows, edges };
}
