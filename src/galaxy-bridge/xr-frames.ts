// Window animation frames while a headset session presents. The copied code paces its builds and its loading card on
// window.requestAnimationFrame (galaxy/viewer/shared/build-budget.js, loading.paint), but a browser need not run window
// frames while an immersive session is presenting: a landing would then never finish.
//
// This shim keeps every callback on the browser's own window frames, and also remembers it while a session presents.
// A heartbeat notes when window frames last ran. If they have stopped (none for STALL_MS), the XR frame loop runs the
// remembered callbacks instead (flushXrFrames, called once a frame by the galaxy system). Each callback runs once,
// by whichever path comes first. Where window frames keep running (a desktop browser, the emulator, whose own XR frames
// are paced by them) the fallback never fires. Nothing in galaxy/ changes.
import type { WebGLRenderer } from '@iwsdk/core';

type FrameCallback = (time: number) => void;
interface Entry {
  callback: FrameCallback;
  nativeId: number;
  done: boolean;
}

const STALL_MS = 100;
const pending = new Map<number, Entry>();
let nextId = 1 << 30;
let lastWindowFrame = 0;
let installed = false;

export function installXrFrames(renderer: WebGLRenderer) {
  if (installed) return;
  installed = true;
  const nativeRequest = window.requestAnimationFrame.bind(window),
    nativeCancel = window.cancelAnimationFrame.bind(window);
  const heartbeat = (time: number) => {
    lastWindowFrame = performance.now();
    void time;
    nativeRequest(heartbeat);
  };
  nativeRequest(heartbeat);
  window.requestAnimationFrame = (callback: FrameCallback) => {
    if (!renderer.xr.isPresenting) return nativeRequest(callback);
    const id = nextId++;
    const entry: Entry = { callback, nativeId: 0, done: false };
    entry.nativeId = nativeRequest(time => {
      pending.delete(id);
      if (entry.done) return;
      entry.done = true;
      callback(time);
    });
    pending.set(id, entry);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    const entry = pending.get(id);
    if (!entry) return nativeCancel(id);
    entry.done = true;
    nativeCancel(entry.nativeId);
    pending.delete(id);
  };
}

/** Runs the remembered callbacks if window frames have stopped. Callbacks they request wait for the next frame. */
export function flushXrFrames(time: number) {
  if (!pending.size || performance.now() - lastWindowFrame < STALL_MS) return;
  const due = [...pending.entries()];
  pending.clear();
  for (const [, entry] of due) {
    if (entry.done) continue;
    entry.done = true;
    entry.callback(time);
  }
}
