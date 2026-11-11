// The composition root: creates the world, builds adapters, hands them to systems and registers systems.
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { createBrowserSpeech } from './adapters/browser-speech.ts';
import { createFakeAgent } from './adapters/fake-agent.ts';
import { createFakeSpeech } from './adapters/fake-speech.ts';
import { createLocalStorage } from './adapters/local-storage.ts';
import { createStaticDataset } from './adapters/static-dataset.ts';
import { galaxyState } from './galaxy-bridge/galaxy-session.js';
import { appState } from './state/app-state.ts';
import { commands } from './state/commands.ts';
import { AgentSystem } from './systems/agent-system.ts';
import { ChatWindowSystem } from './systems/chat-window-system.ts';
import { GalaxySystem } from './systems/galaxy-system.ts';
import { ManipulationSystem } from './systems/manipulation-system.ts';
import './galaxy-bridge/panel-icons.ts';
import { PanelSystem } from './systems/panel-system.ts';
import { TutorialSystem } from './systems/tutorial-system.ts';
import { VoiceSystem } from './systems/voice-system.ts';

const query = new URLSearchParams(location.search);

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(world => {
  world.globals.datasets = createStaticDataset();
  world.globals.storage = createLocalStorage();
  // ?say=Fix%20it|Explain%20the%20fix makes each pinch of the microphone hear the next phrase (tests, demos).
  const say = query.get('say');
  world.globals.speech = say != null ? createFakeSpeech(say.split('|')) : createBrowserSpeech();
  // The recorded agent by default; the live one arrives with the server relay.
  world.globals.agent = createFakeAgent(query.get('scenario') ?? 'range-edge');
  // ?auto=1 (tests): say the first phrase, send it, choose the first option of every question, approve every edit.
  world.globals.auto = query.get('auto') === '1';
  world.registerSystem(GalaxySystem);
  world.registerSystem(ManipulationSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(ChatWindowSystem);
  world.registerSystem(TutorialSystem);
  world.registerSystem(VoiceSystem);
  world.registerSystem(AgentSystem);
  const agent = world.getSystem(AgentSystem)!;
  const galaxy = world.getSystem(GalaxySystem)!;
  window.__orrery = {
    world,
    state: appState,
    commands,
    /** True once the galaxy is built and attached. */
    get ready() {
      return galaxy.ready;
    },
    /** The agent's in-memory workspace (read, changed, diff…). */
    get workspace() {
      return agent.ws;
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
