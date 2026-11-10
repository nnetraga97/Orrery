// Shared drawing helpers for canvas panels: colours, rounded boxes, wrapped text and buttons.
import type { HitRegion } from '../core/panel-hit.ts';

export const COLORS = {
  background: 'rgba(12, 17, 30, 0.94)',
  border: 'rgba(150, 175, 230, 0.35)',
  text: '#e8eefc',
  dim: '#93a2c4',
  button: '#22304f',
  buttonHover: '#33477a',
  accent: '#7cc4ff',
  danger: '#ff8a7a',
};
export const UI_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function panelBackground(ctx: CanvasRenderingContext2D, w: number, h: number, accent?: string) {
  roundRect(ctx, 2, 2, w - 4, h - 4, 28);
  ctx.fillStyle = COLORS.background;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.border;
  ctx.stroke();
  if (accent) {
    ctx.save();
    roundRect(ctx, 2, 2, w - 4, h - 4, 28);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 14, h);
    ctx.restore();
  }
}

/** Splits text into lines no wider than maxWidth with the context's current font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Shortens text with an ellipsis to fit maxWidth. */
export function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

export function button(
  ctx: CanvasRenderingContext2D,
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  { hovered = false, primary = false, size = 34 } = {},
): HitRegion {
  roundRect(ctx, x, y, w, h, h / 2.6);
  ctx.fillStyle = hovered ? COLORS.buttonHover : primary ? '#2b4a7e' : COLORS.button;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = primary ? COLORS.accent : COLORS.border;
  ctx.stroke();
  ctx.fillStyle = COLORS.text;
  ctx.font = `600 ${size}px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fit(ctx, label, w - 24), x + w / 2, y + h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return { id, x, y, w, h };
}
