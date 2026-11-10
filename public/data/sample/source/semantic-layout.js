// The planet is a map of source structure. Identity and district anchors never use
// source line numbers, file order, line-count rank, or the number of other towns.
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const positive = (n, fallback = 0) => (Number.isFinite(n) ? Math.max(0, n) : fallback);
const unique = values => [...new Set(values)];
export function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // Avalanche the otherwise strongly correlated prefixes of symbol names.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
const fraction = key => stableHash(key) / 4294967296;
const normalize = a => {
  const length = Math.hypot(...a) || 1;
  return a.map(n => n / length);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sphere = key => {
  const y = 2 * fraction(key + ':latitude') - 1,
    angle = 2 * Math.PI * fraction(key + ':longitude'),
    radius = Math.sqrt(1 - y * y);
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
};
const fieldsOf = region =>
  unique(
    (region.fields || []).map(field => (typeof field === 'string' ? field : field.id || field.name)).filter(Boolean),
  );

function flowCount(flow) {
  let statements = 0;
  const seen = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value.t === 'stmt') statements++;
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  }
  // Serialized hoods repeat the main body and add separate callback bodies.
  // Count that rendering plan once, rather than counting body and hoods twice.
  walk(flow?.hoods?.length ? flow.hoods.map(hood => hood.items) : flow?.body || flow);
  return statements;
}

function collectCallables(sym) {
  if (Array.isArray(sym?.callables)) return sym.callables.filter(m => m.executable !== false);
  const items = [];
  function visit(declarations, owner = null) {
    for (const declaration of declarations || []) {
      if (['class', 'object', 'namespace'].includes(declaration.kind)) {
        visit(
          declaration.members || declaration.decls,
          declaration.qualifiedName || (owner ? owner + '.' : '') + declaration.name,
        );
      } else if (
        ['function', 'method', 'ctor', 'constructor', 'get', 'set', 'callback', 'initializer', 'module'].includes(
          declaration.kind,
        ) &&
        declaration.executable !== false
      ) {
        items.push({ ...declaration, owner: declaration.owner || owner });
      }
    }
  }
  visit(sym?.decls);
  return items;
}

