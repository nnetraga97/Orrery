// Line icons for canvas panels. The shapes are the copied toolbar icons (galaxy/viewer/shared/ui-icons.js), 24-unit
// SVG fragments of <path>, <circle>, <rect> and <ellipse>. Panels may not import the copied code, so the composition
// root hands the shapes in (setIconShapes); a name the module lacks, or any name before then, draws as a small circle.
import { THEME, glowStroke } from './paint.ts';

type ShapeOf = (name: string) => string | null;

// Shapes this app adds; the copied module has no microphone.
const OWN: Record<string, string> = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/>',
};

let shapeOf: ShapeOf = () => null;
const cache = new Map<string, Path2D>();

/** Gives the panels the icon shapes. `shape` returns an SVG fragment, or null for an unknown name. */
export function setIconShapes(shape: ShapeOf) {
  shapeOf = shape;
  cache.clear();
}

const num = (attrs: Record<string, string>, key: string, fallback = 0) => {
  const v = parseFloat(attrs[key] ?? '');
  return Number.isFinite(v) ? v : fallback;
};

/** An SVG fragment as one Path2D in the 24-unit box. */
export function pathOf(svg: string): Path2D {
  const path = new Path2D();
  for (const [, tag, body] of svg.matchAll(/<(path|circle|rect|ellipse)\s([^>]*?)\/?>/g)) {
    const attrs: Record<string, string> = {};
    for (const [, key, value] of body.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[key] = value;
    if (tag === 'path') path.addPath(new Path2D(attrs.d ?? ''));
    else if (tag === 'circle') {
      const sub = new Path2D();
      sub.arc(num(attrs, 'cx'), num(attrs, 'cy'), num(attrs, 'r'), 0, Math.PI * 2);
      path.addPath(sub);
    } else if (tag === 'rect') {
      const sub = new Path2D();
      sub.roundRect(num(attrs, 'x'), num(attrs, 'y'), num(attrs, 'width'), num(attrs, 'height'), num(attrs, 'rx'));
      path.addPath(sub);
    } else {
      const rotate = attrs.transform?.match(/rotate\(\s*(-?[\d.]+)/);
      const sub = new Path2D();
      sub.ellipse(num(attrs, 'cx'), num(attrs, 'cy'), num(attrs, 'rx'), num(attrs, 'ry'), rotate ? (parseFloat(rotate[1]) * Math.PI) / 180 : 0, 0, Math.PI * 2);
      path.addPath(sub);
    }
  }
  return path;
}

function iconPath(name: string): Path2D | null {
  let path = cache.get(name);
  if (!path) {
    const svg = OWN[name] ?? shapeOf(name);
    if (!svg) return null;
    cache.set(name, (path = pathOf(svg)));
  }
  return path;
}

/** Draws an icon in a size × size box whose left edge is x and whose centre line is y. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  size: number,
  color: string = THEME.line,
  { rotate = 0, strength = 0.5 }: { rotate?: number; strength?: number } = {},
) {
  const path = iconPath(name);
  ctx.save();
  ctx.translate(x + size / 2, y);
  if (rotate) ctx.rotate(rotate);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.translate(-12, -12);
  if (path) glowStroke(ctx, path, color, 2, strength);
  else {
    const dot = new Path2D();
    dot.arc(12, 12, 4, 0, Math.PI * 2);
    glowStroke(ctx, dot, color, 2, strength);
  }
  ctx.restore();
}

/** Names of the icons the chat draws, for checking that the module has them. */
export const CHAT_ICONS = [
  'file', 'search', 'list', 'terminal', 'fileAdd', 'fileRemove', 'pencil', 'plug', 'sparkles', 'globe', 'compress',
  'alert', 'chevron', 'thought', 'checklist', 'check', 'diff', 'paperclip', 'arrowUp', 'stop', 'close', 'plus',
  'refresh', 'lock', 'unlock', 'shield', 'mic',
] as const;

/** The chat's icons that have no shape. */
export const missingIcons = () => CHAT_ICONS.filter(name => !OWN[name] && !shapeOf(name));
