// Electron checks (checks/*.cjs) drive the viewer through page.evaluate with these global names.
// They are not used by the viewer itself.
import { createPlanetDetail } from '../planet/planet.js';
import { buildTowns } from '../towns/towns.js';
import { createTraffic } from '../traffic/traffic.js';
import { ctxWin } from './context-windows.tsx';
import { $ } from './dom.ts';
import { actions, state } from './state.ts';
import { galaxyMemory } from './galaxy-memory.ts';
import { chatStore } from './codex-chat.ts';
import type { RendererHost } from './host.ts';

export function installCheckSurface(host: RendererHost) {
  const stateKeys = ['nodes', 'dataset', 'view', 'selected', 'revision', 'generation'] as const;
  for (const key of stateKeys) Object.defineProperty(window, key, { get: () => state[key], configurable: true });
  const actionKeys = ['enterPlanet', 'exitPlanet', 'render'] as const;
  for (const key of actionKeys) Object.defineProperty(window, key, { get: () => actions[key], configurable: true });
  Object.assign(window, {
    $, ctxWin, buildTowns, createTraffic, galaxyMemory,
    createPlanetDetail: (fileIdx: number, scene: unknown, options: Parameters<typeof createPlanetDetail>[2]) =>
      createPlanetDetail(fileIdx, scene, options, host),
  });
  Object.defineProperty(window, 'chatState', { get: () => chatStore.get(), configurable: true });
}
