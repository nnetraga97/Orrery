// Codex-specific decoding. Neither the runtime nor the viewer depends on Codex tool names.
// Supports documented `codex exec --json` events and selected local rollout records.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createEmitter } from '../protocol.cjs';
import { localPath, resource } from '../resources.cjs';
import { semantics } from '../semantics.cjs';
import { createCodexAgents } from './codex-agents.cjs';

const clip = (value, max = 160) => String(value ?? '').slice(0, max);
const idOf = value =>
  /^[\w.-]{1,120}$/.test(String(value))
    ? String(value)
    : `codex.${createHash('sha256').update(String(value)).digest('hex').slice(0, 32)}`;
const textOf = value =>
  typeof value === 'string' ? value : Array.isArray(value) ? value.map(b => b.text || b.summary || '').join('\n') : '';
const typeOf = item =>
  String(item.type || '')
    .replace(/_/g, '')
    .toLowerCase();
const changeOf = kind =>
  ({ add: 'create', create: 'create', update: 'edit', edit: 'edit', delete: 'delete' })[
    typeof kind === 'object' ? kind.type : kind
  ];

export function createCodexAdapter({
  root,
  sessionId,
  emit,
  displayName = 'Codex',
  workspaceAliases = [],
  requireContext = false,
  trackAgents = true,
  agents: suppliedAgents,
  rootSessionId,
  agentId,
}) {
  root = path.resolve(root);
  const forward = event =>
    emit({ ...event, ...(rootSessionId ? { rootSessionId, agentId: agentId || sessionId } : {}) });
  const emitter = createEmitter({ provider: 'codex', sessionId, workspaceRoot: root, emit: forward, displayName });
  const agents = trackAgents ? suppliedAgents || createCodexAgents({ root, sessionId, emit: forward }) : null;
  const collabCalls = new Map();
  const pending = new Map(),
    completed = new Set(),
    messages = new Set(),
    turns = new Set();
  const roots = new Set([root, ...workspaceAliases.map(p => localPath(p)).filter(Boolean)]);
  let observedAt = Date.now(),
    projected = false,
    lastCompact = null;
  const questions = new Map();
  let active = false,
    cwd = root,
    inWorkspace = !requireContext,
    externalTurn = null,
    contextLimit;
  const remember = (set, key, limit = 4096) => {
    set.add(key);
    if (set.size > limit) set.delete(set.values().next().value);
  };
  const rel = (value, base = cwd) => resource(value, root, base)?.path || null;
  const resources = values =>
    (Array.isArray(values) ? values : [])
      .map(value => resource(value, root, cwd))
      .filter(Boolean)
      .slice(0, 32);
  function compact(source) {
    const key = externalTurn || emitter.turnId;
    if (
      lastCompact &&
      lastCompact.key === key &&
      lastCompact.source !== source &&
      Math.abs(observedAt - lastCompact.at) < 30000
    ) {
      lastCompact = null;
      return;
    }
    if (begin()) {
      emitter.send('attention', { reason: 'compact' });
      lastCompact = { key, source, at: observedAt };
    }
  }
  function resolveQuestion(request, q) {
    if (!q?.acknowledged || q.answers.size < q.count) return;
    emitter.send(
      'question.resolved',
      { requestId: idOf(request), state: 'answered' },
      { turnId: q.turnId, operationId: q.id },
    );
    questions.delete(request);
  }
  function answer(text) {
    const match = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/.exec(text);
    if (!match) return;
    try {
      for (const reply of JSON.parse(match[1])) {
        const identity = JSON.parse(reply.questionItemId),
          request = identity[1],
          q = questions.get(request);
        if (!q) continue;
        q.answers.add(identity[2]);
        resolveQuestion(request, q);
      }
    } catch {
      /* An unrelated message cannot resolve a pending question. */
    }
  }
  function context(record) {
    if (typeof record.cwd === 'string') {
      const resolved = localPath(record.cwd);
      cwd = resolved || root;
      inWorkspace = !!resolved && roots.has(cwd);
      if (inWorkspace) cwd = root;
    }
    if (record.turn_id) externalTurn = record.turn_id;
    if (Number.isFinite(record.model_context_window)) contextLimit = record.model_context_window;
  }
  function begin(text = 'Codex turn', turnId = externalTurn) {
    if (!inWorkspace || (turnId && turns.has(idOf(turnId)))) return false;
    if (active) return true;
    pending.clear();
    completed.clear();
    messages.clear();
    emitter.begin(clip(text, 8192), turnId ? idOf(turnId) : undefined);
    active = true;
    if (rootSessionId) agents?.state(agentId || sessionId, 'running', { restart: true });
    return true;
  }
  function finish(outcome = 'completed', payload = {}) {
    if (!active) return;
    // Close observed children before the parent turn. Missing outcomes never imply successful writes.
    for (const operation of pending.values())
      for (const operationId of operation.ids)
        emitter.send(
          'operation.finished',
          { ok: false, error: 'Operation ended without a recorded outcome.' },
          { operationId },
        );
    pending.clear();
    collabCalls.clear();
    if (outcome !== 'completed')
      for (const [id, q] of questions) {
        if (q.acknowledged)
          emitter.send(
            'question.resolved',
            { requestId: idOf(id), state: 'cancelled' },
            { turnId: q.turnId, operationId: q.id },
          );
        questions.delete(id);
      }
    emitter.send('turn.finished', { ...payload, outcome });
    active = false;
    remember(turns, emitter.turnId, 256);
    externalTurn = null;
    if (rootSessionId)
      agents?.state(
        agentId || sessionId,
        payload.outcomeUnobserved ? 'unknown' : outcome === 'failed' ? 'errored' : outcome,
      );
  }
  function message(text, role = 'assistant', key) {
    const contentKey = `${role}.${createHash('sha256').update(String(text)).digest('hex')}`;
    if (!inWorkspace || !text || messages.has(contentKey) || (key && messages.has(key)) || !begin()) return;
    remember(messages, contentKey);
    if (key) remember(messages, key);
    emitter.send('message', { role, text: clip(text, 8192) });
  }
  function usage(info, limit = contextLimit) {
    if (!active || !inWorkspace || !info) return;
    const context = info.input_tokens ?? info.inputTokens;
    if (!Number.isFinite(context)) return;
    emitter.send('usage', {
      context,
      output: info.output_tokens ?? info.outputTokens ?? 0,
      ...(Number.isFinite(limit) ? { contextLimit: limit } : {}),
    });
  }
  function operation(id, payload) {
    id = idOf(id);
    if (!inWorkspace || pending.has(id) || completed.has(id) || !begin()) return;
    if (pending.size >= 256) throw new Error('Codex operation backlog exceeded its limit.');
    // Split large manifests to preserve every declared path within the v1 payload bounds.
    const entries = payload.changes?.length ? payload.changes : (payload.files || []).map(path => ({ path }));
    const groups = [[]];
    let bytes = 0;
    for (const entry of entries) {
      const n = Buffer.byteLength(JSON.stringify(entry));
      if (groups.at(-1).length >= 32 || bytes + n > 22000) {
        groups.push([]);
        bytes = 0;
      }
      groups.at(-1).push(entry);
      bytes += n;
    }
    const ids = groups.map((group, i) => {
      const operationId = groups.length === 1 ? id : `${id}.part.${i}`;
      emitter.send(
        'operation.started',
        {
          observedAt,
          ...(projected ? { metadataTruncated: true } : {}),
          ...payload,
          files: group.map(e => e.path),
          ...(payload.changes ? { changes: group } : {}),
        },
        { operationId },
      );
      return operationId;
    });
    pending.set(id, { ids, action: payload.action, requestId: payload.requestId });
  }
  function resolve(id, ok, payload = {}) {
    id = idOf(id);
    const operation = pending.get(id);
    if (!operation || !active || !inWorkspace) return; // Work started before attachment, or another workspace.
    for (const operationId of operation.ids) emitter.send('operation.finished', { ...payload, ok }, { operationId });
    pending.delete(id);
    remember(completed, id);
  }
  function patchChanges(patch) {
    const changes = [];
    for (const line of String(patch || '').split('\n')) {
      const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (header) {
        const p = rel(header[2]);
        if (p)
          changes.push({ path: p, change: changeOf({ Add: 'add', Update: 'update', Delete: 'delete' }[header[1]]) });
      }
      const move = /^\*\*\* Move to: (.+)$/.exec(line);
      if (move) {
        const p = rel(move[1]);
        if (p && changes.length) {
          changes.at(-1).change = 'delete';
          changes.push({ path: p, change: 'create' });
        }
      }
    }
    return changes;
  }
  const manifest = changes => ({
    action:
      changes.length && changes.every(c => c.change === 'create')
        ? 'create'
        : changes.length && changes.every(c => c.change === 'delete')
          ? 'delete'
          : 'edit',
    changes,
    files: changes.map(c => c.path),
    tool: 'apply_patch',
    label: `Patch ${changes.length} file${changes.length === 1 ? '' : 's'}`,
  });
  function toolCall(item) {
    const name = String(item.name || '')
        .split('.')
        .at(-1),
      id = item.call_id || item.id;
    let args = item.arguments ?? item.input ?? {};
    if (typeof args === 'string' && name !== 'apply_patch') {
      try {
        args = JSON.parse(args);
      } catch {
        args = {};
      }
    }
    let payload;
    if (name === 'apply_patch')
      payload = manifest(patchChanges(typeof args === 'string' ? args : args.patch || args.input));
    else if (['exec_command', 'shell', 'shell_command'].includes(name))
      payload = {
        action: 'command',
        tool: name,
        command: clip(args.cmd || args.command, 1000),
        label: clip(args.description || args.cmd || args.command),
        files: [],
      };
    else if (['read_file', 'view_image'].includes(name))
      payload = {
        action: 'read',
        tool: name,
        files: [rel(args.path || args.file_path)].filter(Boolean),
        inputs: resources([args.path || args.file_path]),
        label: name,
      };
    else if (name === 'update_plan') payload = { action: 'task', tool: name, label: 'Plan update' };
    else if (
      [
        'spawn_agent',
        'wait',
        'wait_agent',
        'send_input',
        'send_message',
        'followup_task',
        'resume_agent',
        'close_agent',
        'interrupt_agent',
        'list_agents',
      ].includes(name)
    ) {
      payload = {
        action: 'task',
        tool: name,
        label: clip(args.description || args.task_name || name.replaceAll('_', ' ')),
      };
      collabCalls.set(id, { name, args });
      if (collabCalls.size > 256) collabCalls.delete(collabCalls.keys().next().value);
    } else if (name === 'search_query' || item.namespace === 'web')
      payload = { action: 'web', tool: name, label: 'Web lookup' };
    else if (name === 'request_user_input' || name === 'request_user_input_async')
      payload = {
        action: 'question',
        tool: name,
        label: 'User input',
        requestId: idOf(id),
        asynchronous: name.endsWith('_async'),
      };
    // Opaque code-mode wrappers are never evaluated or mined for filenames. Typed items describe their work.
    if (payload && id) {
      operation(id, payload);
      if (payload.asynchronous)
        questions.set(id, {
          turnId: emitter.turnId,
          id: idOf(id),
          count: Math.max(1, args.questions?.length || 1),
          answers: new Set(),
        });
    }
  }
  function itemRecord(item, done, timing = {}) {
    const type = typeOf(item),
      id = item.id;
    if (['collabtoolcall', 'collabagenttoolcall', 'subagentactivity'].includes(type)) {
      if (begin()) agents?.observe(sessionId, item, done);
      return;
    }
    if (type === 'usermessage' || type === 'agentmessage' || type === 'reasoning') {
      if (!done) return;
      if (type === 'usermessage') {
        const text = textOf(item.content);
        answer(text);
        return begin(text);
      }
      return message(
        item.text || textOf(item.content) || textOf(item.summary_text || item.summary),
        type === 'reasoning' ? 'reasoning' : 'assistant',
        id,
      );
    }
    if (type === 'contextcompaction') {
      if (done) compact('item');
      return;
    }
    let payload;
    if (type === 'filechange') {
      const changes = [];
      const entries = Array.isArray(item.changes)
        ? item.changes
        : Object.entries(item.changes || {}).map(([path, c]) => ({ path, ...c }));
      for (const c of entries) {
        const p = rel(c.path),
          change = changeOf(c.kind || c.type),
          move = c.move_path || c.kind?.move_path;
        if (!p || !change) continue;
        changes.push({ path: p, change: move ? 'delete' : change });
        if (move) {
          const to = rel(move);
          if (to) changes.push({ path: to, change: 'create' });
        }
      }
      payload = manifest(changes);
    } else if (type === 'commandexecution') {
      const actions = item.commandActions || item.parsed_cmd || [],
        base = localPath(item.cwd) || cwd;
      const reads = actions.filter(a => a.type === 'read'),
        searches = actions.filter(a => a.type === 'search' || a.type === 'listFiles' || a.type === 'list_files');
      const action =
        reads.length === actions.length && reads.length
          ? 'read'
          : searches.length === actions.length && searches.length
            ? 'search'
            : 'command';
      payload = {
        action,
        tool: 'command_execution',
        command: clip(Array.isArray(item.command) ? item.command.join(' ') : item.command, 1000),
        files: action === 'read' ? [...new Set(reads.map(a => rel(a.path, base)).filter(Boolean))] : [],
        label: clip(Array.isArray(item.command) ? item.command.join(' ') : item.command),
        inputs: reads
          .map(a => resource(a.path, root, base))
          .filter(Boolean)
          .slice(0, 32),
      };
    } else if (type === 'mcptoolcall' || type === 'dynamictoolcall')
      payload = {
        action: item.server === 'cua_repl' ? 'ui' : 'other',
        evidence: 'tool',
        tool: clip(`${item.server || ''}.${item.tool || ''}`),
        label: clip(item.arguments?.title || item.tool || 'External tool'),
      };
    else if (type === 'websearch' || (type === 'extension' && item.kind?.startsWith('web.')))
      payload = { action: 'web', tool: 'web_search', label: clip(item.query || 'Web lookup') };
    else if (type === 'imageview')
      payload = {
        action: 'read',
        tool: 'view_image',
        files: [rel(item.path)].filter(Boolean),
        inputs: resources([item.path]),
        label: 'View image',
      };
    else if (type === 'extension' && item.kind === 'image_gen.generation')
      payload = {
        action: 'artifact',
        artifactType: 'image',
        tool: item.kind,
        label: 'Generate image',
        evidence: 'tool',
        inputs: resources(item.referenced_image_paths || []),
        outputs: resources(
          [
            item.savedPath,
            item.path,
            item.output_path,
            ...(Array.isArray(item.outputPaths) ? item.outputPaths : []),
          ].filter(Boolean),
        ),
      };
    else if (type === 'todolist' || type === 'plan') payload = { action: 'task', tool: 'plan', label: 'Plan update' };
    if (!payload && id)
      payload = {
        action: 'other',
        tool: clip(item.kind || item.type),
        label: clip(item.kind || item.type || 'Unsupported operation'),
        unsupported: true,
      };
    if (!payload || !id || !inWorkspace) return;
    const seconds =
      typeof item.duration === 'number' ? item.duration : item.duration?.secs + (item.duration?.nanos || 0) / 1e9;
    payload = {
      ...payload,
      ...semantics(item.galaxy || item.result?.structuredContent?.galaxy || item.arguments?.galaxy, root, cwd),
      ...(done && !pending.has(idOf(id)) ? { completionOnly: true } : {}),
      ...(done && Number.isFinite(seconds) && seconds >= 0
        ? { startedAt: observedAt - seconds * 1000, finishedAt: observedAt }
        : {}),
    };
    if (Number.isFinite(timing.started_at_ms)) payload.startedAt = timing.started_at_ms;
    if (Number.isFinite(timing.completed_at_ms)) payload.finishedAt = timing.completed_at_ms;
    payload.timingSource = Number.isFinite(timing.started_at_ms)
      ? 'provider'
      : done && Number.isFinite(seconds)
        ? 'duration'
        : 'observed';
    operation(id, payload);
    if (done) {
      const ok =
        !['failed', 'declined', 'cancelled', 'interrupted'].includes(item.status) &&
        !item.error &&
        !item.failure &&
        !item.result?.isError &&
        item.success !== false &&
        (item.exit_code ?? item.exitCode ?? 0) === 0;
      resolve(id, ok, {
        ...(ok ? {} : { error: clip(item.error?.message || item.error || item.stderr || 'Operation failed', 1000) }),
        output: clip(item.aggregated_output || item.aggregatedOutput || item.stdout, 2000),
      });
    }
  }
  function record(record) {
    if (!record || typeof record !== 'object') return;
    observedAt = Number.isFinite(Date.parse(record.timestamp)) ? Date.parse(record.timestamp) : Date.now();
    projected = !!record._projection?.truncated;
    const p = record.payload || {};
    if (record.type === 'session_meta') {
      context(p);
      return;
    }
    if (record.type === 'turn_context') {
      const previous = inWorkspace;
      context(p);
      if (previous && !inWorkspace) finish('interrupted');
      return;
    }
    if (record.type === 'compacted') {
      compact('record');
      return;
    }
    if (record.type === 'event_msg') {
      if (p.type === 'task_started') {
        if (Number.isFinite(p.model_context_window)) contextLimit = p.model_context_window;
        if (active) finish('interrupted');
        externalTurn = p.turn_id || null;
      } else if (p.type === 'task_complete' && (!externalTurn || p.turn_id === externalTurn)) finish('completed');
      else if (p.type === 'turn_aborted' && (!externalTurn || p.turn_id === externalTurn)) finish('interrupted');
      else if (p.type === 'item_started' || p.type === 'item_completed') {
        if (p.turn_id && ((externalTurn && p.turn_id !== externalTurn) || turns.has(idOf(p.turn_id)))) return;
        itemRecord(p.item || {}, p.type === 'item_completed', p);
      } else if (p.type === 'user_message') {
        answer(p.message || '');
        if (!active) begin(p.message);
      } else if (p.type === 'agent_message') message(p.message);
      else if (p.type === 'token_count') usage(p.info?.last_token_usage, p.info?.model_context_window);
      return;
    }
    if (record.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(p.type)) toolCall(p);
      else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
        const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output || {});
        const exit = /(?:Process exited with code|Exit code:)\s*(\d+)/.exec(output);
        const mutation = ['create', 'edit', 'delete'].includes(pending.get(idOf(p.call_id))?.action);
        const ok =
          (!exit || Number(exit[1]) === 0) &&
          !/"isError"\s*:\s*true|^Error:|apply_patch verification failed/i.test(output) &&
          (!mutation || /Success\. Updated|"success"\s*:\s*true/i.test(output));
        const collab = collabCalls.get(p.call_id);
        if (collab) {
          collabCalls.delete(p.call_id);
          let value;
          try {
            value = typeof p.output === 'string' ? JSON.parse(p.output) : p.output;
            if (value?.content)
              value = JSON.parse(
                value.content
                  .filter(b => b.type === 'text')
                  .map(b => b.text)
                  .join('\n'),
              );
          } catch {
            /* Missing structured identity is never guessed from prose. */
          }
          if (ok && value && inWorkspace) {
            const childId = value.agent_id || value.agentId;
            if (collab.name === 'spawn_agent' && childId) {
              agents?.register(childId, sessionId, {
                operationId: idOf(p.call_id),
                label: collab.args.description || collab.args.task_name || collab.args.message?.split('\n')[0],
              });
              agents?.state(childId, 'running');
            }
            for (const [id, status] of Object.entries(value.status || {})) {
              const state = typeof status === 'string' ? status : Object.keys(status || {})[0];
              agents?.state(id, state);
            }
            const target = collab.args.id || collab.args.agent_id;
            if (collab.name === 'close_agent') agents?.state(target, 'shutdown');
            else if (collab.name === 'interrupt_agent') agents?.state(target, 'interrupted');
            else if (['resume_agent', 'followup_task', 'send_input'].includes(collab.name))
              agents?.state(target, 'running', { restart: true });
          }
        }
        const awaitingAnswer = questions.has(p.call_id) && ok && /"accepted"\s*:\s*true/.test(output);
        if (awaitingAnswer) questions.get(p.call_id).acknowledged = true;
        if (questions.has(p.call_id) && !awaitingAnswer) questions.delete(p.call_id);
        resolve(p.call_id, ok, {
          ...(awaitingAnswer ? { awaitingAnswer: true } : {}),
          output: clip(output, 2000),
          ...(ok ? {} : { error: clip(output, 1000) }),
        });
        if (awaitingAnswer) resolveQuestion(p.call_id, questions.get(p.call_id));
      } else if (p.type === 'message' && p.role === 'assistant') message(textOf(p.content), 'assistant', p.id);
      // User/developer instruction blocks and encrypted reasoning are never rendered as prompts.
      return;
    }
    // Public CLI JSONL. These events are distinct from the private rollout representation above.
    if (record.type === 'turn.started') begin();
    else if (record.type === 'item.started' || record.type === 'item.updated' || record.type === 'item.completed')
      itemRecord(record.item || {}, record.type === 'item.completed');
    else if (record.type === 'turn.completed') {
      usage(record.usage);
      finish('completed');
    } else if (record.type === 'turn.failed') {
      message(record.error?.message || 'Codex turn failed', 'error');
      finish('failed');
    } else if (record.type === 'error') {
      message(record.message || 'Codex stream error', 'error');
    }
  }
  return {
    start: emitter.start,
    begin,
    finish,
    record,
    prime: r => {
      if (r.type === 'session_meta' || r.type === 'turn_context') context(r.payload || {});
    },
    get turnId() {
      return emitter.turnId;
    },
    agents,
  };
}
