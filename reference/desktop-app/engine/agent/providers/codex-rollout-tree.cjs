// Follow only descendants of the explicitly selected rollout. Metadata is cached;
// unrelated transcripts are never tailed and date-directory rollover is supported.
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path');
const { followJSONL } = require('../event-stream.cjs');
const { codexMetadata, recentContext } = require('./codex-sessions.cjs');
const { createCodexAgents } = require('./codex-agents.cjs');

async function followCodexTree({ file, root, metadata, createAdapter, publish, onError, fromStart = false }) {
  let directory = path.dirname(file);
  while (/^\d{2,4}$/.test(path.basename(directory))) directory = path.dirname(directory);
  const attachedAt = Date.now(),
    streams = new Map(),
    headers = new Map();
  let disposed = false,
    scanning = false,
    again = false,
    timer,
    recovery,
    watcher;
  const agents = createCodexAgents({ root, sessionId: metadata.id, emit: publish });
  const primary = createAdapter({
    root,
    sessionId: metadata.id,
    emit: publish,
    workspaceAliases: [metadata.rawCwd],
    requireContext: true,
    agents,
  });
  primary.start();
  async function follow(m, adapter, replay) {
    const { context, offset } = replay ? { context: null, offset: 0 } : await recentContext(m.file);
    if (context) adapter.prime(context);
    const stream = await followJSONL(m.file, record => adapter.record(record), { startOffset: offset, onError });
    if (disposed) stream.dispose();
    else streams.set(m.id, { stream, adapter });
    return stream;
  }
  const mainStream = await follow(metadata, primary, fromStart);
  async function inventory(dir, depth = 0) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (disposed) return;
      const name = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3 && /^\d{2,4}$/.test(entry.name)) await inventory(name, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl') && !headers.has(name)) {
        try {
          headers.set(name, await codexMetadata(name));
        } catch {
          /* Incomplete headers are retried after an append. */
        }
      }
    }
  }
  async function scan() {
    if (disposed) return;
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    try {
      do {
        again = false;
        await inventory(directory);
        let found;
        do {
          found = false;
          for (const m of headers.values()) {
            if (disposed) return;
            if (m.id === metadata.id || streams.has(m.id) || m.cwd !== root) continue;
            if (m.parentThreadId !== metadata.id && !streams.has(m.parentThreadId)) continue;
            const agent = agents.register(m.id, m.parentThreadId, m);
            if (!agent) continue;
            const adapter = createAdapter({
              root,
              sessionId: m.id,
              rootSessionId: metadata.id,
              agentId: m.id,
              displayName: agent.label,
              emit: publish,
              workspaceAliases: [m.rawCwd],
              requireContext: true,
              agents,
            });
            adapter.start();
            await follow(m, adapter, fromStart || m.createdAt >= attachedAt);
            found = true;
          }
        } while (found && !disposed);
      } while (again && !disposed);
    } catch (error) {
      if (!disposed) onError(error);
    } finally {
      scanning = false;
    }
  }
  const schedule = () => {
    if (!disposed && !timer)
      timer = setTimeout(() => {
        timer = null;
        void scan();
      }, 40);
  };
  try {
    watcher = fs.watch(directory, { recursive: true }, schedule);
  } catch {
    /* The low-frequency inventory also supports non-recursive platforms. */
  }
  watcher?.on('error', onError);
  recovery = setInterval(schedule, 2000);
  recovery.unref?.();
  await scan();
  return {
    provider: 'codex',
    sessionId: metadata.id,
    metrics: mainStream.metrics,
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearInterval(recovery);
      watcher?.close();
      for (const { stream, adapter } of streams.values()) {
        stream.dispose();
        adapter.finish('interrupted', { outcomeUnobserved: true });
      }
      agents.stop();
      streams.clear();
      headers.clear();
    },
  };
}
module.exports = { followCodexTree };
