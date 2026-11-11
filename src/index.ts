// The composition root: creates the world, builds adapters, hands them to systems and registers systems.
import { Vector3, World } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { createBrowserSpeech } from './adapters/browser-speech.ts';
import { createAgentSwitch } from './adapters/agent-switch.ts';
import { createFakeAgent } from './adapters/fake-agent.ts';
import { fetchProviders } from './adapters/http-agent.ts';
import { createFakeSpeech } from './adapters/fake-speech.ts';
import { createLocalStorage } from './adapters/local-storage.ts';
import { PANELS } from './panels/canvas-panel.ts';
import { createStaticDataset } from './adapters/static-dataset.ts';
import { galaxyState } from './galaxy-bridge/galaxy-session.js';
import { appState, composer, provider } from './state/app-state.ts';
import { commands } from './state/commands.ts';
import { AgentSystem } from './systems/agent-system.ts';
import { CalloutSystem } from './systems/callout-system.ts';
import { ChatWindowSystem } from './systems/chat-window-system.ts';
import { GalaxySystem } from './systems/galaxy-system.ts';
import { ManipulationSystem } from './systems/manipulation-system.ts';
import { ReplaySystem } from './systems/replay-system.ts';
import { SettingsSystem } from './systems/settings-system.ts';
import { SoundSystem } from './systems/sound-system.ts';
import './galaxy-bridge/panel-icons.ts';
import { chooseTier, installAssetTier } from './galaxy-bridge/asset-tier.ts';
import { PanelSystem } from './systems/panel-system.ts';
import { PauseSystem } from './systems/pause-system.ts';
import { TutorialSystem } from './systems/tutorial-system.ts';
import { VoiceSystem } from './systems/voice-system.ts';

const query = new URLSearchParams(location.search);
// The headset tier's smaller models and textures in a headset's browser (or with ?tier=quest).
const assetTier = chooseTier(location.search, navigator.userAgent);
installAssetTier(assetTier);

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then(world => {
  world.globals.datasets = createStaticDataset();
  world.globals.storage = createLocalStorage();
  // ?say=Fix%20it|Explain%20the%20fix makes each pinch of the microphone hear the next phrase (tests, demos).
  const say = query.get('say');
  world.globals.speech = say != null ? createFakeSpeech(say.split('|')) : createBrowserSpeech();
  // The recorded agent by default; with ?agent=live, the server relay to a provider it holds a key for.
  const agents = createAgentSwitch(createFakeAgent(query.get('scenario') ?? 'range-edge'), message => {
    composer.value = { ...composer.peek(), notice: message };
    provider.value = { ...provider.peek(), id: 'recorded', label: 'Recorded', available: true };
  });
  world.globals.agent = agents.port;
  const recorded = { id: 'recorded', label: 'Recorded', available: true };
  let known: { id: string; label: string; models: string[]; model: string; available: boolean }[] = [];
  const choose = (id: string) => {
    const p = known.find(x => x.id === id);
    if (id === 'recorded' || !p) {
      agents.choose('recorded', 'Recorded');
      provider.value = { ...provider.peek(), ...recorded, models: [], model: '' };
    } else {
      agents.choose(p.id, p.label);
      provider.value = { ...provider.peek(), id: p.id, label: p.label, available: p.available, models: p.models, model: p.model };
    }
  };
  world.globals.chooseProvider = (kind: string, value: string) => {
    if (kind === 'provider') choose(value);
    else if (kind === 'model') provider.value = { ...provider.peek(), model: value };
  };
  if (query.get('agent') === 'live')
    void fetchProviders().then(list => {
      // Only providers the server holds a key for are offered.
      known = (list ?? []).filter(p => p.available);
      provider.value = { ...provider.peek(), choices: [recorded, ...known.map(p => ({ id: p.id, label: p.label, available: true }))] };
      if (known.length) choose(known[0].id);
      else composer.value = { ...composer.peek(), notice: 'No live provider is set up on the server, so the recorded agent answers.' };
    });
  // ?auto=1 (tests): say the first phrase, send it, choose the first option of every question, approve every edit.
  world.globals.auto = query.get('auto') === '1';
  world.registerSystem(GalaxySystem);
  world.registerSystem(ManipulationSystem);
  world.registerSystem(PanelSystem);
  world.registerSystem(ChatWindowSystem);
  world.registerSystem(TutorialSystem);
  world.registerSystem(VoiceSystem);
  world.registerSystem(AgentSystem);
  world.registerSystem(CalloutSystem);
  world.registerSystem(ReplaySystem);
  world.registerSystem(SoundSystem);
  world.registerSystem(SettingsSystem);
  world.registerSystem(PauseSystem);
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
    /** Where a window's region is in the room, and its regions (tests aim the emulated hands with it). */
    target: (panel: string, region: string) => {
      const p = PANELS.get(panel)?.worldOf(region);
      return p ? { x: p.x, y: p.y, z: p.z } : null;
    },
    /** Where a file's planet is in the room, or the tutorial ring's planet when no file is named (tests aim with it). */
    planet: (path?: string) => {
      const kit = galaxy.host.kit as unknown as { bodyPos(i: number): Vector3; scene: Object3D } | null;
      if (!path) {
        const ring = world.scene.getObjectByName('tutorial-ring');
        if (!ring?.visible) return null;
        const p = ring.getWorldPosition(new Vector3());
        return { x: p.x, y: p.y, z: p.z };
      }
      const i = galaxyState.nodes.findIndex(n => n.path === path);
      if (!kit || i < 0) return null;
      const p = kit.bodyPos(i).clone().applyMatrix4(kit.scene.matrixWorld);
      return { x: p.x, y: p.y, z: p.z };
    },
    regions: (panel: string) => PANELS.get(panel)?.regions.map(r => r.id) ?? [],
    /** The chat transcript's scroll position (tests drag it with an emulated hand). */
    get chatScroll() {
      return world.getSystem(ChatWindowSystem)?.scroll ?? null;
    },
    /** The agent's in-memory workspace (read, changed, diff…). */
    get workspace() {
      return agent.ws;
    },
    get kit() {
      return galaxy.host.kit;
    },
    /** Milliseconds from navigation to the first frame with the galaxy shown and taking input. */
    get startupMs() {
      return appState.startupMs.peek();
    },
    assetTier,
    stats: () => ({
      calls: world.renderer.info.render.calls,
      triangles: world.renderer.info.render.triangles,
      nodes: galaxyState.nodes.length,
    }),
  };
});
