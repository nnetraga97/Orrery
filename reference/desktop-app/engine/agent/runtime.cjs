// Session reduction and path-based attribution. No provider names, transcript parsing or UI code.
const path = require('node:path');
const { validate, keyOf, operationKey } = require('./protocol.cjs');
const MAX_SESSIONS = 32,
  MAX_CHILD_SESSIONS = 128,
  MAX_OPERATIONS = 512,
  MAX_SEEN = 8192,
  SETTLE_MS = 5000;
class AgentRuntime {
  constructor(root, onEvent = () => {}, onState = () => {}) {
    this.root = path.resolve(root);
    this.onEvent = onEvent;
    this.onState = onState;
    this.sessions = new Map();
    this.operations = new Map();
    this.pathOperations = new Map();
    this.seen = new Map();
    this.usedOperations = new Map();
    this.usedTurns = new Map();
    this.sequence = 0;
    this.questions = new Map();
    this.agents = new Map();
    this.agentOrdinal = 0;
  }
  prune(now = Date.now()) {
    for (const [key, op] of this.operations)
      if (op.expires <= now) {
        this.operations.delete(key);
        for (const file of op.files) {
          const set = this.pathOperations.get(file);
          set?.delete(key);
          if (!set?.size) this.pathOperations.delete(file);
        }
      }
  }
  publish(input) {
    const e = validate(input, this.root),
      key = keyOf(e),
      dedup = `${key}:${e.id}`;
    if (this.seen.has(dedup)) return { accepted: false, duplicate: true };
    this.prune();
    let s = this.sessions.get(key);
    if (e.type === 'session.started') {
      if (s) throw new Error('Session already registered; send a turn.started event to continue.');
      const childCount = [...this.sessions.values()].filter(session => session.rootSessionId).length;
      if (e.rootSessionId ? childCount >= MAX_CHILD_SESSIONS : this.sessions.size - childCount >= MAX_SESSIONS)
        throw new Error('Session limit reached; disconnect an inactive session first.');
      s = {
        key,
        provider: e.provider,
        sessionId: e.sessionId,
        displayName: e.payload.displayName || e.provider,
        status: 'idle',
        turnId: null,
        lastActivity: e.timestamp,
        operations: 0,
        ...(e.rootSessionId ? { rootSessionId: e.rootSessionId, agentId: e.agentId } : {}),
      };
      this.sessions.set(key, s);
      this.usedOperations.set(key, new Set());
      this.usedTurns.set(key, new Set());
    } else {
      if (!s) throw new Error('Register the session before publishing activity.');
      if (s.status === 'ended') throw new Error('Session has ended.');
      if (e.type === 'turn.started') {
        if (s.status === 'running') throw new Error('Previous turn is still running.');
        if (this.usedTurns.get(key).has(e.turnId)) throw new Error('Turn ID cannot be reused.');
      } else if (
        !e.type.startsWith('agent.') &&
        !['session.ended', 'question.resolved'].includes(e.type) &&
        (e.turnId !== s.turnId || s.status !== 'running')
      )
        throw new Error('Event belongs to an inactive turn.');
    }
    if (e.type.startsWith('agent.')) {
      const agentKey = `${key}:${e.agentId}`;
      if (!this.agents.has(agentKey) && this.agents.size >= 256) throw new Error('Agent limit reached.');
      e.payload.ordinal = this.agents.get(agentKey)?.payload.ordinal ?? this.agentOrdinal++;
      this.agents.set(agentKey, { ...e });
    } else if (e.type === 'operation.started') {
      if (!e.payload.completionOnly && e.payload.startedAt == null) e.payload.startedAt = e.timestamp;
      if (this.operations.size >= MAX_OPERATIONS) throw new Error('Outstanding operation limit reached.');
      const opKey = operationKey(e);
      const used = this.usedOperations.get(key);
      if (used.has(e.operationId)) throw new Error('Operation ID cannot be reused within a turn.');
      if (used.size >= 4096) throw new Error('Turn operation limit reached.');
      used.add(e.operationId);
      const mutable = ['edit', 'create', 'delete'].includes(e.payload.action);
      // A command needs declared changes; command text is never evidence of a write.
      const files = new Set([...(mutable ? e.payload.files || [] : []), ...(e.payload.changes || []).map(c => c.path)]);
      this.operations.set(opKey, { event: e, key, files, expires: Infinity, ok: null });
      for (const file of files) {
        const set = this.pathOperations.get(file) || new Set();
        set.add(opKey);
        this.pathOperations.set(file, set);
      }
      s.operations++;
    } else if (e.type === 'operation.updated') {
      const op = this.operations.get(operationKey(e));
      if (!op || op.ok !== null) throw new Error('Cannot update an inactive operation.');
      // Identity and mutation manifests remain fixed; progress/results can be enriched.
      const { files, changes, action, ...update } = e.payload;
      op.event.payload = { ...op.event.payload, ...update };
      e.payload = { ...op.event.payload };
    } else if (e.type === 'question.resolved') {
      const requestKey = `${key}:${e.payload.requestId}`,
        q = this.questions.get(requestKey);
      if (!q || q.turnId !== e.turnId) throw new Error('Unknown question.');
      e.operationId = q.operationId;
      this.questions.delete(requestKey);
    } else if (e.type === 'operation.finished') {
      const op = this.operations.get(operationKey(e));
      if (!op || op.ok !== null) throw new Error('Operation is missing or already finished.');
      e.payload = {
        ...op.event.payload,
        ...e.payload,
        action: op.event.payload.action,
        finishedAt: e.payload.finishedAt ?? e.timestamp,
      };
      if (e.payload.awaitingAnswer && (op.event.payload.action !== 'question' || !e.payload.ok))
        throw new Error('Only a successful question request can await an answer.');
      if (e.payload.awaitingAnswer && op.event.payload.action === 'question') {
        if (this.questions.has(`${key}:${e.payload.requestId || e.operationId}`))
          throw new Error('Question request ID already pending.');
        if (this.questions.size >= 128) throw new Error('Pending question limit reached.');
        this.questions.set(`${key}:${e.payload.requestId || e.operationId}`, {
          turnId: e.turnId,
          operationId: e.operationId,
        });
      }
      for (const change of e.payload.changes || []) {
        op.files.add(change.path);
        const set = this.pathOperations.get(change.path) || new Set();
        set.add(operationKey(e));
        this.pathOperations.set(change.path, set);
      }
      op.event.payload = { ...e.payload };
      op.ok = e.payload.ok;
      op.expires = Date.now() + (op.ok && op.files.size ? SETTLE_MS : 0);
      s.operations--;
    } else if (e.type === 'turn.started') {
      s.status = 'running';
      s.turnId = e.turnId;
      this.usedOperations.get(key).clear();
      const turns = this.usedTurns.get(key);
      turns.add(e.turnId);
      if (turns.size > 256) turns.delete(turns.values().next().value);
    } else if (e.type === 'turn.finished' || e.type === 'session.ended') {
      s.status = e.type === 'session.ended' ? 'ended' : e.payload.outcome;
      for (const op of this.operations.values())
        if (op.key === key && op.expires === Infinity) op.expires = Date.now() + SETTLE_MS;
      s.operations = 0;
    }
    s.lastActivity = e.timestamp;
    this.seen.set(dedup, true);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value);
    this.onEvent({ ...e, sequence: ++this.sequence });
    this.onState(this.snapshot());
    return { accepted: true, sequence: this.sequence };
  }
  attribution(file, now = Date.now()) {
    this.prune(now);
    const candidates = [...(this.pathOperations.get(file) || [])]
      .map(key => this.operations.get(key))
      .filter(op => op && op.ok !== false);
    if (candidates.length !== 1) return { confidence: candidates.length ? 'ambiguous' : 'unattributed' };
    const e = candidates[0].event;
    return {
      confidence: 'correlated',
      provider: e.provider,
      sessionId: e.sessionId,
      turnId: e.turnId,
      operationId: e.operationId,
      parentOperationId: e.parentOperationId || null,
      ...(e.agentId ? { agentId: e.agentId } : {}),
      ...(e.rootSessionId ? { rootSessionId: e.rootSessionId } : {}),
    };
  }
  disconnect(provider, sessionId) {
    const key = `${provider}:${sessionId}`;
    for (const session of this.sessions.values())
      if (session.provider === provider && session.rootSessionId === sessionId)
        this.disconnect(provider, session.sessionId);
    for (const [id, event] of this.agents) if (keyOf(event) === key) this.agents.delete(id);
    this.sessions.delete(key);
    for (const id of this.questions.keys()) if (id.startsWith(key + ':')) this.questions.delete(id);
    this.usedOperations.delete(key);
    this.usedTurns.delete(key);
    for (const op of this.operations.values()) if (op.key === key) op.expires = 0;
    for (const id of this.seen.keys()) if (id.startsWith(key + ':')) this.seen.delete(id);
    this.prune();
    this.onState(this.snapshot());
  }
  snapshot() {
    return {
      version: 1,
      workspaceRoot: this.root,
      sessions: [...this.sessions.values()].map(s => ({ ...s })),
      agents: [...this.agents.values()],
      questions: this.questions.size,
      operations: this.operations.size,
      seen: this.seen.size,
      sequence: this.sequence,
    };
  }
  dispose() {
    this.sessions.clear();
    this.operations.clear();
    this.pathOperations.clear();
    this.seen.clear();
    this.usedOperations.clear();
    this.usedTurns.clear();
    this.questions.clear();
    this.agents.clear();
  }
}
module.exports = { AgentRuntime, SETTLE_MS };
