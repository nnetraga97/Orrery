// The attached cards and the fault dot (docs/visual-style.md, "Windows and how they are anchored"). The problem card is
// red, beside the bug's planet, with a red dot breathing on the model above it; pinching the card opens the chat with
// the first suggested prompt ready to send. When the workspace no longer holds the bug, card and dot turn `ok` for five
// seconds, then leave. The agent's "Show me" card (show_user) sits beside the file it points at: Show me opens the code
// card at the line, Dismiss puts it away. Cards follow the model as it turns and face the head; no line joins them.
import { AdditiveBlending, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, createSystem } from '@iwsdk/core';
import { heard } from '../core/chat/composer.ts';
import { THEME } from '../core/theme.ts';
import { fileIndex, galaxyState } from '../galaxy-bridge/galaxy-session.js';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { CALLOUT, calloutHue, calloutTitle, drawCallout } from '../panels/draw-problem-card.ts';
import type { Callout } from '../panels/draw-problem-card.ts';
import { loadFonts } from '../panels/fonts.ts';
import { agentPointer, composer, phase, scenario, scenarioState } from '../state/app-state.ts';
import { showChatPage, showCode } from '../state/commands.ts';
import { GalaxySystem } from './galaxy-system.ts';
import { headPosition } from './head.ts';
import { SEAT } from './panel-system.ts';

/** Metres beside and above the anchor a card sits. */
const SIDE = 0.06,
  LIFT = 0.05;
const DOT_RADIUS = 0.006;
const PULSE_SECONDS = 1.6;

type View = { bodyPos?(i: number): { x: number; y: number; z: number }; bodySize?(i: number): number };

export class CalloutSystem extends createSystem({}) {
  private problem!: CanvasPanel;
  private pointer!: CanvasPanel;
  private dot!: Mesh;
  private halo!: Mesh;
  private problemCard: Callout | null = null;
  private pointerCard: Callout | null = null;
  private fontReady = false;
  private head = new Vector3();
  private at = new Vector3();
  private side = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private clock = 0;
  /** Set by the settings: no breathing dot. */
  reduceMotion = false;

  init() {
    const make = (name: string, card: () => Callout | null) => {
      const panel = new CanvasPanel({
        name,
        ...CALLOUT,
        renderer: this.renderer,
        window: { title: () => (card() ? calloutTitle(card()!) : ''), hue: () => (card() ? calloutHue(card()!) : THEME.line), closable: false, movable: true },
      }).attach(this.world);
      panel.eye = SEAT.eye;
      // Over the chat window where they meet.
      panel.mesh.renderOrder = 33;
      panel.visible = false;
      panel.onHover = () => this.draw(panel, card());
      return panel;
    };
    this.problem = make('problem-card', () => this.problemCard);
    this.pointer = make('pointer-card', () => this.pointerCard);
    this.problem.onPress = id => {
      if (id !== 'card') return;
      const prompt = scenario.peek()?.prompts[0];
      showChatPage('transcript');
      if (prompt && !composer.peek().running) composer.value = heard(composer.peek(), prompt);
    };
    this.pointer.onPress = id => {
      const p = agentPointer.peek();
      if (id === 'show' && p) showCode(p.file, p.line ?? 1);
      if (id === 'dismiss' || id === 'show') agentPointer.value = null;
    };
    const dotMaterial = new MeshBasicMaterial({ color: THEME.alert, transparent: true, toneMapped: false, depthWrite: false });
    this.dot = new Mesh(new SphereGeometry(DOT_RADIUS, 16, 12), dotMaterial);
    this.halo = new Mesh(
      new SphereGeometry(DOT_RADIUS * 2.6, 16, 12),
      new MeshBasicMaterial({ color: THEME.alert, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.dot.add(this.halo);
    this.dot.name = 'fault-dot';
    this.dot.visible = false;
    this.world.createTransformEntity(this.dot);
    void loadFonts().then(() => {
      this.fontReady = true;
      this.refresh();
    });
    const refresh = () => this.refresh();
    this.cleanupFuncs.push(scenario.subscribe(refresh), scenarioState.subscribe(refresh), agentPointer.subscribe(refresh), phase.subscribe(refresh), () => {
      this.problem.dispose();
      this.pointer.dispose();
    });
  }

  private refresh() {
    const s = scenario.peek(),
      state = scenarioState.peek(),
      inScene = phase.peek() === 'overview' || phase.peek() === 'landed';
    this.problemCard = s && inScene && (state === 'broken' || state === 'fixed') ? { kind: 'problem', title: s.shortTitle, fn: s.function, fixed: state === 'fixed' } : null;
    const p = agentPointer.peek();
    this.pointerCard = p && inScene ? { kind: 'pointer', ...p } : null;
    const tint = state === 'fixed' ? THEME.ok : THEME.alert;
    (this.dot.material as MeshBasicMaterial).color.set(tint);
    (this.halo.material as MeshBasicMaterial).color.set(tint);
    this.draw(this.problem, this.problemCard);
    this.draw(this.pointer, this.pointerCard);
  }

  private draw(panel: CanvasPanel, card: Callout | null) {
    const show = !!card && this.fontReady;
    if (show !== panel.visible) {
      panel.visible = show;
      panel.moved = false;
    }
    if (show) panel.redraw((ctx, w, h) => drawCallout(ctx, w, h, panel.u, card!, panel.hovered));
  }

  /** A point just above a file's planet, in the room; false while the scene is not up. */
  private anchor(file: string, out: Vector3): boolean {
    const view = galaxyState.view as View | null,
      kit = this.world.getSystem(GalaxySystem)?.host?.kit;
    const i = fileIndex(file);
    if (!view?.bodyPos || i < 0 || !kit) return false;
    const p = view.bodyPos(i),
      r = view.bodySize?.(i) ?? 0;
    out.set(p.x, p.y + r * 1.15, p.z).applyMatrix4(kit.scene.matrixWorld);
    return true;
  }

  /** Beside the anchor and up: on the side toward the view's centre line, because the chat window stands to the
   * left and a card on its far side would sit behind it. */
  private placeCard(panel: CanvasPanel, file: string, lift: number) {
    if (!panel.visible || panel.moved || !this.anchor(file, this.at)) return;
    this.side.copy(this.at).sub(this.head).cross(this.up).normalize();
    if (this.at.x > this.head.x) this.side.negate();
    panel.mesh.position.copy(this.at).addScaledVector(this.side, SIDE + CALLOUT.widthM / 2);
    panel.mesh.position.y += lift;
    panel.face(this.head);
  }

  update(delta: number) {
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.clock += delta;
    const s = scenario.peek();
    if (this.problemCard && s) {
      this.placeCard(this.problem, s.file, LIFT);
      this.dot.visible = this.anchor(s.file, this.at);
      this.dot.position.copy(this.at);
      // One slow breath, 70% to 100%, every 1.6 s.
      const k = this.reduceMotion ? 1 : 0.85 + 0.15 * Math.sin((this.clock / PULSE_SECONDS) * Math.PI * 2);
      (this.dot.material as MeshBasicMaterial).opacity = k;
    } else this.dot.visible = false;
    const p = agentPointer.peek();
    if (this.pointerCard && p) this.placeCard(this.pointer, p.file, p.file === s?.file && this.problemCard ? LIFT + CALLOUT.heightM + 0.04 : LIFT);
    this.problem.tick(delta, this.problem.moved ? this.head : undefined);
    this.pointer.tick(delta, this.pointer.moved ? this.head : undefined);
  }
}
