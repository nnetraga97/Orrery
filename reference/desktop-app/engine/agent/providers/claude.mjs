// Decode Claude records into semantic work. No rendering or workspace-watching behavior lives here.
// One normalizer per session: it remembers each tool_use so the matching tool_result can be resolved against it.
// Events: { kind, agent, ... } — the host adds id, t and session. `agent` is the subagent's spawning tool_use id, or null.
import path from 'node:path';
import { resource } from '../resources.cjs';
import { semantics } from '../semantics.cjs';
import { createEmitter } from '../protocol.cjs';

// Which round the cannon fires for each tool.
const ACTIONS = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'create',
  Bash: 'command',
  BashOutput: 'command',
  KillShell: 'command',
  KillBash: 'command',
  TaskStop: 'command',
  Monitor: 'command',
  Agent: 'delegate',
  Task: 'delegate',
  WebSearch: 'web',
  WebFetch: 'web',
  TodoWrite: 'task',
  TaskCreate: 'task',
  TaskUpdate: 'task',
  TaskList: 'task',
  TaskGet: 'task',
  Skill: 'load',
  ToolSearch: 'load',
  AskUserQuestion: 'question',
  ExitPlanMode: 'question',
  EnterPlanMode: 'question',
};
const actionOf = name => ACTIONS[name] || 'other';
const MUTATING = new Set(['edit', 'create', 'command']);

const clip = (s, n = 160) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
      : '';

