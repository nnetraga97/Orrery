// An info card: what a pinned thing in the scene is (a file, a black hole, an import lane), with its actions.
import type { HitRegion } from '../core/panel-hit.ts';
import { COLORS, UI_FONT, button, fit, panelBackground, wrap } from './paint.ts';

export interface InfoCard {
  key: string;
  kind: string;
  title: string;
  sub?: string;
  color?: string;
  /** Body text, already plain (no markup). */
  text?: string;
  actions: { label: string; primary?: boolean }[];
}

export const INFO_CARD = { widthPx: 1024, heightPx: 640, widthM: 0.34, heightM: 0.2125 };
const PAD = 48,
  MAX_BODY_LINES = 4,
  BUTTON_H = 84;

/** Draws the card; regions are `action:<k>` for each action and `close`. */
export function drawInfoCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: InfoCard,
  hovered: string | null = null,
): HitRegion[] {
  panelBackground(ctx, w, h, card.color || COLORS.accent);
  const regions: HitRegion[] = [];
  let y = PAD + 30;
  ctx.fillStyle = COLORS.dim;
  ctx.font = `600 30px ${UI_FONT}`;
  ctx.fillText(fit(ctx, card.kind.toUpperCase(), w - PAD * 2 - 90), PAD, y);
  regions.push(button(ctx, 'close', '✕', w - PAD - 72, PAD - 12, 72, 72, { hovered: hovered === 'close', size: 36 }));
  y += 62;
  ctx.fillStyle = COLORS.text;
  ctx.font = `700 54px ${UI_FONT}`;
  ctx.fillText(fit(ctx, card.title, w - PAD * 2), PAD, y);
  if (card.sub) {
    y += 46;
    ctx.fillStyle = COLORS.dim;
    ctx.font = `400 32px ${UI_FONT}`;
    ctx.fillText(fit(ctx, card.sub, w - PAD * 2), PAD, y);
  }
  if (card.text) {
    ctx.font = `400 34px ${UI_FONT}`;
    ctx.fillStyle = COLORS.text;
    const lines = wrap(ctx, card.text, w - PAD * 2);
    const shown = lines.slice(0, MAX_BODY_LINES);
    if (lines.length > MAX_BODY_LINES) shown[MAX_BODY_LINES - 1] = fit(ctx, shown[MAX_BODY_LINES - 1] + ' …', w - PAD * 2);
    y += 20;
    for (const line of shown) {
      y += 46;
      ctx.fillText(line, PAD, y);
    }
  }
  const actions = card.actions.slice(0, 3);
  if (actions.length) {
    const gap = 20,
      bw = (w - PAD * 2 - gap * (actions.length - 1)) / actions.length,
      by = h - PAD - BUTTON_H;
    actions.forEach((a, k) =>
      regions.push(
        button(ctx, `action:${k}`, a.label, PAD + k * (bw + gap), by, bw, BUTTON_H, {
          hovered: hovered === `action:${k}`,
          primary: !!a.primary,
        }),
      ),
    );
  }
  return regions;
}
