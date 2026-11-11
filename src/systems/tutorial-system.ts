// The tutorial: four gestures taught once per device (src/core/tutorial.ts). A panel above the table says what to do
// and offers Skip; a ring pulses around one planet during the first step. Steps advance on app state: a selection, an
// orbit, a landing, a statement shown. Help on the dock starts it again.
import { DoubleSide, Mesh, MeshBasicMaterial, TorusGeometry, Vector3, createSystem } from '@iwsdk/core';
import { TUTORIAL_STEPS, TUTORIAL_TEXT, nextStep } from '../core/tutorial.ts';
import type { TutorialEvent, TutorialStep } from '../core/tutorial.ts';
import type { StoragePort } from '../ports/storage.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { TUTORIAL_PANEL, drawTutorial } from '../panels/draw-tutorial.ts';
import { codeView, orbits, phase, selectedPath, tutorialRestarts, tutorialStep } from '../state/app-state.ts';
import { GalaxySystem } from './galaxy-system.ts';
import { headPosition } from './head.ts';
import { PLACEMENTS, place } from './panel-system.ts';

const SEEN_KEY = 'tutorialSeen';
const RING_RADIUS = 0.035;

export class TutorialSystem extends createSystem({}) {
  private panel!: CanvasPanel;
  private ring!: Mesh;
  private storage: StoragePort | null = null;
  private target: number | null = null;
  private head!: Vector3;
  private at!: Vector3;

  init() {
    this.head = new Vector3();
    this.at = new Vector3();
    this.storage = (this.globals.storage as StoragePort | undefined) ?? null;
    this.panel = new CanvasPanel({ name: 'tutorial', ...TUTORIAL_PANEL, renderer: this.renderer }).attach(this.world);
    place(this.panel, PLACEMENTS.tutorial);
    this.panel.visible = false;
    this.panel.onHover = () => this.draw();
    this.panel.onPress = id => {
      if (id === 'skip') this.raise('skip');
    };
    this.ring = new Mesh(
      new TorusGeometry(RING_RADIUS, 0.003, 8, 64),
      new MeshBasicMaterial({ color: '#7cc4ff', transparent: true, depthTest: false, side: DoubleSide }),
    );
    this.ring.renderOrder = 40;
    this.ring.visible = false;
    this.world.createTransformEntity(this.ring);

    let lastPhase = phase.peek(),
      lastSelected = selectedPath.peek(),
      lastOrbits = orbits.peek(),
      lastRange = codeView.peek()?.selectedRange ?? null,
      lastRestarts = tutorialRestarts.peek();
    this.cleanupFuncs.push(
      phase.subscribe(p => {
        if (p === lastPhase) return;
        lastPhase = p;
        if (p === 'overview' && this.storage?.get(SEEN_KEY) !== '1' && tutorialStep.peek() === 'done') this.start();
        if (p === 'landed') this.raise('landed');
      }),
      selectedPath.subscribe(path => {
        if (path === lastSelected) return;
        lastSelected = path;
        if (path) this.raise('selected');
      }),
      orbits.subscribe(n => {
        if (n === lastOrbits) return;
        lastOrbits = n;
        this.raise('orbited');
      }),
      codeView.subscribe(view => {
        const range = view?.selectedRange ?? null;
        if (range === lastRange) return;
        lastRange = range;
        if (range && phase.peek() === 'landed') this.raise('statementShown');
      }),
      tutorialRestarts.subscribe(n => {
        if (n === lastRestarts) return;
        lastRestarts = n;
        this.start();
      }),
      tutorialStep.subscribe(() => this.draw()),
      () => this.panel.dispose(),
    );
  }

  private start() {
    this.target = null;
    tutorialStep.value = 'point';
  }

  private raise(event: TutorialEvent) {
    const step = tutorialStep.peek();
    const next = nextStep(step, event);
    if (next === step) return;
    tutorialStep.value = next;
    if (next === 'done') this.storage?.set(SEEN_KEY, '1');
  }

  private draw() {
    const step = tutorialStep.peek();
    this.panel.visible = step !== 'done';
    if (step === 'done') return;
    const index = TUTORIAL_STEPS.indexOf(step) + 1;
    this.panel.redraw((ctx, w, h) => drawTutorial(ctx, w, h, step, TUTORIAL_TEXT[step], index, this.panel.hovered));
  }

  /** The planet the first step points at: the largest one. */
  private pickTarget(): number | null {
    const kit = this.world.getSystem(GalaxySystem)?.host.kit;
    if (!kit?.bodyPos || !kit.bodySize) return null;
    const kinds = kit.bodyKind as ((i: number) => string) | undefined;
    let best: number | null = null,
      size = -1;
    for (let i = 0; i < (this.world.getSystem(GalaxySystem)?.host.data.nodes().length ?? 0); i++) {
      if (kinds && kinds(i) !== 'planet') continue;
      const s = kit.bodySize(i);
      if (s > size) {
        size = s;
        best = i;
      }
    }
    return best;
  }

  update(_delta: number, time: number) {
    const step: TutorialStep = tutorialStep.peek();
    const kit = this.world.getSystem(GalaxySystem)?.host.kit;
    const pulsing = step === 'point' && phase.peek() === 'overview' && !!kit?.bodyPos;
    this.ring.visible = pulsing;
    if (!pulsing || !kit?.bodyPos) return;
    this.target ??= this.pickTarget();
    if (this.target == null) return;
    const p = kit.bodyPos(this.target);
    this.at.set(p.x, p.y, p.z).applyMatrix4(kit.scene.matrixWorld);
    headPosition(this.renderer, this.player, this.camera, this.head);
    this.ring.position.copy(this.at);
    this.ring.lookAt(this.head);
    this.ring.scale.setScalar(1 + 0.25 * Math.sin(time * 5));
  }
}
