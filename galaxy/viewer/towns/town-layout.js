// Pure town geometry shared by the sphere, flat plans and offline checks.
import { FORK, LANE, LOT, TRY_GAP, measureSeq, terminalKind, ifChain, ladderOffset } from '../shared/town-flow.js';

export const sequenceFallsThrough = items => items.every(fallsThrough);
export function fallsThrough(it) {
  if (terminalKind(it)) return false;
  if (it.t === 'block') return sequenceFallsThrough(it.body);
  if (it.t === 'if') return sequenceFallsThrough(it.then) || sequenceFallsThrough(it.else || []);
  if (it.t === 'switch') return !it.hasDefault || it.cases.some(sequenceFallsThrough);
  if (it.t === 'try')
    return (
      sequenceFallsThrough(it.finalizer || []) &&
      (sequenceFallsThrough(it.body) || (!!it.handler && sequenceFallsThrough(it.handler)))
    );
  return true;
}

export function drawSeq(items, x, y, out, depth, sideState) {
  for (const it of items) {
    drawItem(it, x, y, out, depth, sideState);
    y -= it._m.h;
    if (!fallsThrough(it)) return null;
  }
  return y;
}
// Shared road sampling and ribbons live in road-ribbon.js.
function road(out, pts, kind, arm = null) {
  if (pts.some(p => p[1] == null)) return;
  out.roads.push({ pts, kind, arm });
}
// Each rung owns only its body interval; completed arms share the spine below it.
function drawRung(items, measured, x, y, out, depth, side, arm) {
  const fork = [x, y - 0.45],
    enter = [x - ladderOffset(measured.w), y - FORK],
    merge = [x, y - 2 * FORK - Math.max(measured.h, 0.6)];
  road(out, [[x, y], fork], depth ? 'branch' : 'main');
  // The spine past the body is the path that skips it. It runs the body's full length, so drawn as a main road it
  // read as an empty highway beside the code; a lighter bypass keeps the branch with its buildings as the street.
  road(out, [fork, merge], 'skip');
  road(out, [fork, enter], 'branch', arm);
  out.terraces.push({
    x0: enter[0] - measured.w / 2,
    x1: enter[0] + measured.w / 2,
    y0: enter[1] + 0.1,
    y1: enter[1] - measured.h - 0.1,
    depth: depth + 1,
  });
  const end = drawSeq(items, ...enter, out, depth + 1, side);
  if (end != null) road(out, [[enter[0], end], merge], 'branch');
  return { fork, then: enter, else: merge, merge, end };
}
function drawIfLadder(it, x, y, out, depth, side) {
  const { branches, tail } = ifChain(it),
    bottom = [x, y - it._m.h];
  let cursor = y;
  for (const branch of branches) {
    branch._at = { x, y: cursor, h: branch._m.h };
    const rung = drawRung(branch.then, branch._m.a, x, cursor, out, depth, side, 'then');
    branch._lanes = { ...rung, ladder: true, bottom };
    out.forks.push({ it: branch, x, y: rung.fork[1], depth });
    cursor = rung.merge[1];
  }
  it._lanes.tail = [x, cursor];
  it._lanes.bypass = [];
  if (tail.length) {
    // A completed arm skips the final else. Keep that shared bypass local to
    // the else body, so even a terminal else never has a road through its cap.
    const top = cursor - FORK,
      end = drawSeq(tail, x, top, out, depth, side);
    road(
      out,
      [
        [x, cursor],
        [x, top],
      ],
      depth ? 'branch' : 'main',
    );
    if (end != null) road(out, [[x, end], bottom], depth ? 'branch' : 'main');
    it._lanes.tail = [x, top];
    if (branches.some(branch => sequenceFallsThrough(branch.then))) {
      const bx = x + ladderOffset(it._m.end.w),
        pts = [[x, cursor], [bx, top], [bx, top - it._m.end.h], bottom];
      road(out, pts, 'branch');
      it._lanes.bypass = pts;
    }
  }
}
function drawItem(it, x, y, out, depth, side) {
  const m = it._m;
  it._at = { x, y, h: m.h };
  if (it.t === 'stmt') {
    road(
      out,
      [
        [x, y],
        [x, y - m.h * (terminalKind(it) ? 0.5 : 1)],
      ],
      depth ? 'branch' : 'main',
    );
    if (terminalKind(it)) Object.assign(out.roads.at(-1), { terminal: terminalKind(it), it });
    side.flip = !side.flip;
    const bx = x + (side.flip ? LOT : -LOT),
      by = y - m.h / 2;
    out.lots.push({ it, x: bx, y: by, rx: x, ry: by, depth, size: Math.min(1, 0.45 + (it.end - it.line) * 0.07) });
    return;
  }
  if (it.t === 'if') {
    if (m.ladder) {
      drawIfLadder(it, x, y, out, depth, side);
      return;
    }
    const { a, b } = m,
      xa = x - m.w / 2 + a.w / 2,
      xb = x + m.w / 2 - Math.max(b.w, LANE * 0.6) / 2,
      top = y - FORK,
      bottom = y - m.h + FORK;
    road(
      out,
      [
        [x, y],
        [x, y - 0.45],
      ],
      depth ? 'branch' : 'main',
    );
    road(
      out,
      [
        [x, y - 0.45],
        [xa, top],
      ],
      'branch',
      'then',
    );
    road(
      out,
      [
        [x, y - 0.45],
        [xb, top],
      ],
      'branch',
      'else',
    );
    out.forks.push({ it, x, y: y - 0.45, depth });
    out.terraces.push({
      x0: x - m.w / 2 + 0.05,
      x1: xa + a.w / 2 - 0.05,
      y0: top + 0.1,
      y1: bottom - 0.1,
      depth: depth + 1,
    });
    const ya = drawSeq(it.then, xa, top, out, depth + 1, side);
    road(
      out,
      [
        [xa, ya],
        [xa, bottom],
      ],
      'branch',
    );
    if (it.else && it.else.length) {
      const yb = drawSeq(it.else, xb, top, out, depth + 1, side);
      road(
        out,
        [
          [xb, yb],
          [xb, bottom],
        ],
        'branch',
      );
    } else
      road(
        out,
        [
          [xb, top],
          [xb, bottom],
        ],
        'branch',
      );
    if (ya != null)
      road(
        out,
        [
          [xa, bottom],
          [x, y - m.h],
        ],
        'branch',
      );
    if (sequenceFallsThrough(it.else || []))
      road(
        out,
        [
          [xb, bottom],
          [x, y - m.h],
        ],
        'branch',
      );
    it._lanes = { then: [xa, top], else: [xb, top], bottom: [x, y - m.h], laneBottom: bottom, fork: [x, y - 0.45] };
    return;
  }
  if (it.t === 'loop') {
    const x0 = x - m.w / 2 + 0.2,
      x1 = x + m.w / 2 - 0.2,
      y0 = y - 0.7,
      y1 = y - m.h + 0.7;
    road(
      out,
      [
        [x, y],
        [x, y0],
      ],
      depth ? 'branch' : 'main',
    );
    road(
      out,
      [
        [x, y0],
        [x1, y0],
        [x1, y1],
        [x, y1],
      ],
      'loop',
    ); // ring road = the back edge
    road(
      out,
      [
        [x, y1],
        [x, y - m.h],
      ],
      depth ? 'branch' : 'main',
    );
    out.loops.push({ it, x, y: y0, depth });
    out.terraces.push({ x0: x0 + 0.1, x1: x1 - 0.1, y0: y0 - 0.1, y1: y1 + 0.1, depth: depth + 1 });
    road(
      out,
      [
        [x, y0],
        [x, y0 - 0.25],
      ],
      'branch',
    );
    const end = drawSeq(it.body, x, y0 - 0.25, out, depth + 1, side);
    if (end != null) {
      road(
        out,
        [
          [x, end],
          [x, y1],
        ],
        'branch',
      );
      road(
        out,
        [
          [x, y1],
          [x0, y1],
          [x0, y0],
          [x, y0],
        ],
        'loop',
        'return',
      );
    }
    it._lanes = {
      body: [x, y0 - 0.25],
      ring: [
        [x, y0],
        [x1, y0],
        [x1, y1],
        [x, y1],
      ],
    };
    return;
  }
  if (it.t === 'switch') {
    let cursor = y;
    it._lanes = { rungs: [], merge: [x, y - m.h] };
    it.cases.forEach((items, k) => {
      const rung = drawRung(items, m.cs[k], x, cursor, out, depth, side, 'case');
      rung.breaks = [];
      const exits = items =>
        items.forEach(item => {
          if (!item._at || item.t === 'loop' || item.t === 'switch') return;
          if (item.kind === 'jump' && /^(break|yield)\s*;?$/.test(item.summary.trim())) {
            const a = item._at,
              pts = [[a.x, a.y - a.h / 2], [a.x, a.y - a.h], rung.merge];
            rung.breaks.push({ it: item, pts });
            if (a.x !== rung.then[0] || Math.abs(a.y - a.h - rung.end) > 1e-8) road(out, pts.slice(1), 'branch');
          }
          for (const key of ['then', 'else', 'body', 'handler', 'finalizer']) if (item[key]) exits(item[key]);
        });
      exits(items);
      it._lanes.rungs.push(rung);
      cursor = rung.merge[1];
    });
    out.forks.push({ it, x, y: y - 0.45, depth });
    return;
  }
  if (it.t === 'try') {
    const mergeY = y - m.h + m.f.h,
      laneY = y - TRY_GAP;
    const xb = x - (it.handler ? (m.c.w + 0.6) / 2 : 0),
      xc = xb + m.b.w / 2 + 0.6 + m.c.w / 2;
    road(
      out,
      [
        [x, y],
        [xb, laneY],
      ],
      depth ? 'branch' : 'main',
    );
    out.walls.push({ x0: xb - m.b.w / 2 - 0.1, x1: xb + m.b.w / 2 + 0.1, y0: y - 0.5, y1: mergeY + 0.5 });
    const yb = drawSeq(it.body, xb, laneY, out, depth + 1, side);
    road(
      out,
      [
        [xb, yb],
        [x, mergeY],
      ],
      'branch',
    );
    if (it.handler) {
      road(
        out,
        [
          [x, y],
          [xc, laneY],
        ],
        'branch',
      );
      const yc = drawSeq(it.handler, xc, laneY, out, depth + 1, side);
      road(
        out,
        [
          [xc, yc],
          [x, mergeY],
        ],
        'branch',
      );
    }
    it._lanes = { enter: [xb, laneY], handlerAt: [xc, laneY], merge: [x, mergeY] };
    drawSeq(it.finalizer || [], x, mergeY, out, depth, side);
    return;
  }
  if (it.t === 'block') {
    drawSeq(it.body, x, y, out, depth, side);
  }
}

