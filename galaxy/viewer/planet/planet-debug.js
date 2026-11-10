// Owns evidence, captured stacks, runtime traces, breakpoints and debug layers.
import { createTownDebug } from '../debug/town-debug.js';
import { createRuntimeMarkers } from '../debug/runtime-markers.js';
import { createEvidenceMarkers } from '../debug/evidence-markers.js';
import { createStackPaths } from '../debug/stack-paths.js';
import { createStepCar } from '../debug/step-car.js';
import { frameParts } from '../shared/debug-frames.js';

export function createPlanetDebug(ctx, world, { pin, selectStatement, viewOf }) {
  const { T, host, n, revision, detail } = ctx;
  const { body, source } = world;
  if (ctx.towns) ctx.debugView = createTownDebug({ T, body, towns: ctx.towns });
  if (ctx.towns) ctx.stackLayer = createStackPaths(T, ctx.towns, { onSelect: index => host.debug?.selectFrame(index) });
  if (ctx.towns) ctx.evidence = createEvidenceMarkers(T, ctx.towns);
  if (ctx.towns) ctx.runtimeMarkers = createRuntimeMarkers(T, ctx.towns, source, revision, ctx.evidence);
  if (ctx.towns) ctx.stepCar = createStepCar(T, ctx.towns, ctx.traffic, () => ctx.callLayer?.routes ?? []);
  // Evidence the user loaded, and git changes, follow the world into its next revision (and go stale there).
  const evidenceChanged = () =>
    ctx.inspector?.evidenceChanged(ctx.evidence?.rows ?? [], ctx.evidence?.selected ?? null);
  const routesAt = element =>
    ctx.callLayer?.routes
      .filter(
        route =>
          element.kind !== 'town' &&
          route.a === element.town &&
          route.from.sourceStart != null &&
          route.from.sourceStart >= element.sourceStart &&
          route.from.sourceEnd <= element.sourceEnd,
      )
      .map(route => route.id) ?? [];
  const traceRoutes = new Set();
  let followedTown = null;
  const setEvidence = (from, records) => {
    if (!ctx.evidence) throw new Error('Load source before showing evidence.');
    const rows = ctx.evidence.set(from, records);
    ctx.callLayer?.capture(
      'evidence',
      rows.flatMap(row =>
        row.status === 'exact' && ['execution', 'hot-path'].includes(row.record.type)
          ? row.elements.flatMap(routesAt)
          : [],
      ),
    );
    evidenceChanged();
    return rows;
  };
  const selectEvidence = id => {
    const row = ctx.evidence?.select(id);
    evidenceChanged();
    const element = row?.elements[0];
    if (!element) return;
    pin(element.town, { fly: false });
    if (element.lot) selectStatement(element.lot, false);
  };
  // Changed lines since the last commit, from the main process's fixed git command.
  const showGitChanges = async enabled => {
    if (!enabled) return setEvidence('git', []);
    const changes = await window.galaxyDesktop?.gitChangedLines?.(host.data.dataset(), n.path);
    if (!changes) throw new Error('Git changes are unavailable for this project.');
    if (detail.stopped || revision !== host.data.revision()) return [];
    return setEvidence(
      'git',
      changes.map(c => ({
        type: 'git-change',
        file: n.path,
        line: c.line,
        change: c.change,
        revision,
        source: 'git',
      })),
    );
  };
  const setStack = (records, names) => {
    if (!ctx.stackLayer) throw new Error('Load source before opening a captured stack.');
    if (revision !== host.data.revision())
      throw new Error('Source is updating; wait for the current revision before loading a capture.');
    const rows = ctx.stackLayer.set(records, names);
    ctx.callLayer?.capture(
      'stack',
      rows.flatMap(row => (row.status === 'exact' && row.location?.element ? routesAt(row.location.element) : [])),
    );
    ctx.inspector?.stackChanged(rows, ctx.stackLayer.selected);
    return rows;
  };
  const selectStackFrame = number => {
    const row = ctx.stackLayer?.select(number);
    ctx.inspector?.stackChanged(ctx.stackLayer.rows, number);
    if (row?.status !== 'exact' || !row.location?.element) return;
    const element = row.location.element;
    const sameTown = detail.pinnedRegion === element.town;
    pin(element.town, { fly: false });
    if (element.lot) selectStatement(element.lot, false);
    // Stepping keeps the camera still while the paused building stays near the middle of the view; otherwise a
    // short flight recentres it. Re-framing on every step made stepping jump.
    const target = element.lot ? ctx.towns.worldOfLot(element.lot) : ctx.towns.centerOf(element.town),
      seen = target.clone().project(T.camera);
    if (sameTown && seen.z < 1 && Math.abs(seen.x) < 0.55 && Math.abs(seen.y) < 0.55) return;
    const view = viewOf(element.town);
    view.cam.add(target.clone().sub(view.target));
    T.flyTo(target, 0, { cam: view.cam, arc: !sameTown, duration: sameTown ? 450 : 900 });
  };
  return {
    setEvidence,
    selectEvidence,
    showGitChanges,
    setStack,
    selectStackFrame,
    invalidateRevision: () => {
      ctx.runtimeMarkers?.trace(null);
      traceRoutes.clear();
      ctx.callLayer?.capture('evidence', []);
      ctx.callLayer?.capture('stack', []);
      ctx.callLayer?.capture('trace', []);
      ctx.runtimeMarkers?.breakpoints([]);
      ctx.inspector?.stackChanged(ctx.stackLayer?.invalidate() ?? [], ctx.stackLayer?.selected ?? null);
      ctx.evidence?.invalidate();
      evidenceChanged();
    },
    runtime: {
      runtimeTrace: async (point, follow = false) => {
        if (detail.stopped || revision !== host.data.revision()) return false;
        const exact = await ctx.runtimeMarkers?.trace(point);
        const traced =
          exact && !detail.stopped && revision === host.data.revision()
            ? ctx.towns.locate({ line: point.line, column: point.column, revision }).element
            : null;
        // Execution warms the buildings it passes: repeated hits run hot, and the heat fades over seconds, leaving a
        // trail of where the program has just been.
        if (traced?.lot) ctx.towns.heatLot(traced.lot, 1);
        if (traced) routesAt(traced).forEach(id => traceRoutes.add(id));
        else {
          traceRoutes.clear();
          followedTown = null;
        }
        ctx.callLayer?.capture('trace', traceRoutes);
        if (exact && follow && !detail.stopped && revision === host.data.revision()) {
          const found = ctx.towns.locate({ line: point.line, column: point.column, revision }).element;
          if (found) {
            // The camera frames the town and holds still while the ship moves between its buildings; it only
            // travels when execution moves to another town, so rapid hits do not restart a flight each time.
            if (found.town !== followedTown) {
              followedTown = found.town;
              pin(found.town, { fly: false });
              const view = viewOf(found.town);
              T.flyTo(view.target, 0, { cam: view.cam, duration: 600, arc: true });
            }
            if (found.lot) selectStatement(found.lot, false);
          }
        }
        return exact;
      },
      runtimeBreakpoints: points => {
        if (detail.stopped || revision !== host.data.revision()) return;
        ctx.runtimeMarkers?.breakpoints(points);
        evidenceChanged();
      },
      debugSelection: () => {
        const range = ctx.towns?.rangeOf(detail.selectedElement?.it.id);
        return range && revision === host.data.revision()
          ? {
              file: n.path,
              line: range.line,
              column: range.column || 1,
              end: range.end,
              endColumn: range.endColumn || Infinity,
              text: source,
            }
          : null;
      },
      debugFrameAtSelection: frames =>
        !detail.selectedElement
          ? -1
          : frames.findIndex(
              f =>
                f.file === n.path &&
                f.text === source &&
                ctx.towns?.locate({ line: f.line, column: f.column, revision: host.data.revision() }).element?.id ===
                  detail.selectedElement?.it.id,
            ),
      runtimeArguments: (index, lines) => {
        if (detail.stopped || revision !== host.data.revision()) return;
        ctx.stackLayer?.details(index + 1, lines);
      },
      runtimeStack: (frames, selected, exception = null, reason = null) => {
        if (detail.stopped || revision !== host.data.revision()) return;
        ctx.traffic?.hold(frames.length > 0);
        // The innermost frame is where execution is paused; an exception pause also marks the exception there.
        const top = frames.find(f => f.depth === 0),
          here = top && {
            file: top.file,
            line: top.line,
            column: top.column,
            revision: top.local && top.file === n.path && top.text === source ? revision : 'runtime-source-mismatch',
            source: 'Node Inspector',
            session: top.id.split(':')[0],
            context: top.context,
          };
        ctx.evidence?.set(
          'runtime',
          here
            ? [
                { ...here, type: 'execution' },
                ...(exception ? [{ ...here, type: 'exception', message: String(exception) }] : []),
              ]
            : [],
        );
        const pausedAt = ctx.evidence?.rows.find(r => r.source === 'runtime' && r.elements.length);
        // The paused statement's building stirs while the rest of the planet holds still, and the debugger's car drives
        // there from the previous pause.
        if (pausedAt?.elements[0]?.lot) ctx.towns?.heatLot(pausedAt.elements[0].lot, 1.5);
        void ctx.stepCar?.at(pausedAt?.elements[0] ?? null, reason === 'step');
        if (pausedAt && ctx.evidence.selected == null) ctx.evidence.select(pausedAt.id);
        evidenceChanged();
        const records = frames.map(f => ({
          type: 'frame',
          file: f.file,
          line: f.line,
          column: f.column,
          revision: f.local && f.file === n.path && f.text === source ? revision : 'runtime-source-mismatch',
          source: 'Node Inspector',
          session: f.id.split(':')[0],
          invocation: f.id,
          context: f.context,
          continues: f.continues,
          depth: f.depth,
        }));
        const rows = setStack(
          records,
          frames.map(f => {
            const { method } = frameParts(f);
            return `${method}:${f.line}`;
          }),
        );
        if (selected != null) selectStackFrame(selected + 1);
        return rows.map(r => ({ n: r.n, status: r.status }));
      },
    },
  };
}
