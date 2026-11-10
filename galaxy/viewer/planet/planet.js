// Owns the planet entry points, body host, source caches and detail lifetime.
import * as THREE from 'three';
import { languageOf } from '../../source-model/languages.js';
import { sourceUrl } from '../app/static-data.js';
import { loadTypeScript } from '../towns/towns.js';
import { planetSeed } from './planet-appearance.js';
import { buildPlanetDetail } from './planet-detail.js';

// Canonical radius for the code-shaped surface.
export const PLANET_R = 10;
export const CODE_BODY_R = PLANET_R + 0.018;
// The viewer fill's strength on the night side, as a share of the sun's.
const FILL = 0.35;

// A scene3D-like host for one body: its own scene and camera in the body's frame, driven by the main camera.
// frame() → { origin, scale, quaternion } maps local to world: world = origin + local * scale. The body's own
// orientation (quaternion) turns its surface, not the frame, so code placed in the frame needs no rotation.
// The host is drawn into the main depth buffer with a camera that is the main camera in this frame (scene3d.js), and
// lit by copies of the main lights, so the landed body and its orbital instance are one object.
export function makePlanetHost(main, frame) {
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(main.camera.fov, main.camera.aspect, 0.02, 100);
  scene.environment = main.scene.environment;
  scene.environmentIntensity = main.scene.environmentIntensity;
  let sun = null;
  for (const light of main.scene.children.filter(o => o.isHemisphereLight || o.isDirectionalLight)) {
    const copy = light.clone();
    copy.name = 'planet-light';
    scene.add(copy);
    if (copy.isDirectionalLight) sun ||= copy;
  }
  // Code on the night side would sit in the dark. A soft sky fill from the viewer's side lifts what the camera faces,
  // as far as the sun is missing there. Being ambient it keeps the sun's shading and adds no glare: a directional light
  // at the eye flattened every surface and glazed metal white.
  const fill = new THREE.HemisphereLight('#7f97cc', '#0b1020', 0);
  fill.name = 'planet-viewer-fill';
  scene.add(fill);
  const sunDirection = new THREE.Vector3(),
    viewDirection = new THREE.Vector3();
  const updateFill = () => {
    if (!sun) return;
    viewDirection.copy(camera.position).normalize();
    sunDirection.copy(sun.position).sub(sun.target.position).normalize();
    fill.position.copy(viewDirection);
    // It grows with the close-up's fade-in, so the orbital body (which has no fill) hands over without a jump.
    fill.intensity = sun.intensity * FILL * (1 - Math.max(0, viewDirection.dot(sunDirection))) * (H.opacity ?? 1);
  };
  const toWorld = v => {
    const f = frame();
    return v.multiplyScalar(f.scale).add(f.origin);
  };
  const toLocal = (v, out = new THREE.Vector3()) => {
    const f = frame();
    return out.copy(v).sub(f.origin).divideScalar(f.scale);
  };
  const listeners = [],
    removers = [],
    onFrame = [];
  const el = main.controls.domElement;
  const H = {
    scene,
    camera,
    prepareDraw: (object, checkpoint) => main.prepareDraw(object, camera, scene, checkpoint),
    interactive: true,
    // Blend the short handoff as an image; settled detail shares the main depth buffer.
    get sharedDepth() {
      return H.opacity >= 1 || H.opacity <= 0;
    },
    // A world-space near plane for the camera's height above this body (scene3d.js splits depth below it).
    nearWorld: () => Math.max(1e-6, (camera.position.length() - PLANET_R) * 0.05 * frame().scale),
    // The orbital body's loaded parts (planet-library.js), so the close-up draws the same materials.
    libraryParts: entry => main.libraryParts(entry),
    highDetail: entry => main.highDetail(entry),
    setHighDetail: (entry, enabled, signal) => main.setHighDetail(entry, enabled, signal),
    element: el,
    addOverlay: o => main.addOverlay(o),
    onFrame,
    isSelectionClick: main.isSelectionClick,
    toLocal,
    frame,
    opacity: 0,
    get navigationRevision() {
      return main.navigationRevision;
    },
    minDistance: PLANET_R * 0.005,
    controls: {
      domElement: {
        addEventListener: (type, fn, opts) => {
          const gated = e => {
            if (H.interactive) fn(e);
          };
          el.addEventListener(type, gated, opts);
          listeners.push([type, gated, opts]);
        },
        getBoundingClientRect: () => el.getBoundingClientRect(),
      },
      get enabled() {
        return main.controls.enabled;
      },
      set enabled(value) {
        main.controls.enabled = value;
      },
      get target() {
        return toLocal(main.controls.target);
      },
      get minDistance() {
        return H.minDistance;
      },
      set minDistance(v) {
        H.minDistance = v;
      },
      update: () => {},
    },
    // Surface labels only once the planet fills the view; place names pass a longer reach (in planet radii) so the
    // whole globe still reads as an outline of the file.
    addLabels: (list, owner = null, reach = 3) => {
      const remove = main.addLabels(
        list,
        owner
          ? v => {
              const f = owner.host.frame();
              return v.multiplyScalar(f.scale).add(f.origin);
            }
          : toWorld,
        () => {
          const host = owner?.host ?? H;
          return host.interactive && host.opacity > 0.6 && host.camera.position.length() < PLANET_R * reach;
        },
      );
      if (!owner) removers.push(remove);
      return remove;
    },
    flyTo: (p, dist, opts = {}) => main.flyTo(p, dist, { ...opts, frame }),
    // Place the camera directly (local target and camera position).
    setView: (target, cam) => {
      main.cancelFlight();
      main.clearControlMotion();
      // This placement already includes the body's motion. Reset the follow delta
      // so scene3D does not carry the chase camera along a second time this frame.
      main.setFollowing(true);
      main.controls.target.copy(toWorld(target.clone()));
      main.camera.position.copy(toWorld(cam.clone()));
      main.controls.update();
    },
    sync: () => {
      toLocal(main.camera.position, camera.position);
      camera.quaternion.copy(main.camera.quaternion);
      const alt = camera.position.length() - PLANET_R;
      camera.fov = main.camera.fov;
      camera.aspect = main.camera.aspect;
      camera.near = Math.min(1, Math.max(0.002, alt * 0.05));
      camera.far = camera.position.length() + PLANET_R * 1.5;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      updateFill();
    },
    stop: () => {
      removeOverlay();
      main.onFrame.splice(main.onFrame.indexOf(tick), 1);
      listeners.forEach(([type, fn, opts]) => el.removeEventListener(type, fn, opts));
      removers.forEach(r => r());
      scene.traverse(o => {
        if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
          o.geometry?.dispose();
          if (o.isInstancedMesh) o.dispose();
        }
      });
    },
  };
  const tick = t =>
    H.interactive &&
    (main.runFrameCallbacks ? main.runFrameCallbacks(onFrame, t, 'planet animation') : onFrame.forEach(f => f(t)));
  main.onFrame.push(tick);
  const removeOverlay = main.addOverlay(H);
  H.sync();
  return H;
}

