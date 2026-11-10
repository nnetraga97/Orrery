// Directed call-site routes for one file (docs/design/planet-towns.md I-8, §11): one route per call site, never an
// aggregate town pair, so recursion, repeated calls and unresolved targets stay visible. Targets come only from
// resolved analyzer facts; a matching name is never a destination.
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const offset = value => (Number.isInteger(value) && value >= 0 ? value : null);
const rangeKey = value =>
  offset(value.sourceStart) !== null && offset(value.sourceEnd) !== null && value.sourceEnd >= value.sourceStart
    ? `${value.sourceStart}:${value.sourceEnd}`
    : null;
const callOperation = op => !!op.call || /(^|[-_:])(call|construct)($|[-_:])/.test(op.kind);
const targetId = call => call.id || call.targetId || (typeof call.target === 'object' ? call.target?.id : call.target);
const targetKey = call =>
  JSON.stringify([targetId(call) ?? null, call.import?.source ?? null, call.receiver ?? null, call.name ?? null]);

// These facts are mirrored in callTargets, even after JSON removes shared object identity.
// Counting the mirror only avoids duplicate sites; it never assigns an operation by name or line.
const mirrorKey = call =>
  JSON.stringify([
    targetKey(call),
    call.resolution ?? null,
    call.line ?? null,
    call.argc ?? null,
    call.sourceStart ?? null,
    call.sourceEnd ?? null,
  ]);

function sitesOf(region) {
  const operations = (region.operations || []).filter(callOperation),
    byRange = new Map(),
    mirrored = new Map(),
    sites = [];
  for (const operation of operations) {
    const key = rangeKey(operation);
    if (key) (byRange.get(key) || byRange.set(key, []).get(key)).push(operation);
    if (!operation.call) continue;
    const call = operation.call,
      mirror = mirrorKey(call);
    mirrored.set(mirror, (mirrored.get(mirror) || 0) + 1);
    // The embedded fact supplies its site's range, which bare callTargets lack today.
    sites.push({ call, sourceStart: operation.sourceStart, sourceEnd: operation.sourceEnd, line: operation.line });
  }
  for (const call of region.callTargets || []) {
    const mirror = mirrorKey(call),
      count = mirrored.get(mirror) || 0;
    if (count) mirrored.set(mirror, count - 1);
    else sites.push({ call, sourceStart: call.sourceStart, sourceEnd: call.sourceEnd, line: call.line });
  }
  return sites
    .map(site => {
      const matches = byRange.get(rangeKey(site));
      // An ambiguous or missing range stays unmapped; text cannot establish a source link.
      return { ...site, operation: matches?.length === 1 ? matches[0] : null };
    })
    .sort(
      (a, b) =>
        compare(offset(a.sourceStart) ?? Infinity, offset(b.sourceStart) ?? Infinity) ||
        compare(offset(a.sourceEnd) ?? Infinity, offset(b.sourceEnd) ?? Infinity) ||
        compare(targetKey(a.call), targetKey(b.call)),
    );
}

function destination(call, region, byId, file) {
  const unknown = { town: null, external: null, unresolved: true };
  if (call.resolution === 'ambiguous') return { kind: 'unresolved', to: unknown };
  const other = byId.get(targetId(call));
  // Match semantic-layout's concrete-id rule, without its same-name legacy fallback.
  if (other && !['unresolved', 'external'].includes(call.resolution))
    return {
      kind: other.id === region.id ? 'recursive' : 'local',
      to: { town: other.id, external: null, unresolved: false },
    };
  const targetFile = typeof call.target === 'object' ? call.target?.file : call.target;
  // An unresolved receiver is stored in target too; only resolved facts establish a file.
  const external =
    call.import?.source ||
    ((call.resolution === 'external' ||
      (call.resolution === 'resolved' && !call.local && (call.id || call.targetId || call.target?.id))) &&
    targetFile &&
    targetFile !== file
      ? targetFile
      : null);
  if (external || call.resolution === 'external')
    return { kind: 'external', to: { town: null, external: external || null, unresolved: false } };
  return { kind: 'unresolved', to: unknown };
}

/**
 * Derives one directed route per call site in buildRegions() output, without mutating it.
 * Missing source fields and operation links stay null. IDs inherit analyzer operation identity;
 * calls without an operation use the town, target and occurrence, never source lines or offsets.
 * Comments inside call expressions can change analyzer IDs. Async flags require explicit metadata
 * or a direct await range; wrapped await operands need an analyzer link that is not recorded today.
 * @param {Array<object>} regions Towns from one file's analysis.
 * @param {{file?: string}} options The analyzed file's path.
 * @returns {Array<object>} Routes ordered by source town and source offset (unknown offsets last).
 */
export function callRoutes(regions, { file = '' } = {}) {
  const byId = new Map(regions.map(region => [region.id, region])),
    routes = [];
  for (const region of [...regions].sort((a, b) => compare(a.id, b.id))) {
    const occurrences = new Map(),
      awaits = (region.operations || []).filter(op => op.kind === 'await' && rangeKey(op));
    for (const site of sitesOf(region)) {
      const { call, operation } = site,
        target = targetKey(call),
        occurrence = occurrences.get(target) || 0;
      occurrences.set(target, occurrence + 1);
      const identity = operation?.id ? ['operation', operation.id] : ['target', target, occurrence];
      routes.push({
        id: 'call-route:' + JSON.stringify([region.id, ...identity]),
        from: {
          town: region.id,
          operation: operation?.id ?? null,
          line: operation?.line ?? site.line ?? null,
          sourceStart: offset(operation?.sourceStart ?? site.sourceStart),
          sourceEnd: offset(operation?.sourceEnd ?? site.sourceEnd),
        },
        ...destination(call, region, byId, file),
        // What the call names, so a view can find the statement that makes it when the fact has no range.
        callee: { name: call.name ?? null, receiver: call.receiver ?? null },
        async: !!(
          call.awaited ||
          operation?.async ||
          /(^|[-_:])(async|await)($|[-_:])/.test(operation?.kind || '') ||
          // A shared end offset identifies the directly awaited call, excluding its arguments.
          (rangeKey(site) && awaits.some(op => op.sourceStart < site.sourceStart && op.sourceEnd === site.sourceEnd))
        ),
      });
    }
  }
  return routes;
}

/** Returns a town's outgoing and incoming routes; recursion appears in both lists. */
export function routesOf(routes, town) {
  return {
    outgoing: routes.filter(route => route.from.town === town),
    incoming: routes.filter(route => route.to.town === town),
  };
}
