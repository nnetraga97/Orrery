// The composition root: creates the world, builds adapters, hands them to systems and registers systems.
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { createLocalStorage } from './adapters/local-storage.ts';
import { createStaticDataset } from './adapters/static-dataset.ts';
import { galaxyState } from './galaxy-bridge/galaxy-session.js';
import { appState } from './state/app-state.ts';
import { commands } from './state/commands.ts';
import { ChatWindowSystem } from './systems/chat-window-system.ts';
import { GalaxySystem } from './systems/galaxy-system.ts';
import { ManipulationSystem } from './systems/manipulation-system.ts';
import './galaxy-bridge/panel-icons.ts';
import { PanelSystem } from './systems/panel-system.ts';
import { TutorialSystem } from './systems/tutorial-system.ts';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(world => {
  world.globals.datasets = createStaticDataset();
  world.globals.storage = createLocalStorage();
  world.registerSystem(GalaxySystem);
  world.registerSystem(ManipulationSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(ChatWindowSystem);
  world.registerSystem(TutorialSystem);
  const galaxy = world.getSystem(GalaxySystem)!;
  window.__orrery = {
    world,
    state: appState,
    commands,
    /** True once the galaxy is built and attached. */
    get ready() {
      return galaxy.ready;
    },
    get kit() {
      return galaxy.host.kit;
    },
    stats: () => ({
      calls: world.renderer.info.render.calls,
      triangles: world.renderer.info.render.triangles,
      nodes: galaxyState.nodes.length,
    }),
  };
});
