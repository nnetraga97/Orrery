// Quarantine an animation that throws once, while keeping independent callbacks alive.
// Keep callback arrays intact: their owners still remove them during normal teardown.
function create({ onError = () => {} } = {}) {
  const failed = new WeakSet(),
    errors = [];
  function report(error, scope) {
    const record = {
      scope,
      message: String(error?.message || error),
      stack: String(error?.stack || ''),
      at: Date.now(),
    };
    errors.push(record);
    if (errors.length > 8) errors.shift();
    console.error(`[Galaxy ${scope}] ${record.stack || record.message}`);
    onError(record);
  }
  return {
    run(callbacks, time, scope = 'animation') {
      callbacks.forEach(callback => {
        if (failed.has(callback)) return;
        try {
          callback(time);
        } catch (error) {
          failed.add(callback);
          report(error, scope);
        }
      });
    },
    report,
    errors: () => errors.slice(),
  };
}
export const GalaxyFrameLoop = { create };
