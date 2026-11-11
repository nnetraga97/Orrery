// The chat window and its tab strip. The window (0.40 × 0.72 m, to the left of the model) is the app's one standing
// window: shown while state.agentOpen is set, hidden from its close mark, moved by its grab bar. It shows the transcript
// (or the chat list, or the settings) above the composer. Pinches go to the agent system by region id; a toggle opens
// or closes a row; pinching and holding the microphone, a question's "Say your answer" or a queued message's "Say it
// again" talks; a vertical drag on the transcript scrolls it. While anything moves (the working glyph, a spinning plan
// step) it redraws ten times a second, otherwise only when something changes. The tab strip rides on the window's left
// edge and stays when the window is closed, so the Chat tab can bring it back.
import { Vector3, createSystem } from '@iwsdk/core';
import type { ComposerView } from '../core/chat/composer-layout.ts';
import { workingLabel } from '../core/chat/describe.ts';
import { chatMetrics, clampScroll, layoutChat, layoutThreadList, stickToBottom } from '../core/chat/layout.ts';
import type { ChatLayout, ChatMetrics } from '../core/chat/layout.ts';
import { titleFor } from '../core/chat/threads.ts';
import { CanvasPanel, STYLE_PX_PER_M } from '../panels/canvas-panel.ts';
import { CHAT_WINDOW } from '../panels/draw-chat-shell.ts';
import { canvasMeasure, chatView, drawChatWindow, isAnimated } from '../panels/draw-chat.ts';
import { composerLayout } from '../panels/draw-composer.ts';
import { drawIcon } from '../panels/icons.ts';
import { TAB_STRIP, TAB_STRIP_OFFSET, drawTabStrip } from '../panels/draw-tab-strip.ts';
import type { TabId } from '../panels/draw-tab-strip.ts';
import { loadFonts } from '../panels/fonts.ts';
import { THEME } from '../panels/paint.ts';
import {
  agentOpen,
  answers,
  changedFiles,
  chatPage,
  chatToggles,
  codeView,
  composer,
  dataset,
  layoutResets,
  paused,
  provider,
  scenario,
  speech,
  thread,
  threads,
  voiceTarget,
} from '../state/app-state.ts';
import { chatAction, goHome, hideChat, pressMic, releaseMic, showChatPage } from '../state/commands.ts';
import { AgentSystem } from './agent-system.ts';
import { headPosition } from './head.ts';
import { PLACEMENTS, SEAT, place } from './panel-system.ts';

export const WELCOME = 'What would you like to fix?';
const FRAME_SECONDS = 0.1;

export class ChatWindowSystem extends createSystem({}) {
  private chat!: CanvasPanel;
  private tabs!: CanvasPanel;
  private fontReady = false;
  private head!: Vector3;
  private offset!: Vector3;
  private dirty = true;
  private since = 0;
  private clock = 0;
  private animated = false;
  private scrollTop = 0;
  private bodyHeight = 0;
  private viewHeight = 0;
  private viewTop = 0;
  private turnStart = 0;
  /** Tabs that do nothing yet; Replay and Settings join when their systems connect (enableTab). */
  private disabled = new Set<TabId>(['search', 'activity', 'replay', 'settings']);
  /** What the Replay and Settings tabs do, once connected. */
  tabActions: Partial<Record<TabId, () => void>> = {};
  /** The settings page's layout and its pinches, once connected (Task 16). */
  settingsPage: { layout(m: ChatMetrics, ctx: CanvasRenderingContext2D): ChatLayout; press(id: string): void } | null = null;
  /** The Activity page, once the activity system connects. */
  activityPage: { layout(m: ChatMetrics, ctx: CanvasRenderingContext2D): ChatLayout; press(id: string): void } | null = null;
  /** The Search page, once the search system connects. */
  searchPage: { layout(m: ChatMetrics, ctx: CanvasRenderingContext2D): ChatLayout; press(id: string): void } | null = null;
  /** Text scale for the chat (a setting). */
  textScale = 1;
  /** Reduce motion (a setting): the working glyph and plan rings stay still. */
  reduceMotion = false;
  /** Left-handed (a setting): the microphone at the composer's left end. */
  micLeft = false;

  /** The transcript's scroll position and whether it is redrawing for motion (for the test hook). */
  get scroll() {
    return { top: this.scrollTop, height: this.bodyHeight, view: this.viewHeight, animated: this.animated };
  }

