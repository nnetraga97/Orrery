// The small card at the table's centre: loading progress, or an error with a Retry button.
import type { HitRegion } from '../core/panel-hit.ts';
import { COLORS, UI_FONT, button, fit, panelBackground, wrap } from './paint.ts';

export type StatusCard = { kind: 'loading'; title: string; detail: string } | { kind: 'error'; text: string };

export const STATUS_CARD = { widthPx: 896, heightPx: 384, widthM: 0.28, heightM: 0.12 };

/** Draws loading or error status; an error has a `retry` region. */
export function drawStatusCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  status: StatusCard,
  hovered: string | null = null,
): HitRegion[] {
  panelBackground(ctx, w, h, status.kind === 'error' ? COLORS.danger : COLORS.accent);
  const pad = 48;
  if (status.kind === 'loading') {
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 50px ${UI_FONT}`;
    ctx.fillText(fit(ctx, status.title, w - pad * 2), pad, 120);
    ctx.fillStyle = COLORS.dim;
    ctx.font = `400 36px ${UI_FONT}`;
    wrap(ctx, status.detail, w - pad * 2)
      .slice(0, 3)
      .forEach((line, k) => ctx.fillText(line, pad, 190 + k * 48));
    return [];
  }
  ctx.fillStyle = COLORS.danger;
  ctx.font = `700 44px ${UI_FONT}`;
  ctx.fillText('Something went wrong', pad, 100);
  ctx.fillStyle = COLORS.text;
  ctx.font = `400 32px ${UI_FONT}`;
  wrap(ctx, status.text, w - pad * 2)
    .slice(0, 2)
    .forEach((line, k) => ctx.fillText(line, pad, 160 + k * 44));
  return [button(ctx, 'retry', 'Retry', pad, h - pad - 84, 260, 84, { hovered: hovered === 'retry', primary: true })];
}
