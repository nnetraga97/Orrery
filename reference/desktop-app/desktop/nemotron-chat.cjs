// Electron-owned Nemotron chats. The loop owns tool execution; this service owns threads and approvals.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setAsideSync, writeJSONAtomicSync } = require('../engine/shared/files.cjs');
const { permissionLevel } = require('../engine/agent/codex-permissions.cjs');
const { createChatQueue, restoreQueue } = require('../engine/agent/chat-queue.cjs');
const { createNemotronLoop, readKey, DEFAULT_MODEL } = require('../engine/agent/providers/nemotron-loop.cjs');
const { createChatAttachments } = require('./chat-attachments.cjs');
const { gitSummary } = require('./git-summary.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,240}$/.test(value);
const sessionId = value =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const errorText = error => String(error?.message || error || 'Nemotron request failed.');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const SIGNED_OUT = 'Set NEBIUS_API_KEY or put your key in ~/.config/nebius/api_key, then choose Check again.';

function createNemotronChat(options) {
  if (!options || !path.isAbsolute(options.dir) || typeof options.projectRoot !== 'function')
    throw new Error('Nemotron chat requires a private directory and project resolver.');
  const { dir, projectRoot, onChange = () => {}, onActivity = () => {} } = options;
  const env = { ...process.env, ...options.env };
  const model = env.GALAXY_NEMOTRON_MODEL || DEFAULT_MODEL;
  const secrets = new Set();
  function apiKey() {
    const key = options.testEndpoint ? options.testKey : readKey(env);
    if (key) secrets.add(key);
    return key;
  }
  function safe(value) {
    return JSON.parse(
      JSON.stringify(value, (_key, entry) => {
        if (typeof entry !== 'string') return entry;
        for (const secret of secrets) entry = entry.split(secret).join('[REDACTED]');
        return entry;
      }),
    );
  }
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
    publications = new Map(),
    sessions = new Map(); // chat id -> loop and current abort controller
  let closed = false,
    account = null,
    available = false,
    failure = null,
    models = [
      {
        id: model,
        model,
        displayName: model,
        isDefault: true,
        supportedReasoningEfforts: [],
        inputModalities: ['text'],
      },
    ],
    refreshing = null;

  try {
    const stored = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (stored.version !== 1 || !Array.isArray(stored.threads)) throw new Error('Invalid Nemotron chat index.');
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
        messages: Array.isArray(entry.messages) ? entry.messages : [],
        items: Array.isArray(entry.items)
          ? entry.items.map(item => (item.status === 'inProgress' ? { ...item, status: 'failed' } : item))
          : [],
        createdAt: entry.createdAt || Date.now(),
        updatedAt: entry.updatedAt || Date.now(),
      });
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const aside = setAsideSync(indexFile);
      failure = `Nemotron chat index was unreadable${aside ? '; saved aside for recovery' : ''}.`;
    }
  }

  function persist() {
    const list = [...owned.values()].filter(record => record.hasTurns !== false);
    writeJSONAtomicSync(indexFile, { version: 1, threads: safe(list) }, { mode: 0o600 });
  }
  function emit(event) {
    if (!closed) onChange(safe(event));
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
      items: record.items || [],
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
      if (!baseRevision) emit({ type: 'thread', projectId: owned.get(id).projectId, thread: snapshot(id) });
      else
        emit({
          type: 'threadPatch',
          projectId: owned.get(id).projectId,
          thread: snapshot(id, false),
          baseRevision,
          items: [...(changedItems.get(id)?.values() || [])],
        });
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
      items: t.items,
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
    if (closed) throw new Error('Nemotron chat is closed.');
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
  async function refreshAccount() {
    if (refreshing) return refreshing;
    refreshing = Promise.resolve()
      .then(() => {
        try {
          account = apiKey() ? { type: 'apiKey' } : null;
          available = true;
          failure = null;
        } catch (error) {
          available = false;
          account = null;
          failure = errorText(error);
        }
        return accountState();
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }
  async function requireAccount() {
    await refreshAccount();
    if (!available) throw new Error(failure || 'Nemotron is unavailable. Check the Nebius key configuration.');
    if (!account) throw new Error(SIGNED_OUT);
  }
  function selection(input = {}, previous = {}) {
    if (!plainObject(input)) throw new Error('Invalid chat options.');
    const chosenModel = input.model || previous.model || model;
    if (chosenModel !== model) throw new Error('Choose the configured Nemotron model.');
    return { model: chosenModel, effort: null, permission: permissionLevel(input.permission || previous.permission) };
  }
  const validateText = input => {
    if (
      !plainObject(input) ||
      typeof input.text !== 'string' ||
      (!input.text.trim() && !input.attachments?.length) ||
      input.text.length > 200000
    )
      throw new Error('Enter a message of at most 200,000 characters.');
    if (input.mentions?.length) throw new Error('Nemotron does not support skills or connectors.');
    return input.text.trim();
  };
  async function providerInput(projectId, input) {
    const root = await rootFor(projectId);
    const records = await attachments.records(projectId, input.attachments || []);
    const content = [input.text.trim()];
    for (const record of records) {
      if (record.kind === 'image') throw new Error('Nemotron currently accepts text and files, not images.');
      if (record.kind === 'folder') {
        const real = await fs.promises.realpath(record.path);
        const relative = path.relative(root, real);
        if (relative.startsWith('..') || path.isAbsolute(relative))
          throw new Error('Attached folders must be inside the project.');
        content.push(`Attached folder: ${relative || '.'}`);
      } else {
        const stat = await fs.promises.stat(record.path);
        if (stat.size > 64000)
          throw new Error(
            'Nemotron file attachments must be at most 64 KB. Use project-relative paths for larger files.',
          );
        content.push(`Attached file: ${record.name}\n${await fs.promises.readFile(record.path, 'utf8')}`);
      }
    }
    return { content: content.join('\n\n'), names: records.map(a => a.name) };
  }

  function approve(id, { command, operationId, turnId, signal }) {
    signal.throwIfAborted();
    const t = threadFor(id);
    const request = {
      id: randomUUID(),
      itemId: operationId,
      turnId,
      type: 'commandApproval',
      tool: 'run_command',
      command,
      cwd: owned.get(id).root,
    };
    return new Promise(resolve => {
      const settle = allowed => {
        signal.removeEventListener('abort', cancel);
        pending.delete(request.id);
        t.requests = t.requests.filter(entry => entry.id !== request.id);
        t.status = t.turnId ? 'running' : 'idle';
        publish(id, true);
        resolve(allowed);
      };
      const cancel = () => settle(false);
      pending.set(request.id, { threadId: id, settle });
      t.requests.push(request);
      t.status = 'waiting';
      signal.addEventListener('abort', cancel, { once: true });
      publish(id, true);
    });
  }

  function sessionFor(id) {
    if (sessions.has(id)) return sessions.get(id);
    const record = owned.get(id);
    record.messages ||= [];
    const session = {};
    session.loop = createNemotronLoop({
      root: record.root,
      sessionId: id,
      env,
      messages: record.messages,
      testEndpoint: options.testEndpoint,
      onEvent: event => onActivity(record.projectId, safe(event)),
      onItem: (item, turnId, status) => {
        upsert(threadFor(id), item, turnId, status);
        publish(id);
      },
      onHistory: () => updateRecord(id),
      approve: request => approve(id, request),
    });
    sessions.set(id, session);
    return session;
  }

  async function beginTurn(projectId, id, input, chosen) {
    const record = owned.get(id);
    const { content, names } = await providerInput(projectId, input);
    const key = apiKey();
    if (!key) throw new Error(SIGNED_OUT);
    const semanticSearch = await options.atlasSearch?.(projectId);
    const session = sessionFor(id),
      t = threadFor(id),
      turnId = `turn-${randomUUID()}`;
    const show = await options.show?.(projectId);
    const debug = (session.debug ||= await options.debug?.(projectId));
    Object.assign(t, { ...chosen, error: null, status: 'running', turnId });
    if (t.title === 'New chat') t.title = input.text.trim().replace(/\s+/g, ' ').slice(0, 90) || 'Attachments';
    upsert(
      t,
      { id: `user:${turnId}`, type: 'userMessage', text: input.text.trim(), attachmentNames: names },
      turnId,
      'completed',
    );
    record.hasTurns = true;
    updateRecord(id);
    publish(id, true);
    session.controller = new AbortController();
    session.done = session.loop
      .run({ text: content, turnId, key, semanticSearch, debug, show, ...chosen, signal: session.controller.signal })
      .then(result => {
        Object.assign(t, {
          turnId: null,
          requests: [],
          status: result.outcome === 'completed' ? 'idle' : result.outcome === 'interrupted' ? 'interrupted' : 'error',
          error: result.error || null,
          usage: result.usage,
        });
        updateRecord(id);
        publish(id, true);
        queue.completed(id, result.outcome);
      })
      .catch(error => {
        Object.assign(t, { turnId: null, requests: [], status: 'error', error: errorText(error) });
        updateRecord(id);
        publish(id, true);
        queue.pause(id);
      });
    return safe(snapshot(id));
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
      if (closed) throw new Error('Nemotron chat is closed.');
      if (projectId != null) await rootFor(projectId);
      await refreshAccount();
      return safe({
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
      throw new Error('Remove NEBIUS_API_KEY and ~/.config/nebius/api_key to disconnect Nemotron.');
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
        return safe(snapshot(id));
      });
    },
    async readChat(projectId, id) {
      await assertOwned(projectId, id);
      threadFor(id);
      return safe(snapshot(id));
    },
    async send(projectId, id, input) {
      const record = await assertOwned(projectId, id);
      validateText(input);
      return exclusive(id, async () => {
        await requireAccount();
        const t = threadFor(id);
        if (t.turnId || t.requests.length || t.status === 'running' || t.status === 'waiting')
          throw new Error('Wait for this turn to finish or stop it before sending another message.');
        return beginTurn(projectId, id, input, selection(input, t.model ? t : record));
      });
    },
    async compact(projectId, id) {
      await assertOwned(projectId, id);
      throw new Error('Compaction is not supported by Nemotron yet.');
    },
    async stop(projectId, id) {
      await assertOwned(projectId, id);
      const session = sessions.get(id);
      if (!threads.get(id)?.turnId || !session) throw new Error('This chat has no active turn to stop.');
      queue.pause(id);
      session.controller.abort();
      await session.done;
      return safe(snapshot(id));
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
        return safe(snapshot(id));
      });
    },
    async removeQueued(projectId, id, messageId) {
      await assertOwned(projectId, id);
      queue.remove(id, messageId);
      return safe(snapshot(id));
    },
    async resumeQueue(projectId, id) {
      await assertOwned(projectId, id);
      queue.resume(id);
      return safe(snapshot(id));
    },
    async steer() {
      throw new Error('Nemotron cannot change a running turn. Queue this message instead.');
    },
    async respond(projectId, id, requestId, response) {
      await assertOwned(projectId, id);
      const entry = pending.get(String(requestId));
      if (!entry || entry.threadId !== id || !plainObject(response))
        throw new Error('This request is no longer awaiting a response.');
      if (!['accept', 'decline', 'cancel'].includes(response.decision))
        throw new Error('Choose Allow once or Decline.');
      entry.settle(response.decision === 'accept');
      return safe(snapshot(id));
    },
    async close() {
      if (closed) return;
      closed = true;
      queue.close();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const session of sessions.values()) session.controller?.abort();
      await Promise.allSettled([...sessions.values()].map(session => session.done));
      pending.clear();
      persist();
    },
  };
  return api;
}
module.exports = { createNemotronChat };
