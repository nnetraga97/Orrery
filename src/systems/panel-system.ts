// Puts the canvas panels in the room and keeps them current: the info card of the pinned item (12 cm above what it
// describes, facing the head) and the loading / error card at the table's centre. Panels redraw only when their
// signal or hover changes.
import { Vector3, createSystem } from '@iwsdk/core';
import { visibleLines, shownRange } from '../core/code-view.ts';
import { panelPlacements } from '../core/layout.ts';
import type { Placement, Seat } from '../core/layout.ts';
import type { ContextItem } from '../ports/host.ts';
import { loadCodeFont } from '../panels/code-font.ts';
import { CODE_LAYOUT, CODE_PAGE, drawCodePage } from '../panels/draw-code-page.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { INFO_CARD, drawInfoCard } from '../panels/draw-info-card.ts';
import type { InfoCard } from '../panels/draw-info-card.ts';
import { STATUS_CARD, drawStatusCard } from '../panels/draw-status-card.ts';
import type { StatusCard } from '../panels/draw-status-card.ts';
import { cardFromItem } from '../panels/info-card-content.ts';
import { codePageOpen, codeScroll, codeView, error, loading, pinned } from '../state/app-state.ts';
import { closeCard, retry } from '../state/commands.ts';
import { GalaxySystem, TABLE_ANCHOR } from './galaxy-system.ts';
import { headPosition } from './head.ts';

const CARD_LIFT = 0.12,
  STATUS_LIFT = 0.18;

/** The seated eye the panels are laid out for (room metres; the user faces -Z). */
export const SEAT: Seat = { eye: [0, 1.2, 0] };
export const PLACEMENTS = panelPlacements(SEAT);

/** Puts a panel mesh at a placement, facing the eye. */
export function place(panel: CanvasPanel, p: Placement) {
  panel.mesh.position.set(p.position[0], p.position[1], p.position[2]);
  panel.mesh.lookAt(p.position[0] + p.facing[0], p.position[1] + p.facing[1], p.position[2] + p.facing[2]);
}

export class PanelSystem extends createSystem({}) {
  private info!: CanvasPanel;
  private status!: CanvasPanel;
  private item: ContextItem | null = null;
  private card: InfoCard | null = null;
  private statusCard: StatusCard | null = null;
  private code!: CanvasPanel;
  private fontReady = false;
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
    this.code = panel('code-page', CODE_PAGE);
    this.code.visible = false;
    place(this.code, PLACEMENTS.codePage);
    this.code.onHover = () => this.drawCode();
    void loadCodeFont().then(() => {
      this.fontReady = true;
      this.drawCode();
    });
    this.cleanupFuncs.push(
      codeView.subscribe(() => this.drawCode()),
      codeScroll.subscribe(() => this.drawCode()),
      codePageOpen.subscribe(() => this.drawCode()),
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
        this.code.dispose();
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

  /** The code page: shown while a landed planet has code and the page is open. */
  drawCode() {
    const view = codeView.peek();
    const show = !!view && view.lines.length > 0 && codePageOpen.peek() && this.fontReady;
    this.code.visible = show;
    if (!show || !view) return;
    const rows = visibleLines(view, { rows: CODE_LAYOUT.rows, columns: CODE_LAYOUT.columns, scrollTop: codeScroll.peek() });
    const region = view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
    const range = shownRange(view);
    this.code.redraw((ctx, w, h) =>
      drawCodePage(ctx, w, h, rows, {
        file: view.file,
        functionName: region?.name ?? null,
        mode: view.mode,
        shown: {
          first: rows[0]?.number ?? range.start,
          last: rows[rows.length - 1]?.number ?? range.start,
          total: view.lines.length,
        },
        hovered: this.code.hovered,
      }),
    );
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
