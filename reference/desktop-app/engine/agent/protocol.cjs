// The integration boundary. Providers describe work; presentation decides how to draw it.
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const VERSION = 1;
const TYPES = new Set([
  'session.started',
  'session.ended',
  'turn.started',
  'turn.finished',
  'operation.started',
  'operation.updated',
  'operation.finished',
  'question.resolved',
  'message',
  'usage',
  'attention',
  'agent.started',
  'agent.updated',
  'agent.finished',
]);
const ACTIONS = new Set([
  'read',
  'search',
  'edit',
  'create',
  'delete',
  'command',
  'delegate',
  'web',
  'task',
  'load',
  'question',
  'other',
  'artifact',
  'build',
  'test',
  'repository',
  'ui',
  'transfer',
  'debug',
]);
const keyOf = e => `${e.provider}:${e.sessionId}`;
const operationKey = e => `${keyOf(e)}:${e.turnId}:${e.operationId}`;
const identifier = v => typeof v === 'string' && /^[\w.-]{1,160}$/.test(v);
const relativePath = v =>
  typeof v === 'string' &&
  v.length <= 1024 &&
  !v.includes('\\') &&
  !v.includes('\0') &&
  !path.posix.isAbsolute(v) &&
  v.split('/').every(p => p && p !== '.' && p !== '..');

function validate(input, root) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Agent event must be an object.');
  if (input.version !== VERSION || !TYPES.has(input.type)) throw new Error('Unsupported agent event version or type.');
  for (const field of ['id', 'provider', 'sessionId'])
    if (!identifier(input[field])) throw new Error(`Invalid ${field}.`);
  if (typeof input.workspaceRoot !== 'string' || path.resolve(input.workspaceRoot) !== root)
    throw new Error('Agent event belongs to a different workspace.');
  if (!Number.isFinite(input.timestamp)) throw new Error('Agent event requires a timestamp.');
  for (const field of ['agentId', 'parentAgentId', 'rootSessionId'])
    if (input[field] != null && !identifier(input[field])) throw new Error(`Invalid ${field}.`);
  if (input.type.startsWith('agent.') && !identifier(input.agentId))
    throw new Error('Agent lifecycle requires agentId.');
  if (!input.type.startsWith('session.') && !input.type.startsWith('agent.') && !identifier(input.turnId))
    throw new Error('Agent event requires a turnId.');
  if (input.type.startsWith('operation.') && !identifier(input.operationId))
    throw new Error('Agent operation requires an operationId.');
  if (input.parentOperationId != null && !identifier(input.parentOperationId))
    throw new Error('Invalid parent operation.');
  const p = input.payload || {};
  if (
    input.type.startsWith('agent.') &&
    !['pendingInit', 'running', 'completed', 'interrupted', 'errored', 'shutdown', 'notFound', 'unknown'].includes(
      p.state,
    )
  )
    throw new Error('Invalid agent state.');
  if (typeof p !== 'object' || Array.isArray(p) || Buffer.byteLength(JSON.stringify(p)) > 65536)
    throw new Error('Agent payload exceeds 64 KB or is invalid.');
  if (input.type === 'operation.started' && !ACTIONS.has(p.action)) throw new Error('Unsupported operation action.');
  if (input.type === 'operation.finished' && typeof p.ok !== 'boolean')
    throw new Error('Operation outcome requires ok.');
  if (input.type === 'question.resolved' && (!identifier(p.requestId) || !['answered', 'cancelled'].includes(p.state)))
    throw new Error('Invalid question resolution.');
  if (p.requestId != null && !identifier(p.requestId)) throw new Error('Invalid question request ID.');
  if (p.awaitingAnswer != null && typeof p.awaitingAnswer !== 'boolean')
    throw new Error('Invalid question waiting state.');
  const resource = r =>
    r &&
    typeof r === 'object' &&
    (relativePath(r.path) || (typeof r.uri === 'string' && r.uri.length <= 4096 && /^(file|https?):\/\//.test(r.uri)));
  for (const field of ['inputs', 'outputs'])
    if (p[field] != null && (!Array.isArray(p[field]) || p[field].length > 32 || !p[field].every(resource)))
      throw new Error('Invalid operation resources.');
  for (const field of ['from', 'to'])
    if (p[field] != null && !resource(p[field])) throw new Error('Invalid operation endpoint.');
  if (
    p.progress &&
    (!Number.isFinite(p.progress.completed) ||
      !Number.isFinite(p.progress.total) ||
      p.progress.total <= 0 ||
      p.progress.completed < 0 ||
      p.progress.completed > p.progress.total)
  )
    throw new Error('Invalid measured progress.');
  for (const field of ['startedAt', 'finishedAt', 'observedAt'])
    if (p[field] != null && !Number.isFinite(p[field])) throw new Error('Invalid operation time.');
  if (input.type === 'turn.finished' && !['completed', 'failed', 'interrupted'].includes(p.outcome))
    throw new Error('Invalid turn outcome.');
  if (p.files != null && (!Array.isArray(p.files) || p.files.length > 128 || !p.files.every(relativePath)))
    throw new Error('Operation files must be workspace-relative paths (up to 128).');
  if (
    p.changes != null &&
    (!Array.isArray(p.changes) ||
      p.changes.length > 128 ||
      !p.changes.every(c => relativePath(c.path) && ['create', 'edit', 'delete'].includes(c.change)))
  )
    throw new Error('Invalid declared changes.');
  for (const field of ['text', 'label', 'tool', 'command', 'error', 'displayName'])
    if (p[field] != null && typeof p[field] !== 'string') throw new Error(`Invalid ${field}.`);
  // Detach producer-owned objects. Consumers cannot mutate the producer's state.
  return JSON.parse(JSON.stringify({ ...input, workspaceRoot: root, payload: p }));
}

function createEmitter({ provider, sessionId, workspaceRoot, emit, displayName = provider }) {
  let seq = 0,
    turn = 0,
    turnId = null;
  const runId = randomUUID();
  const send = (type, payload = {}, fields = {}) => {
    const e = {
      version: VERSION,
      id: `${runId}.${++seq}`,
      timestamp: Date.now(),
      provider,
      sessionId,
      workspaceRoot,
      type,
      ...(!type.startsWith('session.') ? { turnId } : {}),
      ...fields,
      payload,
    };
    emit(e);
    return e;
  };
  return {
    send,
    start: () => send('session.started', { displayName }),
    begin: (text, id = `${runId}.turn.${++turn}`) => {
      turnId = id;
      return send('turn.started', { text });
    },
    get turnId() {
      return turnId;
    },
  };
}

module.exports = { VERSION, TYPES, ACTIONS, keyOf, operationKey, relativePath, validate, createEmitter };
