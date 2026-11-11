// The tab strip (docs/visual-style.md): a slim rounded column of icons on the chat window's left edge. Home, Chat,
// Replay, Settings; the current tab is lit, a hovered tab brightens, a disabled tab is drawn faint and takes no pinch.
// Icons are drawn here from plain strokes (adapted from docs/style/mock.html).
import type { HitRegion } from '../core/panel-hit.ts';
import { STYLE_PX_PER_M } from './canvas-panel.ts';
import { THEME, glowStroke } from './paint.ts';

export type TabId = 'home' | 'chat' | 'replay' | 'settings';
export const TABS: readonly TabId[] = ['home', 'chat', 'replay', 'settings'];

/** In style pixels: 44 wide, a 46-pixel cell per tab (5.4 cm in the room), 5 pixels of margin top and bottom. */
const W = 44,
  CELL = 46,
  MARGIN = 5;
const PX_PER_M = 3000;
const heightStyle = TABS.length * CELL + MARGIN * 2;
export const TAB_STRIP = {
  widthPx: Math.round((W / STYLE_PX_PER_M) * PX_PER_M),
  heightPx: Math.round((heightStyle / STYLE_PX_PER_M) * PX_PER_M),
  widthM: W / STYLE_PX_PER_M,
  heightM: heightStyle / STYLE_PX_PER_M,
};
/** Where the strip sits against the chat window, in style pixels: 12 px left of its left edge, 40 px below its top. */
export const TAB_STRIP_OFFSET = { gap: 12, top: 40 };

const ICONS: Record<TabId, (p: Path2D) => void> = {
  home: p => {
    p.moveTo(-9, 0);
    p.lineTo(0, -9);
    p.lineTo(9, 0);
    p.moveTo(-6, -1);
    p.lineTo(-6, 8);
    p.lineTo(6, 8);
    p.lineTo(6, -1);
  },
  chat: p => {
    p.roundRect(-10, -8, 20, 14, 4);
    p.moveTo(-4, 6);
    p.lineTo(-7, 11);
    p.lineTo(1, 6);
  },
  replay: p => {
    p.moveTo(-5, -8);
    p.lineTo(8, 0);
    p.lineTo(-5, 8);
    p.closePath();
  },
  settings: p => {
    p.moveTo(4, 0);
    p.arc(0, 0, 4, 0, Math.PI * 2);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      p.moveTo(7 * Math.cos(a), 7 * Math.sin(a));
      p.lineTo(10 * Math.cos(a), 10 * Math.sin(a));
    }
  },
};

export function drawTabStrip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  { active, hovered, disabled }: { active: TabId | null; hovered: string | null; disabled: readonly TabId[] },
): HitRegion[] {
  const u = w / W;
  const regions: HitRegion[] = [];
  const body = new Path2D();
  body.roundRect(u, u, w - 2 * u, h - 2 * u, (W / 2 - 1) * u);
  ctx.save();
  ctx.globalAlpha = THEME.inkAlpha;
  ctx.fillStyle = THEME.ink;
  ctx.fill(body);
  ctx.restore();
  glowStroke(ctx, body, THEME.lineDim, u, 0.5);
  TABS.forEach((tab, i) => {
    const cx = w / 2,
      cy = (MARGIN + CELL * i + CELL / 2) * u;
    const off = disabled.includes(tab),
      lit = tab === active,
      hover = !off && hovered === `tab:${tab}`;
    if (lit || hover) {
      ctx.save();
      ctx.globalAlpha = lit ? 0.35 : 0.2;
      ctx.fillStyle = THEME.glow;
      ctx.beginPath();
      ctx.arc(cx, cy, 17 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const icon = new Path2D();
    ICONS[tab](icon);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(u, u);
    ctx.globalAlpha = off ? 0.35 : 1;
    ctx.strokeStyle = lit || hover ? THEME.white : THEME.line;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(icon);
    ctx.restore();
    if (!off) regions.push({ id: `tab:${tab}`, x: 0, y: (MARGIN + CELL * i) * u, w, h: CELL * u });
  });
  return regions;
}
