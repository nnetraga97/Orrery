// Codex agent identity outlives a spawn/wait tool call and the parent's current turn.
const { createEmitter } = require('../protocol.cjs');
const valid = value => typeof value === 'string' && /^[\w.-]{1,160}$/.test(value);
const terminal = new Set(['completed', 'interrupted', 'errored', 'shutdown', 'notFound', 'unknown']);
const toolName = value =>
  String(value || '')
    .replaceAll('_', '')
    .toLowerCase();
const parentOf = thread =>
  thread?.parentThreadId || (thread?.source?.subAgent || thread?.source?.subagent)?.thread_spawn?.parent_thread_id;

function createCodexAgents({ root, sessionId, emit, onDiscover = () => {} }) {
  const agents = new Map(),
    seen = new Set(),
    prompts = new Map();
  const emitter = createEmitter({ provider: 'codex', sessionId, workspaceRoot: root, emit });
  function register(id, parent = sessionId, info = {}) {
    if (!valid(id) || id === sessionId || !valid(parent) || (parent !== sessionId && !agents.has(parent))) return null;
    let agent = agents.get(id);
    if (agent) {
      if (agent.parentThreadId !== parent) return null;
      if (info.label && agent.label !== String(info.label).slice(0, 160)) {
        agent.label = String(info.label).slice(0, 160);
        if (valid(info.operationId)) agent.spawningOperationId = info.operationId;
        if (agent.state)
          emitter.send(
            terminal.has(agent.state) ? 'agent.finished' : 'agent.updated',
            { ...agent, ...(terminal.has(agent.state) ? { ok: agent.state === 'completed' } : {}) },
            { agentId: id, ...(agent.parentThreadId !== sessionId ? { parentAgentId: agent.parentThreadId } : {}) },
          );
      }
      return agent;
    }
    if (agents.size >= 128) return null;
    agent = {
      id,
      parentThreadId: parent,
      label: String(info.label || info.agentNickname || info.agentRole || 'Subagent').slice(0, 160),
      state: null,
      ...(valid(info.operationId) ? { spawningOperationId: info.operationId } : {}),
    };
    agents.set(id, agent);
    onDiscover({ ...agent });
    return agent;
  }
  function state(id, next, { restart = false, label } = {}) {
    const agent = agents.get(id);
    if (!agent || (!terminal.has(next) && !['running', 'pendingInit'].includes(next))) return;
    // Transport loss and generic completion markers cannot erase an observed failure.
    if (terminal.has(agent.state) && (next === 'unknown' || next === 'completed')) return;
    if (label) agent.label = String(label).slice(0, 160);
    if (agent.state === next || (terminal.has(agent.state) && !terminal.has(next) && !restart)) return;
    const previous = agent.state;
    agent.state = next;
    emitter.send(
      terminal.has(next) ? 'agent.finished' : previous && !terminal.has(previous) ? 'agent.updated' : 'agent.started',
      { ...agent, state: next, ...(terminal.has(next) ? { ok: next === 'completed' } : {}) },
      { agentId: id, ...(agent.parentThreadId !== sessionId ? { parentAgentId: agent.parentThreadId } : {}) },
    );
  }
  function observe(threadId, item, done = false) {
    if (threadId !== sessionId && !agents.has(threadId)) return;
    const type = toolName(item?.type);
    if (type === 'subagentactivity') {
      // Item completion is the delivery of a lifecycle marker, not completion of its child.
      const key = `${threadId}:${item.id}:${item.kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 4096) seen.delete(seen.values().next().value);
      const agent = register(item.agentThreadId, threadId, {
        agentNickname: item.agentPath?.split('/').filter(Boolean).at(-1),
      });
      if (!agent) return;
      if (item.kind === 'started') state(agent.id, 'running');
      else if (item.kind === 'completed' || item.kind === 'interrupted') state(agent.id, item.kind);
      return;
    }
    if (!['collabagenttoolcall', 'collabtoolcall'].includes(type)) return;
    const tool = toolName(item.tool),
      key = `${threadId}:${item.id}`;
    if (item.prompt) {
      prompts.set(key, String(item.prompt).split('\n')[0].slice(0, 160));
      if (prompts.size > 256) prompts.delete(prompts.keys().next().value);
    }
    for (const id of item.receiverThreadIds || []) {
      if (tool === 'spawnagent') register(id, threadId, { label: prompts.get(key), operationId: item.id });
      if (!agents.has(id)) continue;
      const next = item.agentsStates?.[id]?.status;
      const restart =
        done && ['resumeagent', 'followuptask', 'sendinput'].includes(tool) && item.status === 'completed';
      if (next) state(id, next, { restart });
      else if (tool === 'spawnagent') state(id, 'running');
      else if (restart) state(id, 'running', { restart: true });
      else if (done && tool === 'closeagent' && item.status === 'completed') state(id, 'shutdown');
    }
  }
  return {
    agents,
    register,
    state,
    observe,
    thread(thread) {
      const agent = register(thread?.id, parentOf(thread), thread || {});
      if (agent && thread.status?.type === 'active') state(agent.id, 'running');
      return agent;
    },
    stop() {
      for (const agent of agents.values()) if (!terminal.has(agent.state)) state(agent.id, 'unknown');
    },
  };
}
module.exports = { createCodexAgents, parentOf };
