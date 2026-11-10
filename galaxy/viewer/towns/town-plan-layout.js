import * as THREE from 'three';
import { flatTownSurface } from './town-surface.js';

// Plan fitting uses drawn content, not the raster's reserved empty packing cells.
export function fitTownPlan(town, width, height) {
  const points = town.out.roads.flatMap(r => r.pts);
  for (const lot of [...town.out.lots, ...town.out.forks, ...town.out.loops]) {
    points.push([lot.x - town.s, lot.y - town.s], [lot.x + town.s, lot.y + town.s]);
  }
  const port = town.port;
  if (port) points.push([port.x0, port.y0], [port.x1, port.y1]);
  if (!points.length) points.push([0, 0]);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const padding = Math.min(24, Math.min(width, height) * 0.08),
    units = Math.max((x1 - x0) / Math.max(1, width - padding * 2), (y1 - y0) / Math.max(1, height - padding * 2), 1e-6);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, span: units * height, bounds: { x0, x1, y0, y1 } };
}

export const PLAN_DETAIL_ZOOM = 2.2;
export const planLabelVisible = (definition, zoom) => !definition.planDetail || zoom >= PLAN_DETAIL_ZOOM;

// The plan flattens the existing packing. Its roads always use full flat-surface
// detail; zoom controls labels only, never the town's connectivity.
export function townPlanContext(ctx, town, region, T, signal) {
  return {
    ...ctx,
    signal,
    T,
    regions: [ctx.regions[region]],
    surface: flatTownSurface([new THREE.Vector3()]),
    layoutTowns: () => [town.packing],
    maxScale: [town.s],
    centerOf: [new THREE.Vector3()],
    shapeOf: [],
    groundAt: () => 0,
    roadDetail: () => true,
  };
}
