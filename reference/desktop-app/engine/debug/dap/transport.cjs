const { EventEmitter } = require('node:events');
const { appendFileSync } = require('node:fs');
// GALAXY_DAP_TRACE=<file> appends every protocol message as a JSON line, for adapter debugging.
const trace = (direction, message) => {
  if (process.env.GALAXY_DAP_TRACE)
    appendFileSync(process.env.GALAXY_DAP_TRACE, JSON.stringify({ time: Date.now(), direction, message }) + '\n');
};
class Transport extends EventEmitter {
  constructor(readable, writable = readable) {
    super();
    this.readable = readable;
    this.writable = writable;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.onData = chunk => {
      try {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        while (this.buffer.length) {
          const end = this.buffer.indexOf('\r\n\r\n');
          if (end < 0) {
            if (this.buffer.length > 8192) throw new Error('Invalid protocol header');
            break;
          }
          const match = /^Content-Length:\s*(\d+)\s*$/im.exec(this.buffer.subarray(0, end).toString('ascii'));
          if (!match || +match[1] > 32 * 1024 * 1024) throw new Error('Invalid Content-Length');
          const length = +match[1];
          if (this.buffer.length < end + 4 + length) break;
          const body = this.buffer.subarray(end + 4, end + 4 + length);
          this.buffer = this.buffer.subarray(end + 4 + length);
          const message = JSON.parse(body.toString('utf8'));
          trace('receive', message);
          this.emit('message', message);
        }
      } catch (error) {
        this.close(error);
      }
    };
    this.onEnd = () => this.close(new Error('Protocol connection closed'));
    this.onError = error => this.close(error);
    readable.on('data', this.onData);
    readable.on('end', this.onEnd);
    readable.on('close', this.onEnd);
    readable.on('error', this.onError);
    if (writable !== readable) writable.on('error', this.onError);
  }
  send(message) {
    if (this.closed) throw new Error('Protocol connection closed');
    trace('send', message);
    const body = Buffer.from(JSON.stringify(message));
    this.writable.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }
  close(error = new Error('Protocol connection closed')) {
    if (this.closed) return;
    this.closed = true;
    this.readable.removeListener('data', this.onData);
    this.readable.destroy();
    if (this.writable !== this.readable) this.writable.destroy();
    this.emit('close', error);
  }
}
module.exports = { Transport };
