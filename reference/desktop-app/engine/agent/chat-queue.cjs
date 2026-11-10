const { randomUUID } = require('node:crypto');
const { permissionLevel } = require('./codex-permissions.cjs');

function restoreQueue(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .filter(
      item =>
        item &&
        typeof item.id === 'string' &&
        typeof item.text === 'string' &&
        (item.text.trim() || item.attachments?.length) &&
        item.text.length <= 200000,
    )
    .map(item => ({
      id: item.id,
      text: item.text,
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      attachmentInfo: Array.isArray(item.attachmentInfo) ? item.attachmentInfo : [],
      mentions: Array.isArray(item.mentions) ? item.mentions : [],
      model: item.model || null,
      effort: item.effort || null,
      permission: permissionLevel(item.permission),
      collaborationMode: item.collaborationMode === 'plan' ? 'plan' : 'default',
      state: item.state === 'ready' ? 'ready' : 'failed',
      ...(item.state !== 'ready' && {
        error: 'Check chat history before editing or removing this message; its delivery may be incomplete.',
      }),
    }));
}

// The main process owns queued turns, so switching/closing panels never dispatches or loses them.
function createChatQueue({ records, snapshot, save, publish, send, locked, activate = () => {} }) {
  const timers = new Map();
  let closed = false;
  const changed = id => {
    save();
    publish(id, true);
  };
  const cancelTimer = id => {
    clearTimeout(timers.get(id));
    timers.delete(id);
  };
  function pause(id) {
    cancelTimer(id);
    const record = records.get(id);
    if (!record) return;
    record.queuePaused = true;
    changed(id);
  }
  function schedule(id) {
    const record = records.get(id),
      t = snapshot(id);
    if (closed || timers.has(id) || record.queuePaused || !record.queue?.length || t.status !== 'idle' || t.turnId)
      return;
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void drain(id);
      }, 25),
    );
  }
  async function drain(id) {
    const record = records.get(id),
      t = snapshot(id),
      item = record.queue?.[0];
    if (closed || record.queuePaused || !item || item.state !== 'ready' || t.status !== 'idle' || t.turnId) return;
    if (locked(id)) {
      schedule(id);
      return;
    }
    item.state = 'sending';
    changed(id);
    try {
      await send(record.projectId, id, item);
      record.queue = record.queue.filter(message => message.id !== item.id);
    } catch (error) {
      item.state = 'failed';
      item.error = String(error.message || error);
      record.queuePaused = true;
    }
    changed(id);
    schedule(id);
  }
  return {
    add(id, input) {
      const record = records.get(id);
      record.queue ||= [];
      if (record.queue.length >= 20) throw new Error('This chat already has 20 queued messages.');
      record.queue.push({ ...input, id: randomUUID(), state: 'ready' });
      changed(id);
      schedule(id);
    },
    remove(id, messageId) {
      const record = records.get(id),
        item = record.queue?.find(message => message.id === messageId);
      if (!item) throw new Error('This queued message is no longer available.');
      if (item.state === 'sending') throw new Error('This message is already being sent.');
      record.queue = record.queue.filter(message => message.id !== messageId);
      changed(id);
    },
    resume(id) {
      const record = records.get(id);
      if (record.queue?.[0]?.state === 'failed')
        throw new Error('Check history, then edit or remove the failed queued message first.');
      activate(id);
      record.queuePaused = false;
      changed(id);
      schedule(id);
    },
    pause,
    completed(id, status) {
      status === 'completed' ? schedule(id) : pause(id);
    },
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const record of records.values()) if (record.queue?.length) record.queuePaused = true;
      save();
    },
  };
}
module.exports = { createChatQueue, restoreQueue };
