// Incremental JSON projection: retain bounded metadata, never buffer a whole media-bearing line.
// Limits apply to retained values, not record length. Truncation is explicit to adapters/history.
class JSONLDecoder {
  constructor({ onRecord, onError = () => {}, stringLimit = 8192, nodeLimit = 8192, byteLimit = 262144 } = {}) {
    Object.assign(this, { onRecord, onError, stringLimit, nodeLimit, byteLimit });
    this.metrics = { records: 0, malformed: 0, projected: 0, maxRetained: 0 };
    this.reset();
  }
  reset() {
    this.stack = [];
    this.value = undefined;
    this.mode = null;
    this.token = '';
    this.escape = false;
    this.safe = 0;
    this.nodes = 0;
    this.retained = 0;
    this.cut = false;
    this.error = null;
    this.started = false;
  }
  put(value) {
    const parent = this.stack.at(-1);
    if (!parent) {
      if (this.value !== undefined) throw new Error('Multiple JSON values.');
      this.value = value;
      return;
    }
    if (!(parent.state === 'value' || (parent.array && parent.state === 'first')))
      throw new Error('Unexpected JSON value.');
    if (parent.value && this.nodes <= this.nodeLimit) {
      if (parent.array) parent.value.push(value);
      else
        Object.defineProperty(parent.value, parent.key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
    }
    parent.state = 'comma';
  }
  keep() {
    const keep = ++this.nodes <= this.nodeLimit && this.retained < this.byteLimit;
    if (!keep) this.cut = true;
    return keep;
  }
  endToken() {
    const raw = this.token;
    this.token = '';
    this.mode = null;
    const value = JSON.parse(raw);
    this.put(this.keep() ? value : null);
  }
  char(c) {
    if (this.mode === 'string') {
      if (c === '"' && !this.escape && !this.unicode) {
        const raw = this.token.slice(0, this.safe),
          value = JSON.parse('"' + raw + '"');
        const parent = this.stack.at(-1);
        if (this.key) {
          parent.key = value;
          parent.state = 'colon';
        } else this.put(this.keep() ? value : null);
        this.mode = null;
        this.token = '';
        return;
      }
      if (this.token.length < this.limit && (this.key || this.retained < this.byteLimit)) {
        this.token += c;
        this.retained += Buffer.byteLength(c);
      } else {
        this.cut = true;
        this.truncatedString = true;
      }
      if (this.unicode) {
        if (!/[0-9a-f]/i.test(c)) throw new Error('Invalid Unicode escape.');
        this.unicode--;
      } else if (this.escape) {
        if (c === 'u') this.unicode = 4;
        else if (!'"\\/bfnrt'.includes(c)) throw new Error('Invalid escape.');
        this.escape = false;
      } else if (c === '\\') this.escape = true;
      else if (c.charCodeAt(0) < 32) throw new Error('Invalid string.');
      if (!this.escape && !this.unicode && !this.truncatedString) this.safe = this.token.length;
      return;
    }
    if (this.mode === 'atom') {
      if (!/[\s,}\]]/.test(c)) {
        if (this.token.length > 128) throw new Error('Invalid scalar.');
        this.token += c;
        return;
      }
      this.endToken();
    }
    if (/\s/.test(c)) return;
    this.started = true;
    const parent = this.stack.at(-1);
    if (c === '"') {
      this.key = !!parent && !parent.array && ['key', 'first'].includes(parent.state);
      if (!this.key && parent && !['value', 'first'].includes(parent.state)) throw new Error('Unexpected string.');
      this.limit = this.key
        ? 1024
        : ['data', 'base64', 'blob', 'image_url'].includes(parent?.key)
          ? 0
          : ['aggregated_output', 'aggregatedOutput', 'stdout', 'stderr', 'output'].includes(parent?.key)
            ? 2000
            : this.stringLimit;
      this.mode = 'string';
      this.token = '';
      this.safe = 0;
      this.truncatedString = false;
      this.escape = false;
      this.unicode = 0;
      return;
    }
    if (c === '{' || c === '[') {
      if (this.stack.length >= 64) throw new Error('JSON nesting exceeds 64.');
      const value = this.keep() ? (c === '[' ? [] : {}) : null;
      this.put(value);
      this.stack.push({ value, array: c === '[', state: 'first' });
      return;
    }
    if (c === '}' || c === ']') {
      if (!parent || parent.array !== (c === ']') || !['first', 'comma'].includes(parent.state))
        throw new Error('Invalid JSON closing delimiter.');
      this.stack.pop();
      return;
    }
    if (c === ':') {
      if (!parent || parent.array || parent.state !== 'colon') throw new Error('Invalid colon.');
      parent.state = 'value';
      return;
    }
    if (c === ',') {
      if (!parent || parent.state !== 'comma') throw new Error('Invalid comma.');
      parent.state = parent.array ? 'value' : 'key';
      return;
    }
    if (parent && !['value', 'first'].includes(parent.state)) throw new Error('Unexpected scalar.');
    this.mode = 'atom';
    this.token = c;
  }
  end() {
    try {
      if (this.error) throw this.error;
      if (this.mode === 'atom') this.endToken();
      if (!this.started) return;
      if (this.mode || this.stack.length || !this.value || typeof this.value !== 'object')
        throw new Error('Incomplete JSON record.');
      if (this.cut) {
        this.value._projection = { truncated: true };
        this.metrics.projected++;
      }
      this.metrics.records++;
      this.onRecord(this.value);
    } catch (error) {
      this.metrics.malformed++;
      this.onError(error);
    } finally {
      this.metrics.maxRetained = Math.max(this.metrics.maxRetained, this.retained);
      this.reset();
    }
  }
  write(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (c === '\n') {
        this.end();
        continue;
      }
      if (this.error) continue;
      try {
        this.char(c);
      } catch (error) {
        this.error = error;
      }
    }
  }
  finish() {
    this.end();
  }
}
module.exports = { JSONLDecoder };
