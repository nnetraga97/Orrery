// The attached cards and the fault dot (docs/visual-style.md, "Windows and how they are anchored"). The problem card is
// red, beside the bug's planet, with a red dot breathing on the model above it; pinching the card opens the chat with
// the first suggested prompt ready to send. When the workspace no longer holds the bug, card and dot turn `ok` for five
// seconds, then leave. The agent's "Show me" card (show_user) sits beside the file it points at: Show me opens the code
// card at the line, Dismiss puts it away. Cards follow the model as it turns and face the head; no line joins them.
// While the user is landed on a function of a card's own file, that file's star is far off: the card docks above the
// code card instead (above the globe when the code card is closed), so the green "Fixed" card and the debugging card
// stay in view through the replay. Once the code card shows the agent's message itself, the pointer card steps aside.
import { AdditiveBlending, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, createSystem } from '@iwsdk/core';
import { heard } from '../core/chat/composer.ts';
import { THEME } from '../core/theme.ts';
import { fileIndex, galaxyState } from '../galaxy-bridge/galaxy-session.js';
import { CanvasPanel, PANELS } from '../panels/canvas-panel.ts';
import { CALLOUT, POINTER_CARD, calloutHue, calloutTitle, drawCallout } from '../panels/draw-problem-card.ts';
import type { Callout } from '../panels/draw-problem-card.ts';
import { loadFonts } from '../panels/fonts.ts';
import { agentPointer, codeCardOpen, codeView, composer, landedPath, layoutResets, paused, phase, replay, scenario, scenarioState } from '../state/app-state.ts';
import { dismissReplayNotice, followReplay, showChatPage, showCode } from '../state/commands.ts';
import { GalaxySystem, LANDED_CENTER, LANDED_GLOBE_DIAMETER } from './galaxy-system.ts';
import { headPosition } from './head.ts';
import { SEAT } from './panel-system.ts';

/** Metres beside and above the anchor a card sits. */
const SIDE = 0.06,
  LIFT = 0.05;
const DOT_RADIUS = 0.006;
/** Beyond this from the head an anchor is out of reach (its planet scaled away while another is landed): the card
 * and the dot wait, hidden, until it comes back. */
const MAX_REACH = 2.5;
const PULSE_SECONDS = 1.6;
/** Between docked cards, and between the lowest one and what it docks above. */
const DOCK_GAP = 0.02;
/** Above the landed globe's top, clear of the town's labels. */
const GLOBE_CLEARANCE = 0.08;

type View = { bodyPos?(i: number): { x: number; y: number; z: number }; bodySize?(i: number): number };

export class CalloutSystem extends createSystem({}) {
  private problem!: CanvasPanel;
  private pointer!: CanvasPanel;
  private debug!: CanvasPanel;
  private dot!: Mesh;
  private halo!: Mesh;
  private problemCard: Callout | null = null;
  private pointerCard: Callout | null = null;
  private debugCard: Callout | null = null;
  private fontReady = false;
  private head = new Vector3();
  private at = new Vector3();
  private side = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private dockUp = new Vector3();
  /** How high the docked cards are stacked so far this frame. */
  private docked = 0;
  private codeFile: string | null = null;
  private clock = 0;
  /** Set by the settings: no breathing dot. */
  reduceMotion = false;

