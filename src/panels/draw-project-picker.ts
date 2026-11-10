// A project card on the table: its title, what it is and its licence. The whole card is one button (`open`).
import type { HitRegion } from '../core/panel-hit.ts';
import type { DatasetEntry } from '../ports/dataset.ts';
import { COLORS, UI_FONT, fit, panelBackground, roundRect, wrap } from './paint.ts';

export const PROJECT_CARD = { widthPx: 768, heightPx: 480, widthM: 0.26, heightM: 0.1625 };

export function drawProjectCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: DatasetEntry,
  hovered: string | null = null,
): HitRegion[] {
  panelBackground(ctx, w, h, COLORS.accent);
  if (hovered === 'open') {
    roundRect(ctx, 6, 6, w - 12, h - 12, 24);
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.accent;
    ctx.stroke();
  }
  const pad = 48;
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 28px ${UI_FONT}`;
  ctx.fillText('PROJECT', pad, pad + 28);
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 58px ${UI_FONT}`;
  ctx.fillText(fit(ctx, project.title, w - pad * 2), pad, pad + 100);
  ctx.font = `400 34px ${UI_FONT}`;
  wrap(ctx, project.blurb, w - pad * 2)
    .slice(0, 4)
    .forEach((line, k) => ctx.fillText(line, pad, pad + 170 + k * 46));
  ctx.fillStyle = COLORS.dim;
  ctx.font = `500 28px ${UI_FONT}`;
  ctx.fillText(project.licence ? `Licence: ${project.licence} · pinch to open` : 'Pinch to open', pad, h - pad);
  return [{ id: 'open', x: 0, y: 0, w, h }];
}
