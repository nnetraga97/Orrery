import { createSourceIndex } from '../../source-model/source-index.js';

// A revision changes the file's line table and these small translations. Each unchanged town keeps its index.
export function townSourceView({ file, revision, source, regions }, views) {
  const coordinates = createSourceIndex({ file, revision, source, elements: [] });
  const partitions = views.map(view => {
    const before = view.unit.region,
      after = regions[view.k];
    const lines = after.start - before.start,
      offsets = (after.sourceStart ?? 0) - (before.sourceStart ?? 0);
    const index = view.unit.renderer.sourceIndex,
      cache = new Map();
    const element = old => {
      if (!old) return null;
      if (!cache.has(old))
        cache.set(old, {
          ...old,
          id: old.id.replaceAll(view.unit.file, file),
          town: view.k,
          line: old.line + lines,
          end: old.end + lines,
          sourceStart: old.sourceStart == null ? old.sourceStart : old.sourceStart + offsets,
          sourceEnd: old.sourceEnd == null ? old.sourceEnd : old.sourceEnd + offsets,
          ...(old.lot ? { lot: view.lot(old.lot) } : {}),
        });
      return cache.get(old);
    };
    return {
      view,
      index,
      element,
      query: q => ({
        ...q,
        town: 0,
        revision: undefined,
        line: q.line == null ? undefined : q.line - lines,
        offset: q.offset == null ? undefined : q.offset - offsets,
      }),
      originalId: id => id.replaceAll(file, view.unit.file),
      lines,
      offsets,
    };
  });
  function locate(query) {
    const base = coordinates.locate(query);
    if (base.status === 'stale') return base;
    const candidates = partitions
      .filter(p => query.town == null || p.view.k === query.town)
      .flatMap(p => p.index.locate(p.query({ ...query, line: base.line })).candidates.map(p.element));
    if (!candidates.length) return base;
    const span = e =>
      (query.offset != null || query.column != null) && e.sourceStart != null
        ? e.sourceEnd - e.sourceStart
        : e.end - e.line;
    const min = Math.min(...candidates.map(span)),
      closest = candidates.filter(e => span(e) === min);
    return { ...base, status: closest.length > 1 ? 'approximate' : 'exact', element: closest[0], candidates: closest };
  }
  return {
    file,
    revision,
    size: partitions.reduce((n, p) => n + p.index.size, 0),
    locate,
    element(id) {
      if (typeof id !== 'string') return null;
      for (const p of partitions) {
        const e = p.element(p.index.element(p.originalId(id)));
        if (e) return e;
      }
      return null;
    },
    rangeOf(id) {
      if (typeof id !== 'string') return null;
      for (const p of partitions) {
        const range = p.index.rangeOf(p.originalId(id));
        if (range)
          return {
            ...range,
            file,
            revision,
            line: range.line + p.lines,
            end: range.end + p.lines,
            sourceStart: range.sourceStart == null ? null : range.sourceStart + p.offsets,
            sourceEnd: range.sourceEnd == null ? null : range.sourceEnd + p.offsets,
          };
      }
      return null;
    },
    nearest(query) {
      const found = locate(query);
      if (found.element || found.status === 'stale') return found;
      const near = partitions
        .filter(p => query.town == null || p.view.k === query.town)
        .map(p => p.element(p.index.nearest(p.query(query)).element))
        .filter(Boolean)
        .sort((a, b) => Math.abs(a.line - query.line) - Math.abs(b.line - query.line))[0];
      return near ? { ...found, status: 'approximate', element: near, candidates: [near] } : found;
    },
  };
}
