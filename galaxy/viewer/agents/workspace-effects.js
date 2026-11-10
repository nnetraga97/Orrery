import { isSource } from '../../source-model/languages.js';

// Disk evidence is real work even when a shell did not declare its output files.
// Keep its unknown attribution; exclude repeated downloads and generated/vendor trees.
export function workspaceFileEffect(payload = {}) {
  const path = payload.path || '';
  if (!path || payload.entity === 'directory') return false;
  if (/(^|\/)(node_modules|\.git|runtime|models|vendor|third_party|decoders|dist|coverage)(\/|$)/i.test(path))
    return false;
  if (/(^|\/)data\/artifacts\/|\.(part|tsbuildinfo|map|log)$/i.test(path)) return false;
  return (
    payload.analyzable ||
    isSource(path) ||
    /\.(json|ya?ml|toml|css|scss|html|md)$/i.test(path) ||
    /(^|\/)\.(gitignore|env\.example)$/.test(path)
  );
}
