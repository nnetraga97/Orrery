// Explicitly armed discovery of ONE future session. Providers supply paths/metadata; no model is executed.
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path');
const MAX_PENDING = 128,
  MAX_WATCHERS = 512;
async function watchNextSession({ directory, readSession, onSession, onError = () => {}, subdirectory = () => false }) {
  directory = path.resolve(directory);
  const known = new Set(),
    pending = new Map(),
    watchers = new Map();
  let disposed = false,
    scanning = false,
    again = false,
    scanTimer,
    retryTimer,
    recursive = false,
    claimed = false;
  const metrics = { scans: 0, metadataReads: 0, watched: 0 };
  async function inventory(dir = directory, depth = 0, files = [], dirs = []) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return { files, dirs };
      throw e;
    }
    dirs.push(dir);
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name));
      else if (entry.isDirectory() && depth < 3 && subdirectory(entry.name))
        await inventory(path.join(dir, entry.name), depth + 1, files, dirs);
    }
    return { files, dirs };
  }
  function dispose() {
    disposed = true;
    clearTimeout(scanTimer);
    clearTimeout(retryTimer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    pending.clear();
  }
  async function inspect(file) {
    if (disposed || claimed || known.has(file)) return;
    if (!pending.has(file) && pending.size >= MAX_PENDING) {
      onError(new Error('Too many new session files; reconnect to arm discovery again.'));
      return;
    }
    const entry = pending.get(file) || { attempts: 0, reading: false };
    pending.set(file, entry);
    if (entry.reading) return;
    entry.reading = true;
    entry.attempts++;
    metrics.metadataReads++;
    try {
      const session = await readSession(file);
      if (disposed || claimed) return;
      if (!session) {
        known.add(file);
        pending.delete(file);
        return;
      }
      claimed = true;
      dispose();
      await onSession(session);
    } catch (e) {
      if (disposed) return;
      // Stop active retries, but let a later append retry a slow/incomplete header.
      if (entry.attempts >= 12) {
        pending.delete(file);
        onError(new Error(`Could not read new session metadata: ${e.message}`));
      } else if (!retryTimer)
        retryTimer = setTimeout(() => {
          retryTimer = null;
          for (const file of pending.keys()) void inspect(file);
        }, 100);
    } finally {
      entry.reading = false;
    }
  }
  function changed(dir, name) {
    if (disposed) return;
    if (!name) return scheduleScan();
    const file = path.resolve(dir, String(name));
    if (file === directory || directory.startsWith(file + path.sep)) return scheduleScan();
    if (!file.startsWith(directory + path.sep)) return;
    if (file.endsWith('.jsonl')) void inspect(file);
    else scheduleScan(); // A new date directory may contain an already-written session file.
  }
  function watch(dir, tryRecursive = false) {
    if (disposed || watchers.has(dir)) return;
    if (watchers.size >= MAX_WATCHERS)
      throw new Error('Session directory watch limit reached. Choose an existing session instead.');
    let watcher;
    try {
      watcher = fs.watch(dir, { recursive: tryRecursive }, (_, name) => changed(dir, name));
      if (tryRecursive) recursive = true;
    } catch (e) {
      if (!tryRecursive) throw e;
      watcher = fs.watch(dir, (_, name) => changed(dir, name));
    }
    watcher.on('error', e => {
      if (!disposed) onError(e);
    });
    watchers.set(dir, watcher);
    metrics.watched = watchers.size;
  }
  async function watchRoot() {
    let ancestor = directory;
    while (true) {
      try {
        await fsp.access(ancestor);
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error('No session directory is available to watch.');
        ancestor = parent;
      }
    }
    // Before a provider has created its log directory, watch only its nearest parent.
    // A recursive watch of the home directory would observe unrelated work.
    watch(ancestor, ancestor === directory);
    for (const [dir, watcher] of watchers)
      if (dir !== ancestor && !dir.startsWith(directory + path.sep)) {
        watcher.close();
        watchers.delete(dir);
      }
    metrics.watched = watchers.size;
  }
  async function scan() {
    if (disposed) return;
    if (scanning) {
      again = true;
      return;
    }
    scanning = true;
    try {
      do {
        again = false;
        metrics.scans++;
        await watchRoot();
        if (disposed) return;
        const state = await inventory();
        if (!recursive) for (const dir of state.dirs) watch(dir);
        for (const file of state.files) if (!known.has(file)) await inspect(file);
      } while (again && !disposed);
    } catch (e) {
      onError(e);
    } finally {
      scanning = false;
    }
  }
  function scheduleScan() {
    if (!scanTimer)
      scanTimer = setTimeout(() => {
        scanTimer = null;
        void scan();
      }, 40);
  }
  try {
    // Ignore every pre-existing session. Close the snapshot/watch gap with one second inventory.
    const initial = await inventory();
    initial.files.forEach(file => known.add(file));
    await watchRoot();
    if (!recursive) for (const dir of initial.dirs) watch(dir);
    await scan();
    return { dispose, metrics };
  } catch (e) {
    dispose();
    throw e;
  }
}
module.exports = { watchNextSession };