// Per-file detail for the files a close-up shows: its own and its importers'. Fetched from the loaded graph's revision
// and cached (window.SYMBOLS[dataset][path]) while the file's detail hash is unchanged; files without symbols are not
// fetched. A response that a newer revision overtook installs nothing for the files it changed.
export async function loadFileSymbols(paths, host) {
  const ds = host.data.dataset(),
    cache = ((window.SYMBOLS ||= {})[ds] ||= {});
  if (!host.projects.has(ds)) return cache;
  const want = [...new Set(paths)].filter(p => !(p in cache) && host.graph.nodeOf(p)?.detail);
  for (let i = 0; i < want.length; i += 100) {
    const batch = want.slice(i, i + 100),
      hashes = batch.map(p => host.graph.nodeOf(p)?.detail);
    const got = await host.graph
      .fetchSymbols(ds, batch, host.data.revision())
      .catch(error => (error.status === 410 ? host.graph.fetchSymbols(ds, batch) : Promise.reject(error)));
    if (host.data.dataset() !== ds) return {};
    batch.forEach((p, k) => {
      if (host.graph.nodeOf(p)?.detail === hashes[k]) cache[p] = got[p];
    });
  }
  return cache;
}
const sourceCache = {};
export function loadSource(path, getDataset) {
  const key = getDataset() + '/' + path;
  if (!sourceCache[key])
    sourceCache[key] = fetch(sourceUrl(getDataset(), path))
      .then(r => (r.ok ? r.text() : null))
      .catch(() => null)
      .then(text => {
        // A failed read is retried on the next request instead of being cached as missing.
        if (text == null) delete sourceCache[key];
        return text;
      });
  return sourceCache[key];
}

/**
 * A changed file's symbols and source text are stale (every file's when `paths` is omitted).
 * @param {string} name
 * @param {string[] | null} [paths]
 */