export function splitScopes(flow, region) {
  const measured = flow.hoods.map(h => ({ ...h, m: measureSeq(h.items) })),
    heightLimit = Math.max(8, Math.sqrt(measured.reduce((n, h) => n + h.m.w * h.m.h, 0)) * 0.7);
  const cols = measured.flatMap(h => {
    const parts = [];
    let items = [],
      height = 0;
    const flush = () => {
      if (items.length)
        parts.push({ ...h, name: h.name + (parts.length ? ' · continued' : ''), items, m: measureSeq(items) });
      items = [];
      height = 0;
    };
    for (const it of h.items) {
      if (height + it._m.h > heightLimit) flush();
      items.push(it);
      height += it._m.h;
    }
    flush();
    return parts;
  });
  if (!cols.length) cols.push({ name: region.name, scope: region.start, items: [], m: { w: LANE, h: 1.1 } });
  return cols;
}

export function groupScopeBlocks(blocks, aspect = 1) {
  const byScope = new Map();
  blocks.forEach((b, i) => {
    const key = b.scope ?? i;
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key).push(i);
  });
  return [...byScope.values()].map(indices => {
    const minWidth = Math.max(...indices.map(i => blocks[i].w)),
      maxWidth = indices.reduce((n, i) => n + blocks[i].w, 0),
      target = Math.max(1 / 3, Math.min(3, aspect));
    let best,
      score = Infinity;
    // Try a bounded number of shelf widths. Whole chunks retain source order;
    // alternate rows so a continuation never travels back across the group.
    for (let step = 0; step <= 16; step++) {
      const limit = minWidth * (maxWidth / minWidth) ** (step / 16),
        rows = [{ w: 0, h: 0, children: [] }];
      for (const i of indices) {
        const b = blocks[i];
        let row = rows.at(-1);
        if (row.children.length && row.w + b.w > limit + 1e-8) {
          row = { w: 0, h: 0, children: [] };
          rows.push(row);
        }
        row.children.push({ i, x: row.w });
        row.w += b.w;
        row.h = Math.max(row.h, b.h + 1.6);
      }
      const w = Math.max(...rows.map(r => r.w)),
        h = rows.reduce((n, r) => n + r.h, 0),
        ratio = w / h,
        cost = Math.abs(Math.log(ratio / target)) + (ratio < 1 / 3 || ratio > 3 ? 100 : 0);
      if (cost >= score) continue;
      score = cost;
      let y = 0;
      const children = rows.flatMap((r, row) => {
        const placed = r.children.map(c => ({
          ...c,
          x: row % 2 ? w - c.x - blocks[c.i].w : c.x,
          y,
          row,
        }));
        y += r.h;
        return placed;
      });
      best = { w, h, children };
    }
    return best;
  });
}
export function unpackScopeBlocks(packing, groups, blocks) {
  const placed = [],
    owners = [];
  groups.forEach((g, i) => {
    const box = packing.placed[i];
    g.children.forEach(({ i: j, x, y, row }) => {
      const b = blocks[j];
      placed[j] = {
        ...box,
        cx: box.cx + (x + b.w / 2 - g.w / 2) * packing.s,
        cy: box.cy + ((g.h - b.h) / 2 - y - 0.8) * packing.s,
        row,
        gw: (b.w * packing.s) / packing.cell,
        gh: (b.h * packing.s) / packing.cell,
      };
      owners[j] = i;
    });
  });
  return { ...packing, placed, portal: (i, top) => packing.portal(owners[i], top) };
}
export function connectColumns(columns, packing, s) {
  const roads = [],
    last = new Map(),
    definitions = new Map();
  const visit = (items, fn) =>
    items.forEach(it => {
      fn(it);
      for (const key of ['then', 'else', 'body', 'handler', 'finalizer']) if (it[key]) visit(it[key], fn);
      (it.cases || []).forEach(items => visit(items, fn));
    });
  const statements = [];
  columns.forEach((co, i) =>
    visit(co.c.items, it => {
      if (it._at) statements.push({ it, co, i });
    }),
  );
  columns.forEach((co, j) => {
    const prev = last.get(co.c.scope);
    if (prev != null && sequenceFallsThrough(columns[prev].c.items)) {
      const from = columns[prev],
        box = packing.placed[prev],
        next = packing.placed[j],
        direction = co.start[0] >= from.start[0] ? 1 : -1,
        gap = box.cx + direction * ((box.gw * packing.cell) / 2 - 0.35 * s),
        // Clear only the column being left: dipping to the lower of both ends sent a short column's continuation
        // down the whole length of a tall neighbour and back up, an empty road the height of the town.
        bottom = from.end[1] - 0.5 * s,
        top = co.start[1] + 0.4 * s;
      const pts =
        box.row !== next.row
          ? [from.end, [from.end[0], top], [co.start[0], top], co.start]
          : [from.end, [from.end[0], bottom], [gap, bottom], [gap, top], [co.start[0], top], co.start];
      roads.push({ kind: 'continuation', scope: co.c.scope, nested: co.c.parentLine != null, pts });
      co.route = pts;
    } else if (prev == null && co.c.parentLine != null) {
      const parent = statements
        .filter(p => p.co.c.scope !== co.c.scope && p.it.line <= co.c.parentLine && p.it.end >= co.c.parentLine)
        .sort((a, b) => a.it.end - a.it.line - (b.it.end - b.it.line))[0];
      if (parent) {
        const scope = parent.co.c.scope;
        if (!definitions.has(scope)) definitions.set(scope, []);
        definitions.get(scope).push({ co, j, parent: parent.it.id });
      }
    }
    last.set(co.c.scope, j);
  });
  for (const [parentScope, callbacks] of definitions) {
    const root = columns.findIndex(co => co.c.scope === parentScope),
      portal = packing.portal(root, true),
      origin = packing.xy(...portal),
      edges = new Map();
    const add = (a, b, scope) => {
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-8) return;
      const key = [a, b]
        .map(p => p.map(v => v.toFixed(8)).join(','))
        .sort()
        .join('/');
      if (!edges.has(key)) edges.set(key, { kind: 'definition', parentScope, trunk: true, scopes: [], pts: [a, b] });
      const edge = edges.get(key);
      if (!edge.scopes.includes(scope)) edge.scopes.push(scope);
    };
    for (const { co, j, parent } of callbacks) {
      const path = packing.route(portal, packing.portal(j, true));
      if (!path) continue;
      add(columns[root].start, origin, co.c.scope);
      // Routes from one portal share the raster's BFS tree. Split compressed
      // legs at cell boundaries and emit each edge once, with its descendants.
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1],
          b = path[i],
          n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / packing.cell)),
          at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        for (let k = 0; k < n; k++) add(at(k / n), at((k + 1) / n), co.c.scope);
      }
      const a = path.at(-1),
        b = co.start,
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        t = length ? Math.max(0, 1 - (0.8 * s) / length) : 0,
        split = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      add(a, split, co.c.scope);
      roads.push({ kind: 'definition', parentScope, scope: co.c.scope, parent, scopes: [co.c.scope], pts: [split, b] });
    }
    const keyOf = p => p.map(v => v.toFixed(8)).join(','),
      nodes = new Map(),
      emitted = new Set();
    for (const edge of edges.values()) {
      edge.scopes.sort((a, b) => a - b);
      for (const p of edge.pts) {
        const key = keyOf(p);
        if (!nodes.has(key)) nodes.set(key, []);
        nodes.get(key).push(edge);
      }
    }
    // Keep junctions fixed. Only uninterrupted chains with the same visible
    // descendants can be sampled as one dashed ribbon.
    for (const edge of edges.values()) {
      if (emitted.has(edge)) continue;
      emitted.add(edge);
      const pts = [...edge.pts];
      for (const reverse of [false, true]) {
        if (reverse) pts.reverse();
        while (true) {
          const end = pts.at(-1),
            adjacent = nodes.get(keyOf(end));
          if (adjacent.length !== 2) break;
          const next = adjacent.find(e => !emitted.has(e));
          if (!next || next.scopes.join(',') !== edge.scopes.join(',')) break;
          emitted.add(next);
          pts.push(next.pts.find(p => keyOf(p) !== keyOf(end)));
        }
      }
      roads.push({ ...edge, pts });
    }
  }
  return roads;
}

