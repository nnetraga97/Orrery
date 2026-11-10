// The dock: four large buttons with icons and words, Home, Code, Agent and Help. The same drawing serves the strip at
// the table's edge and the palm menu.
import type { HitRegion } from '../core/panel-hit.ts';
import { COLORS, UI_FONT, panelBackground, roundRect } from './paint.ts';

export const DOCK = { widthPx: 1280, heightPx: 288, widthM: 0.4, heightM: 0.09 };
export const PALM_MENU = { widthPx: 1280, heightPx: 288, widthM: 0.2, heightM: 0.045 };

export type DockButton = 'home' | 'code' | 'agent' | 'help';
export const DOCK_BUTTONS: { id: DockButton; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'code', label: 'Code', icon: 'file' },
  { id: 'agent', label: 'Agent', icon: 'agents' },
  { id: 'help', label: 'Help', icon: 'info' },
];

export interface DockState {
  hovered: string | null;
  /** Buttons whose panel is open (drawn lit). */
  on: Partial<Record<DockButton, boolean>>;
  /** Icon outlines per icon name, in a 24-unit box (from src/galaxy-bridge/icons.ts). */
  icons: Record<string, string[]>;
}

export function drawDock(ctx: CanvasRenderingContext2D, w: number, h: number, state: DockState): HitRegion[] {
  panelBackground(ctx, w, h);
  const pad = 20,
    gap = 16,
    bw = (w - pad * 2 - gap * 3) / 4,
    bh = h - pad * 2;
  return DOCK_BUTTONS.map((b, k) => {
    const x = pad + k * (bw + gap),
      y = pad,
      hovered = state.hovered === b.id,
      on = !!state.on[b.id];
    roundRect(ctx, x, y, bw, bh, 34);
    ctx.fillStyle = hovered ? COLORS.buttonHover : on ? '#2b4a7e' : COLORS.button;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = on ? COLORS.accent : COLORS.border;
    ctx.stroke();
    // Icon: the 24-unit box scaled to 104 px, stroked.
    const size = 88,
      ix = x + 26,
      iy = y + (bh - size) / 2;
    ctx.save();
    ctx.translate(ix, iy);
    ctx.scale(size / 24, size / 24);
    ctx.lineWidth = 1.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = on ? '#bfe2ff' : COLORS.text;
    for (const d of state.icons[b.icon] ?? []) ctx.stroke(new Path2D(d));
    ctx.restore();
    ctx.fillStyle = COLORS.text;
    ctx.font = `700 46px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, ix + size + 16, y + bh / 2 + 2);
    ctx.textBaseline = 'alphabetic';
    return { id: b.id, x, y, w: bw, h: bh };
  });
}
