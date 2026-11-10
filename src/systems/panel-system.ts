// Puts the canvas panels in the room and keeps them current: the info card of the pinned item (12 cm above what it
// describes, facing the head) and the loading / error card at the table's centre. Panels redraw only when their
// signal or hover changes.
import { Vector3, createSystem } from '@iwsdk/core';
import type { ContextItem } from '../ports/host.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { INFO_CARD, drawInfoCard } from '../panels/draw-info-card.ts';
import type { InfoCard } from '../panels/draw-info-card.ts';
import { STATUS_CARD, drawStatusCard } from '../panels/draw-status-card.ts';
import type { StatusCard } from '../panels/draw-status-card.ts';
import { cardFromItem } from '../panels/info-card-content.ts';
import { error, loading, pinned } from '../state/app-state.ts';
import { closeCard, retry } from '../state/commands.ts';
import { GalaxySystem, TABLE_ANCHOR } from './galaxy-system.ts';
import { headPosition } from './head.ts';

const CARD_LIFT = 0.12,
  STATUS_LIFT = 0.18;

export class PanelSystem extends createSystem({}) {
  private info!: CanvasPanel;
  private status!: CanvasPanel;
  private item: ContextItem | null = null;
  private card: InfoCard | null = null;
  private statusCard: StatusCard | null = null;
  private head!: Vector3;
  private at!: Vector3;

  init() {
    this.head = new Vector3();
    this.at = new Vector3();
    const panel = (name: string, size: typeof INFO_CARD) =>
      new CanvasPanel({ name, ...size, renderer: this.renderer }).attach(this.world);
    this.info = panel('info-card', INFO_CARD);
    this.info.visible = false;
    this.info.onHover = () => this.drawInfo();
    this.info.onPress = id => {
      if (id === 'close') closeCard();
      else if (id.startsWith('action:')) this.item?.actions?.[Number(id.slice(7))]?.onClick();
    };
    this.status = panel('status-card', STATUS_CARD);
    this.status.visible = false;
    this.status.onHover = () => this.drawStatus();
    this.status.onPress = id => {
      if (id === 'retry') retry();
    };
    this.cleanupFuncs.push(
      pinned.subscribe(item => {
        this.item = item;
        this.card = item ? cardFromItem(item) : null;
        this.drawInfo();
      }),
      loading.subscribe(() => this.updateStatus()),
      error.subscribe(() => this.updateStatus()),
      () => {
        this.info.dispose();
        this.status.dispose();
      },
    );
  }

  private updateStatus() {
    const l = loading.peek(),
      e = error.peek();
    this.statusCard = e
      ? { kind: 'error', text: e }
      : l
        ? { kind: 'loading', title: l.title, detail: l.detail }
        : null;
    this.drawStatus();
  }

  private drawInfo() {
    const card = this.card;
    this.info.visible = !!card;
    if (card) this.info.redraw((ctx, w, h) => drawInfoCard(ctx, w, h, card, this.info.hovered));
  }

  private drawStatus() {
    const status = this.statusCard;
    this.status.visible = !!status;
    if (status) this.status.redraw((ctx, w, h) => drawStatusCard(ctx, w, h, status, this.status.hovered));
  }

  update() {
    headPosition(this.renderer, this.player, this.camera, this.head);
    if (this.info.visible) {
      const anchor = this.item?.anchor;
      const kit = this.world.getSystem(GalaxySystem)?.host.kit;
      if (anchor && kit) {
        // anchor.world() is a point in the model; the model's world matrix is its pose on the table (modelToRoom).
        const p = anchor.world();
        this.at.set(p.x, p.y, p.z).applyMatrix4(kit.scene.matrixWorld);
      } else this.at.set(TABLE_ANCHOR.position[0], TABLE_ANCHOR.position[1], TABLE_ANCHOR.position[2]);
      this.at.y += CARD_LIFT;
      this.info.mesh.position.copy(this.at);
      this.info.mesh.lookAt(this.head);
    }
    if (this.status.visible) {
      this.status.mesh.position.set(TABLE_ANCHOR.position[0], TABLE_ANCHOR.position[1] + STATUS_LIFT, TABLE_ANCHOR.position[2]);
      this.status.mesh.lookAt(this.head);
    }
  }
}
