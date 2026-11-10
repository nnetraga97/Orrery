// Owns the towns entry point, build lifetime, labels, interaction, and public API.
// Towns: every method region on a planet becomes a town built from its control flow, using Kenney's CC0 kits.
// The method body, read top to bottom, is the main road: statements are buildings in source order, if forks the road,
// loops are ring roads with a marker on selection, return is a gate, throw is a crater. Towns are linked by persistent directed call routes, the constructor's town is the capital with utilities piped to field users,
// edited lines get cranes.
// Usage (from planet.js): buildTowns(ctx) → { group, labels, pickables, pick, frame, lotForLine, worldOfLot, ... }

import * as THREE from 'three';
import { loadKit, loadTreeSitter, prepareTownKit } from './town-assets.js';
import { prepareTowns } from './town-preparation.js';
import { buildTownGround } from './town-ground.js';
import { placeTownModels } from './town-placement.js';
import { roadDetailVisible } from './town-layout.js';
import { planetBuildBudget } from '../shared/build-budget.js';
import { LANGUAGES, languageOf } from '../../source-model/languages.js';
import { RiggedAssets } from '../scene/rigged-assets.js';
import { loadTownPortAsset } from './town-port-rig.js';
import { STATEMENT_TYPES, statementType } from '../shared/town-flow.js';
import { createSourceIndex } from '../../source-model/source-index.js';

export { KIT, loadModel, loadTypeScript } from './town-assets.js';
export { smoothPath } from './road-ribbon.js';

