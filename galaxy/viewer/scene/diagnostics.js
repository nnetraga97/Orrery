// Local structured metadata only. Batching keeps logging out of animation and IPC hot paths.
let records = [],
  timer = null,
  dropped = 0;
function flush() {
  timer = null;
  const batch = records.splice(0, 32);
  if (dropped && batch.length) {
    batch[0].dropped = dropped;
    dropped = 0;
  }
  if (batch.length) {
    try {
      Promise.resolve(window.galaxyDesktop?.recordDiagnostics?.(batch)).catch(() => {});
    } catch {}
  }
  if (records.length) timer = setTimeout(flush, 100);
}
export function trace(type, details = {}) {
  if (!window.galaxyDesktop?.recordDiagnostics) return;
  if (records.length >= 256) {
    dropped++;
    return;
  }
  records.push({ ...details, type, rendererAt: Date.now() });
  if (timer === null) timer = setTimeout(flush, 100);
}
