// Source inspection on a planet, shown in context windows (../context-windows.tsx) beside what you point at:
// a method region → method window, a building / fork / loop → statement window, a spaceport or landing pad → transport
// window, a station → its call connections. Hovering previews; clicking pins. The toolbar, file map and
// statement-type key stay over the canvas. No inferred runtime values or paths.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Vector3 } from 'three';
import { callsMember } from '../../shared/town-flow.js';
import { ctxWin, worldAnchor, type CtxSpec } from '../context-windows.tsx';
import { createSharedPieces, type Rec, type Lot, type Segment } from './planet-inspector/shared.tsx';
import { createMethodSection } from './planet-inspector/MethodSection.tsx';
import { createStatementSection } from './planet-inspector/StatementSection.tsx';
import { createTransportSection } from './planet-inspector/TransportSection.tsx';
import { createToolbarSection } from './planet-inspector/ToolbarSection.tsx';
import { createDebugSection } from './planet-inspector/DebugSection.tsx';
import { createMapSection } from './planet-inspector/MapSection.tsx';

export { highlightPlanetSource } from './planet-inspector/shared.tsx';

export function createPlanetInspector(ctx: Rec) {
  const {
    file,
    regions,
    source,
    towns,
    onMethod,
    onStatement,
    onDependencies,
    onFit,
    onInspect,
    mapPaths,
    imports = new Map(),
    callers = () => [],
    changedLines = [],
    analysis = {},
  } = ctx as Rec;
  const sourceLines: string[] = (source || '').split('\n');
  const colored: Segment[][] = ctx.colored ?? sourceLines.map(text => [{ text }]);
  const districtOf = (r: Rec): Rec =>
    r.district || {
      id: r.owner || 'module',
      name: r.owner || 'Module',
      reason: 'Members share this declaration owner.',
    };
  const neighborhoods = new Set(regions.map((r: Rec) => r.neighborhood?.id).filter(Boolean));
  const districts = new Map<string, Rec>();
  regions.forEach((r: Rec, i: number) => {
    const d = districtOf(r);
    if (!districts.has(d.id)) districts.set(d.id, { ...d, regions: [] });
    districts.get(d.id)!.regions.push(i);
  });
  const membersOf = (r: Rec): Rec[] => r.members || [r];
  const byId = new Map<string, number>();
  regions.forEach((r: Rec, i: number) => {
    if (r.id) byId.set(r.id, i);
    membersOf(r).forEach(m => {
      if (m.id) byId.set(m.id, i);
    });
  });
  const diagnostics: Rec[] = Array.isArray(analysis.diagnostics) ? analysis.diagnostics : [];
  const limitations: string[] = Array.isArray(analysis.limitations) ? analysis.limitations : [];

  // Only identities supplied by source analysis form resolved edges. Unknown receivers never fall back to a name match.
  const targetIndex = (c: Rec) =>
    byId.get(c.targetId || c.id || (typeof c.target === 'string' && byId.has(c.target) ? c.target : ''));
  const schemaCalls = (r: Rec): Rec[] | null => {
    const modeled = r.analysisStatus != null || membersOf(r).some(m => m.analysisStatus != null || m.flow);
    if (!modeled && !(r.callTargets || []).length) return null; // Legacy Java retains owner/arity links.
    return Array.isArray(r.callTargets) ? r.callTargets : membersOf(r).flatMap(m => m.callTargets || []);
  };
  const hasCall = (caller: Rec, target: Rec) => {
    const links = schemaCalls(caller);
    if (links) return links.some(c => targetIndex(c) === regions.indexOf(target));
    return (
      caller.owner === target.owner &&
      (caller.sigs || caller.selfCalls) &&
      membersOf(target).some(m => callsMember(caller, m))
    );
  };
  const callsOf = (k: number) => {
    const r = regions[k],
      all = regions.map((x: Rec, i: number) => ({ x, i }));
    return {
      out: all.filter(({ x, i }: Rec) => i !== k && hasCall(r, x)),
      in: all.filter(({ x, i }: Rec) => i !== k && hasCall(x, r)),
    };
  };

  // The overlays' state: the selected region, the dependency toggle and the hint line.
  let region = 0,
    selected: Lot | null = null,
    flightStatus: Rec = { phase: 'idle' };
  let overlay = {
    region: null as number | null,
    dependencies: false,
    // Buildings name the statement they stand for (branches, calls, returns, throws in the focused town, a few at a
    // time), so a town can be read without hovering each building.
    labels: true,
    plan: false,
    callShips: false,
    debugLayers: false,
    auxiliary: null as 'map' | 'key' | 'help' | 'stack' | null,
    stackRows: [] as Rec[],
    stackSelected: null as number | null,
    stackVisible: true,
    evidenceRows: [] as Rec[],
    evidenceSelected: null as string | null,
    evidenceVisible: true,
    gitChanges: false,
  };
  towns?.setDetailLabels(overlay.labels);
  const listeners = new Set<() => void>();
  const overlayStore = {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get: () => overlay,
  };
  function setOverlay(patch: Partial<typeof overlay>) {
    overlay = { ...overlay, ...patch };
    flushSync(() => listeners.forEach(fn => fn()));
  }

  // Positions in the planet's local frame → the main scene → stage pixels.
  const mainPos = (local: Vector3 | null) => {
    if (!local) return null;
    const f = ctx.frame();
    return local.clone().multiplyScalar(f.scale).add(f.origin);
  };
  const anchorLocal = (get: () => Vector3 | null) => worldAnchor(() => mainPos(get()));
  const elementsOf = (k: number): Lot[] => towns?.elementsOf(k) || [];
  const summary = (it: Rec) => it.summary || sourceLines[it.line - 1]?.trim() || it.name || it.kind || 'Statement';
  const goMethod = (i: number) => {
    onMethod(i);
    openMethod(i);
  };

  const { OpenSource, Evidence, Roles, Coverage, SourceBlock, ImportButton } = createSharedPieces({
    ctx,
    sourceLines,
    colored,
    changedLines,
    towns,
    onStatement,
    imports,
    analysis,
    diagnostics,
    limitations,
  });
  const { methodWindow } = createMethodSection({
    ctx,
    file,
    regions,
    towns,
    sourceLines,
    districtOf,
    callsOf,
    callers,
    schemaCalls,
    targetIndex,
    byId,
    goMethod,
    elementsOf,
    membersOf,
    anchorLocal,
    onMethod,
    onFit,
    openTransport,
    openMethod,
    OpenSource,
    Roles,
    Evidence,
    Coverage,
    SourceBlock,
    ImportButton,
  });
  const { statementWindow } = createStatementSection({
    file,
    regions,
    towns,
    sourceLines,
    colored,
    changedLines,
    schemaCalls,
    targetIndex,
    membersOf,
    elementsOf,
    summary,
    goMethod,
    districtOf,
    anchorLocal,
    onStatement,
    onInspect,
    openMethod,
    getRegion: () => region,
    OpenSource,
    SourceBlock,
  });
  const { transportWindow, stationWindow } = createTransportSection({
    ctx,
    regions,
    towns,
    callers,
    imports,
    anchorLocal,
    openMethod,
    openTransport,
    goMethod,
    getFlightStatus: () => flightStatus,
    ImportButton,
  });
  const { Toolbar } = createToolbarSection({
    ctx,
    file,
    regions,
    towns,
    analysis,
    districts,
    districtOf,
    goMethod,
    onFit,
    onInspect,
    onDependencies,
    openMethod,
    openTransport,
    getRegion: () => region,
    overlayStore,
    setOverlay,
  });
  const { CapturedStack } = createDebugSection({
    ctx,
    file,
    towns,
    overlayStore,
    setOverlay,
  });
  const { Auxiliary } = createMapSection({
    ctx,
    regions,
    districts,
    neighborhoods,
    mapPaths,
    districtOf,
    goMethod,
    overlayStore,
    setOverlay,
    CapturedStack,
  });

  function openMethod(k: number, opts?: { showSource?: boolean; sourceLine?: number | null }) {
    setOverlay({ auxiliary: null });
    ctxWin.pin(methodWindow(k, opts));
  }

  function openTransport(k: number) {
    setOverlay({ auxiliary: null });
    onMethod(k);
    ctxWin.pin(transportWindow(k));
    ctx.onPort(k);
  }

  // What a pick on the surface (building / prop) describes.
  function windowFor(info: Rec | null): CtxSpec | null {
    if (!info) return null;
    if (info.style === 'overflow') return methodWindow(info.k);
    if (info.style === 'station') return stationWindow(info.k);
    if (['spaceport', 'port'].includes(info.style)) return transportWindow(info.k);
    const l = elementsOf(info.k).find(x => x.it === info.it) || towns?.lotForLine(info.k, info.it.line);
    return l ? statementWindow({ ...l, k: l.k ?? info.k }, info.style) : null;
  }

  const container = document.createElement('div');
  container.style.display = 'contents';
  document.getElementById('stage')!.append(container);
  const root = createRoot(container);
  flushSync(() =>
    root.render(
      <>
        <Toolbar />
        <Auxiliary />
      </>,
    ),
  );

  function setRegion(k: number) {
    region = k;
    selected = null;
    setOverlay({ region: k });
    // A pinned window about another region's statement no longer matches the selection.
    if (ctxWin.pinned?.key?.startsWith('planet:stmt:') && !ctxWin.pinned.key.startsWith(`planet:stmt:${k}:`))
      ctxWin.close();
  }
  /** open: pin the statement's window (user actions); otherwise only record the selection. */
  function showStatement(l: Lot | null, { open = false } = {}) {
    selected = l;
    if (!l) {
      if (ctxWin.pinned?.key?.startsWith('planet:stmt:')) ctxWin.close();
      return;
    }
    if (open || ctxWin.pinned?.key?.startsWith('planet:stmt:')) ctxWin.pin(statementWindow({ ...l, k: l.k ?? region }));
  }
  return {
    stackChanged: (stackRows: Rec[], stackSelected: number | null, stackVisible = overlay.stackVisible) =>
      setOverlay({ stackRows, stackSelected, stackVisible }),
    evidenceChanged: (evidenceRows: Rec[], evidenceSelected: string | null) =>
      setOverlay({ evidenceRows, evidenceSelected }),
    setRegion,
    showStatement,
    openMethod,
    openTransport,
    windowFor,
    // Former tab names, kept for callers: transport → spaceport window, source → method window with its source open.
    setTab: (tab: string) => {
      if (tab === 'transport') ctxWin.pin(transportWindow(region));
      else if (tab === 'source') openMethod(region, { showSource: true });
    },
    transportStatus: (status: Rec) => {
      flightStatus = status;
      ctxWin.refresh(`planet:port:${region}`);
    },
    hover: (info: Rec | null) => {
      const spec = info?.region != null ? methodWindow(info.region) : windowFor(info);
      // A compact preview identifies the object; click opens its complete source inspector.
      // The selected method already has a persistent name in the breadcrumb.
      ctxWin.hover(
        info?.region === region
          ? null
          : spec
            ? {
                ...spec,
                sub: undefined,
                preview: spec.preview?.slice(0, 1),
              }
            : null,
      );
    },
    get selected() {
      return selected;
    },
    dispose: () => {
      root.unmount();
      container.remove();
      if (ctxWin.pinned?.key?.startsWith('planet:')) ctxWin.close();
      ctxWin.hover(null);
    },
  };
}
