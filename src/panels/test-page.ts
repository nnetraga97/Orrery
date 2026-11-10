// panels.html: every panel drawn on a plain canvas from fixed sample data, stacked down the page, so each can be
// checked with a screenshot. Sets window.__panels = { ready, regions } for tests.
import type { HitRegion } from '../core/panel-hit.ts';
import { INFO_CARD, drawInfoCard } from './draw-info-card.ts';
import { STATUS_CARD, drawStatusCard } from './draw-status-card.ts';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => HitRegion[];
const regions: Record<string, HitRegion[]> = {};

function show(name: string, widthPx: number, heightPx: number, draw: Draw) {
  const figure = document.createElement('figure');
  const caption = document.createElement('figcaption');
  caption.textContent = name;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  canvas.style.width = `${Math.round(widthPx / 2)}px`;
  figure.append(caption, canvas);
  document.getElementById('panels')!.append(figure);
  regions[name] = draw(canvas.getContext('2d')!, widthPx, heightPx);
}

/** Every panel, in the order the plan adds them. Later tasks append here. */
export async function drawAll() {
  show('infoCard', INFO_CARD.widthPx, INFO_CARD.heightPx, (ctx, w, h) =>
    drawInfoCard(ctx, w, h, {
      key: 'file:core/range.ts',
      kind: 'File',
      title: 'range.ts',
      sub: 'core/range.ts',
      color: '#7cc4ff',
      text: '461 lines · imports 2 · imported by 41\nGroup: core',
      actions: [{ label: 'Open', primary: true }, { label: 'Deselect' }],
    }),
  );
  show('loadingCard', STATUS_CARD.widthPx, STATUS_CARD.heightPx, (ctx, w, h) =>
    drawStatusCard(ctx, w, h, { kind: 'loading', title: 'Opening project', detail: 'editor-core' }),
  );
  show('errorCard', STATUS_CARD.widthPx, STATUS_CARD.heightPx, (ctx, w, h) =>
    drawStatusCard(ctx, w, h, { kind: 'error', text: 'Could not open editor-core: Failed to fetch' }),
  );
}

drawAll().then(() => {
  window.__panels = { ready: true, regions };
});

declare global {
  interface Window {
    __panels?: { ready: boolean; regions: Record<string, HitRegion[]> };
  }
}
