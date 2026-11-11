// The small card in front of the model while a project loads, or with an error and a Retry button. It is a window
// whose title is "Loading" or "Something went wrong" (drawn by CanvasPanel, in `alert` for an error).
import type { HitRegion } from '../core/panel-hit.ts';
import { THEME, button, fit, font, stateOf, wrap } from './paint.ts';

export type StatusCard = { kind: 'loading'; title: string; detail: string } | { kind: 'error'; text: string };

export const STATUS_CARD = { widthPx: 952, heightPx: 408, widthM: 0.28, heightM: 0.12 };

export const statusTitle = (status: StatusCard) => (status.kind === 'error' ? 'Something went wrong' : 'Loading');

/** Draws loading or error status; an error has a `retry` region. */
export function drawStatusCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  status: StatusCard,
  hovered: string | null = null,
): HitRegion[] {
  const pad = 14 * u;
  if (status.kind === 'loading') {
    ctx.font = font('body', 18 * u);
    ctx.fillStyle = THEME.white;
    ctx.fillText(fit(ctx, status.title, w - pad * 2), pad, 62 * u);
    ctx.font = font('body', 14 * u);
    ctx.fillStyle = THEME.line;
    wrap(ctx, status.detail, w - pad * 2)
      .slice(0, 2)
      .forEach((line, k) => ctx.fillText(line, pad, 86 * u + k * 20 * u));
    return [];
  }
  ctx.font = font('body', 15 * u);
  ctx.fillStyle = THEME.white;
  const lines = wrap(ctx, status.text, w - pad * 2);
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = fit(ctx, shown[1] + ' …', w - pad * 2);
  shown.forEach((line, k) => ctx.fillText(line, pad, 58 * u + k * 21 * u));
  const r = button(ctx, 'retry', 'Retry', pad, h - pad - 30 * u, 90 * u, 30 * u, u, {
    state: stateOf(hovered, 'retry'),
    hue: THEME.alert,
  });
  return r ? [r] : [];
}
