// OS paths and file URLs meet only here. External resources never become workspace filenames.
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { relativePath } = require('./protocol.cjs');
function localPath(value, base = process.cwd()) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null;
  try {
    return /^file:/i.test(value)
      ? fileURLToPath(value)
      : /^[a-z][\w+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)
        ? null
        : path.resolve(base, value);
  } catch {
    return null;
  }
}
function resource(value, root, base = root) {
  const abs = localPath(value, base);
  if (abs) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    return relativePath(rel) ? { path: rel } : { uri: pathToFileURL(abs).href };
  }
  try {
    const uri = new URL(value);
    if (['https:', 'http:'].includes(uri.protocol)) return { uri: uri.href };
  } catch {}
  return null;
}
module.exports = { localPath, resource };
