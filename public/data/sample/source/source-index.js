// A two-way map between source locations and world elements for one file revision (docs/design/planet-towns.md I-6).
// Every answer says how good it is:
//   exact        one innermost element contains the location at the precision asked
//   approximate  several candidates tie (same-line expressions asked by line only), or a browsing fallback
//   stale        the location belongs to another revision than this index
//   unmapped     no element contains it (a blank line, a comment, code between towns)
// A location is never silently moved to a neighbouring element; only `nearest` does that, and it says so.

export const MATCH = Object.freeze({
  exact: 'exact',
  approximate: 'approximate',
  stale: 'stale',
  unmapped: 'unmapped',
});

// Offsets of each line's first character, so line/column and source offsets convert both ways.
function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/**
 * elements: [{ id, kind, town, line, end, sourceStart?, sourceEnd?, ...anything }]; `town` is the region index.
 * Offsets are UTF-16 positions in `source`; elements without them are matched by line only.
 */
export function createSourceIndex({ file, revision = null, source = null, elements }) {
  const starts = source != null ? lineStarts(source) : null;
  const byId = new Map(elements.map(e => [e.id, e]));
  const hasOffsets = e => Number.isFinite(e.sourceStart) && Number.isFinite(e.sourceEnd);
  const offsetOf = (line, column) => {
    if (
      !starts ||
      !Number.isInteger(line) ||
      line < 1 ||
      line > starts.length ||
      !Number.isInteger(column) ||
      column < 1
    )
      return null;
    const offset = starts[line - 1] + column - 1;
    return offset < (starts[line] ?? source.length + 1) ? offset : null;
  };
  const positionOf = offset => {
    if (!starts) return null;
    let lo = 0,
      hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };

  /** query: { line, column?, offset?, revision?, town? } → { status, element, candidates, file, line, column } */
  function locate(query) {
    const answer = (status, element = null, candidates = []) => ({
      status,
      element,
      candidates,
      file,
      line: query.line ?? positionOf(query.offset)?.line ?? null,
      column: query.column ?? (query.offset != null ? positionOf(query.offset)?.column : null),
      revision,
    });
    if (query.revision != null && revision != null && query.revision !== revision) return answer(MATCH.stale);
    if (query.offset == null && query.column != null && starts && offsetOf(query.line, query.column) == null)
      return answer(MATCH.unmapped);
    let offset = query.offset ?? (query.column != null ? offsetOf(query.line, query.column) : null);
    // A column in the line's indentation (debuggers report column 1 for "this line") means the line's first code.
    if (query.offset == null && offset != null) {
      const start = starts[query.line - 1],
        lineEnd = (starts[query.line] ?? source.length + 1) - 1,
        indent = source.slice(start, lineEnd).search(/\S/);
      if (indent >= 0 && offset < start + indent) offset = start + indent;
    }
    const line = query.line ?? positionOf(offset)?.line;
    if (line == null) return answer(MATCH.unmapped);
    const pool = query.town == null ? elements : elements.filter(e => e.town === query.town);
    // With an offset, elements that carry offsets must contain it; line-only elements need the line.
    const contains = e =>
      offset != null && hasOffsets(e)
        ? e.sourceStart <= offset && offset < Math.max(e.sourceEnd, e.sourceStart + 1)
        : e.line <= line && line <= e.end;
    const holding = pool.filter(contains);
    if (!holding.length) return answer(MATCH.unmapped);
    // Innermost = smallest span, measured at the precision of the query: by line alone, two statements on one line
    // tie, which is exactly the ambiguity a line number cannot resolve.
    const spanOf = e =>
      offset != null && hasOffsets(e) ? e.sourceEnd - e.sourceStart : (e.end - e.line + 1) * (starts ? 1e7 : 1);
    const smallest = Math.min(...holding.map(spanOf)),
      innermost = holding.filter(e => spanOf(e) === smallest);
    if (innermost.length > 1) return answer(MATCH.approximate, innermost[0], innermost);
    return answer(MATCH.exact, innermost[0], innermost);
  }

  /** For browsing only: the containing element, else the nearest one by line, always labelled approximate. */
  function nearest(query) {
    const found = locate(query);
    if (found.element || found.status === MATCH.stale) return found;
    const pool = query.town == null ? elements : elements.filter(e => e.town === query.town);
    const element = [...pool].sort((a, b) => Math.abs(a.line - query.line) - Math.abs(b.line - query.line))[0];
    return element ? { ...found, status: MATCH.approximate, element, candidates: [element] } : found;
  }

  /** element id → its source range in this revision. */
  function rangeOf(id) {
    const e = byId.get(id);
    if (!e) return null;
    const from = hasOffsets(e) ? positionOf(e.sourceStart) : null,
      to = hasOffsets(e) ? positionOf(e.sourceEnd) : null;
    return {
      file,
      revision,
      line: e.line,
      end: e.end,
      column: from?.column ?? null,
      endColumn: to?.column ?? null,
      sourceStart: e.sourceStart ?? null,
      sourceEnd: e.sourceEnd ?? null,
    };
  }

  return { file, revision, size: elements.length, locate, nearest, rangeOf, element: id => byId.get(id) ?? null };
}
