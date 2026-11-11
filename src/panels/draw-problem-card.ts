// The small attached cards (docs/visual-style.md, "Sizes in the room": 0.24 × 0.09 m). The problem card is red, titled
// with the scenario's short title, and names the function; pinching it opens the chat with the first prompt ready. Once
// fixed it turns `ok` and reads "Fixed". The agent's "Show me" card is titled "Agent · file:line", with the agent's
// message and the buttons Show me and Dismiss. The window frame (title, hue) is drawn by CanvasPanel.
import type { HitRegion } from '../core/panel-hit.ts';
import { THEME, button, fit, font, microLabel, stateOf, wrap } from './paint.ts';

export const CALLOUT = { widthPx: 720, heightPx: 270, widthM: 0.24, heightM: 0.09 };

export type ProblemCard = { kind: 'problem'; title: string; fn: string; fixed: boolean };
export type PointerCard = { kind: 'pointer'; file: string; line: number | null; message: string };
export type Callout = ProblemCard | PointerCard;

export const calloutTitle = (c: Callout) =>
  c.kind === 'problem' ? (c.fixed ? 'Fixed' : c.title) : `Agent · ${c.file.split('/').pop()}${c.line ? `:${c.line}` : ''}`;
export const calloutHue = (c: Callout) => (c.kind === 'problem' ? (c.fixed ? THEME.ok : THEME.alert) : THEME.line);

export function drawCallout(ctx: CanvasRenderingContext2D, w: number, h: number, u: number, c: Callout, hovered: string | null): HitRegion[] {
  const pad = 14 * u;
  if (c.kind === 'problem') {
    microLabel(ctx, fit(ctx, c.fn, w - pad * 2), pad, 50 * u, 11 * u, c.fixed ? THEME.ok : THEME.white);
    ctx.save();
    ctx.font = font('body', 12 * u);
    ctx.fillStyle = THEME.line;
    ctx.fillText(fit(ctx, c.fixed ? c.title : 'Pinch to ask the agent about it', w - pad * 2), pad, 68 * u);
    ctx.restore();
    // The whole card is the target.
    return c.fixed ? [] : [{ id: 'card', x: 0, y: 0, w, h }];
  }
  ctx.save();
  ctx.font = font('body', 11.5 * u);
  ctx.fillStyle = THEME.white;
  const lines = wrap(ctx, c.message, w - pad * 2 - 140 * u).slice(0, 3);
  lines.forEach((line, k) => ctx.fillText(k === 2 && lines.length === 3 ? fit(ctx, line + '…', w - pad * 2 - 140 * u) : line, pad, (46 + k * 15) * u));
  ctx.restore();
  const bw = 62 * u,
    bh = 24 * u,
    x = w - pad - bw,
    regions: HitRegion[] = [];
  for (const [k, [id, label]] of [['show', 'Show me'], ['dismiss', 'Dismiss']].entries()) {
    const r = button(ctx, id, label, x, (34 + k * 28) * u, bw, bh, u, { state: stateOf(hovered, id), px: 10 });
    if (r) regions.push(r);
  }
  return regions;
}
