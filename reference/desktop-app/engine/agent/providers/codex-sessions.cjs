// One-shot discovery for an explicit connection. No process polling, database access or latest-session switching.
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { localPath } = require('../resources.cjs');
const { readJSONL } = require('../../shared/files.cjs');
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const MAX_HEADER = 256 * 1024;

async function codexMetadata(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    let text = '';
    for (let offset = 0; offset < Math.min(stat.size, MAX_HEADER); offset += 65536) {
      const buffer = Buffer.alloc(Math.min(65536, stat.size - offset, MAX_HEADER - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      text += buffer.subarray(0, bytesRead).toString('utf8');
      if (text.includes('\n') || offset + bytesRead === stat.size) break;
    }
    const record = JSON.parse(text.split('\n')[0]),
      p = record.payload;
    if (
      record.type !== 'session_meta' ||
      !p ||
      typeof p.cwd !== 'string' ||
      !/^[\w.-]{1,160}$/.test(p.id || p.session_id || '')
    )
      throw new Error('Not a supported local Codex session.');
    return {
      file,
      id: p.id || p.session_id,
      cwd: await fs.realpath(localPath(p.cwd) || '\0'),
      rawCwd: p.cwd,
      modified: stat.mtimeMs,
      source: typeof p.originator === 'string' ? p.originator : 'Codex',
      parentThreadId: p.source?.subagent?.thread_spawn?.parent_thread_id || p.parent_thread_id || null,
      agentNickname: p.agent_nickname || p.source?.subagent?.thread_spawn?.agent_nickname || null,
      agentRole: p.agent_role || p.source?.subagent?.thread_spawn?.agent_role || null,
      createdAt: Date.parse(record.timestamp) || stat.birthtimeMs,
    };
  } finally {
    await handle.close();
  }
}

async function codexSessions(root, home = codexHome()) {
  root = await fs.realpath(root);
  const matches = [];
  async function walk(dir, depth = 0) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    const files = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'));
    // At most eight metadata reads in flight. Read only the header, never full conversation histories.
    for (let i = 0; i < files.length; i += 8) {
      const found = await Promise.all(
        files.slice(i, i + 8).map(async e => {
          try {
            const m = await codexMetadata(path.join(dir, e.name));
            return m.cwd === root ? m : null;
          } catch {
            return null;
          }
        }),
      );
      matches.push(...found.filter(Boolean));
    }
    if (depth < 3)
      for (const e of entries)
        if (e.isDirectory() && /^\d{2,4}$/.test(e.name)) await walk(path.join(dir, e.name), depth + 1);
  }
  await walk(path.join(home, 'sessions'));
  return matches.sort((a, b) => b.modified - a.modified);
}

async function recentContext(file) {
  // Bounded metadata priming at EOF. If context is outside this tail, wait for the next turn context.
  const { records, size } = await readJSONL(file, { maxBytes: MAX_HEADER, fromEnd: true });
  const context = records.findLast(record => record.type === 'turn_context') || null;
  return { context, offset: size };
}
module.exports = { codexHome, codexSessions, codexMetadata, recentContext };
