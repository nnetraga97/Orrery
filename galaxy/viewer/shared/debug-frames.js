// IDE-style names for a paused frame, shared by the Run and Debug panel and the planet's frame cards.

/** `claim:38, HoldQueue (library.catalog)`: the method, its owner and where the owner lives. */
export function frameParts(f) {
  const bare = String(f.name || '').replace(/\(.*\)$/s, ''),
    dot = bare.lastIndexOf('.');
  const file = f.file.split('/').pop() || f.file,
    dir = f.file.includes('/') ? f.file.slice(0, f.file.lastIndexOf('/')) : '';
  const dotted = /\.(java|kt|kts|scala)$/.test(f.file);
  return {
    method: dot >= 0 ? bare.slice(dot + 1) : bare || '(anonymous)',
    owner: dot >= 0 ? bare.slice(0, dot) : file,
    where: f.local ? (dotted ? dir.replaceAll('/', '.') : dir) : f.file,
  };
}