// ---------- 4. towns on every region ----------
// ctx: { T, R, source, regions, centerOf, shapeOf, groundAt(dir), diffLines, signal, surface? }
// maxScale[k] optionally sets the packing ceiling on flat surfaces only.
// surface supplies frame(k) (world, normalAt, altitude, dirAt, basis, roof); absent means sphere.
export async function buildTowns(ctx) {
  const { T, R, source, regions } = ctx;
  const sourceItem = it => ctx.sourceItem?.(it) ?? it;
  // The analyzer records the language it parsed with (a C++ project's .h headers are C++).
  const language = LANGUAGES.find(l => l.id === ctx.language) || languageOf(ctx.file);
  const [parsed, kit, portAsset] = await Promise.all([
    language && language.frontEnd !== 'typescript' ? loadTreeSitter(language) : Promise.resolve(null),
    ctx.prepareOnly ? Promise.resolve({}) : loadKit(),
    loadTownPortAsset().catch(error => {
      console.warn('Using kit landing-pad fallback', error);
      return null;
    }),
  ]);
  if (ctx.signal?.aborted) throw new DOMException('Planet build cancelled', 'AbortError');
  const sourceTree = !ctx.prepared && parsed && source ? parsed.parse(source) : null,
    sourceTokens = sourceTree ? parsed.tokens(sourceTree) : null;
  const group = new THREE.Group();
  T.scene.add(group);
  const build = {
    ctx,
    group,
    disposables: [],
    focusBatches: [],
    towns: [],
    pickables: [],
    pickMap: new Map(),
    labels: [],
    portFleet: null,
    checkpoint: ctx.checkpoint ?? planetBuildBudget(ctx.signal),
  };
  const { disposables, focusBatches, towns, pickables, pickMap, labels, checkpoint } = build;
  const dependencyMeshes = [];
  let disposed = false,
    treeReleased = false,
    factoryRig = null,
    factorySerial = 0,
    factoryTarget = null,
    factoryTime = 0,
    clearFactory = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearFactory();
    build.portFleet?.dispose();
    T.scene.remove(group);
    disposables.forEach(d => d.dispose?.());
    group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
    });
    if (!treeReleased) {
      sourceTree?.delete();
      treeReleased = true;
    }
    ctx.signal?.removeEventListener('abort', dispose);
  };
  ctx.signal?.addEventListener('abort', dispose, { once: true });
  try {
    await prepareTownKit(build, kit);
    const prepared = await prepareTowns(build, { sourceTree, sourceTokens, parsed, portAsset });
    if (ctx.prepareOnly) {
      dispose();
      return prepared;
    }
    sourceTree?.delete();
    treeReleased = true;
    const ground = await buildTownGround(build);
    const {
      orient,
      lotTime,
      lotDriver,
      riggedBatches,
      semanticInstances,
      loopMarker,
      SM,
      portOf,
      launchOf,
      lines,
      capitalK,
    } = await placeTownModels(build, kit, portAsset);

    let debugLayers = false,
      focusedElement = null;
    let focusedRegion = -1,
      focusedLine = null,
      focusedScope = null,
      hoveredRegion = -1,
      hoveredScope = null,
      dependencies = false;
    const updateRoadLOD = () => ground.updateRoadLOD({ focusedRegion, focusedScope, hoveredRegion, hoveredScope });

    // A stack is not an execution trace: do not invent an animated route through statements.
    // Neighbourhood labels (only near their town).
    let detailLabels = false;
    towns.forEach(tw => {
      const c = tw.fr.world(0, 0);
      const seen = new Set();
      tw.out.hoodLabels.forEach(h => {
        const first = !seen.has(h.scope);
        seen.add(h.scope);

        labels.push({
          text: h.name.length > 34 ? h.name.slice(0, 32) + '…' : h.name,
          pos: tw.fr.world(h.at[0], h.at[1], 0.9 * tw.s),
          col: '#ffe9b0',
          cls: 'hot',
          planDetail: !first || /callback|^\s*\*/i.test(h.name),
          avoidOverlap: true,
          group: 'planet-detail',
          maxVisible: 6,
          // Planets name every town's entry themselves (incremental-towns.js), at every distance.
          visible: () =>
            !(ctx.planetNames && first && !h.nested) &&
            (tw.roadExpanded || (first && !/callback|^\s*\*/i.test(h.name))) &&
            (first || (tw.expanded && detailLabels)) &&
            (!tw.expanded || detailLabels || tw.k === focusedRegion) &&
            T.camera.position.distanceTo(c) < R * 3 &&
            tw.fr.normalAt(c).dot(T.camera.position.clone().sub(c).normalize()) > 0.2,
        });
      });
    });

    clearFactory = () => {
      factorySerial++;
      factoryTarget = null;
      if (!factoryRig) return;
      const { rig, lot, meshes } = factoryRig;
      lot.instance.mesh.setMatrixAt(
        lot.instance.index,
        towns[lot.k].expanded ? lot.matrix : lot.matrix.clone().scale(new THREE.Vector3(0, 0, 0)),
      );
      lot.instance.mesh.instanceMatrix.needsUpdate = true;
      meshes.forEach(mesh => {
        const index = pickables.indexOf(mesh);
        if (index >= 0) pickables.splice(index, 1);
      });
      rig.dispose();
      factoryRig = null;
    };
    async function inspectFactory(lot) {
      const target = lot?.role === 'office' && lot.instance ? `${lot.k}:${lot.it.line}` : null;
      if (target === factoryTarget) return factoryRig;
      clearFactory();
      if (!target) return null;
      factoryTarget = target;
      const serial = factorySerial;
      let rig;
      try {
        rig = await RiggedAssets.create('factory');
      } catch (error) {
        if (serial === factorySerial) factoryTarget = null;
        console.warn('Factory rig unavailable', error);
        return null;
      }
      if (disposed || serial !== factorySerial) {
        rig.dispose();
        return null;
      }
      lot.matrix.decompose(rig.root.position, rig.root.quaternion, rig.root.scale);
      rig.sample('Standby', 0);
      group.add(rig.root);
      const meshes = [];
      rig.root.traverse(mesh => {
        if (mesh.isMesh) {
          mesh.userData.townPick = { k: lot.k, it: lot.it, lot, style: 'office' };
          meshes.push(mesh);
          pickables.push(mesh);
        }
      });
      lot.instance.mesh.setMatrixAt(lot.instance.index, lot.matrix.clone().scale(new THREE.Vector3(0, 0, 0)));
      lot.instance.mesh.instanceMatrix.needsUpdate = true;
      factoryRig = { rig, lot, meshes, started: null };
      return factoryRig;
    }
    const previewFactory = async lot => {
      // Replace a pending selection; the cached fetch is shared and its stale clone is disposed.
      if (factoryTarget && !factoryRig) {
        clearFactory();
      }
      const selected = await inspectFactory(lot);
      if (selected) selected.started = factoryTime;
    };
    // Agent hits heat a lot: one hit makes it active, a quick run of hits makes it hot.
    // Heat cools by one unit every eight seconds back to the lot's baseline.
    const heated = new Set();
    const heatLot = (lot, amount = 1) => {
      const h = lot?.motion;
      if (!h) return false;
      h.heat = Math.min(4, (h.heat || 0) + amount);
      heated.add(h);
      return true;
    };
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const visiblePlacement = p => !p.pick?.it || p.pick.it.kind === 'entry' || towns[p.k].expanded;
    const updateDetail = () => {
      let changed = false;
      for (const tw of towns) {
        const distance = T.camera.position.distanceTo(tw.fr.world(0, 0)),
          expanded =
            ctx.surface?.flat ||
            tw.k === focusedRegion ||
            distance < Math.max(tw.s * (tw.expanded ? 26 : 23), (tw.extent ?? 0) * (tw.expanded ? 8 : 7.2)),
          roadExpanded =
            ctx.roadDetail?.(tw.k) ??
            roadDetailVisible({
              distance,
              scale: tw.s,
              extent: tw.extent,
              expanded: tw.roadExpanded,
              focused: tw.k === focusedRegion,
              line: focusedLine,
              flat: !!ctx.surface?.flat,
            });
        if (tw.roadExpanded !== roadExpanded) {
          tw.roadExpanded = roadExpanded;
          changed = true;
        }
        if (tw.expanded !== expanded) {
          tw.expanded = expanded;
          changed = true;
        }
      }
      if (!changed) return;
      updateRoadLOD();
      for (const { inst, list } of semanticInstances) {
        list.forEach((p, i) => {
          if (p.pick?.it) inst.setMatrixAt(i, visiblePlacement(p) ? p.matrix : hiddenMatrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.boundingSphere = null;
      }
    };
    let lastFrame = null;
    const frame = t => {
      const dt = lastFrame == null ? 0 : Math.min(0.1, t - lastFrame);
      lastFrame = t;
      updateDetail();
      lotTime.value = t;
      for (const h of heated) {
        h.heat = Math.max(0, h.heat - dt / 8);
        lotDriver.set(h, h.heat > 2 ? 2 : h.heat > 0 ? Math.max(h.base, 1) : h.base);
        if (!h.heat) heated.delete(h);
      }
      lotDriver.step(dt);
      if (group.visible) build.portFleet?.step(dt, T.camera, focusedRegion);
      if (group.visible) riggedBatches.forEach(r => r.update(T.camera, i => visiblePlacement(r.list[i])));
      factoryTime = t;
      if (!factoryRig || !group.visible) return;
      const { rig, started } = factoryRig;
      if (started != null && t - started < rig.clips.get('Production cycle').duration)
        rig.sample('Production cycle', t - started);
      else {
        factoryRig.started = null;
        rig.sample('Standby', t, true);
      }
    };

    // One source index for the file's revision: towns and every statement element (lots, forks, loops), with source
    // offsets where the analysis has them (source-model/source-index.js).
    const seenItems = new Set();
    const sourceIndex = createSourceIndex({
      file: ctx.file,
      revision: ctx.revision ?? null,
      source: source ?? null,
      elements: [
        ...regions.map((r, k) => ({
          id: r.id || `town:${k}`,
          kind: 'town',
          town: k,
          line: r.start,
          end: r.end,
          sourceStart: r.sourceStart,
          sourceEnd: r.sourceEnd,
        })),
        ...towns.flatMap(tw =>
          [...tw.out.lots, ...tw.out.forks, ...tw.out.loops]
            .filter(l => !seenItems.has(l.it) && seenItems.add(l.it))
            .map((l, j) => ({
              id: l.it.id || `town:${tw.k}/element:${j}`,
              kind: 'statement',
              town: tw.k,
              line: l.it.line,
              end: l.it.end ?? l.it.line,
              sourceStart: l.it.sourceStart,
              sourceEnd: l.it.sourceEnd,
              lot: { ...l, k: tw.k },
            })),
        ),
      ],
    });
    // A location in the world: the statement element when one holds it, else the town, else nothing (I-6).
    const locate = query => {
      const found = sourceIndex.locate(query);
      return { ...found, lot: found.element?.lot ?? null, k: found.element?.town ?? null };
    };
    // Browsing only (inspector clicks, flashes): the containing element, else the nearest, labelled with its match.
    const lotForLine = (k, line) => {
      if (!towns[k]) return null;
      const found = sourceIndex.locate({ line, town: k });
      if (found.element?.lot) return { ...found.element.lot, match: found.status };
      const near = elementsOf(k).sort((a, b) => Math.abs(a.it.line - line) - Math.abs(b.it.line - line))[0];
      return near ? { ...near, match: 'approximate' } : null;
    };
    const elementsOf = k => {
      const tw = towns[k];
      return [...tw.out.lots, ...tw.out.forks, ...tw.out.loops]
        .map(l => ({ ...l, k }))
        .sort((a, b) => a.it.line - b.it.line || a.it.end - b.it.end);
    };
    const selectionGeometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const selectionEdges = new THREE.EdgesGeometry(selectionGeometry);
    selectionGeometry.dispose();
    const selectionMaterial = new THREE.LineBasicMaterial({
      color: '#e2f3ff',
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const selectedOutline = new THREE.LineSegments(selectionEdges, selectionMaterial);
    selectedOutline.visible = false;
    selectedOutline.renderOrder = 20;
    group.add(selectedOutline);
    disposables.push(selectionEdges, selectionMaterial);
    let selectedPosition = new THREE.Vector3();
    const selectionLabel = {
      text: '',
      pos: () => selectedPosition,
      col: '#e7f4ff',
      cls: 'statement-label',
      avoidOverlap: true,
      visible: () => focusedLine != null,
    };
    labels.push(selectionLabel);
    // The label's text is updated through its DOM reference by scene3D.
    const setFocus = (k, line = null, showDependencies = dependencies, element = null) => {
      focusedRegion = k;
      focusedLine = line;
      focusedElement = element;
      const lot = element || (line == null ? null : lotForLine(k, line));
      focusedScope = lot?.it._co?.c.scope ?? null;
      updateDetail();
      updateRoadLOD();
      dependencies = showDependencies;

      dependencyMeshes.forEach(({ mesh, a, b }) => {
        mesh.visible = dependencies && (a === k || b === k);
      });
      ground.setRoadFocus(k);
      focusBatches.forEach(({ inst, list }) => {
        list.forEach((p, i) =>
          inst.setColorAt(i, new THREE.Color(ctx.surface?.flat || p.k === k ? '#ffffff' : '#bfd1c5')),
        );
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      });
      void inspectFactory(lot);
      selectedOutline.visible = !!lot && lot.it.t !== 'loop';
      loopMarker.visible = lot?.it.t === 'loop';
      if (loopMarker.visible) {
        const tw = towns[k],
          p = tw.fr.world(lot.x, lot.y, tw.s * 0.13 + tw.liftAt(lot.x, lot.y));
        loopMarker.position.copy(p);
        loopMarker.quaternion.copy(orient(tw.fr, p, 0));
        loopMarker.scale.setScalar(tw.s);
      }
      if (lot) {
        const tw = towns[k],
          p = tw.fr.world(lot.x, lot.y, tw.s * 0.1 + tw.liftAt(lot.x, lot.y));
        if (debugLayers) p.addScaledVector(tw.fr.n0, tw.s * 0.6);
        selectedOutline.position.copy(p);
        selectedOutline.quaternion.copy(orient(tw.fr, p, 0));
        const width = lot.bounds?.width || tw.s * 0.6,
          height = lot.bounds?.height || tw.s;
        selectedOutline.scale.set(width * 1.2, height + tw.s * 0.1, width * 1.2);
        selectedPosition = tw.fr.world(lot.x, lot.y, height + tw.s * 0.4 + tw.liftAt(lot.x, lot.y));
        if (debugLayers) selectedPosition.addScaledVector(tw.fr.n0, tw.s * 0.6);
        const code = (lot.it.summary || '').trim();
        selectionLabel.text =
          `L${sourceItem(lot.it).line} · ${STATEMENT_TYPES[statementType(lot.it)].label}` +
          (code ? ` · ${code.length > 46 ? code.slice(0, 45) + '…' : code}` : '');
      }
    };
    towns.forEach(tw =>
      elementsOf(tw.k).forEach(l => {
        // Loops are labelled too: a ring road around a long body is the loop, and its header says what it iterates.
        if (!['branch', 'loop', 'call', 'throw', 'return'].includes(statementType(l.it))) return;
        const p = tw.fr.world(l.x, l.y, tw.s * 0.95);
        labels.push({
          get text() {
            return `${STATEMENT_TYPES[statementType(l.it)].glyph} L${sourceItem(l.it).line} ${(l.it.summary || l.it.kind || '').slice(0, 45)}`;
          },
          pos: p,
          col: STATEMENT_TYPES[statementType(l.it)].color,
          cls: 'code-label',
          planDetail: true,
          avoidOverlap: true,
          // Any town close enough to draw in full names its buildings, not only the selected one; statements have
          // their own budget so method names and arms never crowd them out.
          group: 'statements',
          maxVisible: 16,
          visible: () =>
            detailLabels &&
            (focusedRegion === tw.k || tw.expanded) &&
            focusedLine !== sourceItem(l.it).line &&
            // About when a building is ~18 px on screen; overlap avoidance and the budget keep it readable.
            T.camera.position.distanceTo(p) < tw.s * 60 &&
            (ctx.surface ? tw.fr.normalAt(p) : tw.fr.n0).dot(T.camera.position.clone().sub(p).normalize()) > 0.2,
        });
      }),
    );
    towns.forEach(tw =>
      tw.out.forks
        .filter(f => f.arms)
        .forEach(f =>
          Object.entries(f.arms).forEach(([name, at]) => {
            const p = tw.fr.world(at[0], at[1], tw.s * 0.25);
            labels.push({
              text: name,
              pos: p,
              col: name === 'then' ? '#8bc5e7' : '#c9a1df',
              cls: 'code-label',
              planDetail: true,
              avoidOverlap: true,
              group: 'statements',
              maxVisible: 16,
              visible: () =>
                detailLabels && (focusedRegion === tw.k || tw.expanded) && T.camera.position.distanceTo(p) < tw.s * 23,
            });
          }),
        ),
    );
    setFocus(-1);
    await checkpoint();
    group.visible = true;
    return {
      setFocus,
      setHover: info => {
        const scope = info?.it?._co?.c.scope ?? null,
          k = scope == null ? -1 : info.k;
        if (k === hoveredRegion && scope === hoveredScope) return;
        hoveredRegion = k;
        hoveredScope = scope;
        updateRoadLOD();
      },
      setDebug: enabled => {
        debugLayers = enabled;
        setFocus(focusedRegion, focusedLine, dependencies, focusedElement);
      },
      setDetailLabels: enabled => {
        detailLabels = enabled;
      },
      previewFactory,
      elementsOf,
      sourceTokens,
      townOf: k => towns[k],
      regionCount: towns.length,
      group,
      labels,
      pickables,
      frame,
      S0: SM,
      pick: hit => {
        const k = hit.object.userData.portRegions?.[hit.instanceId];
        return k != null
          ? { k, style: 'port' }
          : hit.object.userData.townPick || pickMap.get(hit.object.uuid + ':' + hit.instanceId) || null;
      },
      centerOf: k => towns[k].fr.world(0, 0),
      extentOf: k => towns[k].extent,
      stationOf: k => portOf[k],
      portOf: k => portOf[k],
      launchOf: k => launchOf[k],
      docksOf: k => build.portFleet?.docks(k) || [],
      reserveDock: k => build.portFleet?.reserve(k) || null,
      releaseDock: dock => build.portFleet?.release(dock),
      poseDock: (k, index, seconds) => build.portFleet?.poseDock(k, index, seconds),
      previewDock: (k, index) => build.portFleet?.preview(k, index),
      portState: () => build.portFleet?.snapshot() || [],
      flat: !!ctx.surface?.flat,
      frameOf: k => towns[k].fr,
      worldOfLot: l =>
        towns[l.k].fr.world(l.x, l.y, 0.3 * towns[l.k].s + (ctx.surface ? 0 : towns[l.k].liftAt(l.x, l.y))),
      scaleOf: k => towns[k].s,
      lotForLine,
      locate,
      rangeOf: id => sourceIndex.rangeOf(id),
      sourceIndex,
      heatLot,
      lines: [...lines.values()],
      capitalK,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
