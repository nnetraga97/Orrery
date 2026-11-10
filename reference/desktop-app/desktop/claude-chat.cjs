// Electron-owned Claude Code conversations, driven through the user's installed `claude` CLI in
// headless stream-json mode. Galaxy never handles Claude credentials: the CLI uses its own login
// (or ANTHROPIC_API_KEY). Conversations are Claude Code sessions, so their history lives in Claude's
// own transcripts and a chat resumes with `--resume <session id>`. The service exposes the same
// API and events as codex-chat.cjs, so the chat panel renders either provider.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setAsideSync, writeJSONAtomicSync } = require('../engine/shared/files.cjs');
const { permissionLevel } = require('../engine/agent/codex-permissions.cjs');
const { createChatQueue, restoreQueue } = require('../engine/agent/chat-queue.cjs');
const { createClaudeProcess, claudeAuthStatus } = require('../engine/agent/providers/claude-cli.cjs');
const { createItemBuilder, transcriptItems, toolChanges } = require('../engine/agent/providers/claude-items.cjs');
const { createChatAttachments } = require('./chat-attachments.cjs');
const { gitSummary } = require('./git-summary.cjs');
const { PASSIVE, galaxyGuidance, createGalaxyTools } = require('../engine/agent/galaxy-tools.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,240}$/.test(value);
const sessionId = value =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const errorText = error => String(error?.message || error || 'Claude Code request failed.');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const SIGNED_OUT = 'Claude Code is not signed in. Run `claude` in a terminal and log in, then retry.';
const MUTATING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const IDLE_MS = 10 * 60 * 1000;
// 'default' leaves the choice to Claude Code's own settings.
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh', 'max'];

// Tools a read-only chat has at all. Anything else, including MCP tools, does not exist for it.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'TodoWrite'];
// The SDK-hosted MCP server that carries the galaxy's tools; Claude names them mcp__galaxy__<tool>.
const GALAXY_SERVER = 'galaxy';
// Approval text larger than this is refused rather than shown in part.
const APPROVAL_LIMIT = 100000;

// Every Claude process reads only the user's own settings. `claude -p` skips the workspace trust
// dialog, so a project's .claude/settings*.json (hooks, allow rules, MCP servers) must not load:
// opening an untrusted folder would otherwise run its hooks and pre-approve its commands.
const SETTINGS_ARGS = ['--setting-sources', 'user'];

// Galaxy's three permission levels as Claude Code permission modes. Prompts arrive as can_use_tool.
function permissionArgs(level) {
  if (level === 'full-access')
    return ['--permission-mode', 'bypassPermissions', '--allow-dangerously-skip-permissions'];
  // Read only removes every tool that can write or run code, so no allow rule can reach one.
  if (level === 'read-only')
    return ['--permission-mode', 'default', '--tools', READ_ONLY_TOOLS.join(','), '--strict-mcp-config'];
  return ['--permission-mode', 'acceptEdits'];
}

function claudeHome(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

async function findTranscript(root, id, env) {
  const projects = path.join(claudeHome(env), 'projects');
  const direct = path.join(projects, root.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
  try {
    await fs.promises.access(direct);
    return direct;
  } catch {}
  // Long or unusual paths are shortened by the CLI; look for the session by its id.
  try {
    for (const entry of await fs.promises.readdir(projects, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(projects, entry.name, `${id}.jsonl`);
      try {
        await fs.promises.access(file);
        return file;
      } catch {}
    }
  } catch {}
  return null;
}

async function readTranscript(file) {
  const stat = await fs.promises.stat(file);
  if (stat.size > 200 * 1024 * 1024) throw new Error('This Claude Code session is too large to show.');
  const records = [];
  for (const line of (await fs.promises.readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {}
  }
  return records;
}

function createClaudeChat(options) {
  if (!options || !path.isAbsolute(options.dir) || typeof options.projectRoot !== 'function')
    throw new Error('Claude chat requires a private directory and project resolver.');
  const { dir, projectRoot, onChange = () => {}, onActivity = () => {} } = options;
  const env = options.env || {};
  const spawnClaude = options.spawn || createClaudeProcess;
  const authStatus = options.authStatus || (() => claudeAuthStatus({ bin: options.bin, env }));
  const indexFile = path.join(dir, 'chats.json');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const attachments = createChatAttachments(dir);
  const itemEpoch = randomUUID();
  let itemRevision = 0;
  const owned = new Map(),
    threads = new Map(),
    locks = new Set(),
    timers = new Map(),
    pending = new Map(),
    changedItems = new Map(),
    fullSnapshots = new Set(),
    publications = new Map(),
    sessions = new Map(), // chat id -> live CLI session
    galaxyByChat = new Map(); // chat id -> galaxy capabilities; the debugger remembers which session the chat owns
  let closed = false,
    account = null,
    available = false,
    failure = null,
    models = [],
    catalogLoaded = false,
    refreshing = null;

  try {
    const stored = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (stored.version !== 1 || !Array.isArray(stored.threads)) throw new Error('Invalid Claude chat index.');
    for (const entry of stored.threads) {
      // A malformed record loses ownership (its chat is not offered), never the whole index.
      if (
        !entry ||
        !sessionId(entry.id) ||
        !validId(entry.projectId) ||
        typeof entry.root !== 'string' ||
        !path.isAbsolute(entry.root) ||
        owned.has(entry.id)
      )
        continue;
      owned.set(entry.id, {
        id: entry.id,
        projectId: entry.projectId,
        root: entry.root,
        title: String(entry.title || 'New chat'),
        model: entry.model || null,
        effort: entry.effort || null,
        permission: permissionLevel(entry.permission),
        queue: restoreQueue(entry.queue),
        queuePaused: true,
        hasTurns: true,
        createdAt: entry.createdAt || Date.now(),
        updatedAt: entry.updatedAt || Date.now(),
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const aside = setAsideSync(indexFile);
      console.error(`Claude chat index was unreadable${aside ? `; moved to ${aside}` : ''}: ${error.message}`);
    }
  }

  function persist() {
    const list = [...owned.values()].filter(record => record.hasTurns !== false);
    writeJSONAtomicSync(indexFile, { version: 1, threads: list }, { mode: 0o600 });
  }
  function emit(event) {
    if (!closed) onChange(clone(event));
  }
  function touchItem(t, item) {
    item.revision = `${itemEpoch}:${++itemRevision}`;
    if (!changedItems.has(t.id)) changedItems.set(t.id, new Map());
    changedItems.get(t.id).set(item.id, item);
  }
  function blankThread(id) {
    const record = owned.get(id);
    return {
      id,
      title: record.title,
      status: 'idle',
      model: record.model,
      effort: record.effort,
      permission: record.permission,
      turnId: null,
      items: [],
      requests: [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
  function threadFor(id) {
    if (!threads.has(id)) threads.set(id, blankThread(id));
    return threads.get(id);
  }
  function snapshot(id, withItems = true) {
    const record = owned.get(id);
    const { items, ...metadata } = threads.get(id) || blankThread(id);
    return {
      ...metadata,
      ...(withItems ? { items } : {}),
      queued: record.queue || [],
      queuePaused: !!record.queuePaused,
      streamEpoch: itemEpoch,
      streamRevision: publications.get(id) || 0,
    };
  }
  function publish(id, immediate = false) {
    if (!owned.has(id) || closed) return;
    if (immediate) {
      clearTimeout(timers.get(id));
      timers.delete(id);
      const baseRevision = publications.get(id) || 0;
      publications.set(id, baseRevision + 1);
      if (!baseRevision || fullSnapshots.has(id))
        emit({ type: 'thread', projectId: owned.get(id).projectId, thread: snapshot(id) });
      else
        emit({
          type: 'threadPatch',
          projectId: owned.get(id).projectId,
          thread: snapshot(id, false),
          baseRevision,
          items: [...(changedItems.get(id)?.values() || [])],
        });
      fullSnapshots.delete(id);
      changedItems.delete(id);
    } else if (!timers.has(id)) {
      const timer = setTimeout(() => {
        timers.delete(id);
        publish(id, true);
      }, 40);
      timer.unref?.();
      timers.set(id, timer);
    }
  }
  function updateRecord(id) {
    const t = threads.get(id),
      record = owned.get(id);
    if (!t || !record) return;
    Object.assign(record, {
      title: t.title,
      model: t.model,
      effort: t.effort,
      permission: t.permission || record.permission,
      updatedAt: (t.updatedAt = Date.now()),
    });
    persist();
  }
  function upsert(t, item, turnId, status) {
    if (!item?.id) return;
    const value = {
      ...clone(item),
      turnId,
      status,
      ...(item.type === 'agentMessage' && { role: 'assistant' }),
      ...(item.type === 'userMessage' && { role: 'user' }),
    };
    const at = t.items.findIndex(entry => entry.id === item.id);
    if (at < 0) t.items.push(value);
    else t.items[at] = { ...t.items[at], ...value };
    touchItem(t, at < 0 ? value : t.items[at]);
  }

  async function rootFor(projectId) {
    if (closed) throw new Error('Claude chat is closed.');
    if (!validId(projectId)) throw new Error('Invalid project.');
    const root = await projectRoot(projectId);
    if (typeof root !== 'string' || !path.isAbsolute(root))
      throw new Error('Open a local project before starting a chat.');
    const real = await fs.promises.realpath(root);
    if (!(await fs.promises.stat(real)).isDirectory()) throw new Error('Project directory is unavailable.');
    return real;
  }
  async function assertOwned(projectId, id) {
    if (!validId(id)) throw new Error('Invalid chat.');
    const record = owned.get(id);
    if (!record || record.projectId !== projectId)
      throw new Error('This chat does not belong to the selected project.');
    if ((await rootFor(projectId)) !== record.root)
      throw new Error('The project folder has changed. Start a new chat for this folder.');
    return record;
  }

  function accountState() {
    return { available, account, requiresAuth: true, login: null, models, ...(failure ? { error: failure } : {}) };
  }
  function adoptCatalog(init) {
    if (!Array.isArray(init?.models)) return;
    models = init.models
      .filter(m => m && typeof m.value === 'string' && /^[\w.:[\]-]{1,120}$/.test(m.value))
      .map(m => ({
        id: m.value,
        model: m.value,
        displayName: String(m.displayName || m.value),
        description: String(m.description || ''),
        isDefault: m.value === 'default',
        supportedReasoningEfforts: m.supportsEffort
          ? ['default', ...(m.supportedEffortLevels || [])]
              .filter(e => EFFORTS.includes(e))
              .map(reasoningEffort => ({ reasoningEffort }))
          : [],
        defaultReasoningEffort: m.supportsEffort ? 'default' : undefined,
        inputModalities: ['text', 'image'],
      }));
    catalogLoaded = true;
  }
  // The model list comes from the CLI's initialize answer; one short-lived process reads it once.
  async function loadCatalog() {
    const probe = spawnClaude({
      bin: options.bin,
      env,
      cwd: dir,
      args: [...SETTINGS_ARGS, '--permission-mode', 'default'],
    });
    try {
      adoptCatalog(await probe.request({ subtype: 'initialize', hooks: {} }, { timeoutMs: 30000 }));
    } finally {
      await probe.close();
    }
  }
  async function refreshAccount() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const status = await authStatus();
        available = true;
        failure = null;
        account = status.loggedIn
          ? {
              type: String(status.authMethod || 'claude'),
              ...(status.email ? { email: String(status.email) } : {}),
              ...(status.subscriptionType ? { planType: String(status.subscriptionType) } : {}),
            }
          : null;
        if (account && !catalogLoaded) await loadCatalog().catch(() => {});
      } catch (error) {
        available = false;
        account = null;
        failure = errorText(error);
      }
      return accountState();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  async function requireAccount() {
    await refreshAccount();
    if (!available) throw new Error(failure || 'Claude Code is unavailable. Install it and reopen the app.');
    if (!account) throw new Error(SIGNED_OUT);
  }
  function selection(input = {}, previous = {}) {
    if (!plainObject(input)) throw new Error('Invalid chat options.');
    const model = input.model || previous.model || null,
      effort = input.effort || previous.effort || null;
    if (model && !/^[\w.:[\]-]{1,120}$/.test(model)) throw new Error('Choose a model from the list.');
    const match = models.find(m => m.model === model);
    if (model && models.length && !match) throw new Error('This model is not available for the signed-in account.');
    if (effort && !EFFORTS.includes(effort)) throw new Error('This effort level is not supported.');
    return {
      model: model || null,
      effort: match && !match.supportedReasoningEfforts.length ? null : effort,
      permission: permissionLevel(input.permission || previous.permission),
    };
  }
  const validateText = input => {
    if (
      !plainObject(input) ||
      typeof input.text !== 'string' ||
      (!input.text.trim() && !input.attachments?.length) ||
      input.text.length > 200000
    )
      throw new Error('Enter a message of at most 200,000 characters.');
    if (input.mentions?.length) throw new Error('Skills and connectors are chosen by Claude Code itself.');
    return input.text.trim();
  };
  async function providerInput(projectId, input) {
    const records = await attachments.records(projectId, input.attachments || []);
    const text = input.text.trim();
    const content = text ? [{ type: 'text', text }] : [];
    const files = records.filter(a => a.kind !== 'image');
    if (files.length)
      content.push({
        type: 'text',
        text:
          'User-provided attachments:\n' +
          files
            .map(a => `Attached ${a.kind}: ${JSON.stringify(a.name)}\nRead from: ${JSON.stringify(a.path)}`)
            .join('\n\n'),
      });
    for (const image of records.filter(a => a.kind === 'image')) {
      const data = await fs.promises.readFile(image.path);
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mime || 'image/png', data: data.toString('base64') },
      });
    }
    return {
      content,
      names: records.map(a => a.name),
      imagePaths: records.filter(a => a.kind === 'image').map(a => a.path),
    };
  }

  // One live `claude` process per chat while it is in use. Changing the model, effort or
  // permission restarts it on the same session.
  async function sessionFor(id, chosen) {
    const record = owned.get(id);
    const live = sessions.get(id);
    const key = JSON.stringify([chosen.model, chosen.effort, chosen.permission]);
    if (live?.proc.running && live.key === key) return live;
    if (live) await stopSession(id);
    const args = [...SETTINGS_ARGS, ...permissionArgs(chosen.permission)];
    args.push(...(record.hasTurns ? ['--resume', id] : ['--session-id', id]));
    if (chosen.model && chosen.model !== 'default') args.push('--model', chosen.model);
    if (chosen.effort && chosen.effort !== 'default') args.push('--effort', chosen.effort);
    const session = {
      id,
      key,
      permission: chosen.permission,
      builder: createItemBuilder({
        root: record.root,
        upsert: (item, turnId, status) => upsert(threadFor(id), item, turnId, status),
      }),
    };
    session.proc = spawnClaude({
      bin: options.bin,
      env,
      cwd: record.root,
      args,
      onMessage: message => received(session, message),
      onControlRequest: (request, requestId) => controlRequest(session, request, requestId),
      onControlCancel: requestId => cancelled(session, requestId),
      onExit: info => exited(session, info),
    });
    sessions.set(id, session);
    try {
      if (!galaxyByChat.has(id)) {
        const projectId = record.projectId;
        galaxyByChat.set(id, {
          show: await options.show?.(projectId),
          debug: await options.debug?.(projectId),
          semanticSearch: await options.atlasSearch?.(projectId),
        });
      }
      session.galaxy = galaxyByChat.get(id);
      // The galaxy's tools are an SDK-hosted MCP server: the CLI relays its JSON-RPC as mcp_message requests.
      const initialize = {
        subtype: 'initialize',
        hooks: {},
        sdkMcpServers: [GALAXY_SERVER],
        appendSystemPrompt: galaxyGuidance(session.galaxy),
      };
      adoptCatalog(await session.proc.request(initialize, { timeoutMs: 60000 }));
    } catch (error) {
      await stopSession(id);
      throw new Error(`Claude Code could not start: ${errorText(error)}`);
    }
    return session;
  }
  async function stopSession(id) {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    clearTimeout(session.idle);
    session.closing = true;
    await session.proc.close();
  }
  function idleLater(session) {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => {
      if (sessions.get(session.id) === session && !threads.get(session.id)?.turnId) void stopSession(session.id);
    }, IDLE_MS);
    session.idle.unref?.();
  }

  function activity(id, event) {
    onActivity(owned.get(id).projectId, { threadId: id, ...clone(event) });
  }
  function received(session, message) {
    const id = session.id;
    if (closed || sessions.get(id) !== session) return;
    const t = threadFor(id);
    if (message.type !== 'stream_event') activity(id, { kind: 'message', message });
    if (message.type === 'system' && message.subtype === 'api_retry') {
      t.reconnecting = `Retrying (attempt ${message.attempt || 1})…`;
    } else if (message.type === 'result') {
      finishTurn(session, message);
      return;
    } else {
      if (t.reconnecting && (message.type === 'assistant' || message.type === 'stream_event')) t.reconnecting = null;
      session.builder.accept(message, t.turnId);
    }
    publish(id);
  }
  function finishTurn(session, result) {
    const id = session.id,
      t = threadFor(id);
    if (!t.turnId) return;
    const turnId = t.turnId;
    const interrupted = !!session.stopping;
    const failed = !interrupted && (result.is_error || (result.subtype && result.subtype !== 'success'));
    for (const toolId of session.builder.unfinished()) {
      const item = t.items.find(entry => entry.id === toolId);
      if (item) {
        item.status = interrupted ? 'declined' : 'failed';
        touchItem(t, item);
      }
      session.builder.forget(toolId);
    }
    for (const request of t.requests) pending.delete(request.id);
    t.requests = [];
    t.turnId = null;
    t.reconnecting = null;
    t.status = interrupted ? 'interrupted' : failed ? 'error' : 'idle';
    t.error = failed
      ? String(result.result || result.errors?.join?.(' ') || 'Claude Code encountered an error.').slice(0, 1000)
      : null;
    if (result.usage) t.usage = clone(result.usage);
    session.stopping = false;
    activity(id, { kind: 'end', turnId, outcome: interrupted ? 'interrupted' : failed ? 'failed' : 'completed' });
    updateRecord(id);
    publish(id, true);
    idleLater(session);
    queue.completed(id, interrupted ? 'interrupted' : failed ? 'failed' : 'completed');
  }
  function exited(session, info) {
    const id = session.id;
    if (sessions.get(id) === session) sessions.delete(id);
    clearTimeout(session.idle);
    if (closed || session.closing) return;
    const t = threads.get(id);
    if (!t?.turnId) return;
    activity(id, { kind: 'end', turnId: t.turnId, outcome: 'failed' });
    for (const request of t.requests) pending.delete(request.id);
    const reason = /not logged in|login|authenticat|api key/i.test(info?.stderr || '') ? ` ${SIGNED_OUT}` : '';
    Object.assign(t, {
      status: 'error',
      turnId: null,
      requests: [],
      reconnecting: null,
      error: `${errorText(info?.error || 'Claude Code stopped unexpectedly.')}${reason} Check the chat history before sending again.`,
    });
    publish(id, true);
    queue.pause(id);
  }

  function requestFor(session, request, requestId) {
    const t = threadFor(session.id);
    const name = String(request.tool_name || 'tool');
    const input = plainObject(request.input) ? request.input : {};
    const base = { id: requestId, itemId: request.tool_use_id || null, turnId: t.turnId, tool: name, input };
    const reason = request.decision_reason || request.description || request.title || null;
    if (name === 'AskUserQuestion' && Array.isArray(input.questions))
      return {
        ...base,
        type: 'userInput',
        questions: input.questions.slice(0, 8).map((q, i) => ({
          id: `q${i}`,
          question: String(q.question || ''),
          header: String(q.header || ''),
          options: (q.options || [])
            .slice(0, 12)
            .map(o => ({ label: String(o.label || ''), description: String(o.description || '') })),
        })),
      };
    // The card shows exactly the input that "Approve once" allows: never the transcript's copy of
    // the call, and never a shortened command.
    if (MUTATING.has(name))
      return {
        ...base,
        type: 'fileChangeApproval',
        reason,
        changes: toolChanges(owned.get(session.id).root, name, input),
      };
    const detail =
      name === 'Bash' ? String(input.command ?? '') : `${request.display_name || name} ${JSON.stringify(input)}`;
    return {
      ...base,
      type: 'commandApproval',
      reason,
      command: detail || name,
      cwd: name === 'Bash' ? owned.get(session.id).root : undefined,
    };
  }
  async function galaxyMessage(session, message, requestId) {
    const reply = result =>
      session.proc.respond(requestId, { mcp_response: { jsonrpc: '2.0', id: message?.id ?? 0, ...result } });
    const tools = createGalaxyTools({
      root: owned.get(session.id).root,
      permission: () => session.permission,
      // The CLI has already asked through can_use_tool, unless the chat bypasses permissions.
      approve: async () => true,
      ...session.galaxy,
    });
    if (message?.method === 'initialize')
      return reply({
        result: {
          protocolVersion: message.params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: GALAXY_SERVER, version: '1' },
        },
      });
    if (message?.method === 'tools/list') return reply({ result: { tools: tools.definitions() } });
    if (message?.method === 'tools/call') {
      if (!threadFor(session.id).turnId) return reply({ error: { code: -32600, message: 'No turn is active.' } });
      const result = await tools.call(message.params?.name, message.params?.arguments);
      return reply({ result: { content: [{ type: 'text', text: result.output }], isError: !result.ok } });
    }
    if (message?.id == null) return reply({ result: {} });
    reply({ error: { code: -32601, message: `Unsupported method ${message?.method}` } });
  }
  function controlRequest(session, request, requestId) {
    const id = session.id,
      t = threadFor(id);
    if (request.subtype === 'mcp_message' && request.server_name === GALAXY_SERVER)
      return void galaxyMessage(session, request.message, requestId).catch(error =>
        session.proc.reject(requestId, errorText(error)),
      );
    // Pointing at code, reading diagnostics and reading a pause need no approval, even in a read-only chat.
    if (
      request.subtype === 'can_use_tool' &&
      t.turnId &&
      PASSIVE.has(String(request.tool_name).replace(`mcp__${GALAXY_SERVER}__`, '')) &&
      String(request.tool_name).startsWith(`mcp__${GALAXY_SERVER}__`)
    )
      return session.proc.respond(requestId, {
        behavior: 'allow',
        updatedInput: request.input,
        toolUseID: request.tool_use_id,
      });
    if (request.subtype !== 'can_use_tool')
      return session.proc.reject(requestId, 'Galaxy does not handle this request.');
    if (!t.turnId) return session.proc.reject(requestId, 'No turn is active.');
    const deny = message =>
      session.proc.respond(requestId, { behavior: 'deny', message, toolUseID: request.tool_use_id });
    // A read-only chat is offered only read tools; anything else that asks is refused unseen.
    if (
      session.permission === 'read-only' &&
      !READ_ONLY_TOOLS.includes(request.tool_name) &&
      request.tool_name !== 'AskUserQuestion'
    )
      return deny('This chat is read-only.');
    const entry = requestFor(session, request, requestId);
    if (JSON.stringify(entry).length > APPROVAL_LIMIT)
      return deny('This request is too large to show for approval. Split it into smaller steps.');
    pending.set(requestId, { threadId: id, session, request: entry });
    t.requests.push(entry);
    t.status = 'waiting';
    publish(id, true);
  }
  function cancelled(session, requestId) {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    const t = threadFor(session.id);
    t.requests = t.requests.filter(request => request.id !== requestId);
    if (!t.requests.length && t.turnId) t.status = 'running';
    publish(session.id, true);
  }

  async function beginTurn(projectId, id, input, chosen, { label } = {}) {
    const record = owned.get(id);
    const { content, names, imagePaths } = await providerInput(projectId, input);
    const session = await sessionFor(id, chosen);
    const t = threadFor(id);
    const turnId = `turn-${randomUUID()}`;
    Object.assign(t, {
      model: chosen.model,
      effort: chosen.effort,
      permission: chosen.permission,
      error: null,
      status: 'running',
      turnId,
    });
    if (t.title === 'New chat') t.title = input.text.trim().replace(/\s+/g, ' ').slice(0, 90) || 'Attachments';
    upsert(
      t,
      {
        id: `user:${turnId}`,
        type: 'userMessage',
        text: label || input.text.trim(),
        attachmentNames: names,
        imagePaths,
      },
      turnId,
      'completed',
    );
    clearTimeout(session.idle);
    record.hasTurns = true;
    updateRecord(id);
    activity(id, { kind: 'begin', turnId, prompt: (label || input.text.trim()).slice(0, 32000) });
    publish(id, true);
    try {
      session.proc.send(content, id);
    } catch (error) {
      Object.assign(t, { status: 'error', turnId: null, error: `${errorText(error)} This message was not sent.` });
      activity(id, { kind: 'end', turnId, outcome: 'failed' });
      publish(id, true);
      throw new Error(t.error);
    }
    return clone(snapshot(id));
  }

  // Claude Code keeps the conversation; a chat that is not live is read back from its transcript.
  async function loadHistory(id) {
    const record = owned.get(id);
    const file = await findTranscript(record.root, id, { ...process.env, ...env });
    const t = threadFor(id);
    if (file) {
      t.items = transcriptItems(await readTranscript(file), record.root);
      for (const item of t.items) {
        if (item.type === 'agentMessage') item.role = 'assistant';
        if (item.type === 'userMessage') item.role = 'user';
        item.revision = `${itemEpoch}:${++itemRevision}`;
      }
    } else t.error = 'Claude Code no longer has this conversation’s history.';
    fullSnapshots.add(id);
    changedItems.delete(id);
    publish(id, true);
  }

  const queue = createChatQueue({
    records: owned,
    snapshot,
    save: persist,
    publish,
    locked: id => locks.has(id),
    activate: id => {
      const t = threads.get(id);
      if (t && !t.turnId && ['interrupted', 'error'].includes(t.status)) {
        t.status = 'idle';
        t.error = null;
      }
    },
    send: (...args) => api.send(...args),
  });
  async function exclusive(id, callback) {
    if (locks.has(id)) throw new Error('A request for this chat is already in progress.');
    locks.add(id);
    try {
      return await callback();
    } finally {
      locks.delete(id);
    }
  }

  const api = {
    async images(projectId, id, itemId) {
      const record = await assertOwned(projectId, id);
      const item = threads.get(id)?.items.find(item => item.id === itemId);
      if (!item) throw new Error('This message is not in the selected chat.');
      return require('./chat-images.cjs').transcriptImages({ dir, root: record.root, projectId, item });
    },
    async attach(projectId, paths) {
      await rootFor(projectId);
      return attachments.importPaths(projectId, paths);
    },
    async pasteImage(projectId, dataUrl) {
      await rootFor(projectId);
      return attachments.pasteImage(projectId, dataUrl);
    },
    async integrations(projectId, threadId) {
      const root = await rootFor(projectId);
      if (threadId) await assertOwned(projectId, threadId);
      return { entries: [], errors: [], ...(await gitSummary(root)) };
    },
    async state(projectId) {
      if (closed) throw new Error('Claude chat is closed.');
      if (projectId != null) await rootFor(projectId);
      await refreshAccount();
      return clone({
        ...accountState(),
        threads: [...owned.values()]
          .filter(value => value.projectId === projectId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map(value => snapshot(value.id)),
      });
    },
    async signIn() {
      throw new Error(SIGNED_OUT);
    },
    async cancelLogin() {
      return { cancelled: true };
    },
    async signOut() {
      throw new Error('Sign out of Claude Code in a terminal with `claude auth logout`.');
    },
    async newChat(projectId, input = {}) {
      return exclusive('new:' + projectId, async () => {
        const root = await rootFor(projectId);
        await requireAccount();
        const chosen = selection(input);
        const id = randomUUID();
        owned.set(id, {
          id,
          projectId,
          root,
          title: 'New chat',
          model: chosen.model,
          effort: chosen.effort,
          permission: chosen.permission,
          queue: [],
          queuePaused: false,
          hasTurns: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        threads.set(id, blankThread(id));
        publish(id, true);
        return clone(snapshot(id));
      });
    },
    async readChat(projectId, id) {
      const record = await assertOwned(projectId, id);
      if (threads.get(id)?.turnId || sessions.has(id) || !record.hasTurns) return clone(snapshot(id));
      return exclusive(id, async () => {
        await loadHistory(id);
        return clone(snapshot(id));
      });
    },
    async send(projectId, id, input) {
      const record = await assertOwned(projectId, id);
      validateText(input);
      return exclusive(id, async () => {
        await requireAccount();
        const t = threadFor(id);
        if (t.turnId || t.requests.length || t.status === 'running' || t.status === 'waiting')
          throw new Error('Wait for this turn to finish or stop it before sending another message.');
        if (record.hasTurns && !t.items.length) await loadHistory(id).catch(() => {});
        return beginTurn(projectId, id, input, selection(input, t.model ? t : record));
      });
    },
    async compact(projectId, id) {
      const record = await assertOwned(projectId, id);
      return exclusive(id, async () => {
        await requireAccount();
        const t = threadFor(id);
        if (t.turnId) throw new Error('Stop or finish the current turn before compacting.');
        if (!record.hasTurns) throw new Error('Send a message before compacting this chat.');
        return beginTurn(projectId, id, { text: '/compact' }, selection({}, t.model ? t : record));
      });
    },
    async stop(projectId, id) {
      await assertOwned(projectId, id);
      const t = threads.get(id),
        session = sessions.get(id);
      if (!t?.turnId || !session) throw new Error('This chat has no active turn to stop.');
      queue.pause(id);
      session.stopping = true;
      for (const request of t.requests) {
        pending.delete(request.id);
        try {
          session.proc.respond(request.id, {
            behavior: 'deny',
            message: 'The user stopped this turn.',
            interrupt: true,
            toolUseID: request.itemId,
          });
        } catch {}
      }
      t.requests = [];
      await session.proc.request({ subtype: 'interrupt' }, { timeoutMs: 10000 });
      return clone(snapshot(id));
    },
    async enqueue(projectId, id, input) {
      await assertOwned(projectId, id);
      const text = validateText(input);
      return exclusive(id, async () => {
        const chosen = selection(input, threads.get(id) || owned.get(id));
        queue.add(id, {
          text,
          ...chosen,
          attachments: input.attachments || [],
          attachmentInfo: (await attachments.records(projectId, input.attachments || [])).map(a => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
          })),
          mentions: [],
        });
        return clone(snapshot(id));
      });
    },
    async removeQueued(projectId, id, messageId) {
      await assertOwned(projectId, id);
      queue.remove(id, messageId);
      return clone(snapshot(id));
    },
    async resumeQueue(projectId, id) {
      await assertOwned(projectId, id);
      queue.resume(id);
      return clone(snapshot(id));
    },
    async steer() {
      throw new Error('Claude Code cannot change a running turn. Queue this message instead.');
    },
    async respond(projectId, id, requestId, response) {
      await assertOwned(projectId, id);
      const entry = pending.get(String(requestId));
      if (!entry || entry.threadId !== id || !plainObject(response))
        throw new Error('This request is no longer awaiting a response.');
      const { request, session } = entry;
      let answer;
      if (request.type === 'userInput') {
        if (!plainObject(response.answers)) throw new Error('Answer the requested questions.');
        const answers = {};
        for (const question of request.questions) {
          const value = response.answers[question.id]?.answers;
          if (
            !Array.isArray(value) ||
            !value.length ||
            value.some(v => typeof v !== 'string' || !v.trim() || v.length > 20000)
          )
            throw new Error('Answer each requested question.');
          answers[question.question] = value.join(', ');
        }
        answer = { behavior: 'allow', updatedInput: { ...request.input, answers }, toolUseID: request.itemId };
      } else if (response.decision === 'accept')
        answer = { behavior: 'allow', updatedInput: request.input, toolUseID: request.itemId };
      else if (response.decision === 'decline' || response.decision === 'cancel')
        answer = {
          behavior: 'deny',
          message: 'The user declined this action.',
          ...(response.decision === 'cancel' && { interrupt: true }),
          toolUseID: request.itemId,
        };
      else throw new Error('Choose Allow once or Decline.');
      // Consume before writing so a double click cannot repeat a permission grant.
      pending.delete(String(requestId));
      const t = threadFor(id);
      t.requests = t.requests.filter(value => value.id !== request.id);
      try {
        if (!session.proc.respond(request.id, answer))
          throw new Error('The Claude Code request is no longer connected.');
      } catch (error) {
        t.error = 'The response could not be delivered. It was not retried.';
        publish(id, true);
        throw error;
      }
      if (!t.requests.length) t.status = t.turnId ? 'running' : 'idle';
      publish(id, true);
      return clone(snapshot(id));
    },
    async close() {
      if (closed) return;
      closed = true;
      queue.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
      await Promise.allSettled([...sessions.keys()].map(stopSession));
    },
  };
  return api;
}
module.exports = { createClaudeChat };
