// How one analyzer snapshot differs from the next. A file's path is its identity across snapshots; its row index is
// only its position in one snapshot. Changes come in three kinds, each with its own cost to show:
//   topology  a file appeared or disappeared, or its imports changed: the galaxy's structure moves
//   content   its text changed (size, lines): its body changes
//   detail    its symbols changed (calls, declarations, references): its surface, towns and traffic change
// Content and detail come from the analyzer's per-row hashes. A row without a content hash (an older dataset) counts
// as changed; a missing detail hash means the file has no symbols.
import type { DatasetGraph } from './types.ts';

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  imports: string[]; // files whose own imports changed
  content: string[];
  detail: string[];
  // Nothing a view shows changed.
  same: boolean;
}

const importsOf = (g: DatasetGraph) => {
  const out = new Map<string, string[]>();
  for (const [s, t] of g.e) {
    const from = g.f[s][0];
    if (!out.has(from)) out.set(from, []);
    out.get(from)!.push(g.f[t][0]);
  }
  return new Map([...out].map(([from, to]) => [from, to.sort().join('\n')]));
};

export function diffSnapshots(prev: DatasetGraph | null | undefined, next: DatasetGraph): SnapshotDiff {
  const before = new Map((prev?.f || []).map(row => [row[0], row])),
    after = new Map(next.f.map(row => [row[0], row]));
  const added = [...after.keys()].filter(path => !before.has(path)),
    removed = [...before.keys()].filter(path => !after.has(path));
  const importsBefore = prev ? importsOf(prev) : new Map<string, string>(),
    importsAfter = importsOf(next);
  const imports: string[] = [],
    content: string[] = [],
    detail: string[] = [];
  for (const [path, row] of after) {
    const old = before.get(path);
    if (!old) continue;
    if ((importsBefore.get(path) || '') !== (importsAfter.get(path) || '')) imports.push(path);
    if (!row[3] || old[3] !== row[3] || old[1] !== row[1]) content.push(path);
    if (old[4] !== row[4]) detail.push(path);
  }
  return {
    added,
    removed,
    imports,
    content,
    detail,
    same: !added.length && !removed.length && !imports.length && !content.length && !detail.length,
  };
}
