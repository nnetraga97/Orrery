// Work yields only at explicit safe boundaries; cancellation is checked before resuming.
export function planetBuildBudget(signal, dispose, { frameBound = true, milliseconds = 4 } = {}) {
  let deadline = performance.now() + milliseconds;
  return async (force = false) => {
    if (signal?.aborted) {
      dispose?.();
      throw new DOMException('Planet build cancelled', 'AbortError');
    }
    if (!force && performance.now() < deadline) return;
    if (!force && !frameBound && globalThis.scheduler?.yield) await globalThis.scheduler.yield();
    else
      await new Promise(resolve =>
        force || frameBound ? requestAnimationFrame(() => setTimeout(resolve, 0)) : setTimeout(resolve, 0),
      );
    if (signal?.aborted) {
      dispose?.();
      throw new DOMException('Planet build cancelled', 'AbortError');
    }
    deadline = performance.now() + milliseconds;
  };
}
