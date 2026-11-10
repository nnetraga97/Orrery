// Owns detail build sequencing, inspector wiring, revision publication and inspection API.
import * as THREE from 'three';
import { buildPlanetSurface } from './planet-scene.js';
import { createPlanetInteraction, planetAgentActions } from './planet-interaction.js';
import { createPlanetDebug } from './planet-debug.js';

export async function buildPlanetDetail(ctx, sym, source, model, options) {
  const { T, host, n, revision, R, detail, buildAbort, loading, preparedCache, ctl, appearance } = ctx;
  const { previous, publish, bodyKind, selection, land, focusLine, townId, arrival, navigationAtStart } = options;
  const world = await buildPlanetSurface(ctx, sym, source, model, options);
  if (!world) return null;
  const {
    regions,
    terrain,
    terrainKey,
    centerOf,
    regionColor,
    surfacePoint,
    groundRadius,
    body,
    importerCalls,
    moonDecls,
    routes,
    loadingInfo,
  } = world;
  sym = world.sym;
  const interaction = createPlanetInteraction(ctx, world, options);
  const { centerPort, pin, selectStatement, viewOf, focus } = interaction;
  ctx.goToTown = k => {
    pin(k);
    const v = viewOf(k);
    T.flyTo(v.target, 0, { cam: v.cam, arc: true });
  };
  const colored = await host.inspector.highlightSource(n, source || '', ctx.towns, buildAbort.signal);
  const mapPaths = terrain.mapPaths;
  if (loadingInfo) loadingInfo.textContent = ctx.towns ? '' : 'Source unavailable · showing method regions only';
  ctx.towns?.commit();
  publish?.();
  ctl.ready = true;
  const debug = createPlanetDebug(ctx, world, interaction);
  const { setEvidence, selectEvidence, showGitChanges, setStack, selectStackFrame } = debug;
  ctx.inspector = host.inspector.create({
    onOpenSource: point => host.source.open({ file: n.path, text: source, ...point }, revision),
    colored,
    file: n,
    regions,
    source,
    towns: ctx.towns,
    mapPaths,
    types: moonDecls,
    analysis: { ...window.DATASETS?.[host.data.dataset()]?.analysis, ...sym?.analysis },
    regionColors: regionColor,
    routes,
    traffic: ctx.traffic,
    portTraffic: ctx.portTraffic,
    onDebugLayers: value => ctx.debugView?.set(value),
    onCallShips: enabled => ctx.callLayer?.animate(enabled),
    onStackLoad: setStack,
    onStackFrame: selectStackFrame,
    onStackVisible: enabled => ctx.stackLayer?.show(enabled),
    onEvidenceLoad: records => setEvidence('loaded', records),
    onEvidenceSelect: selectEvidence,
    onEvidenceVisible: enabled => ctx.evidence?.show(enabled),
    onGitChanges: showGitChanges,
    onPlan: enabled => ctx.plan?.setEnabled(enabled, detail.pinnedRegion),
    onPort: k => centerPort(k ?? detail.pinnedRegion),
    frame: () => T.frame(),
    regionCenter: k => (ctx.towns ? ctx.towns.centerOf(k) : surfacePoint(centerOf[k], k, 0)),
    onCancelTransport: () => ctx.transport?.cancel(),
    onTransport: (route, travel) => {
      if (!ctx.transport || !route.canFly) return;
      const k = detail.pinnedRegion;
      centerPort(k);
      ctx.transport.play(k, route, {
        onComplete: travel
          ? () => host.actions.enterPlanet(route.target, { arrival: { path: n.path, method: regions[k].name } })
          : undefined,
      });
    },
    imports: new Set(host.data.nodes().map(x => x.path)),
    callers: k => (importerCalls.get(k) || []).map(j => host.data.nodes()[j].path),
    onMethod: k => {
      pin(k);
      const l = ctx.towns?.elementsOf(k)[0];
      if (l) selectStatement(l, false);
    },
    onStatement: (l, pan) => {
      selectStatement(l, pan, true);
    },
    onInspect: () => {
      if (detail.selectedElement)
        T.flyTo(
          ctx.towns.worldOfLot(detail.selectedElement),
          Math.max(0.35, ctx.towns.scaleOf(detail.pinnedRegion) * 10),
        );
    },
    onDependencies: show => {
      detail.dependencies = show;
      ctx.towns?.setFocus(detail.pinnedRegion, detail.selectedLine, show, detail.selectedElement);
    },
    onPlanetFit: () => {
      T.flyTo(new THREE.Vector3(), R * 3, { arc: true });
    },
    onFit: () => {
      const v = viewOf(detail.pinnedRegion);
      T.flyTo(v.target, 0, { cam: v.cam, arc: true });
    },
    onImport: path => host.actions.enterPlanet(host.data.nodes().findIndex(x => x.path === path)),
  });
  if (previous?.evidence) {
    for (const from of ['loaded'])
      if (previous.evidence.records(from).length) setEvidence(from, previous.evidence.records(from));
    if (previous.evidence.records('git').length) showGitChanges(true).catch(() => {});
  }
  if (previous?.stackLayer?.records.length) {
    setStack(previous.stackLayer.records);
    ctx.stackLayer.select(previous.stackLayer.selected);
    ctx.stackLayer.show(previous.stackLayer.group.visible);
    ctx.inspector.stackChanged(ctx.stackLayer.rows, ctx.stackLayer.selected, ctx.stackLayer.group.visible);
  }
  focus(
    focusLine ?? ctx.towns?.rangeOf(selection?.element)?.line ?? null,
    (land || focusLine != null) && T.navigationRevision === navigationAtStart,
    false,
    townId,
  );
  loading?.update('Preparing the selected town…');
  if (ctx.towns) await ctx.towns.prepare(detail.pinnedRegion);
  if (detail.stopped) return null;
  if (arrival && ctx.transport) {
    // A file dependency does not resolve a receiver. Use a public navigation port,
    // label that choice explicitly, and never imply this town was called.
    const k = regions.findIndex(r => r.vis === 'public' && r.kind !== 'group');
    pin(k < 0 ? 0 : k, { fly: false });
    ctx.inspector.setTab('transport');
    centerPort(detail.pinnedRegion);
    ctx.transport.play(
      detail.pinnedRegion,
      { path: arrival.path, arrival: true },
      { arrival: true, onComplete: () => centerPort(detail.pinnedRegion) },
    );
  } else if (arrival) {
    ctx.inspector.setTab('transport');
    ctx.inspector.transportStatus({
      phase: 'file opened; source unavailable for landing',
      route: { path: arrival.path, arrival: true },
    });
  }
  const agentActions = planetAgentActions(ctx, world, interaction);
  Object.assign(ctl, {
    inspection: {
      towns: ctx.towns,
      traffic: ctx.traffic,
      transport: ctx.transport,
      portTraffic: ctx.portTraffic,
      regions,
      callLayer: ctx.callLayer,
      stackLayer: ctx.stackLayer,
      stepCar: ctx.stepCar,
      evidence: ctx.evidence,
      runtimeMarkers: ctx.runtimeMarkers,
      host: T,
      terrain,
      terrainKey,
      groundRadius,
      body,
      asset: appearance.id,
      bodyKind,
      preparedCache,
      debugView: ctx.debugView,
      revision,
    },
    setStack,
    selectStackFrame,
    invalidateRevision: debug.invalidateRevision,
    locate: query => ctx.towns?.locate({ revision: host.data.revision(), ...query }) ?? null,
    rangeOf: id => ctx.towns?.rangeOf(id) ?? null,
    ...agentActions,
  });
  if (loading) {
    await host.loading.paint();
    loading.finish();
  }
  return { ...interaction.sourceAPI, ...debug.runtime };
}
