// The small attached cards (docs/visual-style.md, "Sizes in the room": 0.24 × 0.09 m). The problem card is red, titled
// with the scenario's short title, and names the function; pinching it opens the chat with the first prompt ready. Once
// fixed it turns `ok` and reads "Fixed". The agent's "Show me" card is titled "Agent · file:line" and is taller
// (0.24 × 0.14 m): the agent's message across its width, up to four lines, with Show me and Dismiss in a row under it.
// The window frame (title, hue) is drawn by CanvasPanel.
import type { HitRegion } from '../core/panel-hit.ts';
import { THEME, button, fit, font, microLabel, stateOf, wrap } from './paint.ts';

export const CALLOUT = { widthPx: 720, heightPx: 270, widthM: 0.24, heightM: 0.09 };
/** The agent's pointer card: room for its message. */
export const POINTER_CARD = { widthPx: 720, heightPx: 420, widthM: 0.24, heightM: 0.14 };
const POINTER_LINES = 4;

export type ProblemCard = { kind: 'problem'; title: string; fn: string; fixed: boolean };
export type PointerCard = { kind: 'pointer'; file: string; line: number | null; message: string };
export type DebugCard = { kind: 'debug'; file: string; line: number; following: boolean };
export type Callout = ProblemCard | PointerCard | DebugCard;

export const calloutTitle = (c: Callout) =>
  c.kind === 'problem'
    ? c.fixed
      ? 'Fixed'
      : c.title
    : c.kind === 'debug'
      ? 'Agent is debugging'
      : `Agent · ${c.file.split('/').pop()}${c.line ? `:${c.line}` : ''}`;
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
  if (c.kind === 'debug') {
    ctx.save();
    ctx.font = font('body', 12 * u);
    ctx.fillStyle = THEME.white;
    ctx.fillText(fit(ctx, `Paused at ${c.file.split('/').pop()}:${c.line}`, w - pad * 2), pad, 50 * u);
    ctx.restore();
    const bw = 96 * u,
      bh = 24 * u,
      regions: HitRegion[] = [];
    const follow = button(ctx, c.following ? 'stopFollowing' : 'follow', c.following ? 'Stop following' : 'Follow ship', pad, 62 * u, bw, bh, u, {
      state: stateOf(hovered, c.following ? 'stopFollowing' : 'follow'),
      px: 10,
    });
    const dismiss = button(ctx, 'dismiss', 'Dismiss', pad + bw + 10 * u, 62 * u, 70 * u, bh, u, { state: stateOf(hovered, 'dismiss'), px: 10 });
    if (follow) regions.push(follow);
    if (dismiss) regions.push(dismiss);
    return regions;
  }
  ctx.save();
  ctx.font = font('body', 11.5 * u);
  ctx.fillStyle = THEME.white;
  // The message across the card; the buttons in a row along its bottom edge.
  const all = wrap(ctx, c.message, w - pad * 2),
    lines = all.slice(0, POINTER_LINES);
  lines.forEach((line, k) => ctx.fillText(k === POINTER_LINES - 1 && all.length > POINTER_LINES ? fit(ctx, line + '…', w - pad * 2) : line, pad, (46 + k * 14) * u));
  ctx.restore();
  const bw = 62 * u,
    bh = 20 * u,
    by = h - bh - 6 * u,
    regions: HitRegion[] = [];
  for (const [k, [id, label]] of [['dismiss', 'Dismiss'], ['show', 'Show me']].entries()) {
    const r = button(ctx, id, label, w - pad - bw - k * (bw + 8 * u), by, bw, bh, u, { state: stateOf(hovered, id), px: 10 });
    if (r) regions.push(r);
  }
  return regions;
}
