// Choosing a project: with no ?dataset= in the address, one card per project stands above the table; pinching one
// opens it. The list comes from the DatasetPort the composition root hands over in world.globals.datasets.
import { createSystem } from '@iwsdk/core';
import type { DatasetEntry, DatasetPort } from '../ports/dataset.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { PROJECT_CARD, drawProjectCard } from '../panels/draw-project-picker.ts';
import { dataset, error, phase } from '../state/app-state.ts';
import { openDataset } from '../state/commands.ts';
import { SEAT } from './panel-system.ts';

const CARD_GAP = 0.03,
  CARD_DISTANCE = 0.75,
  CARD_HEIGHT = 1.02;

export class PickerSystem extends createSystem({}) {
  private cards: CanvasPanel[] = [];
  /** Whether the picker is showing its cards. */
  shown = false;

  init() {
    const port = this.globals.datasets as DatasetPort | undefined;
    if (!port || dataset.peek()) return;
    port
      .list()
      .then(projects => this.show(projects))
      .catch((failure: Error) => {
        error.value = `Could not list the projects: ${failure.message}`;
      });
    this.cleanupFuncs.push(
      phase.subscribe(p => {
        if (p !== 'idle') this.hide();
      }),
      () => this.hide(),
    );
  }

  private show(projects: DatasetEntry[]) {
    if (dataset.peek()) return;
    const total = projects.length * PROJECT_CARD.widthM + (projects.length - 1) * CARD_GAP;
    projects.forEach((project, k) => {
      const card = new CanvasPanel({ name: `project-${project.name}`, ...PROJECT_CARD, renderer: this.renderer }).attach(
        this.world,
      );
      const draw = () => card.redraw((ctx, w, h) => drawProjectCard(ctx, w, h, project, card.hovered));
      card.onHover = draw;
      card.onPress = () => openDataset(project.name);
      draw();
      const x = -total / 2 + PROJECT_CARD.widthM / 2 + k * (PROJECT_CARD.widthM + CARD_GAP);
      card.mesh.position.set(x, CARD_HEIGHT, -CARD_DISTANCE);
      card.mesh.lookAt(SEAT.eye[0], SEAT.eye[1], SEAT.eye[2]);
      this.cards.push(card);
    });
    this.shown = true;
  }

  private hide() {
    for (const card of this.cards) card.dispose();
    this.cards = [];
    this.shown = false;
  }
}
