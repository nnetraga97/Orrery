// The chat window's shell (docs/visual-style.md, "The chat window"): 0.40 × 0.72 m, titled "Agent". Until the agent
// arrives in the next milestone the transcript area holds one line saying so. The frame, close mark and grab bar come
// from CanvasPanel.
import type { HitRegion } from '../core/panel-hit.ts';
import { THEME, font, rule, wrap } from './paint.ts';

export const CHAT_WINDOW = { widthPx: 1200, heightPx: 2160, widthM: 0.4, heightM: 0.72 };
export const CHAT_PLACEHOLDER = 'The agent arrives in the next milestone';

export function drawChatShell(ctx: CanvasRenderingContext2D, w: number, h: number, u: number): HitRegion[] {
  rule(ctx, 1, 36 * u, w - 2, u);
  ctx.save();
  ctx.font = font('body', 17 * u);
  ctx.fillStyle = THEME.lineDim;
  ctx.textAlign = 'center';
  wrap(ctx, CHAT_PLACEHOLDER, w - 60 * u).forEach((line, k) => ctx.fillText(line, w / 2, h * 0.45 + k * 24 * u));
  ctx.restore();
  return [];
}