/** Convert both saved legacy symbols and the shared source model into towns. */
export function buildRegions(sym, { file = sym?.file || '' } = {}) {
  const duplicateIds = new Map();
  const regions = collectCallables(sym).map(member => {
    const owner = typeof member.owner === 'object' ? member.owner?.name || member.owner?.id : member.owner;
    const signature = member.signature || member.sigs?.join('|') || '';
    const identity =
      member.id ||
      `${file}::${owner || '<module>'}::${member.kind || 'function'}:${member.name}:${member.static ? 'static' : 'instance'}${signature ? ':' + signature : ''}`;
    // Older datasets can contain indistinguishable duplicate declarations. Keep
    // every one, with an explicit occurrence suffix rather than merging bodies.
    const occurrence = duplicateIds.get(identity) || 0;
    duplicateIds.set(identity, occurrence + 1);
    const id = occurrence ? identity + ':occurrence:' + occurrence : identity;
    const start = member.start || 1,
      end = Math.max(start, member.end || start),
      loc = end - start + 1;
    const statements = positive(member.statements ?? member.metrics?.statements, flowCount(member.flow));
    const branches = positive(member.branches ?? member.metrics?.branches);
    // This is a packing estimate, not a claim about runtime cost or importance.
    // Statements require lots, decisions require road junctions, and sqrt(LOC)
    // provides a bounded fallback for records with only source spans.
    const demand = Math.sqrt(loc) + statements + 1.5 * branches;
    const normalized = {
      ...member,
      id,
      owner: owner || null,
      start,
      end,
      vis: member.vis || (member.exported ? 'public' : 'private'),
      uses: member.uses || [],
      selfCalls: member.selfCalls || [],
      roles: member.roles || [],
      callTargets: member.callTargets || [],
      fields: member.fields || [],
      operations: member.operations || [],
    };
    return {
      ...normalized,
      loc,
      branches,
      members: [normalized],
      areaMetric: {
        id: 'layout-demand',
        label: 'Statement and branch layout demand',
        statements,
        branches,
        loc,
        basis:
          member.flow || Number.isFinite(member.statements ?? member.metrics?.statements) ? 'parsed' : 'source-span',
        value: demand,
      },
    };
  });
  if (!regions.length)
    regions.push({
      id: `${file}::<file>`,
      name: '(whole file)',
      kind: 'file',
      owner: null,
      vis: 'public',
      loc: Math.max(1, sym?.lines || 1),
      start: 1,
      end: Math.max(1, sym?.lines || 1),
      branches: 0,
      members: [],
      uses: [],
      selfCalls: [],
      roles: [],
      callTargets: [],
      fields: [],
      operations: [],
      areaMetric: {
        id: 'layout-demand',
        label: 'Source span fallback',
        statements: 0,
        branches: 0,
        loc: Math.max(1, sym?.lines || 1),
        basis: 'source-span',
        value: Math.sqrt(Math.max(1, sym?.lines || 1)),
      },
    });

  // Syntax front-ends (Java and the tree-sitter languages) record unqualified calls only as name/arity signatures.
  // Those resolve within the declaring type, so a signature that fits exactly one same-owner method by arity is a
  // resolved local call. Overloads that all fit stay ambiguous; a name with no member here (inherited, outer, or a
  // lambda parameter) stays out, rather than becoming a guessed route.
  const fits = (argc, m) =>
    !Number.isFinite(argc) || m.params == null || (m.varargs ? argc >= m.params - 1 : argc === m.params);
  // These derived targets draw routes only. Neighbourhoods keep the same-owner name evidence they always used, so
  // existing planets keep their layout (resolving overloads would add links and reshuffle every town's land).
  const derived = new Set();
  for (const region of regions) {
    if (region.callTargets.length || !region.owner) continue;
    const external = Array.isArray(region.externalCalls) ? region.externalCalls : [];
    if (!(Array.isArray(region.sigs) && region.sigs.length) && !external.length) continue;
    // Calls on a variable whose declared class another analyzed file declares go to that file.
    region.callTargets = [
      ...external,
      ...(region.sigs || []).flatMap(sig => {
        const cut = sig.lastIndexOf('/'),
          name = cut < 0 ? sig : sig.slice(0, cut),
          argc = cut < 0 ? NaN : +sig.slice(cut + 1);
        const matches = regions.filter(r => r.owner === region.owner && r.name === name && fits(argc, r));
        if (!matches.length) return [];
        return matches.length === 1
          ? [{ id: matches[0].id, name, argc, resolution: 'resolved', local: true }]
          : [{ name, argc, resolution: 'ambiguous' }];
      }),
    ];
    derived.add(region);
  }
  const byId = new Map(regions.map(region => [region.id, region]));
  const neighbors = new Map(regions.map(region => [region.id, new Set()]));
  const incoming = new Map(regions.map(region => [region.id, 0]));
  const evidence = new Map(),
    affinity = new Map();
  const link = (a, b, basis, weight = 3) => {
    if (!a || !b || a.id === b.id) return;
    incoming.set(b.id, incoming.get(b.id) + 1);
    // Calls across owners remain connections, not grounds to merge owners.
    if (a.owner !== b.owner) return;
    neighbors.get(a.id).add(b.id);
    neighbors.get(b.id).add(a.id);
    const key = [a.id, b.id].sort(compare).join('\n');
    (evidence.get(key) || evidence.set(key, new Set()).get(key)).add(basis);
    affinity.set(key, (affinity.get(key) || 0) + weight);
  };
  for (const region of regions.filter(r => !derived.has(r)))
    for (const call of region.callTargets) {
      const target = typeof call.target === 'object' ? call.target?.id : call.target;
      const other = byId.get(call.id || call.targetId || target);
      // A concrete local symbol identity is required. A matching method name on
      // an unresolved receiver is not sufficient evidence for a relationship.
      if (other && !['unresolved', 'external', 'ambiguous'].includes(call.resolution))
        link(region, other, 'resolved calls');
    }
  for (const region of regions.filter(r => r.owner && (!r.callTargets.length || derived.has(r))))
    for (const name of region.selfCalls) {
      const matches = regions.filter(r => r.owner === region.owner && r.name === name);
      if (matches.length === 1) link(region, matches[0], 'same-owner calls');
    }
  const stateUsers = new Map();
  for (const region of regions)
    for (const field of fieldsOf(region)) {
      const key = (region.owner || '<module>') + ':' + field;
      (stateUsers.get(key) || stateUsers.set(key, []).get(key)).push(region);
    }
  for (const users of stateUsers.values()) {
    const ownerSize = regions.filter(r => r.owner === users[0].owner).length;
    // A backing store read by nearly every method cannot distinguish cohesive
    // neighborhoods. Scarcer shared state is more useful evidence of affinity.
    if (users.length > Math.max(2, ownerSize * 0.5)) continue;
    for (let i = 0; i < users.length; i++)
      for (let j = i + 1; j < users.length; j++) link(users[i], users[j], 'shared state', 2 / (users.length - 1));
  }
  const visited = new Set();
  for (const region of regions) {
    if (region.owner) {
      region.district = {
        id: `${file}::owner:${region.owner}`,
        name: region.owner,
        reason: 'Declared members of ' + region.owner,
        basis: 'structural',
      };
      continue;
    }
    if (visited.has(region.id)) continue;
    const component = [],
      queue = [region.id],
      reasons = new Set();
    while (queue.length) {
      const id = queue.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      component.push(byId.get(id));
      for (const other of neighbors.get(id)) {
        const key = [id, other].sort(compare).join('\n');
        for (const reason of evidence.get(key) || []) reasons.add(reason);
        if (!visited.has(other)) queue.push(other);
      }
    }
    component.sort((a, b) => compare(a.id, b.id));
    const anchor = component.find(r => r.exported) || component[0];
    const district = {
      id: `${file}::module:${anchor.id}`,
      name: component.length > 1 ? anchor.name + ' + collaborators' : anchor.name,
      reason:
        component.length > 1
          ? 'Connected by ' + [...reasons].sort(compare).join(' and ')
          : 'Independent module callable',
      basis: reasons.has('resolved calls') ? 'resolved' : 'structural',
    };
    for (const member of component) member.district = district;
  }
  for (const region of regions) {
    region.district.roles = unique(
      regions
        .filter(r => r.district.id === region.district.id)
        .flatMap(r => r.roles.map(role => (typeof role === 'string' ? role : role.label || role.id))),
    );
    region.importance =
      (region.exported ? 4 : region.vis === 'public' ? 2 : 0) + incoming.get(region.id) + (region.roles.length ? 1 : 0);
  }
  // Bounded source neighborhoods prevent a long call chain or an entire class
  // from becoming one indistinguishable clump. Strongest evidence merges first;
  // a shared detected role only breaks ties between already connected methods.
  const communities = new Map(regions.map(r => [r.id, new Set([r.id])]));
  const edges = [...affinity]
    .map(([key, weight]) => {
      const [a, b] = key.split('\n'),
        roles = new Set(byId.get(a).roles.map(r => r.id || r));
      const sharedRole = byId.get(b).roles.some(r => roles.has(r.id || r));
      return { a, b, key, weight: weight + (sharedRole ? 0.25 : 0) };
    })
    .sort((a, b) => b.weight - a.weight || compare(a.key, b.key));
  for (const edge of edges) {
    const a = communities.get(edge.a),
      b = communities.get(edge.b);
    if (a === b || a.size + b.size > 8) continue;
    const merged = new Set([...a, ...b]);
    for (const id of merged) communities.set(id, merged);
  }
  for (const region of regions) {
    const ids = [...communities.get(region.id)].sort(compare),
      anchor = byId.get(ids[0]),
      reasons = new Set();
    for (const edge of edges)
      if (ids.includes(edge.a) && ids.includes(edge.b))
        for (const reason of evidence.get(edge.key)) reasons.add(reason);
    region.neighborhood = {
      id: region.district.id + '::neighborhood:' + anchor.id,
      name: ids.length > 1 ? anchor.name + ' cluster' : anchor.name,
      reason:
        ids.length > 1 ? 'Linked by ' + [...reasons].sort(compare).join(' and ') : 'No local affinity established',
      members: ids,
    };
  }
  regions.sort((a, b) => compare(a.district.id, b.district.id) || compare(a.id, b.id));
  return layoutRegions(regions);
}

