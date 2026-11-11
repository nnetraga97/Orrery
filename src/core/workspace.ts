// The project as the agent edits it: the baked files, read on demand, with edits kept in memory. The scene reads edited
// text through the source override (galaxy/viewer/app/static-data.js), so a changed file rebuilds from what the agent
// wrote. Nothing is written anywhere else.
import { unifiedDiff } from './diff.ts';

export type SearchHit = { path: string; line: number; text: string };
export type Workspace = ReturnType<typeof createWorkspace>;

const MAX_HITS = 200;

/** Rejects absolute paths, drive letters, backslashes, empty segments and `..`. */
export function checkPath(path: string): string {
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\\') || path.split('/').some(s => !s || s === '..' || s === '.'))
    throw new Error(`Invalid path: ${path || '(empty)'}`);
  return path;
}

/**
 * A pattern written between slashes (`/^\s+if/i`) as a regular expression, when it is safe to run: short, and with no
 * quantified group that is itself quantified (the shape that can take exponential time). Otherwise null, and the
 * pattern is searched as plain text.
 */
export function safePattern(pattern: string): RegExp | null {
  const m = pattern.match(/^\/(.+)\/([imsu]*)$/);
  if (!m || m[1].length > 200) return null;
  if (/\([^)]*[+*}][^)]*\)\s*[+*{?]/.test(m[1])) return null;
  try {
    return new RegExp(m[1], m[2]);
  } catch {
    return null;
  }
}

export function createWorkspace(readOriginal: (path: string) => Promise<string | null>, paths: readonly string[]) {
  const originals = new Map<string, Promise<string | null>>();
  // Originals that have arrived, for synchronous comparison.
  const known = new Map<string, string | null>();
  /** Text that differs from the original (or a new file), by path. */
  const edits = new Map<string, string>();
  let turnStart = new Map<string, string>();
  const listeners = new Set<(path: string) => void>();
  const baked = new Set(paths);

  const original = (path: string) => {
    let text = originals.get(path);
    if (!text) {
      text = (baked.has(path) ? readOriginal(path) : Promise.resolve(null)).then(t => {
        known.set(path, t);
        return t;
      });
      originals.set(path, text);
    }
    return text;
  };
  const changedNow = (path: string) => {
    for (const listener of listeners) listener(path);
  };

  async function read(path: string): Promise<string> {
    checkPath(path);
    const own = edits.get(path);
    if (own != null) return own;
    const text = await original(path);
    if (text == null) throw new Error(`No such file: ${path}`);
    return text;
  }

  async function set(path: string, text: string) {
    const base = await original(path);
    if (text === base) edits.delete(path);
    else edits.set(path, text);
    changedNow(path);
  }

  return {
    read,
    /** Every file, sorted: the baked ones and any the agent wrote. */
    list: () => [...new Set([...baked, ...edits.keys()])].sort(),
    /** Lines containing the pattern (plain text, or a safe /regular expression/), under a folder if given. */
    async search(pattern: string, under?: string): Promise<SearchHit[]> {
      const regex = safePattern(pattern);
      const prefix = under ? checkPath(under).replace(/\/?$/, '/') : '';
      const hits: SearchHit[] = [];
      for (const path of [...new Set([...baked, ...edits.keys()])].sort()) {
        if (prefix && !path.startsWith(prefix)) continue;
        const text = edits.get(path) ?? (await original(path));
        if (text == null) continue;
        const lines = text.split('\n');
        for (let k = 0; k < lines.length; k++) {
          if (regex ? (regex.lastIndex = 0, regex.test(lines[k])) : lines[k].includes(pattern)) {
            hits.push({ path, line: k + 1, text: lines[k] });
            if (hits.length >= MAX_HITS) return hits;
          }
        }
      }
      return hits;
    },
    /** Replaces old text that occurs exactly once in the file. */
    async replace(path: string, oldText: string, newText: string) {
      const text = await read(path);
      const count = oldText ? text.split(oldText).length - 1 : 0;
      if (count === 0) throw new Error(`old_text was not found in ${path}`);
      if (count > 1) throw new Error(`old_text occurs ${count} times in ${path}; include more of the surrounding text`);
      await set(path, text.replace(oldText, () => newText));
    },
    write(path: string, text: string) {
      checkPath(path);
      // Compared with the original at once if it has arrived, else when it does.
      if (known.has(path) && known.get(path) === text) edits.delete(path);
      else edits.set(path, text);
      changedNow(path);
      void original(path).then(base => {
        if (base === text && edits.get(path) === text) edits.delete(path);
      });
    },
    /** Paths whose text differs from the original, sorted. */
    changed: () => [...edits.keys()].sort(),
    /** The edited text of a file, or null if it is unchanged. Synchronous, for the scene's source override. */
    edited: (path: string) => edits.get(path) ?? null,
    async diff(path: string) {
      return unifiedDiff(path, (await original(path)) ?? '', await read(path));
    },
    /** Remembers the current text, so turnDiff shows only what the next turn changes. */
    markTurn() {
      turnStart = new Map(edits);
    },
    async turnDiff() {
      const parts: string[] = [];
      for (const path of new Set([...edits.keys(), ...turnStart.keys()])) {
        const before = turnStart.get(path) ?? (await original(path)) ?? '';
        const after = edits.get(path) ?? (await original(path)) ?? '';
        parts.push(unifiedDiff(path, before, after));
      }
      return parts.join('');
    },
    reset() {
      const paths = [...edits.keys()];
      edits.clear();
      turnStart = new Map();
      paths.forEach(changedNow);
    },
    onChange(listener: (path: string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