// Focused towns and close cameras show the complete flow geometry.
// A town shows its detail within a distance of its building scale or, for a settlement's small towns, of its extent.
export function roadDetailVisible({ distance, scale, extent = 0, expanded, focused, line, flat = false }) {
  return flat || focused || distance < Math.max(scale * (expanded ? 26 : 23), extent * (expanded ? 8 : 7.2));
}

// Both renderers and offline measurements use these exact mutually exclusive layers.
export function townRoadLayers(tw) {
  const layers = [];
  for (const rd of tw.out.roads) {
    layers.push({ road: rd, mode: rd.kind === 'definition' ? 'definition' : rd.scope == null ? 'always' : 'detail' });
  }
  const scopes = new Map();
  for (const co of tw.cols) {
    if (!scopes.has(co.c.scope)) scopes.set(co.c.scope, { start: co.start, bottom: co.end[1] });
    const scope = scopes.get(co.c.scope);
    scope.bottom = Math.min(scope.bottom, co.end[1]);
  }
  for (const [scope, { start, bottom }] of scopes)
    layers.push({ road: { kind: 'main', scope, pts: [start, [start[0], bottom]] }, mode: 'overview' });
  return layers;
}

// Landing on a region is not scope inspection. Only explicit scope selection
// reveals its own callbacks; hovering a callback reveals just its incoming path.
export function definitionLinkVisible(rd, { scope = null, hovered = null } = {}) {
  return (
    (scope != null && (rd.parentScope === scope || rd.scopes.includes(scope))) ||
    (hovered != null && rd.scopes.includes(hovered))
  );
}

