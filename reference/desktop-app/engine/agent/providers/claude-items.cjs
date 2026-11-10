// Claude Code messages -> the chat transcript's item shapes (userMessage, agentMessage, reasoning,
// commandExecution, fileChange, webSearch, dynamicToolCall), so the chat panel renders Claude and
// Codex conversations alike. Live stream-json output and saved transcript records share this path.
// Subagent work (parent_tool_use_id) stays out of the transcript; the scene shows it as drones.
const path = require('node:path');

const OUTPUT_LIMIT = 20000;
const clip = (value, limit = OUTPUT_LIMIT) => {
  const text = String(value ?? '');
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
};
const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map(block => (block?.type === 'text' ? block.text : ''))
          .filter(Boolean)
          .join('\n')
      : '';
const lines = (prefix, text) =>
  String(text ?? '')
    .split('\n')
    .map(line => prefix + line)
    .join('\n');

function hunkDiff(hunks) {
  return hunks
    .map(h => [`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, ...(h.lines || [])].join('\n'))
    .join('\n');
}

/** The prompt text of a user record, or null for tool results, meta records and command wrappers. */
function promptOf(record) {
  if (record.type !== 'user' || record.isMeta || record.isCompactSummary || record.isSidechain) return null;
  if (record.parent_tool_use_id) return null;
  const content = record.message?.content;
  if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) return null;
  const text = textOf(content).trim();
  if (!text || /^\[Request interrupted/.test(text) || /^</.test(text)) return null;
  return text;
}

// A project-relative path when the file is inside the project, otherwise the path as given.
function displayPath(root, file) {
  if (!file) return '';
  const relative = path.relative(root, path.resolve(root, String(file)));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : String(file);
}

/** The diff an Edit, MultiEdit, Write or NotebookEdit call makes (or made, given its result). */
function toolChanges(root, name, input, result) {
  const file = displayPath(root, input.file_path || input.notebook_path);
  if (result?.structuredPatch?.length)
    return [{ path: file, kind: result.type === 'create' ? 'add' : 'update', diff: hunkDiff(result.structuredPatch) }];
  if (name === 'Write')
    return [{ path: file, kind: result?.type === 'update' ? 'update' : 'add', diff: lines('+', input.content) }];
  const edits = name === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits : []) : [input];
  const diff = edits
    .map(e => [lines('-', e?.old_string ?? ''), lines('+', e?.new_string ?? e?.new_source ?? '')].join('\n'))
    .join('\n');
  return [{ path: file, kind: 'update', diff }];
}

function createItemBuilder({ root, upsert }) {
  const display = file => displayPath(root, file);
  const changesFor = (name, input, result) => toolChanges(root, name, input, result);
  const tools = new Map(); // tool_use id -> { name, input }
  const streams = new Map(); // assistant message id -> { blocks: Map(index -> item), done: { text, thinking } }

  function toolItem(block) {
    const input = block.input && typeof block.input === 'object' ? block.input : {};
    const name = String(block.name || 'tool');
    const base = { id: block.id, tool: name };
    switch (name) {
      case 'Bash':
        return { ...base, type: 'commandExecution', command: input.command || '', cwd: root, output: '' };
      case 'Read':
      case 'NotebookRead': {
        const file = display(input.file_path || input.notebook_path);
        return {
          ...base,
          type: 'commandExecution',
          command: `Read ${file}`,
          commandActions: [{ type: 'read', name: path.basename(file), path: file }],
        };
      }
      case 'Grep':
      case 'Glob':
        return {
          ...base,
          type: 'commandExecution',
          command: `${name} ${input.pattern || ''}`,
          commandActions: [{ type: 'search', query: input.pattern || '', path: input.path ? display(input.path) : '' }],
        };
      case 'LS':
        return {
          ...base,
          type: 'commandExecution',
          command: `List ${display(input.path)}`,
          commandActions: [{ type: 'list_files', path: display(input.path) || '.' }],
        };
      case 'Edit':
      case 'MultiEdit':
      case 'Write':
      case 'NotebookEdit':
        return { ...base, type: 'fileChange', changes: changesFor(name, input) };
      case 'WebSearch':
        return { ...base, type: 'webSearch', query: input.query || '' };
      case 'Agent':
      case 'Task':
        return {
          ...base,
          type: 'dynamicToolCall',
          tool: `${input.subagent_type || 'agent'} · ${clip(input.description || '', 80)}`,
          arguments: input,
        };
      default: {
        const [, server, tool] = name.match(/^mcp__(.+?)__(.+)$/) || [];
        return { ...base, type: 'dynamicToolCall', server: server || '', tool: tool || name, arguments: input };
      }
    }
  }

  function toolUse(block, turnId) {
    if (!block?.id) return;
    tools.set(block.id, { name: block.name, input: block.input || {} });
    upsert(toolItem(block), turnId, 'inProgress');
  }

  function toolResult(block, result, turnId) {
    const call = tools.get(block.tool_use_id);
    if (!call) return;
    tools.delete(block.tool_use_id);
    const text = textOf(block.content);
    const failed = !!block.is_error;
    const declined = failed && /doesn't want to proceed|rejected|denied|declined|read-only/i.test(text);
    const item = { ...toolItem({ id: block.tool_use_id, name: call.name, input: call.input }) };
    const r = result && typeof result === 'object' ? result : {};
    if (item.type === 'commandExecution') {
      item.output = clip(call.name === 'Bash' ? [r.stdout, r.stderr].filter(Boolean).join('\n') || text : '');
      if (call.name === 'Bash') item.exitCode = failed ? 1 : 0;
      if (call.name === 'Bash' && failed) item.output = clip(text);
    } else if (item.type === 'fileChange') {
      if (!failed) item.changes = changesFor(call.name, call.input, r);
    } else if (item.type === 'dynamicToolCall') item.result = clip(text, 4000);
    upsert(item, turnId, declined ? 'declined' : failed ? 'failed' : 'completed');
  }

  // Partial assistant output (stream_event). Text and thinking appear once they have content.
  function streamEvent(message, turnId) {
    if (message.parent_tool_use_id) return;
    const event = message.event || {};
    const id = message.api_message_id || event.message?.id;
    if (event.type === 'message_start' && event.message?.id) {
      streams.set(event.message.id, {
        blocks: new Map(),
        done: { text: 0, thinking: 0 },
        order: { text: [], thinking: [] },
      });
      if (streams.size > 64) streams.delete(streams.keys().next().value);
      return;
    }
    const stream = id && streams.get(id);
    if (!stream || event.type !== 'content_block_delta') return;
    const delta = event.delta || {};
    const kind = delta.type === 'text_delta' ? 'text' : delta.type === 'thinking_delta' ? 'thinking' : null;
    const piece = kind === 'text' ? delta.text : kind === 'thinking' ? delta.thinking : '';
    if (!kind || !piece) return;
    let item = stream.blocks.get(event.index);
    if (!item) {
      item = {
        id: `${id}:${event.index}`,
        type: kind === 'text' ? 'agentMessage' : 'reasoning',
        text: '',
      };
      stream.blocks.set(event.index, item);
      stream.order[kind].push(item);
    }
    item.text += piece;
    upsert({ ...item }, turnId, 'inProgress');
  }

  // A complete assistant message. The CLI emits one per content block, sharing the API message id.
  function assistant(message, turnId, fallbackId) {
    if (message.parent_tool_use_id || message.isSidechain) return;
    const m = message.message || {};
    const stream = m.id && streams.get(m.id);
    (m.content || []).forEach((block, index) => {
      if (block.type === 'tool_use' || block.type === 'server_tool_use' || block.type === 'mcp_tool_use')
        return toolUse(block, turnId);
      const kind = block.type === 'text' ? 'text' : block.type === 'thinking' ? 'thinking' : null;
      const text = kind === 'text' ? block.text : kind === 'thinking' ? block.thinking : '';
      if (!kind) return;
      const streamed = stream?.order[kind][stream.done[kind]];
      if (stream && streamed) stream.done[kind]++;
      if (!text?.trim() && !streamed) return;
      upsert(
        {
          id: streamed?.id || `${m.id || fallbackId}:${kind}:${index}:${fallbackId}`,
          type: kind === 'text' ? 'agentMessage' : 'reasoning',
          text: text || streamed?.text || '',
        },
        turnId,
        'completed',
      );
    });
  }

  function user(message, turnId) {
    if (message.parent_tool_use_id || message.isSidechain) return;
    const content = message.message?.content;
    if (!Array.isArray(content)) return;
    const results = content.filter(block => block?.type === 'tool_result');
    const extra = message.tool_use_result ?? message.toolUseResult;
    for (const block of results) toolResult(block, results.length === 1 ? extra : null, turnId);
  }

  return {
    accept(message, turnId) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'stream_event') streamEvent(message, turnId);
      else if (message.type === 'assistant') assistant(message, turnId, message.uuid || '');
      else if (message.type === 'user') user(message, turnId);
    },
    /** Tool calls still waiting for their result when a turn ended. */
    unfinished: () => [...tools.keys()],
    forget: id => tools.delete(id),
  };
}

/** Rebuilds a conversation from a saved Claude Code transcript (one JSON record per line). */
function transcriptItems(records, root) {
  const items = [],
    index = new Map();
  let turnId = null;
  const upsert = (item, turn, status) => {
    const value = { ...item, turnId: turn, status };
    const at = index.get(item.id);
    if (at == null) {
      index.set(item.id, items.length);
      items.push(value);
    } else items[at] = { ...items[at], ...value };
  };
  const builder = createItemBuilder({ root, upsert });
  for (const record of records) {
    const prompt = promptOf(record);
    if (prompt != null) {
      turnId = record.uuid || `turn:${items.length}`;
      upsert({ id: `user:${turnId}`, type: 'userMessage', role: 'user', text: prompt }, turnId, 'completed');
      continue;
    }
    builder.accept(record, turnId);
  }
  // Calls without a result were cut off (interrupt, crash): they are history, not live work.
  for (const id of builder.unfinished()) {
    const at = index.get(id);
    if (at != null) items[at].status = 'failed';
  }
  return items;
}

module.exports = { createItemBuilder, transcriptItems, toolChanges, promptOf, textOf };
