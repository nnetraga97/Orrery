// An attached card: what a pinned thing in the scene is (the cannon, the station, a moon), with its actions. It is a
// window whose title is "kind · title" (drawn by CanvasPanel); this draws the sub-title, up to three body lines and up
// to three buttons. Files get no card: a selected file shows only its marker.
import type { HitRegion } from '../core/panel-hit.ts';
import { THEME, button, fit, font, stateOf, wrap } from './paint.ts';

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

// Tall enough for three body lines above the buttons (a function's card states three facts).
export const INFO_CARD = { widthPx: 952, heightPx: 612, widthM: 0.28, heightM: 0.18 };
const MAX_BODY_LINES = 3;

/** The card's window title. */
export const infoCardTitle = (card: InfoCard) => (card.kind ? `${card.kind} · ${card.title}` : card.title);

/** Draws the card's contents; regions are `action:<k>` for each action. */
export function drawInfoCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  u: number,
  card: InfoCard,
  hovered: string | null = null,
): HitRegion[] {
  const regions: HitRegion[] = [];
  const pad = 14 * u;
  let y = 36 * u;
  if (card.sub) {
    y += 16 * u;
    ctx.font = font('body', 14 * u);
    ctx.fillStyle = THEME.line;
    ctx.fillText(fit(ctx, card.sub, w - pad * 2), pad, y);
  }
  const actions = card.actions.slice(0, 3);
  const bh = 30 * u,
    by = h - pad - bh;
  if (card.text) {
    ctx.font = font('body', 15 * u);
    ctx.fillStyle = THEME.white;
    const lines = wrap(ctx, card.text, w - pad * 2);
    // As many lines as fit above the buttons, at most three.
    const room = Math.max(1, Math.min(MAX_BODY_LINES, Math.floor(((actions.length ? by : h) - y - 8 * u) / (20 * u))));
    const shown = lines.slice(0, room);
    if (lines.length > room) shown[room - 1] = fit(ctx, shown[room - 1] + ' …', w - pad * 2);
    for (const line of shown) {
      y += 20 * u;
      ctx.fillText(line, pad, y);
    }
  }
  if (actions.length) {
    const gap = 8 * u,
      bw = (w - pad * 2 - gap * (actions.length - 1)) / actions.length;
    actions.forEach((a, k) => {
      const r = button(ctx, `action:${k}`, a.label, pad + k * (bw + gap), by, bw, bh, u, {
        state: stateOf(hovered, `action:${k}`),
        px: 13,
      });
      if (r) regions.push(r);
    });
  }
  return regions;
}
