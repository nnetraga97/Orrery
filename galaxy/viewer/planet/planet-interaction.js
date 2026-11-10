// Owns planet picking, hover, selection, source focus and agent navigation effects.
import * as THREE from 'three';
import { glowTex } from '../scene/textures.js';
import { startTown, townLandingView } from './town-landing.js';
import { intersectVisible } from '../scene/scene-picking.js';

export function createPlanetInteraction(ctx, world, { selection }) {
  const { T, host, n, revision, R, detail, buildAbort, panel } = ctx;
  const { source, regions, identity, centerOf, regionOfLine, surfacePoint, overlay, hlMat, pinMat } = world;
  const { ownerOfDir } = world;
  let hlMesh = null,
    pinMesh = null;
  const centerPort = k => {
    const p = ctx.towns?.portOf(k);
    if (!p) return;
    ctx.towns.setFocus(k, null, detail.dependencies);
    ctx.plan?.focus(k);
    ctx.callLayer?.focus(k);
    const normal = p.clone().normalize(),
      north = ctx.towns.frameOf(k).nn;
    const d = ctx.towns.scaleOf(k) * 12;
    T.flyTo(p, 0, {
      cam: p
        .clone()
        .addScaledVector(normal, d)
        .addScaledVector(north, -d * 0.7),
      arc: true,
    });
  };
  // ---- picking regions ----
  const ray = new THREE.Raycaster(),
    mouse = new THREE.Vector2();
  let pending = false;
  const el = T.controls.domElement;
  const clearHover = () => {
    pending = false;
    detail.hoverInfo = null;
    detail.hoverRegion = -1;
    ctx.towns?.setHover(null);
    ctx.plan?.hover(null);
    ctx.callLayer?.hover(-1);
    ctx.inspector?.hover(null);
  };
  el.addEventListener('pointerleave', clearHover, { signal: buildAbort.signal });
  el.addEventListener('pointerdown', clearHover, { signal: buildAbort.signal });
  const pointerPosition = e => {
    const r = el.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
  };
  el.addEventListener('pointermove', e => {
    if (e.buttons) return;
    pointerPosition(e);
    pending = true;
  });
  el.addEventListener('pointerup', e => {
    if (!T.isSelectionClick(e)) return;
    pointerPosition(e);
    updateHover();
    const info = detail.hoverInfo;
    if (info) {
      if (info.k !== detail.pinnedRegion) pin(info.k, { fly: false });
      if (['spaceport', 'port', 'station'].includes(info.style)) {
        const w = ctx.inspector.windowFor(info);
        if (w) host.windows.context.pin(w);
        return;
      }
      selectStatement(
        ctx.towns.elementsOf(info.k).find(l => l.it === info.it) || ctx.towns.lotForLine(info.k, info.it.line),
        false,
        true,
      );
      return;
    }
    // Bare ground: select that method and show its window; empty space closes the window.
    if (detail.hoverRegion >= 0) {
      if (detail.hoverRegion !== detail.pinnedRegion) pin(detail.hoverRegion);
      ctx.inspector.openMethod(detail.hoverRegion);
    } else host.windows.context.close();
  });
  // Double-click a building: select it and fly in until it fills the view (same viewing direction, distance scaled to the building).
  el.addEventListener('dblclick', e => {
    if (!ctx.towns?.group.visible) return;
    const r = el.getBoundingClientRect(),
      at = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, (-(e.clientY - r.top) / r.height) * 2 + 1);
    T.sync?.();
    T.scene.updateMatrixWorld();
    ray.setFromCamera(at, T.camera);
    const hit = intersectVisible(ray, ctx.towns.pickables)[0],
      info = hit && ctx.towns.pick(hit);
    if (!info) return;
    if (info.k !== detail.pinnedRegion) pin(info.k, { fly: false });
    if (['spaceport', 'port', 'station'].includes(info.style)) {
      const w = ctx.inspector.windowFor(info);
      if (w) host.windows.context.pin(w);
      centerPort(info.k);
      return;
    }
    const l = ctx.towns.elementsOf(info.k).find(x => x.it === info.it); // props that are not statements (spaceport, station) have none
    if (l) selectStatement(l, false, true);
    const s = ctx.towns.scaleOf(info.k),
      b = l?.bounds,
      target = l ? ctx.towns.worldOfLot(l) : hit.point.clone();
    if (b) target.addScaledVector(target.clone().normalize(), b.height * 0.4); // aim at the middle of tall buildings
    T.flyTo(target, Math.max(s * 1.4, (b ? Math.max(b.width, b.height) : s * 1.5) * 3.2));
  });
  function updateHover() {
    pending = false;
    T.sync?.();
    T.scene.updateMatrixWorld();
    ray.setFromCamera(mouse, T.camera);
    const previous = detail.hoverInfo;
    detail.hoverInfo = null;
    if (ctx.towns && ctx.towns.group.visible) {
      const bh = intersectVisible(ray, ctx.towns.pickables)[0],
        info = bh && ctx.towns.pick(bh);
      if (info) {
        ctx.towns.setHover(info);
        ctx.plan?.hover(info);
        ctx.callLayer?.hover(info.k);
        if (previous?.it !== info.it || previous?.style !== info.style || detail.hoverRegion !== -2)
          ctx.inspector?.hover(info);
        detail.hoverInfo = info;
        detail.hoverRegion = -2;
        return;
      }
    }
    ctx.towns?.setHover(null);
    ctx.plan?.hover(null);
    const hit = ray.intersectObject(ctx.surface)[0],
      k = hit ? ownerOfDir(hit.point.clone().normalize()) : -1;
    ctx.callLayer?.hover(k);
    if (k === detail.hoverRegion) return;
    detail.hoverRegion = k;
    if (hlMesh) {
      T.scene.remove(hlMesh);
      hlMesh.geometry.dispose();
      hlMesh = null;
    }
    if (k >= 0 && k !== detail.pinnedRegion) hlMesh = overlay(k, hlMat);
    ctx.inspector?.hover(k >= 0 ? { region: k } : null);
  }
  T.onFrame.push(() => {
    if (pending) updateHover();
  });
  function markLines(a, b, scroll) {
    document.querySelectorAll('.code .cl.hot').forEach(r => r.classList.remove('hot'));
    let first = null;
    for (let l = a; l <= b; l++) {
      const r = document.querySelector(`.code .cl[data-line="${l}"]`);
      if (r) {
        r.classList.add('hot');
        first = first || r;
      }
    }
    if (scroll && first) {
      const code = first.parentElement;
      code.scrollTop = first.offsetTop - code.offsetTop - code.clientHeight / 3;
    }
  }
  // Look obliquely across the selected region's town.
  function viewOf(k) {
    if (ctx.towns) return townLandingView(ctx.towns, k, R);
    const target = surfacePoint(centerOf[k], k, 0);
    return { target, cam: target.clone().multiplyScalar(2) };
  }
  function pin(k, { fly = true } = {}) {
    ctx.transport?.cancel();
    detail.pinnedRegion = k;
    detail.selectedKey = k < 0 ? null : identity.keyOf(regions[k]);
    if (pinMesh) {
      T.scene.remove(pinMesh);
      pinMesh.geometry.dispose();
      pinMesh = null;
    }
    detail.selectedLine = null;
    detail.selectedElement = null;
    ctx.inspector?.setRegion(k);
    ctx.towns?.setFocus(k, null, detail.dependencies);
    ctx.plan?.focus(k);
    ctx.callLayer?.focus(k);
    if (k < 0) return;
    pinMat.opacity = 0.06;
    pinMesh = overlay(k, pinMat);
    if (!ctx.towns) return;
    T.controls.minDistance = ctx.towns.scaleOf(k) * 1.2;
    if (fly) {
      const v = viewOf(k);
      T.flyTo(v.target, 0, { cam: v.cam, arc: true });
    }
  }

  // ---- developer inspector and a map of both hemispheres ----
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function selectStatement(l, pan = true, open = false) {
    if (!l) return;
    detail.selectedLine = l.it.line;
    detail.selectedElement = l;
    ctx.towns?.setFocus(l.k, l.it.line, detail.dependencies, l);
    ctx.plan?.focus(l.k, l.it.line);
    ctx.callLayer?.focus(l.k, l);
    ctx.inspector.showStatement(l, { open });
    if (pan) T.flyTo(ctx.towns.worldOfLot(l), T.camera.position.distanceTo(T.controls.target));
  }
  // Keep the selected method; scrolling in preserves the existing camera.
  // A requested line lands on the element that holds it, never on a neighbour (I-6). When no statement holds it, the
  // town (or the file) is shown and the panel says so.
  function focus(line, fly, instant = false, townId = null) {
    const townIndex = townId ? regions.findIndex(r => r.id === townId) : -1;
    const found = line != null && ctx.towns ? ctx.towns.locate({ line, revision: host.data.revision() }) : null;
    showMatch(line, found);
    const startK =
      townIndex >= 0
        ? townIndex
        : found?.k != null
          ? found.k
          : line != null && regionOfLine(line) >= 0
            ? regionOfLine(line)
            : selection?.key && regions.some(r => identity.keyOf(r) === selection.key)
              ? regions.findIndex(r => identity.keyOf(r) === selection.key)
              : startTown(regions);
    pin(startK, { fly: false });
    const initial = townIndex < 0 && line != null ? found?.lot : null;
    if (initial) selectStatement(initial, false);
    if (!fly) return;
    const v = viewOf(startK);
    // Explicit source-line navigation should land on its actual statement.
    if (initial && line != null) {
      const at = ctx.towns.worldOfLot(initial);
      v.cam.add(at.clone().sub(v.target));
      v.target.copy(at);
    }
    if (instant) T.setView(v.target, v.cam);
    else T.flyTo(v.target, 0, { cam: v.cam, arc: true, duration: 1600 });
  }
  function showMatch(line, found) {
    let note = panel.querySelector('#planetMatch');
    const text =
      !found || found.status === 'exact'
        ? ''
        : found.status === 'approximate'
          ? `Line ${line} holds ${found.candidates.length} statements; showing the first.`
          : found.status === 'stale'
            ? `Line ${line} is from another revision of this file.`
            : `Line ${line} is not inside a statement${found.k == null ? ' or method' : ''}.`;
    if (!text) return note?.remove();
    if (!note) {
      note = document.createElement('div');
      note.id = 'planetMatch';
      note.className = 'planet-match';
      note.setAttribute('role', 'status');
      panel.appendChild(note);
    }
    note.textContent = text;
    note.dataset.match = found.status;
  }
  const sourceAPI = {
    sourceContext: () =>
      !detail.stopped && revision === host.data.revision() ? { file: n.path, text: source, revision } : null,
    revealSource: async (point, current = () => true) => {
      if (detail.stopped || revision !== host.data.revision() || point.file !== n.path || point.text !== source)
        return { status: 'stale' };
      const found = ctx.towns?.locate({ line: point.line, column: point.column, revision });
      if (found?.status !== 'exact') return { status: found?.status || 'unmapped' };
      if (found.k == null) return { status: 'unmapped' };
      await ctx.towns.prepare(found.k);
      if (detail.stopped || revision !== host.data.revision() || !current()) return { status: 'stale' };
      pin(found.k, { fly: false });
      if (found.lot) selectStatement(found.lot, false, true);
      const view = viewOf(found.k),
        target = found.lot ? ctx.towns.worldOfLot(found.lot) : ctx.towns.centerOf(found.k);
      view.cam.add(target.clone().sub(view.target));
      if (found.lot)
        view.cam
          .sub(target)
          .setLength(Math.max(0.35, ctx.towns.scaleOf(found.k) * 10))
          .add(target);
      T.flyTo(target, 0, { cam: view.cam, duration: 1 });
      return { status: 'exact', id: found.element.id };
    },
    focusLine: (line, townId) => {
      focus(line, true, !townId, townId);
      return ctx.towns?.prepare(detail.pinnedRegion);
    },
  };
  return { centerPort, pin, selectStatement, viewOf, focus, markLines, sourceAPI };
}

