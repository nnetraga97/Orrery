// First-class chat activity comes from the app-server stream, never a transcript tail.
// The chat service owns authentication, thread persistence and text streaming. This
// bridge projects only live typed items into the existing Galaxy work protocol.
import { createEmitter } from '../protocol.cjs';
import { createCodexAdapter } from './codex.mjs';
import path from 'node:path';
import { createCodexAgents } from './codex-agents.cjs';

const TEXT_LIMIT = 8192;
const textOf = content =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .filter(part => part?.type === 'text' || typeof part === 'string')
        .map(part => (typeof part === 'string' ? part : part.text || ''))
        .join('\n');
const keep = (set, key, limit = 256) => {
  set.add(key);
  if (set.size > limit) set.delete(set.values().next().value);
};
const itemType = item =>
  String(item?.type || '')
    .replaceAll('_', '')
    .toLowerCase();

/** Feed only notifications for this app-owned thread; do not feed thread/read history. */
function createCodexThreadEvents({
  root,
  sessionId,
  threadId = sessionId,
  emit,
  displayName = 'Codex',
  agents,
  rootSessionId,
}) {
  root = path.resolve(root);
  let started = false,
    stopped = false,
    activeTurn = null,
    currentItem = null,
    completedAt = null;
  const finishedTurns = new Set(),
    completedItems = new Set(),
    users = new Set(),
    fragments = new Map();
  const forward = event =>
    emit({
      ...event,
      ...(rootSessionId ? { rootSessionId, agentId: threadId } : {}),
      source: 'app-server',
      payload: {
        ...event.payload,
        ...(currentItem ? { itemId: currentItem } : {}),
        ...(event.type === 'operation.finished' && completedAt !== null ? { finishedAt: completedAt } : {}),
      },
    });
  const adapter = createCodexAdapter({ root, sessionId, displayName, emit: forward, trackAgents: false });
  const direct = createEmitter({ provider: 'codex', sessionId, workspaceRoot: root, displayName, emit: forward });

  function start() {
    if (!started) {
      adapter.start();
      started = true;
    }
  }
  function begin(id, prompt = 'Codex turn', restart = false) {
    if (!id || finishedTurns.has(id) || stopped) return false;
    if (activeTurn === id) return true;
    if (activeTurn) finish('interrupted');
    start();
    activeTurn = id;
    completedItems.clear();
    users.clear();
    fragments.clear();
    adapter.prime({ type: 'turn_context', payload: { cwd: root, turn_id: id } });
    adapter.begin(prompt, id);
    if (rootSessionId) agents.state(threadId, 'running', { restart });
    return true;
  }
  function message(text, role, itemId) {
    if (!text || !activeTurn) return;
    currentItem = itemId;
    try {
      direct.send('message', { role, text: text.slice(0, TEXT_LIMIT) }, { turnId: adapter.turnId });
    } finally {
      currentItem = null;
    }
  }
  function finish(outcome, error, unobserved = false) {
    if (!activeTurn) return;
    // Interrupted streams may lack item/completed. Retain their partial text as a
    // message; text never becomes a file edit, command, or other executed action.
    for (const [id, value] of fragments) if (!completedItems.has(id)) message(value.text, value.role, id);
    fragments.clear();
    adapter.finish(outcome, error ? { error: String(error).slice(0, 1000) } : {});
    if (rootSessionId) agents.state(threadId, unobserved ? 'unknown' : outcome === 'failed' ? 'errored' : outcome);
    keep(finishedTurns, activeTurn);
    activeTurn = null;
  }
  function item(raw, done, params) {
    if (!raw?.id || completedItems.has(raw.id)) return;
    const type = itemType(raw);
    if (['collabagenttoolcall', 'collabtoolcall', 'subagentactivity'].includes(type)) {
      agents.observe(threadId, raw, done);
      if (done) completedItems.add(raw.id);
      return;
    }
    if (type === 'usermessage') {
      // The user item is delivered on both lifecycle edges. Its prompt is useful
      // immediately, and must not appear twice when the completed item arrives.
      if (!users.has(raw.id)) {
        message(textOf(raw.content), 'user', raw.id);
        users.add(raw.id);
      }
      if (done) completedItems.add(raw.id);
      return;
    }
    if (!done && ['agentmessage', 'reasoning'].includes(type)) return;
    let value = { ...raw };
    if (type === 'agentmessage') value.text = value.text || fragments.get(raw.id)?.text || '';
    if (type === 'reasoning')
      value.content = (
        value.summary?.length
          ? value.summary
          : value.content?.length
            ? value.content
            : [fragments.get(raw.id)?.text || '']
      ).map(text => ({ text }));
    if (type === 'collabagenttoolcall') value.type = 'collabToolCall';
    if (Number.isFinite(raw.durationMs)) value.duration = raw.durationMs / 1000;
    // Lifecycle markers are not external work. Do not render unknown hook text,
    // review labels, or subagent status as an invented operation.
    if (['hookprompt', 'enteredreviewmode', 'exitedreviewmode', 'subagentactivity', 'sleep'].includes(type)) {
      if (done) completedItems.add(raw.id);
      return;
    }
    currentItem = raw.id;
    completedAt = done && Number.isFinite(params.completedAtMs) ? params.completedAtMs : null;
    try {
      adapter.record({
        type: 'event_msg',
        payload: {
          type: done ? 'item_completed' : 'item_started',
          turn_id: activeTurn,
          item: value,
          ...(Number.isFinite(params.startedAtMs) ? { started_at_ms: params.startedAtMs } : {}),
          ...(Number.isFinite(params.completedAtMs) ? { completed_at_ms: params.completedAtMs } : {}),
        },
      });
    } finally {
      currentItem = null;
      completedAt = null;
    }
    if (done) {
      completedItems.add(raw.id);
      fragments.delete(raw.id);
    }
  }

  function accept(notification) {
    if (stopped || !notification || typeof notification.method !== 'string') return false;
    const { method } = notification;
    const params = notification.params;
    if (!params || typeof params !== 'object') return false;
    const owner = params.threadId || params.thread?.id;
    if (owner !== threadId) return false;
    if (method === 'thread/started') {
      start();
      return true;
    }
    const id = params.turn?.id || params.turnId;
    if (
      finishedTurns.has(id) &&
      ['item/started', 'item/completed'].includes(method) &&
      ['collabagenttoolcall', 'collabtoolcall', 'subagentactivity'].includes(itemType(params.item))
    ) {
      agents.observe(threadId, params.item, method === 'item/completed');
      return true;
    }
    if (!id || finishedTurns.has(id)) return false;
    if (method === 'turn/started') {
      const prompt = (params.turn.items || [])
        .filter(value => itemType(value) === 'usermessage')
        .map(value => textOf(value.content))
        .filter(Boolean)
        .join('\n');
      if (!begin(id, prompt || 'Codex turn', true)) return false;
      for (const value of params.turn.items || []) if (itemType(value) === 'usermessage') item(value, false, params);
      return true;
    }
    // Ignore late notifications from an older turn; app-server turns are serial.
    if (activeTurn && id !== activeTurn) return false;
    const recognized = [
      'item/started',
      'item/completed',
      'item/agentMessage/delta',
      'item/reasoning/summaryTextDelta',
      'thread/tokenUsage/updated',
      'turn/completed',
      'error',
    ];
    if (!recognized.includes(method)) return false;
    const prompt = itemType(params.item) === 'usermessage' ? textOf(params.item.content) : '';
    if (!begin(id, prompt || 'Codex turn')) return false;
    if (method === 'item/started' || method === 'item/completed')
      item(params.item, method === 'item/completed', params);
    else if (method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta') {
      if (typeof params.itemId !== 'string' || completedItems.has(params.itemId) || typeof params.delta !== 'string')
        return false;
      if (!fragments.has(params.itemId) && fragments.size >= 256) return false;
      const previous = fragments.get(params.itemId);
      fragments.set(params.itemId, {
        text: ((previous?.text || '') + params.delta).slice(0, TEXT_LIMIT),
        role: method.includes('reasoning') ? 'reasoning' : 'assistant',
      });
    } else if (method === 'thread/tokenUsage/updated') {
      adapter.record({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: params.tokenUsage?.last,
            model_context_window: params.tokenUsage?.modelContextWindow,
          },
        },
      });
    } else if (method === 'error') {
      // The chat owns transient reconnect status. Recording it as an error here
      // leaves a false failure in the scene's activity history after recovery.
      if (!params.willRetry) message(params.error?.message || 'Codex request failed.', 'error');
    } else if (method === 'turn/completed') {
      // Turn payloads may include final items missed during attachment. The adapter
      // marks these completionOnly and item IDs prevent replaying earlier work.
      for (const value of params.turn.items || []) item(value, true, params);
      const status = params.turn.status;
      finish(
        status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed',
        params.turn.error?.message,
      );
    }
    return true;
  }

  return {
    accept,
    start,
    stop(outcome = 'interrupted') {
      if (stopped) return;
      finish(outcome, undefined, true);
      stopped = true;
      if (started) direct.send('session.ended');
    },
  };
}