// One building scale for a whole planet, so a statement's building is the same size in every town and size never
// encodes spare land. Each town's capacity is the scale at which its blocks would fill its usable land at typical
// packing density; the planet takes a low percentile, so most towns reach it and only the most crowded shrink
// further. Rounding to steps of 2^(1/3) keeps small edits from rescaling (and rebuilding) every town.
export function planetTownScale(shapes, blocksOf, maxScale) {
  const capacity = shapes
    .map((shape, k) => {
      const edge = shape?.edge || [];
      let area = 0;
      for (let i = 0; i < edge.length; i++) {
        const [x0, y0] = edge[i],
          [x1, y1] = edge[(i + 1) % edge.length];
        area += x0 * y1 - x1 * y0;
      }
      const need = (blocksOf[k] || []).reduce((sum, b) => sum + b.w * b.h, 0);
      return need > 0 ? Math.sqrt(((Math.abs(area) / 2) * 0.45) / need) : Infinity;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!capacity.length) return maxScale;
  const step = 2 ** (1 / 3),
    pick = capacity[Math.floor(capacity.length * 0.3)];
  return Math.min(maxScale, step ** Math.floor(Math.log(pick) / Math.log(step)));
}

// Pack complete neighbourhood blocks into a raster of the real region. No statement/building budget.
// The free cells also form corridors for roads between blocks.
export async function packRegion(shape, blocks, maxScale, checkpoint) {
  const width = Math.max(...shape.edge.map(p => p[0])) - Math.min(...shape.edge.map(p => p[0])),
    height = Math.max(...shape.edge.map(p => p[1])) - Math.min(...shape.edge.map(p => p[1])),
    groups = groupScopeBlocks(blocks, width / Math.max(1e-8, height)),
    packing = await packBlocks(shape, groups, maxScale, checkpoint);
  return unpackScopeBlocks(packing, groups, blocks);
}
async function packBlocks(shape, blocks, maxScale, checkpoint) {
  const span = Math.sqrt(blocks.reduce((a, b) => a + b.w * b.h, 0)) * maxScale * 1.5;
  const x0 = Math.max(-span, Math.min(...shape.edge.map(p => p[0]))),
    x1 = Math.min(span, Math.max(...shape.edge.map(p => p[0])));
  const y0 = Math.max(-span, Math.min(...shape.edge.map(p => p[1]))),
    y1 = Math.min(span, Math.max(...shape.edge.map(p => p[1])));
  const order = blocks.map((b, i) => ({ ...b, i })).sort((a, b) => b.w * b.h - a.w * a.h);
  // The region as a raster of free cells (1 = outside the shape).
  async function rasterize(resolution) {
    const cell = Math.max(x1 - x0, y1 - y0) / resolution,
      nx = Math.ceil((x1 - x0) / cell),
      ny = Math.ceil((y1 - y0) / cell);
    const mask = new Uint8Array(nx * ny);
    for (let y = 0; y < ny; y++) {
      await checkpoint();
      for (let x = 0; x < nx; x++) {
        mask[y * nx + x] = [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
          [0.5, 0.5],
        ].some(([dx, dy]) => !shape.contains(x0 + (x + dx) * cell, y0 + (y + dy) * cell))
          ? 1
          : 0;
      }
    }
    return { cell, nx, ny, mask, xy: (x, y) => [x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell] };
  }
  async function attempt({ cell, nx, ny, mask, xy }, s) {
    const used = mask.slice(),
      placed = new Array(blocks.length),
      stride = nx + 1;
    for (const b of order) {
      await checkpoint();
      const gw = Math.ceil((b.w * s) / cell) + 2,
        gh = Math.ceil((b.h * s) / cell) + 2;
      const sums = new Int32Array((nx + 1) * (ny + 1));
      for (let y = 0; y < ny; y++) {
        let row = 0;
        for (let x = 0; x < nx; x++) {
          row += used[y * nx + x];
          sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
        }
      }
      let best = null,
        score = Infinity;
      for (let y = 0; y + gh <= ny; y++)
        for (let x = 0; x + gw <= nx; x++) {
          if (
            sums[(y + gh) * stride + x + gw] -
            sums[y * stride + x + gw] -
            sums[(y + gh) * stride + x] +
            sums[y * stride + x]
          )
            continue;
          const [cx, cy] = xy(x + (gw - 1) / 2, y + (gh - 1) / 2),
            d = cx * cx + cy * cy;
          if (d < score) {
            score = d;
            best = { x, y, gw, gh, cx, cy };
          }
        }
      if (!best) return null;
      placed[b.i] = best;
      for (let y = best.y + 1; y < best.y + gh - 1; y++)
        for (let x = best.x + 1; x < best.x + gw - 1; x++) used[y * nx + x] = 1;
    }
    return { placed, used, s };
  }
  async function fit(grid) {
    let result = await attempt(grid, maxScale);
    if (!result) {
      let lo = 0,
        hi = maxScale;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2,
          fits = await attempt(grid, mid);
        if (fits) {
          result = fits;
          lo = mid;
        } else hi = mid;
      }
    }
    return result;
  }
  // Every block needs a free 3×3 window even at the smallest scale, so a narrow region or one crowded with
  // neighbourhoods can have no room on the base raster; finer rasters give it more cells.
  const base = Math.max(80, Math.ceil(Math.sqrt(blocks.length)) * 6);
  let grid, result;
  for (const factor of [1, 2, 4]) {
    grid = await rasterize(base * factor);
    result = await fit(grid);
    if (result) break;
  }
  if (!result) throw new Error('Region has no room for its neighbourhoods');
  const { cell, nx, ny, xy } = grid;
  const { placed, used } = result;
  const portal = (i, top) => {
    const p = placed[i];
    return [p.x + Math.floor(p.gw / 2), top ? p.y + p.gh - 1 : p.y];
  };
  const route = (from, to) => {
    const start = from[1] * nx + from[0],
      end = to[1] * nx + to[0],
      prev = new Int32Array(nx * ny).fill(-1),
      queue = [start];
    prev[start] = start;
    for (let q = 0; q < queue.length && prev[end] < 0; q++) {
      const at = queue[q],
        x = at % nx,
        y = Math.floor(at / nx);
      for (const [xx, yy] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (xx < 0 || xx >= nx || yy < 0 || yy >= ny) continue;
        const next = yy * nx + xx;
        if (prev[next] >= 0 || used[next]) continue;
        prev[next] = at;
        queue.push(next);
      }
    }
    if (prev[end] < 0) return null;
    const cells = [];
    for (let at = end; ; at = prev[at]) {
      cells.push([at % nx, Math.floor(at / nx)]);
      if (at === start) break;
    }
    cells.reverse();
    return cells
      .filter(
        (p, i) =>
          !i ||
          i === cells.length - 1 ||
          p[0] - cells[i - 1][0] !== cells[i + 1][0] - p[0] ||
          p[1] - cells[i - 1][1] !== cells[i + 1][1] - p[1],
      )
      .map(([x, y]) => xy(x, y));
  };
  return { ...result, portal, route, xy, cell, nx, ny, x0, y0 };
}