/** Assign independently reproducible anchors; terrain may move a seed locally
 * to fit land but never rotates all districts when the callable count changes.
 * With `keyOf` (region → persistent layout key, layout-identity.js), anchors hash those keys instead of analyzer
 * ids, so renaming a callable, its owner or its file leaves every anchor where it was. A district or neighborhood is
 * keyed by its oldest member (`ageOf`, lower is older): it keeps its place while that member exists, and a newcomer
 * never re-anchors it. */
export function layoutRegions(regions, keyOf = null, ageOf = () => 0) {
  const keys = new Map(regions.map(region => [region, keyOf ? keyOf(region) : region.id]));
  const older = (a, b) => ageOf(a) - ageOf(b) || compare(keys.get(a), keys.get(b));
  const earliest = (group, idOf) => {
    const map = new Map();
    for (const region of regions) {
      const id = idOf(region);
      if (!map.has(id) || older(region, map.get(id)) < 0) map.set(id, region);
    }
    return region => (keyOf ? group + ':' + keys.get(map.get(idOf(region))) : idOf(region));
  };
  const districtKey = earliest('district', r => r.district?.id || r.owner || r.id || r.name),
    neighborhoodKey = earliest('neighborhood', r => r.neighborhood?.id || r.id);
  for (const region of regions) {
    const key = keys.get(region);
    const districtId = districtKey(region);
    const districtAnchor = sphere(districtId);
    const neighborhoodId = neighborhoodKey(region);
    const neighborhoodAnchor = sphere(neighborhoodId);
    const east = normalize(cross(Math.abs(neighborhoodAnchor[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], neighborhoodAnchor));
    const north = normalize(cross(neighborhoodAnchor, east));
    const angle = 2 * Math.PI * fraction(key + ':bearing');
    const distance = 0.06 + 0.24 * Math.sqrt(fraction(key + ':distance'));
    const tangent = east.map((v, i) => v * Math.cos(angle) + north[i] * Math.sin(angle));
    const anchor = neighborhoodAnchor.map((v, i) => v * Math.cos(distance) + tangent[i] * Math.sin(distance));
    region.layout = {
      version: keyOf ? 3 : 2,
      key,
      districtAnchor,
      neighborhoodAnchor,
      globalAnchor: sphere(key),
      anchor,
      bearing: angle,
      distance,
      districtId,
      neighborhoodId,
    };
  }
  return regions;
}