  init() {
    const make = (name: string, card: () => Callout | null, size = CALLOUT) => {
      const panel = new CanvasPanel({
        name,
        ...size,
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
    this.pointer = make('pointer-card', () => this.pointerCard, POINTER_CARD);
    this.debug = make('debug-card', () => this.debugCard);
    this.debug.onPress = id => {
      if (id === 'follow') followReplay(true);
      else if (id === 'stopFollowing') followReplay(false);
      else if (id === 'dismiss') dismissReplayNotice();
    };
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
    this.cleanupFuncs.push(layoutResets.subscribe(() => {
      this.problem.moved = this.pointer.moved = this.debug.moved = false;
    }), scenario.subscribe(refresh), scenarioState.subscribe(refresh), agentPointer.subscribe(refresh), phase.subscribe(refresh), replay.subscribe(refresh), codeCardOpen.subscribe(refresh), landedPath.subscribe(refresh), codeView.subscribe(v => {
      // Only a change of file matters here (the view also changes on every hover).
      const file = v?.file ?? null;
      if (file === this.codeFile) return;
      this.codeFile = file;
      this.refresh();
    }), () => {
      this.problem.dispose();
      this.pointer.dispose();
      this.debug.dispose();
    });
  }

  private refresh() {
    const s = scenario.peek(),
      state = scenarioState.peek(),
      inScene = phase.peek() === 'overview' || phase.peek() === 'landed';
    this.problemCard = s && inScene && (state === 'broken' || state === 'fixed') ? { kind: 'problem', title: s.shortTitle, fn: s.function, fixed: state === 'fixed' } : null;
    const p = agentPointer.peek();
    // The code card shows the agent's message itself once it is open on the pointer's file.
    const onCodeCard = !!p && codeCardOpen.peek() && codeView.peek()?.file === p.file && landedPath.peek() === p.file;
    this.pointerCard = p && inScene && !onCodeCard ? { kind: 'pointer', ...p } : null;
    const tint = state === 'fixed' ? THEME.ok : THEME.alert;
    (this.dot.material as MeshBasicMaterial).color.set(tint);
    (this.halo.material as MeshBasicMaterial).color.set(tint);
    this.draw(this.problem, this.problemCard);
    this.draw(this.pointer, this.pointerCard);
    const r = replay.peek();
    this.debugCard = r && inScene && !r.noticeDismissed ? { kind: 'debug', file: r.file, line: r.line, following: r.following } : null;
    this.draw(this.debug, this.debugCard);
  }

  private draw(panel: CanvasPanel, card: Callout | null) {
    const show = !!card && this.fontReady && !panel.mesh.userData.outOfReach;
    if (show !== panel.visible) {
      panel.visible = show;
      panel.moved = false;
    }
    if (show) panel.redraw((ctx, w, h) => drawCallout(ctx, w, h, panel.u, card!, panel.hovered));
  }

  /** A point just above a file's planet (`height` planet sizes up), in the room; false while the scene is not up. */
  private anchor(file: string, out: Vector3, height = 1.15): boolean {
    const view = galaxyState.view as View | null,
      kit = this.world.getSystem(GalaxySystem)?.host?.kit;
    const i = fileIndex(file);
    if (!view?.bodyPos || i < 0 || !kit) return false;
    const p = view.bodyPos(i),
      r = view.bodySize?.(i) ?? 0;
    out.set(p.x, p.y + r * height, p.z).applyMatrix4(kit.scene.matrixWorld);
    return true;
  }

  /** Beside the anchor and up: on the side toward the view's centre line, because the chat window stands to the
   * left and a card on its far side would sit behind it. */
  private placeCard(panel: CanvasPanel, file: string, lift: number, height = 1.15) {
    if (panel.moved || !panel.visible && !panel.mesh.userData.outOfReach) return;
    if (!this.anchor(file, this.at, height)) return;
    // Out of reach (another planet is landed): hidden until the anchor comes back. Landed on this file's own function,
    // the card docks instead.
    const away = this.at.distanceTo(this.head) > MAX_REACH,
      dock = away && phase.peek() === 'landed' && landedPath.peek() === file,
      far = away && !dock;
    if (far !== !!panel.mesh.userData.outOfReach) {
      panel.mesh.userData.outOfReach = far;
      panel.visible = !far;
      // Back in reach: drawn again, in case the card changed while it was away.
      if (!far) this.refresh();
    }
    if (far) return;
    if (dock) return this.dock(panel);
    this.side.copy(this.at).sub(this.head).cross(this.up).normalize();
    if (this.at.x > this.head.x) this.side.negate();
    panel.mesh.position.copy(this.at).addScaledVector(this.side, SIDE + CALLOUT.widthM / 2);
    panel.mesh.position.y += lift;
    panel.face(this.head);
  }

  /** Stacks a card above the code card's top edge, or above the landed globe when the code card is closed. */
  private dock(panel: CanvasPanel) {
    const code = PANELS.get('code-card'),
      h = panel.glassHeightM * panel.mesh.scale.y;
    if (code?.visible) {
      this.dockUp.set(0, 1, 0).applyQuaternion(code.mesh.quaternion);
      panel.mesh.position.copy(code.mesh.position).addScaledVector(this.dockUp, (code.glassHeightM * code.mesh.scale.y) / 2 + DOCK_GAP + this.docked + h / 2);
      panel.mesh.quaternion.copy(code.mesh.quaternion);
    } else {
      panel.mesh.position.set(LANDED_CENTER[0], LANDED_CENTER[1] + LANDED_GLOBE_DIAMETER / 2 + GLOBE_CLEARANCE + this.docked + h / 2, LANDED_CENTER[2]);
      panel.face(this.head);
    }
    this.docked += h + DOCK_GAP;
  }

  /** Whether two cards' centres are close enough for the cards to overlap. */
  private overlaps(a: CanvasPanel, b: CanvasPanel) {
    return a.visible && b.visible && !a.moved && !b.moved && Math.abs(a.mesh.position.y - b.mesh.position.y) < (a.glassHeightM + b.glassHeightM) / 2 && a.mesh.position.distanceTo(b.mesh.position) < CALLOUT.widthM;
  }

  update(delta: number) {
    if (paused.peek()) return;
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.clock += delta;
    this.docked = 0;
    const s = scenario.peek();
    if (this.problemCard && s) {
      this.placeCard(this.problem, s.file, LIFT);
      this.dot.visible = this.anchor(s.file, this.at) && this.at.distanceTo(this.head) <= MAX_REACH;
      this.dot.position.copy(this.at);
      // One slow breath, 70% to 100%, every 1.6 s.
      const k = this.reduceMotion ? 1 : 0.85 + 0.15 * Math.sin((this.clock / PULSE_SECONDS) * Math.PI * 2);
      (this.dot.material as MeshBasicMaterial).opacity = k;
    } else this.dot.visible = false;
    const p = agentPointer.peek();
    if (this.pointerCard && p) {
      this.placeCard(this.pointer, p.file, LIFT);
      // Beside the same or a neighbouring file as the problem card: it sits above that card, not over it.
      if (this.problemCard && this.docked === 0 && this.overlaps(this.pointer, this.problem)) {
        this.pointer.mesh.position.copy(this.problem.mesh.position);
        this.pointer.mesh.position.y += (CALLOUT.heightM + POINTER_CARD.heightM) / 2 + DOCK_GAP;
        this.pointer.mesh.quaternion.copy(this.problem.mesh.quaternion);
      }
    }
    // The debugging card sits beside the execution ship, which hovers about two planet sizes above its planet.
    const r = replay.peek();
    if (this.debugCard && r) this.placeCard(this.debug, r.file, 0.02, 1.9);
    this.debug.tick(delta, this.debug.moved ? this.head : undefined);
    this.problem.tick(delta, this.problem.moved ? this.head : undefined);
    this.pointer.tick(delta, this.pointer.moved ? this.head : undefined);
  }
}
