// Compare rendering inputs independently of their location in a file. A leading edit rebases source metadata,
// while an edit to a callable or its resolved effects invalidates only that callable's renderer.
export function townRevision(region, source, file) {
  const normalize = (value, key = '') => {
    if (['layout', 'district', 'neighborhood', 'targetLine'].includes(key)) return undefined;
    if (typeof value === 'number') {
      if (['sourceStart', 'sourceEnd'].includes(key)) return value - (region.sourceStart ?? 0);
      if (['start', 'end', 'line', 'parentLine'].includes(key)) return value - region.start;
    }
    if (typeof value === 'string') return value.replaceAll(file, '<file>');
    if (Array.isArray(value)) return value.map(v => normalize(v));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map(k => [k, normalize(value[k], k)]),
      );
    return value;
  };
  const text =
    region.sourceStart != null
      ? source.slice(region.sourceStart, region.sourceEnd)
      : source
          .split('\n')
          .slice(region.start - 1, region.end)
          .join('\n');
  return JSON.stringify([text, normalize(region)]);
}

// Source-only view of a retained renderer's item; never mutate the still-visible old revision while staging.
export function rebaseTownItem(item, before, after, oldFile, file, targets = new Map(), seen = new Map()) {
  const visit = (value, key = '') => {
    if (key === '_co') return value; // renderer's column identity, not source data
    if (typeof value === 'number') {
      if (['sourceStart', 'sourceEnd'].includes(key)) return value + after.sourceStart - before.sourceStart;
      if (['line', 'start', 'end', 'parentLine'].includes(key)) return value + after.start - before.start;
    }
    if (typeof value === 'string' && ['id', 'targetId', 'file', 'target', 'scope'].includes(key))
      return value.replaceAll(oldFile, file);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const copy = Array.isArray(value) ? [] : {};
    seen.set(value, copy);
    for (const k of Object.keys(value)) copy[k] = visit(value[k], k);
    if (value.targetLine != null) copy.targetLine = targets.get(copy.id) ?? value.targetLine;
    return copy;
  };
  return visit(item);
}