export function forgetDataset(name, paths = null) {
  const symbols = window.SYMBOLS?.[name];
  if (!paths) delete window.SYMBOLS?.[name];
  for (const p of paths || []) delete symbols?.[p];
  Object.keys(sourceCache).forEach(k => {
    if (k.startsWith(name + '/') && (!paths || paths.includes(k.slice(name.length + 1)))) delete sourceCache[k];
  });
}

// One shared semantic model feeds analysis, town flow and geographic districts.
let semanticLayout = null;
const semanticLayoutReady = import('../../source-model/semantic-layout.js').then(module => (semanticLayout = module));
const semanticCodeReady = import('../../source-model/code-model.js');
// Distant rendering only needs a region count before the module has loaded.
export function regionsFor(sym, file = '') {
  if (semanticLayout) return semanticLayout.buildRegions(sym, { file });
  const members = (sym?.decls || []).flatMap(d =>
    d.kind === 'class' ? d.members || [] : d.kind === 'function' ? [d] : [],
  );
  return members.length ? members : [{ name: '(whole file)', members: [], loc: sym?.lines || 1 }];
}
export async function semanticSource(sym, source, file, getNodes) {
  // regionsFor() prefers the semantic layout; without it, the saved symbols still render.
  await semanticLayoutReady.catch(() => {});
  // Only JavaScript and TypeScript have a renderer-side model; tree-sitter languages use their saved symbols.
  if (!source || languageOf(file)?.frontEnd !== 'typescript') return sym;
  const model = await semanticCodeReady;
  if (sym?.schemaVersion === 2 && sym.sourceFingerprint === model.sourceFingerprint(source)) return sym;
  const ts = await loadTypeScript();
  // Shipped snapshots can be older than their source. Reparse through the same
  // model as the workspace analyzer, with an explicit syntax-only evidence scope.
  const known = new Set(getNodes().map(n => n.path));
  const resolveModule = specifier => {
    if (!specifier.startsWith('.')) return { file: specifier, status: 'unresolved' };
    const parts = file.split('/').slice(0, -1);
    for (const part of specifier.split('/')) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    const base = parts.join('/'),
      stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    const hit = [
      base,
      ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].flatMap(ext => [
        stem + ext,
        base + '/index' + ext,
      ]),
    ].find(path => known.has(path));
    return { file: hit || specifier, status: hit ? 'resolved' : 'unresolved' };
  };
  const fresh = model.analyzeSource(ts, source, { file, resolveModule });
  fresh.analysis = {
    ...fresh.analysis,
    mode: 'syntax',
    note: 'Source structure is current; cross-file symbols require workspace analysis.',
  };
  return fresh;
}

