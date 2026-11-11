// Line diffs for the workspace's edits: the longest common subsequence of lines (after trimming the common start and
// end, so a one-line edit to a long file stays cheap), grouped into hunks with context, written as unified diff text in
// git's form so the chat's diff drawing and counts read it as they read a provider's diffs.

export type DiffLine = { op: ' ' | '-' | '+'; text: string };
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] };

const split = (text: string) => {
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/** Every line of both texts in order, each kept, removed or added. */
function edits(a: string[], b: string[]): DiffLine[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA),
    y = b.slice(start, endB);
  // lcs[i][j]: the common subsequence length of x[i..] and y[j..].
  const lcs: Uint32Array[] = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const middle: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      middle.push({ op: ' ', text: x[i] });
      i++;
      j++;
    } else if (i < x.length && (j >= y.length || lcs[i + 1][j] >= lcs[i][j + 1])) middle.push({ op: '-', text: x[i++] });
    else middle.push({ op: '+', text: y[j++] });
  }
  return [
    ...a.slice(0, start).map(text => ({ op: ' ' as const, text })),
    ...middle,
    ...a.slice(endA).map(text => ({ op: ' ' as const, text })),
  ];
}

/** The changes from before to after as hunks, each with up to `context` unchanged lines around it. */
export function lineDiff(before: string, after: string, context = 3): Hunk[] {
  const all = edits(split(before), split(after));
  const changed = all.map((l, k) => (l.op !== ' ' ? k : -1)).filter(k => k >= 0);
  if (!changed.length) return [];
  // Spans of the edit list to show: each change widened by the context, overlapping spans merged.
  const spans: [number, number][] = [];
  for (const k of changed) {
    const from = Math.max(0, k - context),
      to = Math.min(all.length - 1, k + context);
    const last = spans[spans.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else spans.push([from, to]);
  }
  // Line numbers before each edit-list position.
  const oldAt: number[] = [],
    newAt: number[] = [];
  let o = 0,
    n = 0;
  for (const l of all) {
    oldAt.push(o);
    newAt.push(n);
    if (l.op !== '+') o++;
    if (l.op !== '-') n++;
  }
  return spans.map(([from, to]) => {
    const lines = all.slice(from, to + 1),
      oldLines = lines.filter(l => l.op !== '+').length,
      newLines = lines.filter(l => l.op !== '-').length;
    return {
      oldStart: oldLines ? oldAt[from] + 1 : oldAt[from],
      oldLines,
      newStart: newLines ? newAt[from] + 1 : newAt[from],
      newLines,
      lines,
    };
  });
}

/** A unified diff in git's form, or '' when nothing changed. */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  const hunks = lineDiff(before, after, context);
  if (!hunks.length) return '';
  const out = [`diff --git a/${path} b/${path}`, 'index 0000000..0000000 100644', `--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) out.push(l.op + l.text);
  }
  return out.join('\n') + '\n';
}