/** One tree owns the drones; each child keeps its own session and independent turns. */
export function createCodexAppEvents({ root, sessionId, threadId = sessionId, emit, displayName = 'Codex' }) {
  root = path.resolve(root);
  let stopped = false;
  const children = new Map();
  const agents = createCodexAgents({ root, sessionId, emit: event => emit({ ...event, source: 'app-server' }) });
  const primary = createCodexThreadEvents({ root, sessionId, threadId, emit, displayName, agents });
  return {
    accept(notification) {
      if (stopped) return false;
      const p = notification?.params;
      if (!p) return false;
      const owner = p.threadId || p.thread?.id;
      if (owner === threadId) return primary.accept(notification);
      // The native owner attaches only verified descendants. Metadata must still link
      // to this tree before a child can publish anything to the workspace.
      if (notification.method === 'thread/started') {
        primary.start();
        const agent = agents.thread(p.thread);
        if (!agent) return false;
      }
      if (!agents.agents.has(owner)) return false;
      if (notification.method === 'thread/closed') {
        agents.state(owner, 'unknown');
        return true;
      }
      if (notification.method === 'thread/status/changed' && p.status?.type === 'systemError') {
        agents.state(owner, 'errored');
        return true;
      }
      if (!children.has(owner))
        children.set(
          owner,
          createCodexThreadEvents({
            root,
            sessionId: owner,
            threadId: owner,
            rootSessionId: sessionId,
            emit,
            displayName: agents.agents.get(owner).label,
            agents,
          }),
        );
      return children.get(owner).accept(notification);
    },
    stop(outcome = 'interrupted') {
      if (stopped) return;
      for (const child of children.values()) child.stop(outcome);
      agents.stop();
      primary.stop(outcome);
      stopped = true;
      children.clear();
    },
  };
}