function createNormalizer(root) {
  const tools = new Map(); // tool_use id -> { name, input, action, agent }
  const usageSeen = new Set(); // message ids whose usage was already reported (one API response = several messages)
  let mutated = false; // did this turn change files (or run commands that might have)?

  // Absolute or cwd-relative path -> path relative to the linked root, or null when it is outside it.
  const rel = p => resource(p, root)?.path || null;
  // Path-looking tokens in a shell command. The viewer keeps the ones that are files in the dataset.
  const commandPaths = cmd => {
    const tokens = [...String(cmd).matchAll(/"([^"]*)"|'([^']*)'|([^\s'"]+)/g)].flatMap(m =>
      (m[1] ?? m[2]) != null ? [m[1] ?? m[2]] : m[3].split(/[=;|&()<>`]+/),
    );
    return [
      ...new Set(
        tokens
          .filter(t => /[\w.-]\/|\.\w{1,6}$/.test(t) && !/^-|^https?:/.test(t))
          .map(rel)
          .filter(Boolean),
      ),
    ];
  };

  function fire(block, agent) {
    const { id, name, input = {} } = block,
      action = actionOf(name);
    tools.set(id, { name, input, action, agent });
    const ev = { kind: 'fire', agent, toolId: id, tool: name, action, files: [], label: name };
    switch (name) {
      case 'Read':
      case 'NotebookRead': {
        ev.files = [rel(input.file_path || input.notebook_path)].filter(Boolean);
        if (input.offset) ev.lines = [input.offset, input.offset + (input.limit || 2000) - 1];
        ev.label = `Read ${ev.files[0] || input.file_path}`;
        break;
      }
      case 'Edit':
      case 'MultiEdit':
      case 'Write':
      case 'NotebookEdit':
        ev.files = [rel(input.file_path || input.notebook_path)].filter(Boolean);
        ev.label = `${name} ${ev.files[0] || input.file_path}`;
        if (!ev.files.length) ev.outside = input.file_path || input.notebook_path;
        break;
      case 'Grep':
      case 'Glob':
        ev.label = `${name} ${clip(input.pattern, 60)}`;
        break;
      case 'Bash':
        ev.files = commandPaths(input.command);
        ev.label = clip(input.description || input.command, 90);
        ev.command = clip(input.command, 400);
        ev.test = /\b(test|tests|vitest|jest|mocha|pytest|check|checks|tsc|lint|eslint|gradle|mvn)\b/.test(
          input.command || '',
        );
        ev.commit = /\bgit\s+commit\b/.test(input.command || '');
        break;
      case 'Agent':
      case 'Task':
        ev.label = `${input.subagent_type || 'agent'} · ${clip(input.description, 60)}`;
        break;
      case 'WebSearch':
        ev.label = `Search ${clip(input.query, 70)}`;
        break;
      case 'WebFetch':
        ev.label = `Fetch ${clip(input.url, 70)}`;
        break;
      case 'TodoWrite':
        ev.todos = (input.todos || []).map(t => ({ text: clip(t.content, 90), status: t.status }));
        ev.label = 'Todo list';
        break;
      case 'TaskCreate':
        ev.label = `Task · ${clip(input.subject, 70)}`;
        break;
      case 'TaskUpdate':
        ev.label = `Task ${input.taskId} → ${input.status || 'updated'}`;
        break;
      case 'Skill':
        ev.label = `Skill ${input.skill}`;
        break;
      default:
        if (name.startsWith('mcp__')) ev.label = name.split('__').slice(1).join(' · ');
    }
    Object.assign(ev, semantics(input.galaxy, root));
    return ev;
  }

  function resolve(block, extra) {
    const call = tools.get(block.tool_use_id) || { name: '?', input: {}, action: 'other', agent: null };
    tools.delete(block.tool_use_id);
    const text = textOf(block.content);
    const ok = !block.is_error;
    const ev = {
      kind: 'resolve',
      agent: call.agent,
      toolId: block.tool_use_id,
      tool: call.name,
      action: call.action,
      ok,
      files: [],
    };
    if (!ok) {
      ev.error = clip(text, 240);
      if (/doesn't want to proceed|rejected/i.test(text)) ev.denied = true;
    }
    Object.assign(ev, semantics(extra?.galaxy, root));
    const r = extra && typeof extra === 'object' ? extra : {};
    if (ok)
      switch (call.name) {
        case 'Read': {
          const f = r.file;
          ev.files = [rel(f?.filePath || call.input.file_path)].filter(Boolean);
          if (f?.startLine && f?.numLines) ev.lines = [f.startLine, f.startLine + f.numLines - 1];
          break;
        }
        case 'Edit':
        case 'MultiEdit':
        case 'Write':
        case 'NotebookEdit': {
          ev.files = [rel(r.filePath || call.input.file_path)].filter(Boolean);
          const hunks = r.structuredPatch || [];
          if (hunks.length)
            ev.lines = [
              Math.min(...hunks.map(h => h.newStart)),
              Math.max(...hunks.map(h => h.newStart + Math.max(1, h.newLines) - 1)),
            ];
          ev.changed =
            hunks.reduce((n, h) => n + h.lines.filter(l => l[0] === '+' || l[0] === '-').length, 0) ||
            (call.name === 'Write' ? String(call.input.content || '').split('\n').length : 1);
          if (call.name === 'Write') ev.created = r.type === 'create';
          break;
        }
        case 'Grep':
        case 'Glob': {
          const names = r.filenames || (typeof text === 'string' ? text.split('\n').map(l => l.split(':')[0]) : []);
          ev.files = [...new Set(names.map(rel).filter(Boolean))].slice(0, 60);
          ev.matches = r.numFiles ?? names.length;
          break;
        }
        case 'Bash':
          ev.files = commandPaths(call.input.command);
          ev.output = clip(r.stdout || text, 240);
          break;
        case 'TodoWrite':
          ev.todos = (r.newTodos || call.input.todos || []).map(t => ({ text: clip(t.content, 90), status: t.status }));
          break;
        case 'Agent':
        case 'Task':
          ev.background = r.status === 'async_launched' || !!r.isAsync;
          ev.output = clip(text, 240);
          break;
      }
    if (call.name === 'Bash' && !ok) ev.output = ev.error;
    if (MUTATING.has(call.action) && ok) mutated = true;
    if (call.name === 'Bash') {
      ev.test = /\b(test|tests|vitest|jest|mocha|pytest|check|checks|tsc|lint|eslint|gradle|mvn)\b/.test(
        call.input.command || '',
      );
      ev.commit = /\bgit\s+commit\b/.test(call.input.command || '');
    }
    return ev;
  }

  // One SDK message -> zero or more events.
  function normalize(msg) {
    const agent = msg.parent_tool_use_id || null,
      evs = [];
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init')
          evs.push({ kind: 'init', agent, model: msg.model, providerSessionId: msg.session_id, cwd: msg.cwd });
        else if (msg.subtype === 'compact_boundary')
          evs.push({
            kind: 'compact',
            agent,
            pre: msg.compact_metadata?.pre_tokens,
            post: msg.compact_metadata?.post_tokens,
          });
        else if (msg.subtype === 'api_retry')
          evs.push({
            kind: 'stall',
            agent,
            attempt: msg.attempt,
            max: msg.max_retries,
            delayMs: msg.retry_delay_ms,
            status: msg.error_status,
          });
        else if (msg.subtype === 'task_started')
          evs.push({
            kind: 'drone-launch',
            agent,
            toolId: msg.tool_use_id,
            taskId: msg.task_id,
            label: clip(msg.description, 80),
            subagent: msg.subagent_type,
          });
        else if (msg.subtype === 'task_notification')
          evs.push({
            kind: 'drone-dock',
            agent,
            toolId: msg.tool_use_id,
            taskId: msg.task_id,
            status: msg.status,
            label: clip(msg.summary, 120),
          });
        break;
      case 'assistant': {
        const m = msg.message || {};
        if (msg.error || msg.isApiErrorMessage)
          evs.push({ kind: 'stall', agent, error: clip(textOf(m.content) || msg.error, 160) });
        for (const b of m.content || []) {
          if (b.type === 'thinking' || b.type === 'redacted_thinking') evs.push({ kind: 'thinking', agent });
          else if (b.type === 'text' && b.text?.trim()) evs.push({ kind: 'text', agent, text: clip(b.text, 400) });
          else if (b.type === 'tool_use' || b.type === 'server_tool_use' || b.type === 'mcp_tool_use')
            evs.push(fire(b, agent));
        }
        if (!agent && m.id && m.usage && !usageSeen.has(m.id)) {
          usageSeen.add(m.id);
          const u = m.usage;
          if (usageSeen.size > 512) usageSeen.delete(usageSeen.values().next().value);
          evs.push({
            kind: 'usage',
            agent,
            context: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
            output: u.output_tokens || 0,
            model: m.model,
          });
        }
        break;
      }
      case 'user': {
        if (msg.isReplay) break;
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          const results = content.filter(b => b.type === 'tool_result');
          results.forEach(b => evs.push(resolve(b, results.length === 1 ? msg.tool_use_result : null)));
          if (!results.length && /\[Request interrupted by user/.test(textOf(content)))
            evs.push({ kind: 'interrupt', agent });
        } else if (typeof content === 'string' && /\[Request interrupted by user/.test(content))
          evs.push({ kind: 'interrupt', agent });
        break;
      }
      case 'result': {
        evs.push({
          kind: 'turn-end',
          agent,
          ok: !msg.is_error && msg.subtype === 'success',
          subtype: msg.subtype,
          cost: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          turns: msg.num_turns,
          queued: msg.queued_turn_count || 0,
          mutated,
          result: clip(msg.result, 240),
        });
        mutated = false;
        break;
      }
    }
    return evs;
  }
  return { normalize, rel };
}

// Claude's record layout stays inside this adapter. The runtime never knows tool names or log locations.
export function createClaudeAdapter({ root, sessionId, emit, displayName = 'Claude Code' }) {
  const emitter = createEmitter({ provider: 'claude-code', sessionId, workspaceRoot: root, emit, displayName });
  const normalizer = createNormalizer(root),
    finished = new Set();
  let active = false;
  function begin(text = 'Claude Code turn', turnId) {
    if (!active) {
      emitter.begin(text, turnId);
      active = true;
    }
  }
  function finish(outcome = 'completed', payload = {}) {
    if (active) {
      emitter.send('turn.finished', { ...payload, outcome });
      active = false;
    }
  }
  function convert(e) {
    const fields = e.toolId ? { operationId: e.toolId } : {};
    if (e.agent) fields.parentOperationId = e.agent;
    const { kind, agent, toolId, ...payload } = e;
    if (payload.action === 'command') {
      delete payload.test;
      delete payload.commit;
      payload.files = [];
    }
    if (kind === 'resolve' && payload.tool === '?') return; // Result for work that began before this adapter attached.
    if (kind === 'resolve' && payload.action === 'delegate' && payload.background) return;
    if (kind === 'fire' || kind === 'resolve')
      return emitter.send(kind === 'fire' ? 'operation.started' : 'operation.finished', payload, fields);
    if (kind === 'text' || kind === 'thinking')
      return emitter.send(
        'message',
        { role: kind === 'thinking' ? 'reasoning' : 'assistant', text: payload.text || '' },
        fields,
      );
    if (kind === 'usage') return emitter.send('usage', payload);
    if (kind === 'compact' || kind === 'stall') return emitter.send('attention', { ...payload, reason: kind });
    if (kind === 'interrupt') return finish('interrupted');
    if (kind === 'turn-end') return finish(e.ok ? 'completed' : 'failed', payload);
    if (kind === 'drone-dock' && e.toolId)
      return emitter.send(
        'operation.finished',
        { action: 'delegate', tool: 'Agent', ok: e.status !== 'failed', files: [], background: false },
        fields,
      );
  }
  function record(r, parentOperationId = null) {
    if (r.isMeta || r.isCompactSummary) return;
    const content = r.message?.content;
    const prompt =
      r.type === 'user' &&
      !parentOperationId &&
      !r.isSidechain &&
      (typeof content === 'string'
        ? content
        : Array.isArray(content) && !content.some(b => b.type === 'tool_result')
          ? content
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n')
          : null);
    if (typeof prompt === 'string' && prompt.trim() && !/^\s*</.test(prompt) && !/^\[Request interrupted/.test(prompt))
      begin(prompt.trim().slice(0, 32000));
    const events = normalizer.normalize({
      ...r,
      parent_tool_use_id: parentOperationId || r.parent_tool_use_id,
      tool_use_result: r.toolUseResult || r.tool_use_result,
    });
    if (events.some(e => ['fire', 'thinking', 'text'].includes(e.kind))) begin();
    const texts = (Array.isArray(content) ? content : []).filter(b => b.type === 'text' && b.text?.trim());
    for (const e of events)
      if (active) {
        if (e.kind === 'text') e.text = texts.shift()?.text?.slice(0, 32000) || e.text;
        convert(e);
      }
    const m = r.message;
    if (!parentOperationId && r.type === 'assistant' && m?.stop_reason === 'end_turn' && !finished.has(m.id)) {
      finished.add(m.id);
      if (finished.size > 128) finished.delete(finished.values().next().value);
      finish();
    }
  }
  return {
    start: emitter.start,
    begin,
    finish,
    record,
    get turnId() {
      return emitter.turnId;
    },
  };
}
