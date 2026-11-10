// Optional, explicitly selected transports. The exported extension API is the primary integration.
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { pathToFileURL } = require('node:url');
const { followJSONL } = require('./event-stream.cjs');
const { readJSONL } = require('../shared/files.cjs');
const { codexHome, codexSessions, codexMetadata } = require('./providers/codex-sessions.cjs');
const { watchNextSession } = require('./next-session.cjs');
const claudeDirectory = root => path.join(os.homedir(), '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
async function claudeSessions(root) {
  const dir = claudeDirectory(root);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = await Promise.all(
    entries
      .filter(f => f.endsWith('.jsonl'))
      .map(async f => ({
        file: path.join(dir, f),
        id: path.basename(f, '.jsonl'),
        modified: (await fs.stat(path.join(dir, f))).mtimeMs,
      })),
  );
  return files.sort((a, b) => b.modified - a.modified);
}
async function connectClaude(file, root, publish, onError, { fromStart = false } = {}) {
  const { createClaudeAdapter } = await import(pathToFileURL(path.join(__dirname, './providers/claude.mjs')).href);
  const sessionId = path.basename(file, '.jsonl');
  const adapter = createClaudeAdapter({ root, sessionId, emit: publish });
  adapter.start();
  const subdir = path.join(file.slice(0, -6), 'subagents'),
    subs = new Map();
  let watcher,
    discovering = false,
    disposed = false;
  async function discover(fromStart = true) {
    if (discovering || disposed) return;
    discovering = true;
    try {
      for (const name of await fs.readdir(subdir)) {
        if (disposed || !name.endsWith('.jsonl') || subs.has(name)) continue;
        let parent;
        try {
          parent = JSON.parse(
            await fs.readFile(path.join(subdir, name.replace(/\.jsonl$/, '.meta.json')), 'utf8'),
          ).toolUseId;
        } catch {
          continue;
        }
        const sub = await followJSONL(path.join(subdir, name), record => adapter.record(record, parent), {
          fromStart,
          onError,
        });
        if (disposed) sub.dispose();
        else subs.set(name, sub);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') onError(e);
    } finally {
      discovering = false;
    }
  }
  const stream = await followJSONL(
    file,
    record => {
      adapter.record(record);
      void discover();
    },
    { fromStart, onError },
  );
  await discover(false);
  try {
    watcher = require('node:fs').watch(path.dirname(subdir), () => void discover());
  } catch {}
  return {
    provider: 'claude-code',
    sessionId,
    dispose() {
      disposed = true;
      stream.dispose();
      watcher?.close();
      for (const sub of subs.values()) sub.dispose();
    },
  };
}
async function connectEvents(file, root, publish, onError) {
  const {
    records: [header],
  } = await readJSONL(file, { maxBytes: 65536 });
  if (header?.type !== 'session.started')
    throw new Error('The first stream record must be a v1 session.started event.');
  publish(header);
  const stream = await followJSONL(file, publish, { onError });
  return { provider: header.provider, sessionId: header.sessionId, dispose: () => stream.dispose() };
}
async function connectCodex(file, root, publish, onError, { fromStart = false } = {}) {
  const metadata = await codexMetadata(file);
  if (metadata.cwd !== (await fs.realpath(root)))
    throw new Error('This Codex session belongs to a different workspace.');
  const { createCodexAdapter } = await import(pathToFileURL(path.join(__dirname, './providers/codex.mjs')).href);
  return require('./providers/codex-rollout-tree.cjs').followCodexTree({
    file,
    root: metadata.cwd,
    metadata,
    createAdapter: createCodexAdapter,
    publish,
    onError,
    fromStart,
  });
}
async function waitForSession(transport, root, onSession, onError, { directory } = {}) {
  const canonicalRoot = await fs.realpath(root);
  if (transport === 'codex')
    return watchNextSession({
      directory: directory || path.join(codexHome(), 'sessions'),
      subdirectory: name => /^\d{2,4}$/.test(name),
      onSession,
      onError,
      readSession: async file => {
        const session = await codexMetadata(file);
        return session.cwd === canonicalRoot ? session : null;
      },
    });
  if (transport !== 'claude') throw new Error('This transport cannot observe future local sessions.');
  return watchNextSession({
    directory: directory || claudeDirectory(root),
    onSession,
    onError,
    readSession: async file => {
      const { records } = await readJSONL(file, { maxBytes: 262144 });
      const record = records.find(r => typeof r.cwd === 'string');
      if (typeof record?.cwd !== 'string') throw new Error('Waiting for Claude workspace metadata.');
      return (await fs.realpath(record.cwd)) === canonicalRoot ? { file, id: path.basename(file, '.jsonl') } : null;
    },
  });
}
module.exports = { claudeSessions, codexSessions, connectClaude, connectCodex, connectEvents, waitForSession };
