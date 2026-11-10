// Compatibility transport for an explicitly selected JSONL file. Never discovers or switches sessions.
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { JSONLDecoder } = require('./jsonl-decoder.cjs');
const CHUNK = 64 * 1024;
async function followJSONL(file, onRecord, { onError = () => {}, fromStart = false, startOffset } = {}) {
  file = path.resolve(file);
  const initial = await fsp.stat(file);
  let offset = Number.isSafeInteger(startOffset) && startOffset >= 0 ? startOffset : fromStart ? 0 : initial.size,
    inode = initial.ino,
    decoder = new StringDecoder('utf8');
  let running = false,
    again = false,
    disposed = false,
    watcher,
    retryTimer;
  const records = [],
    metrics = { bytes: 0, reads: 0, malformed: 0, oversized: 0, projected: 0, maxRetained: 0 };
  const parser = new JSONLDecoder({
    onRecord: r => records.push(r),
    onError: e => {
      metrics.malformed++;
      onError(e);
    },
  });
  async function drain() {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const handle = await fsp.open(file, 'r');
        try {
          const stat = await handle.stat();
          if (stat.ino !== inode || stat.size < offset) {
            offset = 0;
            inode = stat.ino;
            parser.reset();
            decoder = new StringDecoder('utf8');
          }
          while (offset < stat.size && !disposed) {
            const buffer = Buffer.allocUnsafe(Math.min(CHUNK, stat.size - offset));
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
            if (!bytesRead) break;
            offset += bytesRead;
            metrics.bytes += bytesRead;
            metrics.reads++;
            parser.write(decoder.write(buffer.subarray(0, bytesRead)));
            metrics.projected = parser.metrics.projected;
            metrics.maxRetained = parser.metrics.maxRetained;
            for (const record of records.splice(0)) {
              try {
                await onRecord(record);
              } catch (e) {
                onError(e);
              }
            }
          }
        } finally {
          await handle.close();
        }
      } while (again && !disposed);
    } catch (e) {
      if (e.code !== 'ENOENT') onError(e);
    } finally {
      running = false;
    }
  }
  // Watching the parent survives atomic replacement and truncation of the selected file.
  try {
    watcher = fs.watch(path.dirname(file), (_, name) => {
      if (!name || String(name) === path.basename(file)) void drain();
    });
  } catch (e) {
    onError(e);
  }
  // Low-frequency recovery for platforms/filesystems that drop watch notifications; one selected file only.
  retryTimer = setInterval(() => void drain(), 2000);
  retryTimer.unref?.();
  await drain();
  return {
    metrics,
    drain,
    dispose() {
      disposed = true;
      watcher?.close();
      clearInterval(retryTimer);
      parser.reset();
      records.length = 0;
    },
  };
}
module.exports = { followJSONL };