export function planetAgentActions(ctx, world, { pin, focus, markLines }) {
  const { T, detail } = ctx;
  const { regionOfLine } = world;
  const regionForStep = step => {
    const k = regionOfLine(step.entry);
    if (k < 0 || !ctx.towns) throw new Error(`No source-backed town for ${step.name}.`);
    return k;
  };
  // the agent cannon hitting this file while it is open: a burst at the statement on that line, and the lines marked.
  const bursts = [];
  T.onFrame.push(() => {
    const now = performance.now();
    for (let q = bursts.length - 1; q >= 0; q--) {
      const b = bursts[q],
        k = (now - b.t0) / b.dur;
      if (k >= 1) {
        T.scene.remove(b.sprite);
        b.sprite.material.dispose();
        bursts.splice(q, 1);
        continue;
      }
      b.sprite.scale.setScalar(b.size * (0.4 + 1.6 * Math.sqrt(k)));
      b.sprite.material.opacity = (1 - k) ** 1.5;
    }
  });
  return {
    // An agent hit marks the statement that holds the line; a line outside any statement marks only its town.
    agentFlash: (line, col, size = 1) => {
      const found = line != null ? ctx.towns?.locate({ line }) : null,
        k = found?.k ?? (line != null ? regionOfLine(line) : -1),
        lot = found?.lot ?? null;
      const at = lot ? ctx.towns.worldOfLot(lot) : k >= 0 && ctx.towns ? ctx.towns.centerOf(k) : null;
      if (!at) return false;
      ctx.towns.heatLot(lot, size);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: col,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          transparent: true,
        }),
      );
      sprite.position.copy(at);
      sprite.renderOrder = 20;
      T.scene.add(sprite);
      bursts.push({ sprite, t0: performance.now(), dur: 1400, size: ctx.towns.scaleOf(k) * 7 * size });
      return true;
    },
    agentMark: (a, b) => markLines(a, b ?? a, false),
    followReady: true,
    followAt: step => {
      regionForStep(step);
      focus(step.line, true);
      ctx.inspector.setTab('flow');
    },
    followSource: () => ctx.inspector.setTab('source'),
    followRide: (from, to, opts) => ctx.transport.ride(regionForStep(from), regionForStep(to), opts),
    followDeparture: (step, opts) => ctx.transport.play(regionForStep(step), { path: step.name, resolved: true }, opts),
    followArrival: (step, opts) => {
      const k = regionForStep(step);
      pin(k, { fly: false });
      ctx.inspector.setTab('transport');
      return ctx.transport.play(k, { path: step.name, arrival: true, resolved: true }, { ...opts, arrival: true });
    },
  };
}
