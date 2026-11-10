// The smallest shell the copied scene code runs in: a RendererHost (see reference/desktop-app/viewer/app/host.ts)
// backed by plain DOM. Windows and the planet inspector are stand-ins that record what the scene asked to show;
// the XR app replaces this file with spatial panels.
import { fileAppearance, galaxyLayoutNotice, layoutMemory, saveGalaxyMemory, townKeys } from '../../galaxy/viewer/app/galaxy-memory.ts';
import { fetchSymbols, groupArms, importUse, importsIndexed, membersOf, nodeOf } from '../../galaxy/viewer/app/graph.ts';
import { remember, remembered } from '../../galaxy/viewer/app/project-store.ts';
import { G, actions, projects, state } from '../../galaxy/viewer/app/state.ts';

const $ = id => document.getElementById(id);
const escapeHtml = text =>
  String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function createViewport(stage) {
  const listeners = new Set();
  let viewport = { width: 0, height: 0, left: 0, top: 0, visible: false };
  const refresh = () => {
    const rect = stage.getBoundingClientRect();
    const next = {
      width: stage.clientWidth,
      height: stage.clientHeight,
      left: rect.left,
      top: rect.top,
      visible: !document.hidden && stage.clientWidth > 0 && stage.clientHeight > 0,
    };
    if (Object.keys(next).every(key => next[key] === viewport[key])) return;
    viewport = next;
    for (const listener of listeners) listener(viewport);
  };
  new ResizeObserver(refresh).observe(stage);
  window.addEventListener('resize', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
  return {
    get: () => viewport,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// Context windows: the desktop app draws these as floating HTML windows. Here the last request is kept and described.
function createContextWindows(report) {
  let pinned = null,
    hovered = null;
  const describe = item => (item ? `${item.kind || ''} ${item.title || item.key || ''}`.trim() : '');
  return {
    esc: escapeHtml,
    hover(item) {
      hovered = item || null;
      report('hover', describe(hovered));
    },
    pin(item) {
      pinned = item || null;
      report('pinned', describe(pinned));
    },
    close() {
      pinned = null;
      report('pinned', '');
    },
    place() {},
    refresh() {},
    get pinned() {
      return pinned;
    },
    get hovered() {
      return hovered;
    },
    get pinnedBounds() {
      return null;
    },
  };
}

// The planet inspector: the desktop app mounts a React panel. This stand-in accepts every call and renders nothing.
const inspectorStandIn = () =>
  new Proxy(
    {},
    {
      get: (_, name) => (name === 'then' ? undefined : () => undefined),
    },
  );

export function createFlatHost() {
  const stage = $('stage');
  const info = {};
  const report = (key, value) => {
    info[key] = value;
    $('info').textContent = Object.entries(info)
      .filter(([, text]) => text)
      .map(([name, text]) => `${name}: ${text}`)
      .join('\n');
  };
  let loadingOwner = null;
  return {
    data: {
      dataset: () => state.dataset,
      revision: () => state.revision,
      nodes: () => state.nodes,
      links: () => state.links,
      groups: () => state.groups,
      grouping: () => state.grouping,
      groupIndex: () => state.groupIndex,
      out: () => state.out,
      inc: () => state.inc,
    },
    actions: {
      render: () => actions.render(),
      selectFile: (...args) => actions.selectFile(...args),
      enterPlanet: (...args) => actions.enterPlanet(...args),
      exitPlanet: () => actions.exitPlanet(),
      showHover: (...args) => actions.showHover(...args),
    },
    overview: () => state.view?.overview?.(),
    debug: { selectFrame: () => {} },
    projects: { has: dataset => projects.has(dataset) },
    dom: $,
    windows: { context: createContextWindows(report), worldAnchor: getPos => ({ world: getPos }) },
    memory: {
      fileAppearance,
      townKeys,
      layoutNotice: galaxyLayoutNotice,
      layout: layoutMemory,
      save: saveGalaxyMemory,
    },
    graph: {
      groupOf: G,
      color: group => state.color(group),
      groupArms,
      importUse,
      importsIndexed,
      membersOf,
      fetchSymbols,
      nodeOf,
    },
    preferences: { remember, recall: remembered },
    stage: {
      element: stage,
      viewport: createViewport(stage),
      createObstacles: () => ({ appendTo() {}, dispose() {} }),
    },
    layout: {
      country(build) {
        return (state.cache['country-layout'] ||= build());
      },
    },
    loading: {
      begin(title, detail) {
        const token = {};
        loadingOwner = token;
        $('sceneLoadingTitle').textContent = title;
        $('sceneLoadingDetail').textContent = detail;
        $('busy').hidden = false;
        return {
          update(message) {
            if (loadingOwner === token) $('sceneLoadingDetail').textContent = message;
          },
          finish() {
            if (loadingOwner !== token) return;
            loadingOwner = null;
            $('busy').hidden = true;
          },
        };
      },
      paint: () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))),
    },
    source: { open: point => report('source', `${point.file}:${point.line ?? ''}`) },
    inspector: {
      create: inspectorStandIn,
      highlightSource: async (_node, source) => String(source || '').split('\n').map(escapeHtml),
    },
    report,
  };
}
