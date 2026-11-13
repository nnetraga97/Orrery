// The galaxy's own model of the project, as the agent's find_function tool reads it: the functions each file shows as
// planets and the calls between them (public/data/<name>/functions.json, written by tools/bake-functions.mjs). The
// galaxy shows only each file's most important functions, so a miss says so and points the model at search.

export type FunctionData = {
  files?: { path: string; planets?: { id: string; name: string; kind?: string; start: number; end: number }[] }[];
  calls?: [string, string][];
};
export type FunctionEntry = { id: string; name: string; kind: string; path: string; start: number; end: number };
export type FunctionIndex = ReturnType<typeof createFunctionIndex>;

const MAX_MATCHES = 8,
  MAX_LINKS = 8;

export function createFunctionIndex(data: FunctionData) {
  const byId = new Map<string, FunctionEntry>();
  for (const file of data.files ?? [])
    for (const p of file.planets ?? []) byId.set(p.id, { id: p.id, name: p.name, kind: p.kind ?? 'function', path: file.path, start: p.start, end: p.end });
  const callers = new Map<string, string[]>(),
    callees = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const [from, to] of data.calls ?? []) {
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    link(callees, from, to);
    link(callers, to, from);
  }
  const place = (id: string) => {
    const f = byId.get(id)!;
    return `${f.name} (${f.path}:${f.start})`;
  };
  const links = (ids: string[] | undefined) => {
    if (!ids?.length) return 'none the galaxy shows';
    const names = [...new Set(ids.map(place))];
    return names.slice(0, MAX_LINKS).join(', ') + (names.length > MAX_LINKS ? `, and ${names.length - MAX_LINKS} more` : '');
  };

  /** Functions named like `name`, best first: the whole name, then the name after its class, then names holding it. */
  function find(name: string): FunctionEntry[] {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const rank = (f: FunctionEntry) => {
      const n = f.name.toLowerCase();
      if (n === q) return 0;
      if (n.endsWith('.' + q)) return 1;
      return n.includes(q) ? 2 : -1;
    };
    return [...byId.values()]
      .map(f => ({ f, r: rank(f) }))
      .filter(x => x.r >= 0)
      .sort((a, b) => a.r - b.r || a.f.path.localeCompare(b.f.path) || a.f.start - b.f.start)
      .map(x => x.f);
  }

  return {
    size: byId.size,
    find,
    /** The tool's result for a name, and the files it names (for the scene). */
    describe(name: string): { text: string; files: string[] } {
      const all = find(name),
        shown = all.slice(0, MAX_MATCHES);
      if (!shown.length)
        return {
          text: `No function the galaxy shows is named like "${name.trim()}". It shows each file's most important functions (${byId.size} in all); use search to find anything else.`,
          files: [],
        };
      const lines = shown.map(
        f => `${f.name} — ${f.path}, lines ${f.start}–${f.end} (${f.kind})\n  called by: ${links(callers.get(f.id))}\n  calls: ${links(callees.get(f.id))}`,
      );
      if (all.length > shown.length) lines.push(`… and ${all.length - shown.length} more; give more of the name.`);
      lines.push('Calls are only those between functions the galaxy shows; use search for every use.');
      return { text: lines.join('\n'), files: [...new Set(shown.map(f => f.path))] };
    },
  };
}
