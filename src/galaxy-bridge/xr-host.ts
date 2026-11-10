// The host the copied scene code runs in, for the XR app. Same structure as src/flat/flat-host.js; the differences:
// context windows and loading publish to signals (src/state/app-state.ts) instead of writing to the page, the stage
// is a fixed virtual viewport, and the host supplies the XR scene kit (`sceneKit`, used by the patched
// constellation.js) instead of letting the constellation build a desktop renderer.
import type { WebGLRenderer } from '@iwsdk/core';
import {
  G,
  actions,
  fetchSymbols,
  fileAppearance,
  galaxyLayoutNotice,
  groupArms,
  importUse,
  importsIndexed,
  layoutMemory,
  membersOf,
  nodeOf,
  projects,
  remember,
  remembered,
  saveGalaxyMemory,
  galaxyState as state,
  townKeys,
} from './galaxy-session.js';
import type { TableAnchor } from '../core/table-frame.ts';
import type { ContextItem, ContextWindows, HostPort, InspectorPort, StageViewport, Viewport } from '../ports/host.ts';
import { hovered, loading, pinned } from '../state/app-state.ts';
import { createSceneKit } from './scene-kit.js';
import type { LabelSink, OverlaySink, XrSceneKit } from './scene-kit.js';

const escapeHtml = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

// The copied code sizes things from the stage; the virtual camera's aspect is 1.6.
const VIEWPORT: Viewport = { width: 1600, height: 1000, left: 0, top: 0, visible: true };
const viewport: StageViewport = {
  get: () => VIEWPORT,
  refresh() {},
  subscribe: () => () => {},
};

function createContextWindows(): ContextWindows {
  return {
    esc: escapeHtml,
    hover(item) {
      hovered.value = item || null;
    },
    pin(item) {
      pinned.value = item || null;
    },
    close() {
      pinned.value = null;
    },
    place() {},
    refresh() {},
    get pinned() {
      return pinned.peek();
    },
  };
}

// The planet inspector stand-in: accepts every call and shows nothing (Task 13 replaces it).
const inspectorStandIn = (): InspectorPort =>
  new Proxy({} as InspectorPort, {
    get: (_, name) => (name === 'then' ? undefined : () => undefined),
  });

export interface XrHostServices {
  renderer: WebGLRenderer;
  anchor: TableAnchor;
  labels?: LabelSink;
  overlays?: OverlaySink;
}

export interface XrHost extends HostPort {
  /** Builds the XR scene kit; the patched constellation.js calls this instead of scene3D. */
  sceneKit(camPos: [number, number, number], options?: { space?: boolean }): XrSceneKit;
  /** The kit, once the constellation has built it. */
  readonly kit: XrSceneKit | null;
}

export function createXrHost(services: XrHostServices): XrHost {
  let kit: XrSceneKit | null = null;
  let loadingOwner: object | null = null;
  const host: XrHost = {
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
    dom: id => document.getElementById(id),
    windows: { context: createContextWindows(), worldAnchor: getPos => ({ world: getPos }) },
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
      element: document.getElementById('stage'),
      viewport,
      createObstacles: () => ({ appendTo() {}, dispose() {} }),
    },
    layout: {
      country<T>(build: () => T): T {
        return (state.cache['country-layout'] ||= build()) as T;
      },
    },
    loading: {
      begin(title, detail) {
        const token = {};
        loadingOwner = token;
        loading.value = { title, detail };
        return {
          update(message) {
            if (loadingOwner === token) loading.value = { title, detail: message };
          },
          finish() {
            if (loadingOwner !== token) return;
            loadingOwner = null;
            loading.value = null;
          },
        };
      },
      paint: () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))),
    },
    source: { open() {} },
    inspector: {
      create: inspectorStandIn,
      highlightSource: async (_node, source) => String(source || '').split('\n').map(escapeHtml),
    },
    sceneKit(camPos) {
      kit = createSceneKit({
        camPos,
        host,
        renderer: services.renderer,
        anchor: services.anchor,
        labels: services.labels,
        overlays: services.overlays,
      });
      return kit;
    },
    get kit() {
      return kit;
    },
  };
  return host;
}

export type { ContextItem };
