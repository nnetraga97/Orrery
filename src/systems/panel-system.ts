// Puts the windows in the room and keeps them current: the attached card of a pinned item (12 cm above and 8 cm to the
// side of what it describes, facing the head, no line), the loading / error card in front of the model, and the code
// card to the right of the model while a function or a range is selected. Files get no card: a selected file shows
// only its marker. Windows redraw only when their signal or hover changes.
import { Vector3, createSystem } from '@iwsdk/core';
import { hasSelection, shownRange, visibleLines } from '../core/code-view.ts';
import { panelPlacements } from '../core/layout.ts';
import type { Placement, Seat } from '../core/layout.ts';
import { dragScroll } from '../core/scroll.ts';
import { THEME } from '../core/theme.ts';
import { cardMaxScroll, hoverLine, pressLine } from '../galaxy-bridge/inspector.ts';
import type { ContextItem } from '../ports/host.ts';
import { CanvasPanel } from '../panels/canvas-panel.ts';
import { CODE_CARD, CODE_LAYOUT, codeCardSize, drawCodeCard } from '../panels/draw-code-card.ts';
import { INFO_CARD, drawInfoCard, infoCardTitle } from '../panels/draw-info-card.ts';
import type { InfoCard } from '../panels/draw-info-card.ts';
import { STATUS_CARD, drawStatusCard, statusTitle } from '../panels/draw-status-card.ts';
import type { StatusCard } from '../panels/draw-status-card.ts';
import { loadFonts } from '../panels/fonts.ts';
import { cardFromItem } from '../panels/info-card-content.ts';
import { codeCardOpen, codeCardRows, codeScroll, codeView, error, loading, pinned } from '../state/app-state.ts';
import { closeCard, retry } from '../state/commands.ts';
import { GalaxySystem, TABLE_ANCHOR } from './galaxy-system.ts';
import { headPosition } from './head.ts';

const CARD_LIFT = 0.12,
  CARD_SIDE = 0.08,
  STATUS_LIFT = 0.18;

/** The seated eye the windows are laid out for (room metres; the user faces -Z). */
export const SEAT: Seat = { eye: [0, 1.2, 0] };
export const PLACEMENTS = panelPlacements(SEAT);

/** Puts a panel mesh at a placement, facing the eye. */
export function place(panel: CanvasPanel, p: Placement) {
  panel.mesh.position.set(p.position[0], p.position[1], p.position[2]);
  panel.mesh.lookAt(p.position[0] + p.facing[0], p.position[1] + p.facing[1], p.position[2] + p.facing[2]);
}

/** Context items that get no card: files show only their marker. */
const cardless = (item: ContextItem | null) => !item || (item.key ?? '').startsWith('file:');

export class PanelSystem extends createSystem({}) {
  private info!: CanvasPanel;
  private status!: CanvasPanel;
  private code!: CanvasPanel;
  private item: ContextItem | null = null;
  private card: InfoCard | null = null;
  private statusCard: StatusCard | null = null;
  private fontReady = false;
  private head!: Vector3;
  private at!: Vector3;
  private side!: Vector3;
  private up!: Vector3;

