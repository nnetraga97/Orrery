// The composition root: creates the world, builds adapters, hands them to systems and registers systems.
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { galaxyState } from './galaxy-bridge/galaxy-session.js';
import { appState } from './state/app-state.ts';
import { commands } from './state/commands.ts';
import { GalaxySystem } from './systems/galaxy-system.ts';
import { ManipulationSystem } from './systems/manipulation-system.ts';
import { DockSystem } from './systems/dock-system.ts';
import { PanelSystem } from './systems/panel-system.ts';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(world => {
  world.registerSystem(GalaxySystem);
  world.registerSystem(ManipulationSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(DockSystem);
  const galaxy = world.getSystem(GalaxySystem)!;
  window.__orrery = {
    world,
    state: appState,
    commands,
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
