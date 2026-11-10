// Electron-owned Codex conversations. Credentials and rollouts stay in this app's
// private CODEX_HOME; the renderer receives only safe account metadata and chat data.
const fs = require('node:fs');
const path = require('node:path');
const { setAsideSync, writeJSONAtomicSync } = require('../engine/shared/files.cjs');
const { permissionLevel, permissionPolicy } = require('../engine/agent/codex-permissions.cjs');
const { createChatQueue, restoreQueue } = require('../engine/agent/chat-queue.cjs');
const { createChatAttachments } = require('./chat-attachments.cjs');
const { gitSummary } = require('./git-summary.cjs');
const { parentOf } = require('../engine/agent/providers/codex-agents.cjs');
const { localPath } = require('../engine/agent/resources.cjs');
const { AGENTS, PASSIVE, galaxyGuidance, createGalaxyTools } = require('../engine/agent/galaxy-tools.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,240}$/.test(value);
const errorText = error => String(error?.message || error || 'Codex request failed.');
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
function normalizeItem(item, turnId, status) {
  const out = { ...clone(item), turnId, status: item.status || status || 'completed' };
  if (item.type === 'userMessage') {
    out.role = 'user';
    out.text = (item.content || [])
      .filter(part => part.type === 'text' && !part.text.startsWith('User-provided attachments:\n'))
      .map(part => part.text)
      .join('\n');
    out.attachmentNames = (item.content || []).flatMap(part => {
      if (part.type === 'localImage') return [path.basename(part.path)];
      if (part.type === 'image') return ['Image'];
      if (part.type === 'skill' || part.type === 'mention') return [part.name];
      if (part.type === 'text' && part.text.startsWith('User-provided attachments:\n'))
        return [...part.text.matchAll(/Attached (?:file|folder): ("(?:[^"\\]|\\.)*")/g)].map(match =>
          JSON.parse(match[1]),
        );
      return [];
    });
  } else if (item.type === 'agentMessage') out.role = 'assistant';
  else if (item.type === 'reasoning') out.text = (item.summary || []).join('\n') || (item.content || []).join('\n');
  else if (item.type === 'commandExecution') out.output = item.aggregatedOutput || '';
  return out;
}
function createCodexChat(options) {
  if (!options || !path.isAbsolute(options.dir) || typeof options.projectRoot !== 'function')
    throw new Error('Codex chat requires a private directory and project resolver.');
  const { dir, projectRoot, onChange = () => {}, onActivity = () => {} } = options;
  const home = path.join(dir, 'codex'),
    indexFile = path.join(dir, 'chats.json');
  const attachments = createChatAttachments(dir);
  const catalogs = new Map();
  const itemEpoch = require('node:crypto').randomUUID();
  let itemRevision = 0;
  const changedItems = new Map(),
    fullSnapshots = new Set(),
    publications = new Map();
  const touchItem = (t, item) => {
    item.revision = `${itemEpoch}:${++itemRevision}`;
    if (!changedItems.has(t.id)) changedItems.set(t.id, new Map());
    changedItems.get(t.id).set(item.id, item);
  };
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const owned = new Map(),
    threads = new Map(),
    loaded = new Set(),
    locks = new Set(),
    timers = new Map(),
    pending = new Map(),
    finished = new Map(),
    descendants = new Map(),
    discoveringChildren = new Set(),
    childInbox = new Map(),
    galaxyByThread = new Map();
  let closed = false,
    epoch = 0,
    account = null,
    requiresAuth = true,
    login = null,
    models = [],
    available = false,
    failure = null,
    refreshing = null;
  try {
    const stored = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    if (stored.version !== 1 || !Array.isArray(stored.threads)) throw new Error('Invalid Codex chat index.');
    for (const entry of stored.threads) {
      // A malformed record loses ownership (its chat is not offered), never the whole index.
      if (
        !entry ||
        !validId(entry.id) ||
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
        collaborationMode: entry.collaborationMode === 'plan' ? 'plan' : 'default',
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
      console.error(`Codex chat index was unreadable${aside ? `; moved to ${aside}` : ''}: ${error.message}`);
    }
  }
  function persist() {
    // App-server does not materialize an empty thread until its first turn.
    const threads = [...owned.values()].filter(record => record.hasTurns !== false);
    writeJSONAtomicSync(indexFile, { version: 1, threads }, { mode: 0o600 });
  }
  function emit(event) {
    if (!closed) onChange(clone(event));
  }
  function snapshot(id, withItems = true) {
    const record = owned.get(id);
    const t = threads.get(id) || {
      id,
      title: record.title,
      status: 'idle',
      model: record.model,
      effort: record.effort,
      permission: record.permission,
      collaborationMode: record.collaborationMode || 'default',
      turnId: null,
      items: [],
      requests: [],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const { items, ...metadata } = t;
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
  async function rootFor(projectId) {
    if (closed) throw new Error('Codex chat is closed.');
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
    const root = await rootFor(projectId);
    if (root !== record.root) throw new Error('The project folder has changed. Start a new chat for this folder.');
    return record;
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
      collaborationMode: t.collaborationMode || 'default',
      updatedAt: (t.updatedAt = Date.now()),
    });
    persist();
  }
  function upsert(t, item, turnId, status) {
    if (!item?.id) return;
    const normalized = normalizeItem(item, turnId, status),
      existing = t.items.findIndex(value => value.id === item.id);
    if (existing < 0) t.items.push(normalized);
    else t.items[existing] = { ...t.items[existing], ...normalized };
    touchItem(t, existing < 0 ? normalized : t.items[existing]);
  }
  function ingest(id, result, replace = true) {
    const raw = result.thread;
    if (!raw || raw.id !== id || (raw.cwd && path.resolve(raw.cwd) !== owned.get(id).root))
      throw new Error('Codex returned a chat outside its project.');
    const record = owned.get(id),
      prior = threads.get(id);
    // Reading/resuming can replace, remove or reorder history. Publish one full
    // baseline for that replacement; subsequent stream events contain only edits.
    fullSnapshots.add(id);
    changedItems.delete(id);
    if (raw.turns?.length) record.hasTurns = true;
    const t = {
      ...snapshot(id),
      title: raw.name || prior?.title || record.title || raw.preview?.slice(0, 90) || 'New chat',
      model: result.model || prior?.model || record.model,
      effort: result.reasoningEffort || prior?.effort || record.effort,
      items: replace ? [] : [...(prior?.items || [])],
      requests: prior?.requests || [],
      turnId: null,
      status: 'idle',
      error: null,
      reconnecting: null,
    };
    for (const turn of raw.turns || []) {
      for (const item of turn.items || [])
        upsert(t, item, turn.id, turn.status === 'inProgress' ? 'inProgress' : 'completed');
      // A rollout left inProgress after a crash is history, not a live process.
      // Only an active runtime thread owns a turn that can be interrupted.
      if (turn.status === 'inProgress' && raw.status?.type === 'active') {
        t.turnId = turn.id;
        t.status = 'running';
      }
    }
    const latest = raw.turns?.at(-1);
    if (latest?.status === 'failed') {
      t.status = 'error';
      t.error = latest.error?.message || 'Codex encountered an error.';
    }
    if (raw.status?.type === 'active') t.status = t.requests.length ? 'waiting' : 'running';
    if (raw.status?.type === 'systemError') t.status = 'error';
    threads.set(id, t);
    updateRecord(id);
    return t;
  }
  function accountState() {
    const safeLogin = login
      ? { loginId: login.loginId, status: login.status, ...(login.error ? { error: login.error } : {}) }
      : null;
    return { available, account, requiresAuth, login: safeLogin, models, ...(failure ? { error: failure } : {}) };
  }
  async function refreshAccount() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const response = await rpc.request('account/read', { refreshToken: false });
        available = true;
        failure = null;
        const value = response.account;
        account = value
          ? {
              type: value.type,
              ...(value.email != null ? { email: String(value.email) } : {}),
              ...(value.planType != null ? { planType: String(value.planType) } : {}),
            }
          : null;
        requiresAuth = response.requiresOpenaiAuth !== false;
        models = [];
        if (account || !requiresAuth) {
          let cursor = null;
          const seen = new Set();
          do {
            const page = await rpc.request('model/list', { includeHidden: true, ...(cursor ? { cursor } : {}) });
            for (const model of page.data || [])
              if ((!model.hidden || model.model === 'gpt-6-astra') && !seen.has(model.id)) {
                seen.add(model.id);
                models.push({
                  id: model.id,
                  model: model.model,
                  displayName: model.displayName,
                  description: model.description,
                  isDefault: !!model.isDefault,
                  supportedReasoningEfforts: model.supportedReasoningEfforts || [],
                  defaultReasoningEffort: model.defaultReasoningEffort,
                  inputModalities: model.inputModalities || ['text', 'image'],
                });
              }
            if (page.nextCursor === cursor) break;
            cursor = page.nextCursor;
          } while (cursor && models.length < 500);
        }
      } catch (error) {
        failure = errorText(error);
        if (!available) account = null;
      }
      return accountState();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }
  async function requireAccount() {
    await refreshAccount();
    if (failure) throw new Error(failure);
    if (!available) throw new Error('Codex is unavailable. Install the Codex CLI and reopen the app.');
    if (requiresAuth && !account) throw new Error('Sign in to Codex before starting a chat.');
  }
  function selection(input = {}, previous = {}) {
    if (!plainObject(input)) throw new Error('Invalid chat options.');
    if (input.collaborationMode != null && !['plan', 'default'].includes(input.collaborationMode))
      throw new Error('Unsupported collaboration mode.');
    const model = input.model || previous.model || null,
      effort = input.effort || previous.effort || null;
    const match =
      models.find(value => value.model === model || value.id === model) ||
      (!model && models.find(value => value.isDefault));
    if (model && !match) throw new Error('This model is not available for the signed-in account.');
    if (effort && (!match || !match.supportedReasoningEfforts.some(value => value.reasoningEffort === effort)))
      throw new Error('This reasoning effort is not supported by the selected model.');
    return {
      model: match?.model || model,
      effort: effort || match?.defaultReasoningEffort || null,
      permission: permissionLevel(input.permission || previous.permission),
      collaborationMode: input.collaborationMode || previous.collaborationMode || 'default',
    };
  }
  const policy = (root, level) => ({
    cwd: root,
    approvalPolicy: permissionPolicy(root, level).approvalPolicy,
    approvalsReviewer: 'user',
    sandbox: permissionPolicy(root, level).sandbox,
    config: {
      'sandbox_workspace_write.network_access': false,
      'sandbox_workspace_write.writable_roots': [],
      'features.default_mode_request_user_input': true,
    },
  });
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
  const validateText = input => {
    if (
      !plainObject(input) ||
      typeof input.text !== 'string' ||
      (!input.text.trim() && !input.attachments?.length) ||
      input.text.length > 200000
    )
      throw new Error('Enter a message of at most 200,000 characters.');
    return input.text.trim();
  };
  async function providerInput(projectId, input, chosen, threadId) {
    if (
      input.mentions != null &&
      (!Array.isArray(input.mentions) ||
        input.mentions.length > 12 ||
        input.mentions.some(id => typeof id !== 'string'))
    )
      throw new Error('Invalid chat integrations.');
    const records = await attachments.records(projectId, input.attachments || []);
    const model = models.find(m => m.model === chosen?.model || m.id === chosen?.model);
    if (records.some(a => a.kind === 'image') && model && !model.inputModalities.includes('image'))
      throw new Error('The selected model does not support images. Choose an image-capable model.');
    const files = records.filter(a => a.kind !== 'image');
    const references = files
      .map(a => `Attached ${a.kind}: ${JSON.stringify(a.name)}\nRead from: ${JSON.stringify(a.path)}`)
      .join('\n\n');
    const text = input.text.trim();
    const content = text ? [{ type: 'text', text, text_elements: [] }] : [];
    if (references)
      content.push({ type: 'text', text: `User-provided attachments:\n${references}`, text_elements: [] });
    content.push(...records.filter(a => a.kind === 'image').map(a => ({ type: 'localImage', path: a.path })));
    const catalogKey = `${projectId}:${threadId || ''}`;
    const catalog =
      input.mentions?.length && !catalogs.has(catalogKey)
        ? await api.integrations(projectId, threadId)
        : catalogs.get(catalogKey);
    for (const id of input.mentions || []) {
      const entry = catalog?.entries.find(e => e.id === id && !e.disabled);
      if (!entry) throw new Error('This skill or connector is no longer available. Refresh the integrations menu.');
      content.push({ type: entry.kind === 'skill' ? 'skill' : 'mention', name: entry.name, path: entry.path });
    }
    return content;
  }
  function clearRequests(t, agentThreadId = null) {
    for (const request of t.requests)
      if ((request.agentThreadId || null) === agentThreadId) pending.delete(String(request.id));
    t.requests = t.requests.filter(request => (request.agentThreadId || null) !== agentThreadId);
  }
  function treeOwner(id) {
    return owned.has(id) ? id : descendants.get(id)?.rootThreadId;
  }
  function childActivity(message, rootId) {
    onActivity(owned.get(rootId).projectId, { ...clone(message), rootThreadId: rootId });
  }
  function acceptChild(thread) {
    const parent = parentOf(thread),
      rootId = treeOwner(parent),
      record = owned.get(rootId);
    if (
      !record ||
      !validId(thread?.id) ||
      owned.has(thread.id) ||
      thread.id === parent ||
      (!descendants.has(thread.id) && descendants.size >= 128)
    )
      return false;
    // A descendant belongs to the same workspace; parent links alone never grant
    // access to a different project's commands, patches, or approval requests.
    if (path.resolve(localPath(thread.cwd) || '\0') !== record.root) return false;
    const previous = descendants.get(thread.id);
    if (previous && previous.rootThreadId !== rootId) return false;
    descendants.set(thread.id, { items: new Map(), ...previous, rootThreadId: rootId, parentThreadId: parent });
    childActivity({ method: 'thread/started', params: { thread } }, rootId);
    const inbox = childInbox.get(thread.id) || [];
    childInbox.delete(thread.id);
    for (const message of inbox) notification(message);
    return true;
  }
  async function attachChild(id) {
    if (!validId(id) || discoveringChildren.has(id)) return;
    discoveringChildren.add(id);
    if (!descendants.has(id)) childInbox.set(id, []);
    const requestEpoch = epoch;
    try {
      const result = await rpc.request('thread/read', { threadId: id, includeTurns: false });
      if (closed || requestEpoch !== epoch || !acceptChild(result.thread)) return;
      // Rejoin the existing running child to receive typed operations. No turn is
      // started, no configuration is changed, and saved items are never replayed.
      await rpc.request('thread/resume', { threadId: id, excludeTurns: true });
    } catch {
      // A child can finish before attachment. Its parent's lifecycle/status items
      // remain authoritative; failure to attach never implies successful work.
    } finally {
      discoveringChildren.delete(id);
      childInbox.delete(id);
    }
  }
  function discoverChildren(message) {
    const item = message.params.item;
    if (!item || !['collabAgentToolCall', 'collabToolCall', 'subAgentActivity'].includes(item.type)) return;
    const tool = String(item.tool || '')
      .replaceAll('_', '')
      .toLowerCase();
    const ids =
      item.type === 'subAgentActivity'
        ? [item.agentThreadId]
        : tool === 'spawnagent'
          ? item.receiverThreadIds || []
          : [];
    for (const id of ids) if (!descendants.has(id)) void attachChild(id);
  }
  function notification(message) {
    if (closed || !message || !plainObject(message.params)) return;
    const { method, params: p } = message;
    if (method === 'account/login/completed') {
      if (login && p.loginId !== login.loginId) return;
      login = p.success ? null : { ...(login || {}), status: 'failed', error: p.error || 'Sign-in did not complete.' };
      refreshAccount().then(() => emit({ type: 'account', ...accountState() }));
      return;
    }
    if (method === 'account/updated') {
      catalogs.clear();
      refreshAccount().then(() => emit({ type: 'account', ...accountState() }));
      return;
    }
    if (method === 'skills/changed') {
      catalogs.clear();
      emit({ type: 'integrations' });
      return;
    }
    const id = p.threadId || p.thread?.id;
    if (method === 'thread/started' && !owned.has(id)) {
      if (acceptChild(p.thread)) void attachChild(id);
      return;
    }
    const descendant = descendants.get(id);
    if (descendant) {
      if (method === 'turn/started') {
        descendant.turnId = p.turn.id;
        descendant.items.clear();
      }
      if (method === 'item/started' && !descendant.turnId) descendant.turnId = p.turnId;
      if (['item/started', 'item/completed'].includes(method) && p.item?.id) {
        descendant.items.set(p.item.id, clone(p.item));
        if (descendant.items.size > 256) descendant.items.delete(descendant.items.keys().next().value);
      }
      if (method === 'item/fileChange/patchUpdated' && descendant.items.has(p.itemId))
        descendant.items.get(p.itemId).changes = clone(p.changes || []);
      if (method === 'turn/completed' && descendant.turnId === p.turn.id) {
        descendant.turnId = null;
        const t = threads.get(descendant.rootThreadId);
        if (t) {
          clearRequests(t, id);
          if (t.status === 'waiting' && !t.requests.length) t.status = t.turnId ? 'running' : 'idle';
          publish(t.id, true);
        }
      }
      if (method === 'serverRequest/resolved') {
        pending.delete(String(p.requestId));
        const t = threads.get(descendant.rootThreadId);
        if (t) {
          t.requests = t.requests.filter(r => String(r.id) !== String(p.requestId));
          if (t.status === 'waiting' && !t.requests.length) t.status = t.turnId ? 'running' : 'idle';
          publish(t.id, true);
        }
      }
      discoverChildren(message);
      childActivity(message, descendant.rootThreadId);
      return;
    }
    if (childInbox.has(id)) {
      const inbox = childInbox.get(id);
      if (inbox.length < 256) inbox.push(clone(message));
      return;
    }
    if (!owned.has(id)) return;
    let t = threads.get(id);
    if (!t) {
      t = snapshot(id);
      threads.set(id, t);
    }
    // Retry notices belong to the live connection, not the permanent turn error.
    // Only progress from this turn proves that its stream has recovered.
    const eventTurn = p.turnId || p.turn?.id;
    if (
      t.reconnecting &&
      eventTurn === t.turnId &&
      (method.startsWith('item/') || method === 'turn/completed' || method === 'turn/started')
    )
      t.reconnecting = null;
    if (method === 'turn/started') {
      t.status = 'running';
      t.turnId = p.turn.id;
      t.error = null;
      t.reconnecting = null;
      owned.get(id).hasTurns = true;
      updateRecord(id);
      for (const item of p.turn.items || []) upsert(t, item, p.turn.id, 'inProgress');
    } else if (method === 'turn/completed') {
      if (!finished.has(id)) finished.set(id, new Set());
      finished.get(id).add(p.turn.id);
      for (const item of p.turn.items || []) upsert(t, item, p.turn.id, 'completed');
      const currentTurn = !t.turnId || t.turnId === p.turn.id;
      if (currentTurn) {
        t.turnId = null;
        t.status = p.turn.status === 'failed' ? 'error' : p.turn.status === 'interrupted' ? 'interrupted' : 'idle';
        t.reconnecting = null;
        t.error =
          p.turn.error?.message || (p.turn.status === 'failed' ? t.error || 'Codex encountered an error.' : null);
        clearRequests(t);
      }
      updateRecord(id);
      if (currentTurn) queue.completed(id, p.turn.status);
    } else if (method === 'thread/status/changed') {
      const status = p.status?.type;
      if (status === 'active') t.status = t.requests.length ? 'waiting' : 'running';
      else if (status === 'systemError') t.status = 'error';
      else if (status === 'idle' && t.status !== 'interrupted' && t.status !== 'error') t.status = 'idle';
    } else if (method === 'thread/name/updated') {
      if (p.threadName) t.title = String(p.threadName).slice(0, 200);
      updateRecord(id);
    } else if (method === 'item/started' || method === 'item/completed')
      upsert(t, p.item, p.turnId, method === 'item/started' ? 'inProgress' : 'completed');
    else if (
      method === 'item/agentMessage/delta' ||
      method === 'item/plan/delta' ||
      method === 'item/commandExecution/outputDelta' ||
      method === 'item/reasoning/summaryTextDelta' ||
      method === 'item/reasoning/textDelta'
    ) {
      let item = t.items.find(value => value.id === p.itemId);
      if (!item) {
        const type = method.includes('commandExecution')
          ? 'commandExecution'
          : method.includes('reasoning')
            ? 'reasoning'
            : method.includes('/plan/')
              ? 'plan'
              : 'agentMessage';
        upsert(t, { id: p.itemId, type, text: '' }, p.turnId, 'inProgress');
        item = t.items.find(value => value.id === p.itemId);
      }
      if (item.type === 'commandExecution') {
        item.output = (item.output || '') + (p.delta || '');
        item.aggregatedOutput = item.output;
      } else item.text = (item.text || '') + (p.delta || '');
      touchItem(t, item);
    } else if (method === 'item/fileChange/patchUpdated') {
      const item = t.items.find(value => value.id === p.itemId);
      if (item) {
        item.changes = clone(p.changes || []);
        touchItem(t, item);
      } else upsert(t, { id: p.itemId, type: 'fileChange', changes: p.changes || [] }, p.turnId, 'inProgress');
      for (const req of t.requests.filter(value => value.itemId === p.itemId)) req.changes = clone(p.changes || []);
    } else if (method === 'turn/diff/updated')
      upsert(t, { id: 'diff:' + p.turnId, type: 'turnDiff', diff: p.diff }, p.turnId, 'completed');
    else if (method === 'turn/plan/updated')
      upsert(
        t,
        { id: 'plan:' + p.turnId, type: 'plan', text: p.explanation || '', plan: p.plan },
        p.turnId,
        'inProgress',
      );
    else if (method === 'thread/tokenUsage/updated') t.usage = clone(p.tokenUsage);
    else if (method === 'serverRequest/resolved') {
      pending.delete(String(p.requestId));
      t.requests = t.requests.filter(value => String(value.id) !== String(p.requestId));
      if (!t.requests.length && t.turnId) t.status = 'running';
    } else if (method === 'error') {
      if (p.turnId && p.turnId !== t.turnId) return;
      if (p.willRetry) t.reconnecting = p.error?.message || 'Reconnecting…';
      else {
        t.reconnecting = null;
        t.error = p.error?.message || 'Codex encountered an error.';
        t.status = 'error';
      }
    } else return;
    onActivity(owned.get(id).projectId, clone(message));
    discoverChildren(message);
    publish(id, method === 'turn/completed');
  }
  async function galaxyCapabilities(projectId) {
    return {
      show: await options.show?.(projectId),
      debug: await options.debug?.(projectId),
      semanticSearch: await options.atlasSearch?.(projectId),
    };
  }
  function galaxyTools(root, galaxy, permission, approve = async () => false) {
    return createGalaxyTools({ root, permission, approve, ...galaxy });
  }
  // A Codex dynamic tool call runs one of the galaxy's tools. Ones that run code ask through the normal approval card.
  async function galaxyToolCall(message, responder) {
    const p = message?.params || {},
      id = treeOwner(p.threadId);
    let result;
    try {
      if (!owned.has(id)) throw new Error('This request is not from an app-owned chat.');
      const record = owned.get(id);
      await assertOwned(record.projectId, id);
      const t = threads.get(id);
      if (!t?.turnId || p.turnId !== t.turnId) throw new Error('This request is not from the active turn.');
      // The debug capability keeps which session this chat's agent owns, so it lives as long as the chat.
      if (!galaxyByThread.has(id)) galaxyByThread.set(id, await galaxyCapabilities(record.projectId));
      const galaxy = galaxyByThread.get(id);
      const approve = (name, summary) =>
        new Promise(resolve => {
          const requestId = `galaxy:${p.callId}`;
          const request = {
            id: requestId,
            itemId: p.callId,
            turnId: p.turnId,
            reason: `${AGENTS.codex} wants to run ${name}.`,
            type: 'commandApproval',
            command: summary,
            cwd: record.root,
          };
          const local = {
            respond: (_id, response) => (resolve(response.decision === 'accept'), true),
            reject: () => resolve(false),
          };
          pending.set(requestId, { threadId: id, request, responder: local });
          t.requests.push(request);
          t.status = 'waiting';
          publish(id, true);
        });
      const level = () => permissionLevel(t.permission || record.permission);
      result = await galaxyTools(record.root, galaxy, level, (name, summary) =>
        PASSIVE.has(name) ? true : approve(name, summary),
      ).call(p.tool, p.arguments);
    } catch (error) {
      result = { ok: false, output: errorText(error) };
    }
    responder.respond(message.id, { contentItems: [{ type: 'inputText', text: result.output }], success: result.ok });
  }
  async function serverRequest(message, responder = rpc) {
    if (message?.method === 'item/tool/call') return galaxyToolCall(message, responder);
    const requestEpoch = epoch;
    const p = message?.params || {},
      id = treeOwner(p.threadId),
      descendant = descendants.get(p.threadId);
    try {
      if (!owned.has(id)) throw new Error('This request is not from an app-owned chat.');
      await assertOwned(owned.get(id).projectId, id);
      if (requestEpoch !== epoch || closed) throw new Error('This Codex connection has closed.');
      const t = threads.get(id);
      if (!t || p.turnId !== (descendant ? descendant.turnId : t.turnId) || !p.turnId || !validId(p.itemId))
        throw new Error('This request is not from the active turn.');
      if (pending.has(String(message.id))) throw new Error('Duplicate Codex request.');
      const request = {
        id: message.id,
        itemId: p.itemId,
        turnId: p.turnId,
        reason: p.reason || null,
        ...(descendant ? { agentThreadId: p.threadId } : {}),
      };
      if (message.method === 'item/commandExecution/requestApproval')
        Object.assign(request, {
          type: 'commandApproval',
          command: p.command || '(command details unavailable)',
          cwd: p.cwd || owned.get(id).root,
          networkApprovalContext: p.networkApprovalContext || null,
        });
      else if (message.method === 'item/fileChange/requestApproval') {
        if (p.grantRoot) throw new Error('Persistent write-root permission requests are unsupported.');
        Object.assign(request, {
          type: 'fileChangeApproval',
          changes: clone(
            (descendant ? descendant.items.get(p.itemId) : t.items.find(item => item.id === p.itemId))?.changes || [],
          ),
        });
      } else if (message.method === 'item/tool/requestUserInput') {
        if (
          !Array.isArray(p.questions) ||
          !p.questions.length ||
          p.questions.some(q => !validId(q.id) || typeof q.question !== 'string')
        )
          throw new Error('Invalid user-input request.');
        Object.assign(request, {
          type: 'userInput',
          questions: clone(p.questions),
          isBlocking: p.isBlocking !== false,
        });
      } else throw new Error('This Codex request is not supported by the desktop app.');
      pending.set(String(message.id), { threadId: id, request, responder });
      t.requests.push(request);
      t.status = 'waiting';
      publish(id, true);
    } catch (error) {
      responder.reject(message.id, { code: -32601, message: errorText(error) });
    }
  }
  function exited(info) {
    epoch++;
    available = false;
    loaded.clear();
    pending.clear();
    descendants.clear();
    childInbox.clear();
    discoveringChildren.clear();
    const reason =
      info?.error?.message ||
      info?.message ||
      (info?.signal
        ? `app-server stopped with signal ${info.signal}`
        : info?.code != null
          ? `app-server exited with code ${info.code}`
          : null);
    failure = closed ? null : `Codex disconnected${reason ? ': ' + reason : '.'}`;
    for (const [id, t] of threads)
      if (t.status === 'running' || t.status === 'waiting') {
        t.status = 'error';
        t.reconnecting = null;
        t.error = 'Codex disconnected. Reopen the chat to check its saved history before sending again.';
        t.turnId = null;
        t.requests = [];
        publish(id, true);
        queue.pause(id);
      }
    if (!closed) {
      emit({ type: 'disconnected', error: failure });
      emit({ type: 'account', ...accountState() });
    }
  }
  // Do not inherit a host application's API credentials or its CODEX_HOME.
  const env = { ...process.env, CODEX_HOME: home };
  for (const key of Object.keys(env))
    if (/^(?:OPENAI_API_KEY|CODEX_API_KEY|CHATGPT_TOKEN|CODEX_AUTH_|CODEX_INTERNAL_)/.test(key)) env[key] = undefined;
  const handlers = {
    bin: options.bin,
    env,
    cwd: dir,
    clientInfo: { name: 'galaxy_desktop', title: 'Galaxy', version: '1.0.0' },
    capabilities: { experimentalApi: true, requestAttestation: false },
    onNotification: notification,
    onRequest: serverRequest,
    onExit: exited,
    trace: options.trace,
  };
  const rpc =
    typeof options.transport === 'function'
      ? options.transport(handlers)
      : options.transport || require('../engine/agent/providers/codex-app-server.cjs').createCodexAppServer(handlers);
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
      await requireAccount();
      const entries = [],
        errors = [];
      const results = await Promise.allSettled([
        rpc.request('skills/list', { cwds: [root], forceReload: true }),
        rpc.request('app/installed', {
          ...(threadId && loaded.has(threadId) ? { threadId } : {}),
          forceRefresh: false,
        }),
        gitSummary(root),
      ]);
      if (results[0].status === 'fulfilled') {
        for (const row of results[0].value.data || []) {
          for (const skill of row.skills || [])
            if (skill.enabled !== false)
              entries.push({
                id: `skill:${skill.path}`,
                kind: 'skill',
                group: /[\\/]plugins[\\/]/.test(skill.path) ? 'plugin' : 'skill',
                name: skill.name,
                label: skill.interface?.displayName || skill.name,
                description: skill.interface?.shortDescription || skill.description || '',
                path: skill.path,
              });
          for (const error of row.errors || []) errors.push(error.message);
        }
      } else errors.push(`Skills: ${errorText(results[0].reason)}`);
      if (results[1].status === 'fulfilled') {
        for (const connector of results[1].value.apps || [])
          entries.push({
            id: `app:${connector.id}`,
            kind: 'connector',
            group: 'connector',
            name: connector.runtimeName || connector.id,
            label: connector.runtimeName || connector.id,
            description: !connector.enabled
              ? 'Disabled in Codex settings'
              : !connector.callable
                ? 'No tools available · check the connection in Codex'
                : 'Connected',
            path: `app://${connector.id}`,
            disabled: !connector.callable,
          });
      } else errors.push(`Connectors: ${errorText(results[1].reason)}`);
      const result = { entries, errors, ...results[2].value };
      catalogs.set(`${projectId}:${threadId || ''}`, result);
      return clone(result);
    },
    async compact(projectId, id) {
      const record = await assertOwned(projectId, id);
      return exclusive(id, async () => {
        await requireAccount();
        const t = threads.get(id);
        if (t?.turnId || ['running', 'waiting'].includes(t?.status))
          throw new Error('Stop or finish the current turn before compacting.');
        if (!record.hasTurns) throw new Error('Send a message before compacting this chat.');
        if (!loaded.has(id)) {
          const result = await rpc.request('thread/resume', {
            threadId: id,
            ...policy(record.root, record.permission),
            ...(record.model && { model: record.model }),
          });
          ingest(id, result);
          loaded.add(id);
        }
        await rpc.request('thread/compact/start', { threadId: id });
        return clone(snapshot(id));
      });
    },
    async state(projectId) {
      if (closed) throw new Error('Codex chat is closed.');
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
      if (closed) throw new Error('Codex chat is closed.');
      if (login?.status === 'pending') return clone(login);
      return exclusive('account', async () => {
        const result = await rpc.request('account/login/start', {
          type: 'chatgpt',
          useHostedLoginSuccessPage: true,
          appBrand: 'codex',
        });
        if (result.type !== 'chatgpt' || !result.loginId || typeof result.authUrl !== 'string')
          throw new Error('Codex returned an unsupported sign-in flow.');
        const url = new URL(result.authUrl);
        if (url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth0.openai.com'].includes(url.hostname))
          throw new Error('Codex returned an untrusted sign-in URL.');
        login = { loginId: result.loginId, authUrl: result.authUrl, status: 'pending' };
        available = true;
        failure = null;
        emit({ type: 'account', ...accountState() });
        return clone(login);
      });
    },
    async cancelLogin() {
      if (login?.status === 'pending') await rpc.request('account/login/cancel', { loginId: login.loginId });
      login = null;
      emit({ type: 'account', ...accountState() });
      return { cancelled: true };
    },
    async signOut() {
      return exclusive('account', async () => {
        if ([...threads.values()].some(t => t.turnId || locks.has(t.id)))
          throw new Error('Stop active chats before signing out.');
        if (login?.status === 'pending') await rpc.request('account/login/cancel', { loginId: login.loginId });
        await rpc.request('account/logout', {});
        account = null;
        login = null;
        models = [];
        catalogs.clear();
        failure = null;
        emit({ type: 'account', ...accountState() });
        return { signedOut: true };
      });
    },
    async newChat(projectId, input = {}) {
      return exclusive('new:' + projectId, async () => {
        const root = await rootFor(projectId);
        await requireAccount();
        const chosen = selection(input);
        const params = { ...policy(root, chosen.permission), ...(chosen.model ? { model: chosen.model } : {}) };
        if (chosen.effort) params.config.model_reasoning_effort = chosen.effort;
        // The galaxy's tools are fixed per Codex thread; each call checks the chat's permission at that moment.
        const galaxy = await galaxyCapabilities(projectId);
        params.dynamicTools = galaxyTools(root, galaxy, () => 'workspace-write')
          .definitions()
          .map(tool => ({ type: 'function', ...tool }));
        params.developerInstructions = galaxyGuidance(galaxy);
        const result = await rpc.request('thread/start', params);
        const id = result.thread?.id;
        if (!validId(id) || owned.has(id) || (result.thread.cwd && path.resolve(result.thread.cwd) !== root))
          throw new Error('Codex returned an invalid new chat.');
        galaxyByThread.set(id, galaxy);
        owned.set(id, {
          id,
          projectId,
          root,
          title: 'New chat',
          model: result.model || chosen.model,
          effort: result.reasoningEffort || chosen.effort,
          permission: chosen.permission,
          collaborationMode: chosen.collaborationMode,
          queue: [],
          queuePaused: false,
          hasTurns: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        persist();
        const t = ingest(id, result);
        loaded.add(id);
        publish(id, true);
        return clone(snapshot(id));
      });
    },
    async readChat(projectId, id) {
      await assertOwned(projectId, id);
      if (threads.get(id)?.turnId || (locks.has(id) && loaded.has(id))) return clone(snapshot(id));
      if (owned.get(id).hasTurns === false && loaded.has(id)) return clone(snapshot(id));
      return exclusive(id, async () => {
        // Reading does not start/resume work or require an authenticated account.
        const result = await rpc.request('thread/read', { threadId: id, includeTurns: true });
        const t = ingest(id, result);
        publish(id, true);
        return clone(snapshot(id));
      });
    },
    async send(projectId, id, input) {
      const record = await assertOwned(projectId, id);
      validateText(input);
      return exclusive(id, async () => {
        await requireAccount();
        let t = threads.get(id);
        if (t?.turnId || t?.requests.length || t?.status === 'running' || t?.status === 'waiting')
          throw new Error('Wait for this turn to finish or stop it before sending another message.');
        const chosen = selection(input, t || record);
        if (!loaded.has(id)) {
          if (record.hasTurns === false)
            throw new Error('This empty chat disconnected before it was saved. Start a new chat.');
          const resumed = await rpc.request('thread/resume', {
            threadId: id,
            ...policy(record.root, chosen.permission),
            ...(chosen.model ? { model: chosen.model } : {}),
          });
          t = ingest(id, resumed);
          loaded.add(id);
          if (t.turnId || t.status === 'running') throw new Error('This chat already has an active turn.');
        }
        const content = await providerInput(projectId, input, chosen, id);
        t = threads.get(id) || snapshot(id);
        threads.set(id, t);
        t.model = chosen.model;
        t.effort = chosen.effort;
        t.permission = chosen.permission;
        t.collaborationMode = chosen.collaborationMode;
        t.error = null;
        t.status = 'running';
        if (t.title === 'New chat') t.title = input.text.trim().replace(/\s+/g, ' ').slice(0, 90) || 'Attachments';
        // Save ownership before dispatch: a timed-out first turn may have been
        // accepted even if neither its response nor notification reached us.
        // Retaining the mapping lets read/resume recover its provider history.
        record.hasTurns = true;
        updateRecord(id);
        publish(id, true);
        try {
          const result = await rpc.request('turn/start', {
            threadId: id,
            input: content,
            cwd: record.root,
            approvalPolicy: permissionPolicy(record.root, chosen.permission).approvalPolicy,
            approvalsReviewer: 'user',
            sandboxPolicy: permissionPolicy(record.root, chosen.permission).sandboxPolicy,
            ...(chosen.model ? { model: chosen.model } : {}),
            ...(chosen.effort ? { effort: chosen.effort } : {}),
            collaborationMode: {
              mode: chosen.collaborationMode,
              settings: {
                model: chosen.model,
                reasoning_effort: chosen.effort,
                developer_instructions: null,
              },
            },
          });
          record.hasTurns = true;
          updateRecord(id);
          // Notifications can arrive before the response; never turn a completed
          // notification back into a running turn or manufacture a user message.
          if (!finished.get(id)?.has(result.turn.id)) {
            if (t.status === 'running' || t.status === 'waiting') t.turnId = result.turn.id;
            for (const item of result.turn.items || [])
              upsert(t, item, result.turn.id, result.turn.status === 'inProgress' ? 'inProgress' : 'completed');
          }
          publish(id, true);
          return clone(snapshot(id));
        } catch (error) {
          t.error = errorText(error) + ' Check the chat history before sending again; this message was not retried.';
          if (!t.turnId) {
            t.status = 'error';
            loaded.delete(id);
          }
          publish(id, true);
          throw new Error(t.error);
        }
      });
    },
    async stop(projectId, id) {
      await assertOwned(projectId, id);
      const t = threads.get(id);
      if (!t?.turnId) throw new Error('This chat has no active turn to stop.');
      queue.pause(id);
      await rpc.request('turn/interrupt', { threadId: id, turnId: t.turnId });
      return clone(snapshot(id));
    },
    async enqueue(projectId, id, input) {
      await assertOwned(projectId, id);
      const text = validateText(input);
      return exclusive(id, async () => {
        const chosen = selection(input, threads.get(id) || owned.get(id));
        await providerInput(projectId, input, chosen, id);
        queue.add(id, {
          text,
          ...chosen,
          attachments: input.attachments || [],
          attachmentInfo: (await attachments.records(projectId, input.attachments || [])).map(a => ({
            id: a.id,
            name: a.name,
            kind: a.kind,
          })),
          mentions: input.mentions || [],
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
    async steer(projectId, id, input) {
      await assertOwned(projectId, id);
      const text = validateText(input);
      return exclusive(id, async () => {
        const t = threads.get(id);
        if (
          !validId(input.expectedTurnId) ||
          t?.turnId !== input.expectedTurnId ||
          !['running', 'waiting'].includes(t.status)
        )
          throw new Error('The active turn changed. Queue this message or send it as a new turn.');
        try {
          const content = await providerInput(projectId, input, t, id);
          await rpc.request('turn/steer', {
            threadId: id,
            expectedTurnId: input.expectedTurnId,
            input: content,
          });
        } catch (error) {
          throw new Error(errorText(error) + ' Steering was not retried; check chat history before sending again.');
        }
        return clone(snapshot(id));
      });
    },
    async respond(projectId, id, requestId, response) {
      await assertOwned(projectId, id);
      const entry = pending.get(String(requestId));
      if (!entry || entry.threadId !== id || !plainObject(response))
        throw new Error('This request is no longer awaiting a response.');
      const request = entry.request;
      let result;
      if (request.type === 'userInput') {
        if (!plainObject(response.answers)) throw new Error('Answer the requested questions.');
        const answers = Object.create(null),
          expected = new Set(request.questions.map(q => q.id));
        if (Object.keys(response.answers).some(key => !expected.has(key)))
          throw new Error('Unexpected question answer.');
        for (const question of request.questions) {
          const answer = response.answers[question.id]?.answers;
          if (
            !Array.isArray(answer) ||
            answer.length < 1 ||
            answer.length > 10 ||
            answer.some(value => typeof value !== 'string' || !value.trim() || value.length > 20000)
          )
            throw new Error('Answer each requested question.');
          answers[question.id] = { answers: answer };
        }
        result = { answers };
      } else {
        if (!['accept', 'decline', 'cancel'].includes(response.decision))
          throw new Error('Choose Allow once or Decline.');
        result = { decision: response.decision };
      }
      // Consume before writing so a double click cannot repeat a permission grant.
      pending.delete(String(requestId));
      const t = threads.get(id);
      t.requests = t.requests.filter(value => String(value.id) !== String(requestId));
      try {
        if ((await entry.responder.respond(request.id, result)) === false)
          throw new Error('The Codex request is no longer connected.');
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
      changedItems.clear();
      fullSnapshots.clear();
      publications.clear();
      await Promise.allSettled(
        [...threads.values()]
          .filter(thread => thread.turnId)
          .map(thread =>
            rpc.request('turn/interrupt', { threadId: thread.id, turnId: thread.turnId }, { timeoutMs: 2000 }),
          ),
      );
      for (const entry of pending.values()) {
        try {
          await entry.responder.reject(entry.request.id, { code: -32000, message: 'The desktop app is closing.' });
        } catch {}
      }
      pending.clear();
      await rpc.close();
    },
  };
  return api;
}
module.exports = { createCodexChat };
