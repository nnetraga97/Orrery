// Owns landed-detail preparation, revision staging, crossfade and surface handoff.
import * as THREE from 'three';
import { PLANET_R, CODE_BODY_R, createPlanetDetail, makePlanetHost } from '../planet/planet.js';
import { clock, ease, current, orientationOf } from './constellation-orbits.js';

export function createDetail(ctx) {
  const { host, T, u, model, lod, frame: frameState } = ctx;
  // ---------- close-up: the focused body's regions and towns, built when the camera comes within NEAR radii ----------
  const NEAR = 9,
    FAR = 14,
    SHOW_IN = 7.5,
    SHOW_OUT = 8.5;
  // Local planet radius PLANET_R is the orbital body's radius, so the close-up and the instance coincide.
  const bodyScale = i => {
    const o = model.orbit[i],
      now = clock(),
      grow = (o.born == null ? 1 : ease((now - o.born) / 0.8)) * (model.birthScale.get(o.path) ?? 1);
    return (current(o, now).size * grow) / (host.data.nodes()[i].callables === 0 ? PLANET_R : CODE_BODY_R);
  };
  const frameOf = i => () => ({
    origin: model.pos[i],
    scale: bodyScale(i),
    quaternion: orientationOf(host.data.nodes()[i]),
  });
  function openDetail(i) {
    const land = lod.land?.i === i ? lod.land : null;
    lod.land = null;
    lod.approaching = !!land;
    lod.i = i;
    lod.path = host.data.nodes()[i].path;
    lod.seed = host.data.nodes()[i].seed;
    lod.host = makePlanetHost(T, frameOf(i));
    document.body.classList.add('planet-mode');
    if (host.windows.context.pinned?.key?.startsWith('file:')) host.windows.context.close({ silent: true }); // on the surface, windows describe what is under the pointer
    lod.panel = document.createElement('div');
    lod.panel.className = 'planet-status';
    host.dom('stage').appendChild(lod.panel);
    lod.detail = createPlanetDetail(
      i,
      lod.host,
      {
        panel: lod.panel,
        land: !!land,
        line: land?.line ?? null,
        townId: land?.townId ?? null,
        arrival: land?.arrival,
        bodyKind: model.orbit[i].kind,
      },
      host,
    );
    T.setMarkerHidden(true);
    T.setPickBlock(() => true); // clicks and hover belong to the surface now
  }
  function closeDetail() {
    lod.pending?.detail.stop();
    lod.pending?.panel.remove();
    lod.pending = null;
    if (!lod.detail) return;
    lod.detail.stop();
    lod.panel?.remove();
    lod.detail = lod.host = lod.i = lod.panel = null;
    if (host.windows.context.pinned?.key?.startsWith('planet:')) host.windows.context.close({ silent: true });
    document.body.classList.remove('planet-mode');
    T.setMarkerHidden(false);
    T.setPickBlock(null);
    host.actions.showHover(null);
  }
  function refreshDetail(i) {
    lod.pending?.detail.stop();
    lod.pending?.panel.remove();
    const old = lod.detail,
      oldHost = lod.host,
      oldPanel = lod.panel;
    old.followReady = false;
    old.invalidateRevision?.();
    Object.assign(oldHost.frame(), frameOf(i)());
    lod.i = i;
    const planetHost = makePlanetHost(T, frameOf(i)),
      panel = document.createElement('div');
    planetHost.interactive = false;
    panel.className = 'planet-status';
    const note = oldPanel.querySelector('#planetMatch') || oldPanel.appendChild(document.createElement('div'));
    note.id = 'planetMatch';
    note.className = 'planet-match';
    note.dataset.match = 'stale';
    note.textContent = 'Updating source · showing the last valid revision.';
    const pending = { host: planetHost, panel, detail: null };
    lod.pending = pending;
    pending.detail = createPlanetDetail(
      i,
      planetHost,
      {
        panel,
        bodyKind: model.orbit[i].kind,
        previous: old.inspection,
        selection: old.selection,
        publish: () => {
          if (lod.pending !== pending) throw new DOMException('Superseded planet revision', 'AbortError');
          const opacity = oldHost.opacity;
          old.stop();
          oldPanel.remove();
          host.dom('stage').appendChild(panel);
          planetHost.interactive = true;
          planetHost.opacity = opacity;
          lod.detail = pending.detail;
          lod.host = planetHost;
          lod.panel = panel;
          lod.i = i;
          lod.path = host.data.nodes()[i].path;
          lod.seed = host.data.nodes()[i].seed;
          lod.pending = null;
        },
        failed: error => {
          if (lod.pending !== pending) return;
          pending.detail.stop();
          panel.remove();
          lod.pending = null;
          note.textContent = `Update failed · showing the last valid revision: ${error.message}`;
        },
      },
      host,
    );
  }
  T.afterCamera.push(updateDetail);
  function updateDetail() {
    if (frameState.journeyFlight) {
      if (lod.host) closeDetail();
      return;
    }
    const i = T.pinned;
    if (lod.detail && lod.i !== i) closeDetail();
    if (i == null) return;
    const d = T.camera.position.distanceTo(model.pos[i]) / model.orbit[i].size;
    if (!lod.detail && d < NEAR) openDetail(i);
    if (lod.host) {
      // A short distance band blends the library sphere into the code-shaped surface.
      // Limit each step as well: a late build must not pop in after the camera has already arrived.
      const target = lod.detail.ready ? THREE.MathUtils.smoothstep(SHOW_OUT - d, 0, SHOW_OUT - SHOW_IN) : 0;
      const delta = target - lod.host.opacity,
        before = lod.host.opacity;
      lod.host.opacity = Math.abs(delta) < 0.08 ? target : lod.host.opacity + Math.sign(delta) * 0.08;
      if (d < NEAR || !T.flying) lod.approaching = false;
      const closing = !lod.approaching && d > FAR && lod.host.opacity < 0.002;
      if (closing) closeDetail();
      // Opacity changes after the orbital placement pass. Publish visibility for
      // this camera frame, including direct host.setView inspection jumps.
      if (closing || lod.host.opacity !== before) ctx.bodies.place(frameState.time);
    }
  }
  T.land = (i, { line = null, arrival = null, townId = null } = {}) => {
    const towns = lod.detail && lod.i === i ? lod.detail.towns : null,
      current = towns?.find(t => t.shown && towns.length > 1 && !towns.every(x => x.shown)),
      elsewhere =
        current &&
        ((townId && townId !== current.id && towns.some(t => t.id === townId)) ||
          (!townId && line != null && (line < current.start || line > current.end) &&
            towns.some(t => line >= t.start && line <= t.end)));
    if (lod.detail && lod.i === i && !elsewhere) {
      lod.detail.focusLine(line, townId);
      return;
    }
    if (lod.detail) closeDetail();
    lod.land = { i, line, arrival, townId };
    if (T.pinned !== i) T.select(i, { fly: false });
    // Start preparation with the approach, rather than waiting for the near threshold.
    T.flyTo(new THREE.Vector3(), model.orbit[i].size * 3, { frame: T.bodyFrame(i), duration: 1800 });
    openDetail(i);
  };
  T.runtimeTrace = (point, follow) => lod.detail?.runtimeTrace(point, follow);
  T.runtimeBreakpoints = points => lod.detail?.runtimeBreakpoints(points);
  T.debugSelection = () => lod.detail?.debugSelection();
  T.sourceContext = () => lod.detail?.sourceContext();
  T.revealSource = (point, current) => lod.detail?.revealSource(point, current);
  T.debugFrameAtSelection = frames => lod.detail?.debugFrameAtSelection(frames);
  T.debugFile = () => lod.path;
  T.agentShow = (line, current) => lod.detail?.showAgentLine(line, current);
  T.runtimeStack = (frames, selected, exception, reason) =>
    lod.detail?.runtimeStack(frames, selected, exception, reason);
  T.runtimeArguments = (index, lines) => lod.detail?.runtimeArguments(index, lines);
  T.leave = () => {
    T.interruptNavigation();
    lod.detail?.cancelTransport();
    if (lod.i != null) T.flyTo(new THREE.Vector3(), 32 * u, { frame: T.bodyFrame(lod.i), duration: 1600, arc: true });
  };
  Object.defineProperty(T, 'landed', { get: () => !!lod.detail });
  T.landedTowns = () => lod.detail?.towns ?? null;

  return { openDetail, closeDetail, refreshDetail, bodyScale };
}