// T: a planet host. opts: { panel, land, line } — land flies to the opening region; line focuses a source line.
export function createPlanetDetail(
  fileIdx,
  T,
  {
    panel,
    land = false,
    line: focusLine = null,
    townId = null,
    arrival = null,
    bodyKind = 'planet',
    previous = null,
    publish = null,
    failed = null,
    selection = null,
  } = {},
  host,
) {
  const n = host.data.nodes()[fileIdx];
  const revision = host.data.revision();
  const preparedCache = new Map();
  const R = PLANET_R;
  const buildAbort = new AbortController();
  const loading = publish ? null : host.loading.begin('Loading planet', 'Reading ' + n.path + '…');
  const navigationAtStart = T.navigationRevision;
  const detail = {
    stopped: false,
    hoverRegion: -1,
    pinnedRegion: -1,
    selectedLine: null,
    selectedElement: null,
    dependencies: false,
  };
  // Mutable layer handles stay here so asynchronous work and stop() share one lifetime.
  const ctx = {
    T,
    host,
    // Other files' declarations on demand, for navigation that lands on a named method there.
    loadSymbols: paths => loadFileSymbols(paths, host),
    n,
    revision,
    R,
    CODE_BODY_R,
    detail,
    buildAbort,
    loading,
    preparedCache,
    panel,
    inspector: null,
    traffic: null,
    stackLayer: null,
    evidence: null,
    runtimeMarkers: null,
    transport: null,
    portTraffic: null,
    callLayer: null,
    debugView: null,
    towns: null,
    plan: null,
    surface: null,
  };
  let build = null;
  const baseCol = new THREE.Color(host.graph.color(host.graph.groupOf(n)));

  // Both follow the file's layout identity, so a rename keeps the planet's look (galaxy-memory.ts).
  const appearanceSeed = planetSeed(n.seed ?? n.path);
  const appearance = host.memory.fileAppearance(n.path, n.callables);
  T.scene.userData.planetAsset = appearance.id;

  Object.assign(ctx, { appearance, appearanceSeed, baseCol });

  panel.innerHTML = `<div class="row"><button id="backBtn">‹ System</button></div><div id="planetInfo" style="color:var(--muted)"></div>`;
  panel.querySelector('#backBtn').onclick = () => host.actions.exitPlanet();
  if (host.memory.layoutNotice()) {
    const note = document.createElement('div');
    note.className = 'planet-match';
    note.textContent = host.memory.layoutNotice();
    panel.appendChild(note);
  }

  const hitRay = new THREE.Raycaster(),
    shell = new THREE.Sphere(new THREE.Vector3(), R * 1.02);
  const ctl = {
    // The constellation hands its arriving ships to the town ports.
    get portTraffic() {
      return ctx.portTraffic;
    },
    fileIdx,
    ready: false,
    followReady: false,
    get selection() {
      return { key: detail.selectedKey, element: detail.selectedElement?.it.id ?? null };
    },
    cancelTransport: () => ctx.transport?.cancel(),
    stop: () => {
      detail.stopped = true;
      buildAbort.abort();
      loading?.finish();
      ctx.debugView?.dispose();
      ctx.runtimeMarkers?.dispose();
      ctx.evidence?.dispose();
      ctx.callLayer?.dispose();
      ctx.stackLayer?.dispose();
      ctx.stepCar?.dispose();
      ctx.transport?.dispose();
      ctx.portTraffic?.dispose();
      ctx.traffic?.stop();
      ctx.plan?.dispose();
      ctx.towns?.dispose();
      ctx.inspector?.dispose();
      panel.innerHTML = '';
      T.stop();
    },
    // World point on the surface (or a building) under screen position ndc; the bare sphere while the surface builds.
    surfaceHit: ndc => {
      hitRay.setFromCamera(ndc, T.camera);
      const hit = hitRay.intersectObjects([
        ...(ctx.towns?.group.visible ? ctx.towns.pickables : []),
        ...(ctx.surface ? [ctx.surface] : []),
      ])[0];
      const p = hit ? hit.point.clone() : hitRay.ray.intersectSphere(shell, new THREE.Vector3());
      if (!p) return null;
      const f = T.frame();
      return p.multiplyScalar(f.scale).add(f.origin);
    },
    showAgentLine: (line, current) =>
      build?.then(api => {
        if (!current() || !api) return;
        ctl.agentMark?.(line, line);
        ctl.agentFlash?.(line, 0x86bfff, 1);
      }),
    focusLine: (line, townId) => build?.then(api => api?.focusLine(line, townId)),
    sourceContext: () => build?.then(api => api?.sourceContext()),
    revealSource: (point, current) => build?.then(api => api?.revealSource(point, current)),
    runtimeTrace: (point, follow) => build?.then(api => api?.runtimeTrace(point, follow)),
    runtimeBreakpoints: points => build?.then(api => api?.runtimeBreakpoints(points)),
    debugSelection: () => build?.then(api => api?.debugSelection()),
    debugFrameAtSelection: frames => build?.then(api => api?.debugFrameAtSelection(frames)),
    runtimeStack: (frames, selected, exception, reason) =>
      build?.then(api => api?.runtimeStack(frames, selected, exception, reason)),
    runtimeArguments: (index, lines) => build?.then(api => api?.runtimeArguments(index, lines)),
  };
  ctx.ctl = ctl;
  build = Promise.all([
    loadFileSymbols([n.path, ...host.data.inc()[fileIdx].map(j => host.data.nodes()[j].path)], host),
    loadSource(n.path, host.data.dataset),
  ])
    .then(([syms, source]) => {
      if (detail.stopped) return null;
      return buildPlanetDetail(
        ctx,
        syms?.[n.path] || null,
        source,
        {
          ready: semanticLayoutReady,
          get layout() {
            return semanticLayout;
          },
          semanticSource,
          regionsFor,
        },
        { previous, publish, bodyKind, selection, land, focusLine, townId, arrival, navigationAtStart },
      );
    })
    .catch(error => {
      loading?.finish();
      if (detail.stopped || error.name === 'AbortError') return null;
      ctl.error = error.message;
      ctl.errorStack = error.stack;
      const info = panel.querySelector('#planetInfo');
      if (info) info.textContent = `Planet could not load: ${error.message}`;
      console.error(error);
      failed?.(error);
      return null;
    });
  return ctl;
}
