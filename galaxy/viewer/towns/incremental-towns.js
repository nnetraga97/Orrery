// Each town owns its draw batches. Revision views share unchanged owners until commit, so cancellation cannot
// dispose the visible revision and source offsets can change without touching its meshes.
import * as THREE from 'three';
import { buildTowns } from './towns.js';
import { batchTownInstances } from './town-batches.js';
import { packRegion, planetTownScale } from './town-layout.js';
import { runPlanetWorker } from '../planet/planet-build.js';
import { planetBuildBudget } from '../shared/build-budget.js';
import { townSourceView } from './town-source-view.js';
import { rebaseTownItem } from '../../source-model/town-revision.js';
import { languageOf } from '../../source-model/languages.js';
import { callRoutes } from '../../source-model/call-routes.js';

// Towns drawn in full: the largest on screen first, the selected town always. Distant regions use the shared
// overview batches. Entering and leaving thresholds differ so
// a town at the edge does not flicker between forms.
export const DETAIL = Object.freeze({ max: 20, enter: 18, leave: 14 });

export async function buildIncrementalTowns(ctx) {
  const previous = ctx.previousTowns;
  const group = new THREE.Group();
  group.name = 'town-renderers';
  group.visible = false; // Publish once the initial detail/culling state exists.
  // Three updates transforms even below invisible roots. Staged towns have
  // thousands of static children; only explicit GPU preparation needs them
  // before publication. updateWorldMatrix() used by preparation stays available.
  const updateGroup = group.updateMatrixWorld.bind(group);
  group.updateMatrixWorld = force => {
    if (group.visible) updateGroup(force);
  };
  ctx.T.scene.add(group);
  const owned = new Set(),
    units = [],
    views = [];
  let overview = null,
    batches = null;
  let disposed = false,
    committed = false;
  let disposeTownNames = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    disposeTownNames();
    batches?.dispose();
    for (const unit of owned) {
      unit.removeLabels?.();
      unit.controller.abort();
      unit.renderer?.dispose();
      unit.scene.removeFromParent();
    }
    owned.clear();
    if (overview) {
      overview.geometry.dispose();
      for (const mesh of overview.meshes) {
        mesh.dispose();
        mesh.material.dispose();
      }
    }
    group.removeFromParent();
    ctx.signal?.removeEventListener('abort', dispose);
  };
  ctx.signal?.addEventListener('abort', dispose, { once: true });
  try {
    const checkpoint = planetBuildBudget(ctx.signal, undefined, { frameBound: true });
    const revisions = await runPlanetWorker(
      'revisions',
      {
        regions: ctx.regions,
        source: ctx.source,
        file: ctx.file,
      },
      ctx.signal,
    );
    const targets = new Map(revisions.targets),
      fingerprints = revisions.fingerprints;
    const previousByKey = new Map(previous?.units.map(unit => [unit.key, unit]));
    const candidates = ctx.regions.map((r, k) => {
      const unit = previousByKey.get(r.layout.key);
      return unit?.fingerprint === fingerprints[k] ? unit : null;
    });
    const changed = candidates.flatMap((u, k) => (u ? [] : [k]));
    const fresh =
      changed.length || languageOf(ctx.file)?.frontEnd !== 'typescript'
        ? await buildTowns({ ...ctx, checkpoint, regions: changed.map(k => ctx.regions[k]), prepareOnly: true })
        : [];
    const freshByRegion = new Map(changed.map((k, i) => [k, fresh[i]]));
    const prepared = ctx.regions.map((r, k) => candidates[k]?.prepared ?? freshByRegion.get(k));
    // Planets share one building scale across their towns (flat country maps size their own lots).
    const townScale = ctx.terrain?.shapes
      ? planetTownScale(
          ctx.terrain.shapes,
          prepared.map(p => p.blocks),
          ctx.R * (ctx.townScaleCap ?? 0.051),
        )
      : undefined;
    const packings = await ctx.layoutTowns?.(
      prepared.map(p => p.blocks),
      (shape, blocks, scale) => packRegion(shape, blocks, scale, checkpoint),
    );
    const preparation = [];
    let preparing = false,
      priority = 0;
    const drainPreparation = async () => {
      if (preparing) return;
      preparing = true;
      try {
        while (preparation.length) {
          preparation.sort((a, b) => b.priority - a.priority);
          const job = preparation.shift(),
            unit = job.unit;
          try {
            if (!unit.controller.signal.aborted) {
              await unit.host.prepareDraw(unit.scene, planetBuildBudget(unit.controller.signal));
              if (!unit.controller.signal.aborted) unit.gpuReady = true;
            }
            job.resolve();
          } catch (error) {
            job.reject(error);
          }
        }
      } finally {
        preparing = false;
      }
    };
    const prepareUnit = (unit, urgent = false) => {
      if (unit.gpuReady) return Promise.resolve();
      if (unit.preparing) {
        if (urgent) unit.promotePreparation?.();
        return unit.preparing;
      }
      let job;
      const task = new Promise((resolve, reject) => {
        job = { unit, resolve, reject, priority: urgent ? ++priority : 0 };
      });
      unit.promotePreparation = () => {
        job.priority = ++priority;
      };
      unit.preparing = task.finally(() => {
        unit.preparing = null;
        unit.promotePreparation = null;
      });
      preparation.push(job);
      void drainPreparation();
      return unit.preparing;
    };
    for (let k = 0; k < ctx.regions.length; k++) {
      await checkpoint();
      const region = ctx.regions[k],
        placement =
          (ctx.placementKey?.(k) ??
            JSON.stringify([ctx.R, ctx.terrain.seed, ctx.terrain.centers[k], ctx.terrain.shapes[k]])) +
          `|${townScale ?? ''}`;
      let unit = candidates[k];
      if (!unit || unit.placement !== placement) {
        const controller = new AbortController(),
          scene = new THREE.Group();
        unit = {
          key: region.layout.key,
          fingerprint: fingerprints[k],
          placement,
          region,
          file: ctx.file,
          prepared: prepared[k],
          controller,
          scene,
          host: ctx.T,
          renderer: null,
          gpuReady: false,
        };
        const update = scene.updateMatrixWorld.bind(scene);
        scene.updateMatrixWorld = force => {
          if (scene.visible) update(force);
        };
        owned.add(unit);
        const host = new Proxy({}, { get: (_, key) => (key === 'scene' ? scene : unit.host[key]) });
        unit.renderer = await buildTowns({
          ...ctx,
          T: host,
          signal: controller.signal,
          checkpoint,
          regions: [region],
          townScale,
          planetNames: true,
          sourceItem: it => unit.sourceItem?.(it) ?? it,
          allRegions: ctx.regions,
          prepared: [structuredClone(prepared[k])],
          packings: packings ? [packings[k]] : null,
          surface: ctx.surface ? { ...ctx.surface, frame: () => ctx.surface.frame(k) } : null,
          centerOf: [ctx.centerOf[k]],
          siteOf: [ctx.siteOf[k]],
          shapeOf: [ctx.shapeOf[k]],
          regionColor: [ctx.regionColor[k]],
          regionOfLine: line => (ctx.regionOfLine(line) === k ? 0 : -1),
        });
        if (disposed) {
          controller.abort();
          throw new DOMException('Planet build cancelled', 'AbortError');
        }
        ctx.T.sync();
        unit.renderer.frame(0);
        // Do not expose provisional in-view towns to transform traversal. The
        // committed frame chooses at most twelve prepared renderers; everything
        // else uses the summary. Preparation updates matrices explicitly.
        scene.visible = false;
        group.add(scene);
        unit.labels = unit.renderer.labels.map(label => {
          const visible = () =>
            committed &&
            unit.scene.visible &&
            (typeof label.visible === 'function' ? label.visible() : label.visible !== false);
          return new Proxy(label, { get: (target, key) => (key === 'visible' ? visible : target[key]) });
        });
        unit.removeLabels = ctx.T.addLabels(unit.labels, unit);
      }
      units.push(unit);
      const itemViews = new Map(),
        originalItems = new Map(),
        sourceCopies = new Map();
      const item = it => {
        if (!itemViews.has(it)) {
          const copy = rebaseTownItem(it, unit.region, region, unit.file, ctx.file, targets, sourceCopies);
          itemViews.set(it, copy);
          originalItems.set(copy, it);
        }
        return itemViews.get(it);
      };
      const lot = l => (l ? { ...l, k, it: item(l.it) } : null);
      const local = l => (l ? { ...l, k: 0, it: originalItems.get(l.it) ?? l.it } : null);
      const original = unit.renderer.townOf(0);
      const out = {
        ...original.out,
        lots: original.out.lots.map(lot),
        forks: original.out.forks.map(lot),
        loops: original.out.loops.map(lot),
      };
      const town = new Proxy(original, { get: (target, key) => (key === 'k' ? k : key === 'out' ? out : target[key]) });
      views.push({ unit, item, lot, local, k, town });
    }
    batches = batchTownInstances(units);
    group.add(batches.group);
    const frustum = new THREE.Frustum(),
      projection = new THREE.Matrix4();
    const bounds = units.map(
      (unit, k) =>
        new THREE.Sphere(
          unit.renderer.centerOf(0),
          Math.max(unit.renderer.extentOf(0) * 1.5, ctx.visibleRadius?.(k) ?? 0),
        ),
    );
    // Distant towns retain their complete statement footprint in one shared batch.
    // A deck and a single tower erased the code layout whenever detail was culled or uploading.
    const overviewGroup = new THREE.Group(),
      geometry = new THREE.BoxGeometry(1, 1, 1),
      overviewLots = units.map(unit => {
        const renderer = unit.renderer,
          frame = renderer.frameOf(0),
          scale = renderer.scaleOf(0);
        return renderer.elementsOf(0).map(lot => {
          const width = lot.bounds?.width ?? scale * 0.6,
            height = lot.bounds?.height ?? scale,
            base = lot.matrix ? new THREE.Vector3().setFromMatrixPosition(lot.matrix) : renderer.worldOfLot(lot),
            normal = frame.normalAt(base),
            east = frame.e.clone().addScaledVector(normal, -frame.e.dot(normal)).normalize(),
            basis = new THREE.Matrix4().makeBasis(east, normal, east.clone().cross(normal)),
            quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
          return new THREE.Matrix4().compose(
            base.addScaledVector(normal, height / 2),
            quaternion,
            new THREE.Vector3(width, height, width),
          );
        });
      });
    overviewGroup.name = 'town-overview';
    const blocks = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: '#c0d1ca', roughness: 0.85 }),
      overviewLots.reduce((n, lots) => n + lots.length, 0),
    );
    blocks.count = 0;
    blocks.frustumCulled = false;
    blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Allocate colour before GPU preparation, even when every town initially uses full detail.
    blocks.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(blocks.instanceMatrix.count * 3).fill(1),
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    overviewGroup.add(blocks);
    const overviewColors = units.map((_, k) => new THREE.Color(ctx.regionColor[k] || '#a7e2b0'));
    const overviewSites = units.map(unit => {
      const renderer = unit.renderer,
        first = renderer.elementsOf(0)[0];
      return {
        base: first ? renderer.worldOfLot(first) : renderer.centerOf(0),
        top: first?.bounds?.height ?? renderer.scaleOf(0),
        side: first?.bounds?.width ?? renderer.scaleOf(0),
      };
    });
    overview = { geometry, meshes: [blocks] };
    group.add(overviewGroup);
    // Every town in view carries its method name like a place name on a map, in its own label budget so names never
    // compete with statement labels; larger methods claim space first. Renderers keep only their callback labels.
    const centre = new THREE.Vector3(),
      toCamera = new THREE.Vector3();
    const townNames = units
      .map((unit, k) => {
        // The sign stands at the town's port, where execution enters the method.
        const renderer = unit.renderer,
          at = (renderer.portOf(0) ?? renderer.centerOf(0)).clone(),
          normal = renderer.frameOf(0).normalAt(at),
          pos = at.addScaledVector(normal, renderer.scaleOf(0) * 0.9);
        return {
          size: renderer.elementsOf(0).length,
          label: {
            text: unit.region.name,
            pos,
            col: '#ffe9b0',
            cls: 'hot town-name',
            avoidOverlap: true,
            group: 'town-names',
            maxVisible: 48,
            visible: () =>
              committed &&
              group.visible &&
              inView.has(k) &&
              normal.dot(toCamera.copy(ctx.T.camera.position).sub(centre.copy(pos)).normalize()) > 0.03,
          },
        };
      })
      .sort((a, b) => b.size - a.size)
      .map(n => n.label);
    const overviewSlots = [],
      detailed = new Set(),
      inView = new Set();
    let selectedTown = -1;
    const sourceIndex = townSourceView(ctx, views);
    const locate = query => {
      const found = sourceIndex.locate(query);
      return { ...found, lot: found.element?.lot ?? null, k: found.element?.town ?? null };
    };
    const lotForLine = (k, line) => {
      const found = locate({ town: k, line });
      if (found.lot) return { ...found.lot, match: found.status };
      const near = api.elementsOf(k).sort((a, b) => Math.abs(a.it.line - line) - Math.abs(b.it.line - line))[0];
      return near ? { ...near, match: 'approximate' } : null;
    };
    const invoke = (name, k, ...args) => units[k]?.renderer[name](0, ...args);
    const each = (name, ...args) => units.forEach(u => u.renderer[name](...args));
    // Label objects belong to their renderer; defer registration until ownership has transferred.
    const api = {
      units,
      group,
      regionCount: units.length,
      flat: false,
      S0: Math.max(0, ...units.map(u => u.renderer.S0)),
      sourceTokens: fresh.sourceTokens ?? null,
      sourceIndex,
      locate,
      rangeOf: id => sourceIndex.rangeOf(id),
      lotForLine,
      labels: units.flatMap(unit => unit.labels),
      pickables: [...batches.pickables, ...units.flatMap(u => u.renderer.pickables.filter(m => !m.isInstancedMesh))],
      release(unit) {
        owned.delete(unit);
      },
      commit() {
        if (committed || disposed) return;
        committed = true;
        for (const [k, unit] of units.entries()) {
          unit.sourceItem = views[k].item;
          previous?.release(unit);
          owned.add(unit);
          unit.host = ctx.T;
          unit.removeLabels ??= ctx.T.addLabels(unit.labels, unit);
          group.add(unit.scene);
        }
        disposeTownNames = ctx.T.addLabels(townNames, null, 5);
        api.frame(0);
        group.visible = true;
      },
      isVisible: k => units[k]?.scene.visible ?? false,
      // Semantic overlays use camera/horizon visibility, independent of town LOD.
      isInView: k => inView.has(k),
      overviewSite: k => (inView.has(k) && !units[k]?.scene.visible ? overviewSites[k] : null),
      // Finish the current upload, then service explicit navigation before background towns.
      prepare: k => (units[k] ? prepareUnit(units[k], true) : Promise.resolve()),
      frame(t) {
        // Rendering temporarily splits camera depth into near/far slices. Cull against the current full camera.
        ctx.T.sync();
        frustum.setFromProjectionMatrix(
          projection.multiplyMatrices(ctx.T.camera.projectionMatrix, ctx.T.camera.matrixWorldInverse),
        );
        const camera = ctx.T.camera.position,
          distance = camera.length();
        const focal =
          (ctx.T.controls.domElement.clientHeight || 800) / (2 * Math.tan((ctx.T.camera.fov * Math.PI) / 360));
        const candidates = [];
        inView.clear();
        units.forEach((unit, k) => {
          const sphere = bounds[k],
            facing = sphere.center.dot(camera) > sphere.center.lengthSq() - sphere.radius * distance,
            visible = facing && frustum.intersectsSphere(sphere),
            pixels =
              ((unit.renderer.frameOf(0).size ?? Math.max(0.05, unit.renderer.extentOf(0) * 2)) * focal) /
              Math.max(0.001, camera.distanceTo(sphere.center));
          if (visible) inView.add(k);
          if (visible && (k === selectedTown || pixels > (detailed.has(k) ? DETAIL.leave : DETAIL.enter)))
            candidates.push({ k, pixels });
        });
        candidates.sort((a, b) => Number(b.k === selectedTown) - Number(a.k === selectedTown) || b.pixels - a.pixels);
        detailed.clear();
        candidates.slice(0, DETAIL.max).forEach(c => detailed.add(c.k));
        blocks.count = 0;
        overviewSlots.length = 0;
        units.forEach((unit, k) => {
          const visible = inView.has(k);
          const wanted = visible && detailed.has(k);
          if (wanted && !unit.gpuReady)
            void prepareUnit(unit, k === selectedTown).catch(error => {
              if (!unit.controller.signal.aborted) console.warn('Town preparation failed', error);
            });
          const full = wanted && unit.gpuReady;
          unit.scene.visible = unit.renderer.group.visible = full;
          ctx.onVisibility?.(k, full);
          if (full) unit.renderer.frame(t);
          else if (visible) {
            for (const matrix of overviewLots[k]) {
              blocks.setMatrixAt(blocks.count, matrix);
              blocks.setColorAt(blocks.count++, overviewColors[k]);
            }
            overviewSlots.push(k);
          }
        });
        batches.update(t);
        blocks.instanceMatrix.needsUpdate = true;
        if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
      },
      overviewSnapshot: () => ({
        detailed: [...detailed].filter(k => units[k].scene.visible),
        preparing: [...detailed].filter(k => !units[k].gpuReady),
        towns: [...overviewSlots],
        batches: 1,
      }),
      setFocus(k, line, deps, element) {
        selectedTown = k;
        units.forEach((u, i) =>
          u.renderer.setFocus(
            i === k ? 0 : -1,
            i === k ? line : null,
            deps,
            i === k ? views[i].local(element ?? (line == null ? null : lotForLine(k, line))) : null,
          ),
        );
      },
      setHover(info) {
        units.forEach((u, i) =>
          u.renderer.setHover(info?.k === i ? { ...info, k: 0, it: views[i].local(info).it } : null),
        );
      },
      setDebug: enabled => each('setDebug', enabled),
      setDetailLabels: enabled => each('setDetailLabels', enabled),
      previewFactory: (l, ...args) => l && units[l.k].renderer.previewFactory(views[l.k].local(l), ...args),
      elementsOf: k => units[k]?.renderer.elementsOf(0).map(views[k].lot) ?? [],
      townOf: k => views[k]?.town,
      pick(hit) {
        const slot = hit.object.userData.townBatchSlots?.[hit.instanceId];
        if (slot) hit = { ...hit, ...slot };
        for (const view of views) {
          if (!view.unit.renderer.pickables.includes(hit.object)) continue;
          const hitInfo = view.unit.renderer.pick(hit);
          return (
            hitInfo && {
              ...hitInfo,
              k: view.k,
              ...(hitInfo.it ? { it: view.item(hitInfo.it) } : {}),
              ...(hitInfo.lot ? { lot: view.lot(hitInfo.lot) } : {}),
            }
          );
        }
        return null;
      },
      worldOfLot: l => units[l.k].renderer.worldOfLot(views[l.k].local(l)),
      heatLot: (l, size) => l && units[l.k].renderer.heatLot(views[l.k].local(l), size),
      reserveDock: k => {
        const dock = invoke('reserveDock', k);
        return dock && { ...dock, k, unit: units[k], local: dock };
      },
      releaseDock: dock => dock?.unit.renderer.releaseDock(dock.local),
      portState: () =>
        units.flatMap((u, k) => u.renderer.portState().map(p => ({ ...p, k, near: p.near && u.scene.visible }))),
      capitalK: ctx.regions.findIndex(r => r.kind === 'ctor'),
      lines: [],
      dispose,
    };
    for (const name of [
      'centerOf',
      'extentOf',
      'stationOf',
      'portOf',
      'launchOf',
      'docksOf',
      'poseDock',
      'previewDock',
      'frameOf',
      'scaleOf',
    ])
      api[name] = (k, ...args) => invoke(name, k, ...args);
    const pairs = new Map();
    for (const route of callRoutes(ctx.regions, { file: ctx.file })) {
      const a = ctx.regions.findIndex(r => r.id === route.from.town),
        b = ctx.regions.findIndex(r => r.id === route.to.town);
      if (a < 0 || b < 0 || a === b) continue;
      const id = [Math.min(a, b), Math.max(a, b)].join(':');
      if (!pairs.has(id)) pairs.set(id, { a: Math.min(a, b), b: Math.max(a, b), calls: [] });
      pairs.get(id).calls.push({ from: a, to: b, n: 1 });
    }
    api.lines = [...pairs.values()];
    await ctx.T.prepareDraw(batches.group, checkpoint);
    await ctx.T.prepareDraw(overviewGroup, checkpoint);
    return api;
  } catch (error) {
    dispose();
    throw error;
  }
}
