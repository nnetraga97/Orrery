// The settings: loaded from this device at start, shown in the Settings tab of the chat window, stored on each change,
// and applied where they act: text size (the chat relays out; the cards grow), seat height (the room's content moves
// up or down), the microphone's side, high contrast (every window redraws in black and white), reduce motion, sound,
// the provider, model and effort, the permission and mode, and whether the scene follows the agent. Choosing a
// project opens it; Restart tutorial and Reset layout are here too.
import { createSystem } from '@iwsdk/core';
import { canvasMeasure } from '../panels/draw-chat.ts';
import { layoutSettings } from '../core/settings-layout.ts';
import { applyChoice, loadSettings } from '../core/settings.ts';
import type { Settings } from '../core/settings.ts';
import { applyContrast } from '../core/theme.ts';
import type { DatasetPort } from '../ports/dataset.ts';
import type { StoragePort } from '../ports/storage.ts';
import { MOTION, PANELS } from '../panels/canvas-panel.ts';
import { composer, dataset, provider, settings, soundLevel } from '../state/app-state.ts';
import { openDataset, resetLayout, restartTutorial, showChatPage } from '../state/commands.ts';
import { CalloutSystem } from './callout-system.ts';
import { ChatWindowSystem } from './chat-window-system.ts';

const KEY = 'settings';
/** Bumped when a default changes in a way stored copies should pick up (2: the scene follows the agent). */
const VERSION_KEY = 'settingsVersion',
  VERSION = '2';
/** Windows that grow with the text size (the chat relays out instead). */
const SCALED = ['code-card', 'info-card', 'problem-card', 'pointer-card', 'debug-card', 'status-card'];

export class SettingsSystem extends createSystem({}) {
  private storage: StoragePort | null = null;
  private projects: { name: string; title: string }[] = [];
  private applied: Settings | null = null;

  init() {
    this.storage = (this.globals.storage as StoragePort | undefined) ?? null;
    const stored = loadSettings(this.storage?.get(KEY) ?? null);
    // Settings are stored on first load, so a copy from before version 2 holds the old default for "Follow the agent"
    // (off), not a choice: it is switched on once.
    const current = this.storage?.get(VERSION_KEY) === VERSION;
    if (!current) this.storage?.set(VERSION_KEY, VERSION);
    settings.value = current ? stored : { ...stored, followAgent: true };
    void (this.globals.datasets as DatasetPort | undefined)
      ?.list()
      .then(list => {
        this.projects = list.map(p => ({ name: p.name, title: p.title || p.name }));
        this.world.getSystem(ChatWindowSystem)?.refresh();
      })
      .catch(() => {});
    const chat = this.world.getSystem(ChatWindowSystem);
    if (chat) {
      chat.settingsPage = {
        layout: (m, ctx) =>
          layoutSettings(
            {
              settings: settings.peek(),
              projects: this.projects,
              project: dataset.peek(),
              providers: provider.peek().choices.map(c => ({ id: c.id, label: c.label })),
              models: provider.peek().models,
            },
            m,
            canvasMeasure(ctx, m),
          ),
        press: id => this.press(id),
      };
      chat.enableTab('settings', () => showChatPage('settings'));
    }
    this.cleanupFuncs.push(
      settings.subscribe(s => this.apply(s)),
      // The composer's More row also sets the mode and permission: keep the settings in step.
      composer.subscribe(c => {
        const s = settings.peek();
        if (c.mode !== s.mode || c.permission !== s.permission) settings.value = { ...s, mode: c.mode, permission: c.permission };
      }),
      provider.subscribe(() => this.world.getSystem(ChatWindowSystem)?.refresh()),
    );
  }

  private press(id: string) {
    const [kind, key, ...rest] = id.split(':');
    if (kind === 'set') settings.value = applyChoice(settings.peek(), key, rest.join(':'));
    else if (kind === 'project' && key && key !== dataset.peek()) openDataset(key);
    else if (id === 'action:restartTutorial') restartTutorial();
    else if (id === 'action:resetLayout') resetLayout();
  }

  private apply(s: Settings) {
    const before = this.applied;
    this.applied = s;
    this.storage?.set(KEY, JSON.stringify(s));
    const chat = this.world.getSystem(ChatWindowSystem);
    if (chat) {
      chat.textScale = s.textScale;
      chat.reduceMotion = s.reduceMotion;
      chat.micLeft = s.handedness === 'left';
      chat.refresh();
    }
    MOTION.reduce = s.reduceMotion;
    const callouts = this.world.getSystem(CalloutSystem);
    if (callouts) callouts.reduceMotion = s.reduceMotion;
    for (const name of SCALED) PANELS.get(name)?.mesh.scale.setScalar(s.textScale);
    // Seat height: the room's content moves with the seat (the player's origin moves the other way).
    this.player.position.y = -s.seatHeight;
    if (!before || before.highContrast !== s.highContrast) {
      applyContrast(s.highContrast);
      for (const panel of PANELS.values()) panel.refresh();
    }
    soundLevel.value = { volume: s.volume, mute: s.mute };
    if (!before || before.provider !== s.provider || before.model !== s.model) {
      const choose = this.globals.chooseProvider as ((kind: string, value: string) => void) | undefined;
      if (!before || before.provider !== s.provider) choose?.('provider', s.provider);
      if (s.model) choose?.('model', s.model);
    }
    const c = composer.peek();
    if (c.mode !== s.mode || c.permission !== s.permission) composer.value = { ...c, mode: s.mode, permission: s.permission };
    this.globals.followAgent = () => settings.peek().followAgent;
    this.globals.effort = () => settings.peek().effort;
  }
}
