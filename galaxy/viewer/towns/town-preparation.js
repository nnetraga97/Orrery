// Owns source-flow preparation, packing, surface frames, and per-town layout.
import * as THREE from 'three';
import { drawSeq, splitScopes, packRegion, connectColumns } from './town-layout.js';
import { hydrateTownFlow } from '../shared/town-flow.js';

export function prepareTown(r, { ctx, sourceTree, parsed, portAsset }) {
  const { source } = ctx;
  const cacheKey = JSON.stringify([r, source?.slice(r.sourceStart, r.sourceEnd)]),
    cached = ctx.previousPrepared?.get(cacheKey);
  if (cached) {
    ctx.preparedCache?.set(cacheKey, cached);
    return structuredClone(cached);
  }
  let flow = null;
  if (r.members.length === 1 && source)
    flow = sourceTree
      ? parsed.flow(sourceTree, source, r.members[0])
      : r.members[0].flow
        ? hydrateTownFlow(r.members[0].flow)
        : null;
  if (!flow) {
    // Missing flow is explicitly unanalysed, never a fabricated declaration.
    const items = (r.members.length ? r.members : [{ start: r.start, end: r.end, name: r.name }]).map(m => ({
      t: 'stmt',
      kind: 'unknown',
      line: m.start,
      end: m.end,
      calls: [],
      writes: [],
      fields: [],
      name: m.name,
      summary: 'Flow unavailable · ' + m.name,
      analysisStatus: 'unavailable',
    }));
    flow = { body: items, hoods: [{ name: r.name, items }] };
  }
  const cols = splitScopes(flow, r);
  const pub = r.vis === 'public' && r.kind !== 'ctor',
    PORT = portAsset ? { w: 4.2, h: 4.4 } : pub ? { w: 6.4, h: 3.4 } : { w: 3.4, h: 2.2 },
    APRON = PORT.h + 1.0;
  const blocks = cols.map((c, j) => ({
    scope: c.scope,
    w: Math.max(c.m.w, j ? 0 : PORT.w) + 2.4,
    h: c.m.h + 1.2 + (j ? 0 : APRON),
  }));
  const prepared = { flow, cols, pub, PORT, APRON, blocks };
  ctx.preparedCache?.set(cacheKey, structuredClone(prepared));
  return prepared;
}