  init() {
    this.head = new Vector3();
    this.at = new Vector3();
    this.side = new Vector3();
    this.up = new Vector3(0, 1, 0);
    const renderer = this.renderer;
    this.info = new CanvasPanel({
      name: 'info-card',
      ...INFO_CARD,
      renderer,
      window: { title: () => (this.card ? infoCardTitle(this.card) : ''), closable: true, movable: true },
    }).attach(this.world);
    this.info.visible = false;
    this.info.eye = SEAT.eye;
    this.info.onHover = () => this.drawInfo();
    this.info.onClose = () => closeCard();
    this.info.onPress = id => {
      if (id.startsWith('action:')) this.item?.actions?.[Number(id.slice(7))]?.onClick();
    };
    this.status = new CanvasPanel({
      name: 'status-card',
      ...STATUS_CARD,
      renderer,
      window: {
        title: () => (this.statusCard ? statusTitle(this.statusCard) : ''),
        hue: () => (this.statusCard?.kind === 'error' ? THEME.alert : THEME.line),
      },
    }).attach(this.world);
    this.status.visible = false;
    this.status.onHover = () => this.drawStatus();
    this.status.onPress = id => {
      if (id === 'retry') retry();
    };
    this.code = new CanvasPanel({
      name: 'code-card',
      ...CODE_CARD,
      renderer,
      window: { title: () => this.codeTitle(), closable: true, movable: true },
    }).attach(this.world);
    this.code.visible = false;
    this.code.eye = SEAT.eye;
    place(this.code, PLACEMENTS.codeCard);
    this.code.onClose = () => (codeCardOpen.value = false);
    this.code.onHover = id => {
      hoverLine(id?.startsWith('line:') ? Number(id.slice(5)) : null);
      this.drawCode();
    };
    this.code.onPress = id => {
      if (id.startsWith('line:')) pressLine(Number(id.slice(5)));
      else if (id === 'more') this.setRows(codeCardRows.peek() === CODE_LAYOUT.rows ? CODE_LAYOUT.moreRows : CODE_LAYOUT.rows);
    };
    this.code.onDrag = (_dx, dy) => {
      codeScroll.value = dragScroll(codeScroll.peek(), dy, CODE_LAYOUT.lineHeight, cardMaxScroll());
    };
    void loadFonts().then(() => {
      this.fontReady = true;
      this.drawCode();
      this.drawInfo();
      this.drawStatus();
    });
    this.cleanupFuncs.push(
      codeView.subscribe(() => this.drawCode()),
      codeScroll.subscribe(() => this.drawCode()),
      codeCardOpen.subscribe(() => this.drawCode()),
      pinned.subscribe(item => {
        this.item = cardless(item) ? null : item;
        this.card = this.item ? cardFromItem(this.item) : null;
        this.info.moved = false;
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

  private codeTitle() {
    const view = codeView.peek();
    if (!view) return '';
    const file = view.file.split('/').pop() ?? view.file;
    const region = view.selectedRegion != null ? view.regions[view.selectedRegion] : null;
    return region?.name ? `${file} · ${region.name}` : file;
  }

  private setRows(rows: number) {
    codeCardRows.value = rows;
    const size = codeCardSize(rows);
    this.code.resize(size.heightPx, size.heightM);
    codeScroll.value = Math.min(codeScroll.peek(), cardMaxScroll());
    this.drawCode();
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
    this.info.visible = !!card && this.fontReady;
    if (card && this.fontReady) this.info.redraw((ctx, w, h) => drawInfoCard(ctx, w, h, this.info.u, card, this.info.hovered));
  }

  /** The code card: shown while it is open and a function or a range is selected. */
  drawCode() {
    const view = codeView.peek();
    const show = codeCardOpen.peek() && hasSelection(view) && this.fontReady;
    if (show && !this.code.visible && !this.code.moved) place(this.code, PLACEMENTS.codeCard);
    this.code.visible = show;
    if (!show || !view) return;
    const rows = visibleLines(view, { rows: codeCardRows.peek(), columns: CODE_LAYOUT.columns, scrollTop: codeScroll.peek() });
    const range = shownRange(view);
    this.code.redraw((ctx, w, h) =>
      drawCodeCard(ctx, w, h, this.code.u, rows, {
        shown: {
          first: rows[0]?.number ?? range.start,
          last: rows[rows.length - 1]?.number ?? range.start,
          total: view.lines.length,
        },
        more: codeCardRows.peek() !== CODE_LAYOUT.rows,
        hovered: this.code.hovered,
      }),
    );
  }

  private drawStatus() {
    const status = this.statusCard;
    this.status.visible = !!status && this.fontReady;
    if (status && this.fontReady)
      this.status.redraw((ctx, w, h) => drawStatusCard(ctx, w, h, this.status.u, status, this.status.hovered));
  }

  update(delta: number) {
    headPosition(this.renderer, this.player, this.camera, this.head);
    if (this.info.visible && !this.info.moved) {
      const anchor = this.item?.anchor;
      const kit = this.world.getSystem(GalaxySystem)?.host.kit;
      if (anchor && kit) {
        // anchor.world() is a point in the model; the model's world matrix is its pose in the room (modelToRoom).
        const p = anchor.world();
        this.at.set(p.x, p.y, p.z).applyMatrix4(kit.scene.matrixWorld);
      } else this.at.set(TABLE_ANCHOR.position[0], TABLE_ANCHOR.position[1], TABLE_ANCHOR.position[2]);
      // Beside it: up, and to the side away from the view's centre line, so the card does not cover what it describes.
      this.side.copy(this.at).sub(this.head).cross(this.up).normalize();
      if (this.at.x < this.head.x) this.side.negate();
      this.at.addScaledVector(this.side, CARD_SIDE + INFO_CARD.widthM / 2);
      this.at.y += CARD_LIFT;
      this.info.mesh.position.copy(this.at);
      this.info.face(this.head);
    }
    this.info.tick(delta, this.info.moved ? this.head : undefined);
    this.code.tick(delta, this.head);
    if (this.status.visible) {
      this.status.mesh.position.set(TABLE_ANCHOR.position[0], TABLE_ANCHOR.position[1] + STATUS_LIFT, TABLE_ANCHOR.position[2]);
      this.status.face(this.head);
    }
    this.status.tick(delta);
  }
}