  /** Redraws with the current settings. */
  refresh() {
    this.dirty = true;
  }

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
      window: { title: () => this.title(), closable: true, movable: true },
    }).attach(this.world);
    this.chat.eye = SEAT.eye;
    place(this.chat, PLACEMENTS.agentPanel);
    this.chat.visible = false;
    this.chat.onClose = () => hideChat();
    this.chat.onHover = () => (this.dirty = true);
    this.chat.onPress = id => this.press(id);
    this.chat.onPressStart = id => this.holdStart(id);
    this.chat.onPressEnd = id => this.holdEnd(id);
    this.chat.onDrag = (_dx, dy) => this.drag(dy);
    this.tabs = new CanvasPanel({ name: 'tab-strip', ...TAB_STRIP, renderer: this.renderer }).attach(this.world);
    this.tabs.mesh.renderOrder = 31;
    this.tabs.onHover = () => this.drawTabs();
    this.tabs.onPress = id => this.tab(id.replace('tab:', '') as TabId);
    void loadFonts().then(() => {
      this.fontReady = true;
      this.dirty = true;
    });
    const touch = () => (this.dirty = true);
    this.cleanupFuncs.push(
      agentOpen.subscribe(touch),
      thread.subscribe(t => {
        if (t?.status === 'running' && !this.turnStart) this.turnStart = performance.now();
        if (t?.status !== 'running') this.turnStart = 0;
        this.dirty = true;
      }),
      composer.subscribe(touch),
      speech.subscribe(touch),
      answers.subscribe(touch),
      chatToggles.subscribe(touch),
      chatPage.subscribe(() => {
        this.scrollTop = 0;
        this.dirty = true;
      }),
      threads.subscribe(touch),
      provider.subscribe(touch),
      codeView.subscribe(touch),
      changedFiles.subscribe(touch),
      scenario.subscribe(touch),
      layoutResets.subscribe(n => {
        if (!n) return;
        this.chat.moved = false;
        place(this.chat, PLACEMENTS.agentPanel);
      }),
      () => {
        this.chat.dispose();
        this.tabs.dispose();
      },
    );
    this.drawTabs();
  }

  /** Lets a tab work (Replay, Settings) once the system behind it is ready. */
  enableTab(id: TabId, action: () => void) {
    this.disabled.delete(id);
    this.tabActions[id] = action;
    this.drawTabs();
  }

  private title() {
    const page = chatPage.peek();
    if (page === 'threads') return 'Agent · Chats';
    if (page === 'settings') return 'Agent · Settings';
    if (page === 'search') return 'Find a file';
    if (page === 'activity') return 'Agent · Activity';
    const t = thread.peek();
    return `Agent · ${t ? titleFor(t) : 'New chat'}`;
  }

  private tab(id: TabId) {
    if (this.disabled.has(id)) return;
    if (id === 'home') goHome();
    else if (id === 'chat') {
      if (agentOpen.peek() && chatPage.peek() === 'transcript') hideChat();
      else showChatPage('transcript');
    } else this.tabActions[id]?.();
  }

  private drawTabs() {
    const page = chatPage.peek();
    const active: TabId | null = !agentOpen.peek() ? null : page === 'settings' ? 'settings' : page === 'search' ? 'search' : page === 'activity' ? 'activity' : 'chat';
    this.tabs.redraw((ctx, w, h) => drawTabStrip(ctx, w, h, { active, hovered: this.tabs.hovered, disabled: [...this.disabled] }));
  }

  // ---------- input ----------

  private press(id: string) {
    if (id === 'header:threads') return showChatPage(chatPage.peek() === 'threads' ? 'transcript' : 'threads');
    if (id.startsWith('toggle:')) {
      const region = this.chat.regions.find(r => r.id === id) as { open?: boolean } | undefined;
      chatToggles.value = new Map(chatToggles.peek()).set(id.slice(7), !region?.open);
      return;
    }
    // Held controls act on press-and-hold, not on the click.
    if (id === 'mic' || id === 'search:mic' || id.startsWith('say:') || id.startsWith('queue:again:')) return;
    if (chatPage.peek() === 'settings' && this.settingsPage) return this.settingsPage.press(id);
    if (chatPage.peek() === 'search' && this.searchPage) return this.searchPage.press(id);
    if (chatPage.peek() === 'activity' && this.activityPage) return this.activityPage.press(id);
    chatAction(id);
  }

  private holdStart(id: string) {
    if (id === 'mic') pressMic({ kind: 'composer' });
    else if (id === 'search:mic') pressMic({ kind: 'search' });
    else if (id.startsWith('say:')) {
      const [, requestId, ...q] = id.split(':');
      pressMic({ kind: 'answer', requestId, questionId: q.join(':') });
    } else if (id.startsWith('queue:again:')) pressMic({ kind: 'queue', id: id.slice('queue:again:'.length) });
    else return;
    this.dirty = true;
  }

  private holdEnd(id: string) {
    if (id === 'mic' || id === 'search:mic' || id.startsWith('say:') || id.startsWith('queue:again:')) releaseMic();
  }

  private drag(dy: number) {
    // Only a pinch that began on the transcript scrolls it.
    const start = this.chat.pinchStart;
    if (!start || start[1] < this.viewTop || start[1] > this.viewTop + this.viewHeight) return;
    this.scrollTop = clampScroll(this.scrollTop - dy, this.bodyHeight, this.viewHeight);
    this.dirty = true;
  }

  // ---------- drawing ----------

  private composerView(): ComposerView {
    const p = provider.peek(),
      view = codeView.peek(),
      range = view?.selectedRange ?? (view && view.selectedRegion != null ? view.regions[view.selectedRegion] : null),
      s = speech.peek(),
      listening = s.phase === 'listening' && voiceTarget.peek().kind === 'composer';
    return {
      state: composer.peek(),
      prompts: scenario.peek()?.prompts ?? ['Explain this project', 'Find a bug', 'Show me the main function'],
      project: dataset.peek() ?? '',
      changedFiles: changedFiles.peek().length,
      looking: view && range ? `${view.file.split('/').pop()}:${range.start}–${range.end}` : null,
      available: p.available,
      mic: s.phase === 'unavailable' ? 'unavailable' : listening ? 'listening' : 'idle',
      partial: listening ? s.text : '',
      providers: p.choices,
      provider: p.id,
      models: p.models,
      model: p.model,
      micLeft: this.micLeft,
    };
  }

  private draw() {
    const open = agentOpen.peek() && this.fontReady;
    this.chat.visible = open;
    this.drawTabs();
    if (!open) return;
    this.chat.redraw((ctx, w, h) => {
      const u = this.chat.u,
        m = chatMetrics(w, this.textScale);
      const page = chatPage.peek();
      const composer = page === 'transcript' ? composerLayout(ctx, this.composerView(), m) : { lines: [], boxes: [], regions: [], height: 0 };
      const view = chatView(w, h, u, composer.height);
      const body = this.body(page, ctx, { ...m, width: view.w });
      const previous = this.bodyHeight;
      if (page === 'transcript' && body.height !== previous)
        this.scrollTop = stickToBottom(this.scrollTop, previous, body.height, this.viewHeight || view.h);
      this.bodyHeight = body.height;
      this.viewHeight = view.h;
      this.viewTop = view.y;
      this.scrollTop = clampScroll(this.scrollTop, body.height, view.h);
      this.animated = isAnimated(body) || isAnimated(composer);
      const regions = drawChatWindow(ctx, w, h, u, body, composer, m, { scrollTop: this.scrollTop, clock: this.clock, hovered: this.chat.hovered, reduceMotion: this.reduceMotion });
      // The chat list button, left of the close mark.
      const size = 26 * u,
        x = w - 19 * u - 18 * u - 14 * u - size,
        y = 18 * u;
      drawIcon(ctx, 'chats', x, y, size, page === 'threads' || this.chat.hovered === 'header:threads' ? THEME.line : THEME.lineDim);
      regions.push({ id: 'header:threads', x: x - 8 * u, y: 0, w: size + 16 * u, h: 36 * u });
      return regions;
    });
  }

  private body(page: string, ctx: CanvasRenderingContext2D, m: ChatMetrics): ChatLayout {
    const measure = canvasMeasure(ctx, m);
    if (page === 'threads') return layoutThreadList(threads.peek(), thread.peek()?.id ?? null, m, measure);
    if (page === 'settings' && this.settingsPage) return this.settingsPage.layout(m, ctx);
    if (page === 'search' && this.searchPage) return this.searchPage.layout(m, ctx);
    if (page === 'activity' && this.activityPage) return this.activityPage.layout(m, ctx);
    const t = thread.peek();
    const items = t?.items ?? [],
      running = t?.status === 'running',
      requests = t?.requests ?? [];
    const agent = this.world.getSystem(AgentSystem);
    const listening = speech.peek().phase === 'listening' && voiceTarget.peek().kind === 'answer' ? voiceTarget.peek() : null;
    return layoutChat(
      {
        items,
        live: running,
        open: chatToggles.peek(),
        welcome: WELCOME,
        working: running && !requests.length ? workingLabel(items, this.turnStart ? performance.now() - this.turnStart : 0) : null,
        error: t?.status === 'failed' && typeof t.error === 'string' ? `Turn failed: ${t.error}` : null,
        footer: requests.length ? 'Waiting for your response' : t?.status === 'stopped' ? 'Stopped' : t?.status === 'failed' ? 'Turn failed' : null,
        requests,
        answers: answers.peek(),
        notices: agent?.requestNotices,
        listening: listening && listening.kind === 'answer' ? `say:${listening.requestId}:${listening.questionId}` : null,
        messageActions: true,
      },
      m,
      measure,
    );
  }

  update(delta: number) {
    if (paused.peek()) return;
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.chat.tick(delta, this.head);
    this.clock += delta;
    this.since += delta;
    // Ten frames a second while anything moves (nothing moves with reduce motion); otherwise only on change.
    // While a turn streams, changes too are drawn at most ten times a second.
    const streaming = thread.peek()?.status === 'running';
    if ((this.dirty && (!streaming || this.since >= FRAME_SECONDS)) || (this.animated && !this.reduceMotion && this.since >= FRAME_SECONDS)) {
      this.dirty = false;
      this.since = 0;
      this.draw();
    }
    // The strip rides on the window's left edge, open or closed.
    const strip = this.tabs.mesh,
      window = this.chat.mesh;
    strip.quaternion.copy(window.quaternion);
    strip.position.copy(this.offset).applyQuaternion(window.quaternion).add(window.position);
  }
}