export async function prepareTowns(build, { sourceTree, sourceTokens, parsed, portAsset }) {
  const { ctx, checkpoint, towns } = build;
  const { R, regions, centerOf, shapeOf, groundAt } = ctx;
  const S0 = R * 0.1; // largest town scale on the planet; a town shrinks below this only when its region is too small
  const up = new THREE.Vector3(0, 1, 0);
  const prepare = r => prepareTown(r, { ctx, sourceTree, parsed, portAsset });
  let prepared = null;
  if (ctx.prepared) prepared = ctx.prepared;
  else if (ctx.prepareOnly || ctx.layoutTowns) {
    prepared = [];
    for (const r of regions) {
      await checkpoint();
      prepared.push(prepare(r));
    }
  }
  if (ctx.prepareOnly) {
    prepared.sourceTokens = sourceTokens;
    return prepared;
  }
  const countryPackings =
    ctx.packings ??
    (prepared && ctx.layoutTowns
      ? await ctx.layoutTowns(
          prepared.map(p => p.blocks),
          (shape, blocks, scale) => packRegion(shape, blocks, scale, checkpoint),
        )
      : null);

  // Surface frames: planets retain their radial projection; flat cities supply a plane.
  const frames = regions.map((r, k) => {
    if (ctx.surface) return ctx.surface.frame(k);
    const n0 = centerOf[k].clone().normalize(),
      e = up.clone().cross(n0).normalize();
    if (e.lengthSq() < 1e-6) e.set(1, 0, 0);
    const nn = n0.clone().cross(e).normalize();
    const dirAt = (x, y) => n0.clone().multiplyScalar(R).addScaledVector(e, x).addScaledVector(nn, y).normalize();
    return {
      k,
      n0,
      e,
      nn,
      dirAt,
      roof: R,
      normalAt: p => p.clone().normalize(),
      altitude: p => p.length(),
      world: (x, y, lift = 0) => {
        const d = dirAt(x, y);
        return d.multiplyScalar(groundAt(d) + lift);
      },
    };
  });
  // --- lay out each region's town ---
  for (let k = 0; k < regions.length; k++) {
    await checkpoint();
    const r = regions[k];
    const { flow, cols, pub, PORT, APRON, blocks } = prepared?.[k] || prepare(r);
    // Bound the combined building footprint independently of island identity.
    // A roomier persisted island must not inflate every model in a dense town.
    const maxScale = ctx.surface
      ? (ctx.maxScale?.[k] ?? S0)
      : Math.min(
          R * (ctx.townScaleCap ?? 0.051),
          ctx.townScale ?? (R * 0.34) / Math.sqrt(Math.max(1, r.areaMetric?.statements ?? r.statements ?? 1)),
        );
    const packing = countryPackings?.[k] || (await packRegion(shapeOf[k], blocks, maxScale, checkpoint)),
      s = packing.s;
    const out = { roads: [], lots: [], forks: [], loops: [], terraces: [], walls: [], hoodLabels: [] };
    const colOut = cols.map((c, j) => {
      const local = { roads: [], lots: [], forks: [], loops: [], terraces: [], walls: [] },
        box = packing.placed[j];
      drawSeq(c.items, 0, 0, local, 0, { flip: j % 2 === 1 });
      const top = box.cy + (blocks[j].h * s) / 2 - 0.6 * s - (j ? 0 : APRON * s);
      const map = ([lx, ly]) => [box.cx + lx * s, top + ly * s];
      return { c, local, map, start: map([0, 0]), end: map([0, -c.m.h]) };
    });
    const tagColumn = (items, co) =>
      items.forEach(it => {
        it._co = co;
        for (const key of ['then', 'else', 'body', 'handler', 'finalizer']) if (it[key]) tagColumn(it[key], co);
        (it.cases || []).forEach(c => tagColumn(c, co));
      });
    colOut.forEach(co => tagColumn(co.c.items, co));
    colOut.forEach(co => {
      const M = co.map;
      co.local.roads.forEach(rd =>
        out.roads.push({ ...rd, scope: co.c.scope, nested: co.c.parentLine != null, pts: rd.pts.map(M) }),
      );
      co.local.lots.forEach(l => {
        const [x, y] = M([l.x, l.y]),
          [rx, ry] = M([l.rx, l.ry]);
        out.lots.push({ ...l, x, y, rx, ry });
      });
      for (const key of ['forks', 'loops'])
        co.local[key].forEach(f => {
          const [x, y] = M([f.x, f.y]);
          out[key].push({
            ...f,
            x,
            y,
            arms: f.it.t === 'if' ? { then: M(f.it._lanes.then), else: M(f.it._lanes.else) } : null,
          });
        });
      for (const key of ['terraces', 'walls'])
        co.local[key].forEach(t => {
          const [ax, ay] = M([t.x0, t.y0]),
            [bx, by] = M([t.x1, t.y1]);
          out[key].push({
            ...t,
            x0: Math.min(ax, bx),
            x1: Math.max(ax, bx),
            y0: Math.min(ay, by),
            y1: Math.max(ay, by),
          });
        });
      out.hoodLabels.push({
        // The method body's scope is called 'entry' internally; its wrapped columns read as the method continuing.
        name: co.c.name.replace(/^entry(?= · continued|$)/, r.name),
        scope: co.c.scope,
        nested: co.c.parentLine != null,
        at: M([0, 0.45]),
      });
    });
    out.roads.push(...connectColumns(colOut, packing, s));
    const entry = colOut[0].start,
      ax = entry[0],
      y0 = entry[1] + 0.7 * s;
    const port = {
      pub,
      x0: ax - (PORT.w / 2) * s,
      x1: ax + (PORT.w / 2) * s,
      y0,
      y1: y0 + PORT.h * s,
      cx: ax,
      cy: y0 + (PORT.h / 2) * s,
    };
    // The clover's landside gap faces the town; stop at its access socket,
    // rather than running a road into the middle of a landing pad.
    const portAccess = [
      entry[0],
      portAsset ? port.cy + portAsset.access.z * Math.min(PORT.w, PORT.h) * 0.92 * s : port.y0 + 0.35 * s,
    ];
    out.roads.push({
      kind: 'main',
      pts: [entry, portAccess],
    });
    const TER = 0.1 * s;
    const liftAt = (x, y) => {
      let d = 0;
      for (const t of out.terraces) if (x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1) d = Math.max(d, t.depth);
      return d * TER;
    };
    const extent = Math.max(
      ...packing.placed.map(b =>
        Math.hypot(Math.abs(b.cx) + (b.gw * packing.cell) / 2, Math.abs(b.cy) + (b.gh * packing.cell) / 2),
      ),
    );
    towns.push({
      k,
      flow,
      out,
      s,
      entry,
      port,
      portAccess,
      liftAt,
      packing,
      fr: frames[k],
      extent,
      cols: colOut,
    });
  }
}
