// Bounded animation delivery: visual events drain a few per frame and drop (never history) when they fall behind.

/**
 * @param {(event: any) => void} deliver
 * @param {{ ingest: (event: any) => void, onOverflow?: (dropped: number) => void, limit?: number, batchSize?: number }} options
 */
export const createActivityDelivery = (deliver, { ingest, onOverflow = () => {}, limit = 1024, batchSize = 32 }) => {
  let inbox = [],
    frame = null,
    dropped = 0,
    disposed = false;
  const seen = new Set();
  function drain() {
    frame = null;
    for (const event of inbox.splice(0, batchSize)) deliver(event);
    if (inbox.length) frame = requestAnimationFrame(drain);
  }
  function clear() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    inbox = [];
    seen.clear();
    dropped = 0;
  }
  return {
    push(events) {
      if (disposed) return;
      for (const event of events) {
        const key = event.id && `${event.provider || 'disk'}:${event.sessionId || ''}:${event.id}`;
        if (key && seen.has(key)) continue;
        if (key) {
          seen.add(key);
          if (seen.size > 8192) seen.delete(seen.values().next().value);
        }
        ingest(event);
        if (inbox.length < limit) inbox.push(event);
        else onOverflow(++dropped);
      }
      if (inbox.length && frame === null) frame = requestAnimationFrame(drain);
    },
    clear,
    dispose() {
      clear();
      disposed = true;
    },
    stats: () => ({ pending: inbox.length, dropped }),
  };
};
