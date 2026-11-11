// The chat window and its tab strip. The window (0.40 × 0.72 m, to the left of the model) is the app's one standing
// window: shown while state.agentOpen is set, hidden from its close mark, moved by its grab bar. The tab strip rides on
// its left edge and stays when the window is closed, so the Chat tab can bring it back. Home calls goHome(); Replay and
// Settings arrive in the next plan and are disabled until then.
import { Vector3, createSystem } from '@iwsdk/core';
import { CanvasPanel, STYLE_PX_PER_M } from '../panels/canvas-panel.ts';
import { CHAT_WINDOW, drawChatShell } from '../panels/draw-chat-shell.ts';
import { TAB_STRIP, TAB_STRIP_OFFSET, drawTabStrip } from '../panels/draw-tab-strip.ts';
import type { TabId } from '../panels/draw-tab-strip.ts';
import { loadFonts } from '../panels/fonts.ts';
import { agentOpen } from '../state/app-state.ts';
import { goHome, hideChat, showChat } from '../state/commands.ts';
import { headPosition } from './head.ts';
import { PLACEMENTS, SEAT, place } from './panel-system.ts';

const DISABLED: readonly TabId[] = ['replay', 'settings'];

export class ChatWindowSystem extends createSystem({}) {
  private chat!: CanvasPanel;
  private tabs!: CanvasPanel;
  private fontReady = false;
  private head!: Vector3;
  private offset!: Vector3;

  init() {
    this.head = new Vector3();
    // The strip's centre relative to the window's centre, in the window's own frame (metres).
    const m = 1 / STYLE_PX_PER_M;
    this.offset = new Vector3(
      -CHAT_WINDOW.widthM / 2 - TAB_STRIP_OFFSET.gap * m - TAB_STRIP.widthM / 2,
      CHAT_WINDOW.heightM / 2 - TAB_STRIP_OFFSET.top * m - TAB_STRIP.heightM / 2,
      0,
    );
    this.chat = new CanvasPanel({
      name: 'chat',
      ...CHAT_WINDOW,
      renderer: this.renderer,
      window: { title: 'Agent', closable: true, movable: true },
    }).attach(this.world);
    this.chat.eye = SEAT.eye;
    place(this.chat, PLACEMENTS.agentPanel);
    this.chat.visible = false;
    this.chat.onClose = () => hideChat();
    this.tabs = new CanvasPanel({ name: 'tab-strip', ...TAB_STRIP, renderer: this.renderer }).attach(this.world);
    this.tabs.mesh.renderOrder = 31;
    this.tabs.onHover = () => this.drawTabs();
    this.tabs.onPress = id => {
      if (id === 'tab:home') goHome();
      else if (id === 'tab:chat') showChat();
    };
    void loadFonts().then(() => {
      this.fontReady = true;
      this.drawChat();
    });
    this.cleanupFuncs.push(
      agentOpen.subscribe(() => this.drawChat()),
      () => {
        this.chat.dispose();
        this.tabs.dispose();
      },
    );
    this.drawTabs();
  }

  private drawChat() {
    const open = agentOpen.peek() && this.fontReady;
    this.chat.visible = open;
    if (open) this.chat.redraw((ctx, w, h) => drawChatShell(ctx, w, h, this.chat.u));
    this.drawTabs();
  }

  private drawTabs() {
    const active: TabId | null = agentOpen.peek() ? 'chat' : null;
    this.tabs.redraw((ctx, w, h) => drawTabStrip(ctx, w, h, { active, hovered: this.tabs.hovered, disabled: DISABLED }));
  }

  update(delta: number) {
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.chat.tick(delta, this.head);
    // The strip rides on the window's left edge, open or closed.
    const strip = this.tabs.mesh,
      window = this.chat.mesh;
    strip.quaternion.copy(window.quaternion);
    strip.position.copy(this.offset).applyQuaternion(window.quaternion).add(window.position);
  }
}
