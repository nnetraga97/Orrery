const { EventEmitter } = require('node:events');
const { Transport } = require('./transport.cjs');
class DapClient extends EventEmitter {
  constructor(readable, writable = readable, { timeoutMs = 10000, onRequest } = {}) {
    super();
    this.transport = new Transport(readable, writable);
    this.timeoutMs = timeoutMs;
    this.onRequest = onRequest;
    this.seq = 0;
    this.pending = new Map();
    this.transport.on('message', message => {
      if (message.type === 'response') {
        const pending = this.pending.get(message.request_seq);
        if (!pending) return;
        this.pending.delete(message.request_seq);
        clearTimeout(pending.timer);
        if (message.success) pending.resolve(message.body || {});
        else pending.reject(new Error(message.message || message.body?.error?.format || `${message.command} failed`));
      } else if (message.type === 'event') this.emit(message.event, message.body || {});
      else if (message.type === 'request') void this.reverse(message);
    });
    this.transport.on('close', error => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
      this.emit('close', error);
    });
  }
  async reverse(message) {
    let result;
    try {
      if (message.command === 'runInTerminal' || !this.onRequest)
        throw new Error(`Unsupported reverse request: ${message.command}`);
      result = await this.onRequest(message.command, message.arguments || {});
      this.transport.send({
        seq: ++this.seq,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: true,
        body: result?.body || {},
      });
      // Child initialization must start only after the parent acknowledges startDebugging.
      result?.afterResponse?.();
    } catch (error) {
      if (!this.transport.closed)
        this.transport.send({
          seq: ++this.seq,
          type: 'response',
          request_seq: message.seq,
          command: message.command,
          success: false,
          message: error.message,
        });
    }
  }
  request(command, args = {}, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      if (this.transport.closed) return reject(new Error('DAP connection closed'));
      const seq = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP timed out: ${command}`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      try {
        this.transport.send({ seq, type: 'request', command, arguments: args });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(error);
      }
    });
  }
  waitFor(event, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const clean = () => {
        clearTimeout(timer);
        this.off(event, done);
        this.off('close', fail);
      };
      const done = value => {
        clean();
        resolve(value);
      };
      const fail = error => {
        clean();
        reject(error);
      };
      const timer = setTimeout(() => fail(new Error(`DAP timed out waiting for ${event}`)), timeoutMs);
      this.once(event, done);
      this.once('close', fail);
      if (this.transport.closed) fail(new Error('DAP connection closed'));
    });
  }
  close() {
    this.transport.close();
  }
}
module.exports = { DapClient };
