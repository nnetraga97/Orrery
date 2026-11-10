// Town control-flow model shared by town layout, traffic and the inspector. Pure data: no DOM, no three.js.

// Flow records are produced by code-model.js in the analyzer (or the identical
// on-demand source adapter). Rendering never reparses JS/TS independently.
// JSON preserves values but not the shared statement identity between the flow
// body and neighborhood lists. Reconnect them before layout annotates statements;
// traffic and source picking must follow the very same roads/buildings.
export function hydrateTownFlow(source) {
  const flow = structuredClone(source),
    items = new Map();
  const visit = item => {
    if (!item || typeof item !== 'object') return item;
    if (item.id && items.has(item.id)) return items.get(item.id);
    if (item.id) items.set(item.id, item);
    for (const key of ['then', 'else', 'body', 'handler', 'finalizer']) if (item[key]) item[key] = item[key].map(visit);
    if (item.cases) item.cases = item.cases.map(branch => branch.map(visit));
    return item;
  };
  flow.body = flow.body.map(visit);
  flow.hoods = flow.hoods.map(hood => ({ ...hood, items: hood.items.map(visit) }));
  return flow;
}

// Structural traffic counts the same nested control-flow nodes as the town.
export function countStmts(items) {
  return items.reduce(
    (total, item) =>
      total +
      1 +
      ['then', 'else', 'body', 'handler', 'finalizer'].reduce(
        (n, key) => n + (item[key] ? countStmts(item[key]) : 0),
        0,
      ) +
      (item.cases || []).reduce((n, branch) => n + countStmts(branch), 0),
    0,
  );
}

export const STATEMENT_TYPES = {
  branch: { label: 'Branch', color: '#e5b46c', glyph: '?' },
  loop: { label: 'Loop', color: '#c4a0ea', glyph: '↻' },
  call: { label: 'Call', color: '#77baf0', glyph: '↗' },
  state: { label: 'State', color: '#73c9b2', glyph: '=' },
  return: { label: 'Return', color: '#a8c89b', glyph: '↩' },
  throw: { label: 'Throw', color: '#ef927f', glyph: '!' },
  statement: { label: 'Statement', color: '#a7b2c1', glyph: '·' },
};
// Java overloads share a name, so a call fits a member only when its argument count fits the parameter count.
// Members or calls without arity (TypeScript) always fit, which keeps the name-only matching they had before.
export const arityFits = (argc, m) =>
  argc == null || m.params == null || (m.varargs ? argc >= m.params - 1 : argc === m.params);
export const callsMember = (caller, m) =>
  !caller.sigs
    ? caller.selfCalls.includes(m.name)
    : caller.sigs.some(sig => {
        const [name, argc] = sig.split('/');
        return name === m.name && arityFits(+argc, m);
      });
export function statementType(it) {
  return ['if', 'switch'].includes(it.t)
    ? 'branch'
    : it.t === 'loop'
      ? 'loop'
      : ['return', 'throw'].includes(it.kind)
        ? it.kind
        : it.calls?.length
          ? 'call'
          : it.kind === 'decl' || it.writes?.length
            ? 'state'
            : 'statement';
}

// ---------- 2. flowchart layout in a local plane (units: lanes) ----------
// Each laid-out node records roads, lots (building sites), and control-flow terraces.
// Layout units (multiplied by the town scale s). LOT is how far a building sits from its road, FORK the vertical room a lane
// split or merge gets so it can curve, TRY_GAP the same for try / catch lanes.
export const BUILD = 1.7; // a building's base footprint, in layout units
export const LANE = 3.6,
  STMT_H = 1.1,
  LOT = 1.5,
  FORK = 2.2,
  TRY_GAP = 1.8;
// An else-if changes the decision, not the nesting level of its body.
export function ifChain(it) {
  const branches = [];
  while (it) {
    branches.push(it);
    const tail = it.else || [];
    if (tail.length !== 1 || tail[0].t !== 'if') return { branches, tail };
    it = tail[0];
  }
}
export const ladderOffset = width => (LANE + width) / 2 + 0.5;
const ladderWidth = width => 2 * (ladderOffset(width) + width / 2);
function measureIfLadder(it) {
  const { branches, tail } = ifChain(it),
    end = measureSeq(tail);
  let h = end.h + (tail.length ? 2 * FORK : 0),
    w = tail.length ? ladderWidth(end.w) : LANE;
  for (const branch of branches.toReversed()) {
    const a = measureSeq(branch.then),
      rung = 2 * FORK + Math.max(a.h, 0.6);
    h += rung;
    w = Math.max(w, ladderWidth(a.w));
    branch._m = { w, h, a, rung, end, ladder: true };
  }
  return it._m;
}
function measure(it) {
  if (it.t === 'stmt') return { w: LANE, h: STMT_H + Math.min(1.6, (it.end - it.line) * 0.12) };
  if (it.t === 'if') {
    if (ifChain(it).branches.length > 1) return measureIfLadder(it);
    const a = measureSeq(it.then),
      b = measureSeq(it.else || []);
    return { w: a.w + Math.max(b.w, LANE * 0.6) + 0.5, h: 2 * FORK + Math.max(a.h, b.h, 0.6), a, b };
  }
  if (it.t === 'loop') {
    const b = measureSeq(it.body);
    return { w: b.w + 1.4, h: b.h + 2.0, b };
  }
  if (it.t === 'switch') {
    const cs = it.cases.map(measureSeq);
    return {
      w: Math.max(LANE, ...cs.map(c => ladderWidth(c.w))),
      h: cs.reduce((sum, c) => sum + 2 * FORK + Math.max(0.6, c.h), 0),
      cs,
    };
  }
  if (it.t === 'try') {
    const b = measureSeq(it.body),
      c = measureSeq(it.handler || []),
      f = measureSeq(it.finalizer || []);
    return {
      w: Math.max(b.w + (it.handler ? c.w + 0.6 : 0) + 0.8, f.w),
      h: Math.max(b.h, c.h) + 2 * TRY_GAP + f.h,
      b,
      c,
      f,
    };
  }
  if (it.t === 'block') return measureSeq(it.body);
  return { w: LANE, h: STMT_H };
}
export function measureSeq(items) {
  let w = LANE,
    h = 0;
  for (const it of items) {
    const m = measure(it);
    it._m = m;
    w = Math.max(w, m.w);
    h += m.h;
  }
  return { w, h };
}

// Traffic and geometry stop at the same statement midpoint.
export const terminalKind = it => (it.t === 'stmt' && ['return', 'throw'].includes(it.kind) ? it.kind : null);
