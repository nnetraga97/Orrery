const { EventEmitter } = require('node:events');
const { Transport } = require('../dap/transport.cjs');
class LspClient extends EventEmitter {
  constructor(readable, writable, { timeoutMs = 60000, onRequest, workspaceFolders = [] } = {}) {
    super();
    this.transport = new Transport(readable, writable);
    this.timeoutMs = timeoutMs;
    this.seq = 0;
    this.pending = new Map();
    this.onRequest =
      onRequest ||
      (async (method, params) => {
        if (method === 'workspace/configuration') return (params.items || []).map(() => null);
        if (method === 'workspace/workspaceFolders') return workspaceFolders;
        if (method === 'workspace/applyEdit') return { applied: false, failureReason: 'Edits require user review' };
        if (
          [
            'client/registerCapability',
            'client/unregisterCapability',
            'window/workDoneProgress/create',
            'window/showMessageRequest',
          ].includes(method)
        )
          return null;
        throw new Error(`Unsupported LSP request: ${method}`);
      });
    this.transport.on('message', message => {
      if (message.method && message.id != null) void this.reverse(message);
      else if (message.method) this.emit(message.method, message.params);
      else {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
    });
    this.transport.on('close', error => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      this.pending.clear();
      this.emit('close', error);
    });
  }
  async reverse(message) {
    let reply;
    try {
      reply = { result: await this.onRequest(message.method, message.params || {}) };
    } catch (error) {
      reply = { error: { code: -32601, message: error.message } };
    }
    if (!this.transport.closed) this.transport.send({ jsonrpc: '2.0', id: message.id, ...reply });
  }
  request(method, params = null, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.transport.closed) return reject(new Error('LSP connection closed'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.transport.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method, params = {}) {
    this.transport.send({ jsonrpc: '2.0', method, params });
  }
  close() {
    this.transport.close();
  }
}
module.exports = { LspClient };
