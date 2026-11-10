// Capabilities supplied by the shell. Reads stay live across dataset and revision changes.
import { ctxWin, worldAnchor } from './context-windows.tsx';
import { $ } from './dom.ts';
import { fileAppearance, townKeys, galaxyLayoutNotice, layoutMemory, saveGalaxyMemory } from './galaxy-memory.ts';
import { groupArms, importUse, importsIndexed, membersOf, fetchSymbols, nodeOf } from './graph.ts';
import { selectDebugFrame } from './debug.ts';
import { createPlanetInspector, highlightPlanetSource } from './panels/PlanetInspector.tsx';
import { remember, remembered } from './project-store.ts';
import { beginSceneLoading, scenePaint } from './scene-loading.ts';
import { createSceneObstacles } from './scene-obstacles.ts';
import { openPlanetSource } from './source-navigation.ts';
import { stage, stageViewport } from './stage-viewport.ts';
import { G, actions, projects, state, type Actions } from './state.ts';

export function createRendererHost() {
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
      selectFile: (...args: Parameters<Actions['selectFile']>) => actions.selectFile(...args),
      enterPlanet: (...args: Parameters<Actions['enterPlanet']>) => actions.enterPlanet(...args),
      exitPlanet: () => actions.exitPlanet(),
      showHover: (...args: Parameters<Actions['showHover']>) => actions.showHover(...args),
    },
    overview: () => state.view?.overview?.(),
    // A frame card on a planet selects its frame, as the call stack does, and stays in the world.
    debug: { selectFrame: (index: number) => void selectDebugFrame(index, true) },
    projects: { has: (dataset: string) => projects.has(dataset) },
    dom: $,
    windows: { context: ctxWin, worldAnchor },
    memory: {
      fileAppearance,
      townKeys,
      layoutNotice: galaxyLayoutNotice,
      layout: layoutMemory,
      save: saveGalaxyMemory,
    },
    graph: {
      groupOf: G,
      color: (group: string) => state.color(group),
      groupArms,
      importUse,
      importsIndexed,
      membersOf,
      fetchSymbols,
      nodeOf,
    },
    preferences: { remember, recall: remembered },
    stage: { element: stage, viewport: stageViewport, createObstacles: createSceneObstacles },
    layout: {
      country<T>(build: () => T): T {
        return (state.cache['country-layout'] ||= build()) as T;
      },
    },
    loading: { begin: beginSceneLoading, paint: scenePaint },
    source: { open: openPlanetSource },
    inspector: { create: createPlanetInspector, highlightSource: highlightPlanetSource },
  };
}

export type RendererHost = ReturnType<typeof createRendererHost>;
