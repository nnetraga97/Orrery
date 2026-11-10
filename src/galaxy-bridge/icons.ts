// The copied icon set (galaxy/viewer/shared/ui-icons.js) as path strings for the 2D canvas. Each icon is SVG markup
// in a 24-unit box; paths pass through, and circles, ellipses, rectangles and lines become equivalent paths.
import { UIIcons } from './galaxy-session.js';

const attr = (tag: string, name: string) => Number(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? 0);

function ellipsePath(cx: number, cy: number, rx: number, ry: number) {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

function rectPath(x: number, y: number, w: number, h: number, r: number) {
  if (!r) return `M${x} ${y}h${w}v${h}h${-w}Z`;
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

/** The icon's outline as SVG path strings in a 24-unit box (draw with `new Path2D(d)`, stroked). */
export function iconPaths(name: string): string[] {
  const out: string[] = [];
  for (const [tag] of UIIcons.shape(name).matchAll(/<(path|circle|ellipse|rect|line|polyline)\b[^>]*>/g)) {
    if (tag.startsWith('<path')) out.push(tag.match(/\bd="([^"]*)"/)?.[1] ?? '');
    else if (tag.startsWith('<circle')) out.push(ellipsePath(attr(tag, 'cx'), attr(tag, 'cy'), attr(tag, 'r'), attr(tag, 'r')));
    else if (tag.startsWith('<ellipse'))
      out.push(ellipsePath(attr(tag, 'cx'), attr(tag, 'cy'), attr(tag, 'rx'), attr(tag, 'ry')));
    else if (tag.startsWith('<rect'))
      out.push(rectPath(attr(tag, 'x'), attr(tag, 'y'), attr(tag, 'width'), attr(tag, 'height'), attr(tag, 'rx')));
    else if (tag.startsWith('<line'))
      out.push(`M${attr(tag, 'x1')} ${attr(tag, 'y1')}L${attr(tag, 'x2')} ${attr(tag, 'y2')}`);
    else if (tag.startsWith('<polyline')) out.push(`M${tag.match(/\bpoints="([^"]*)"/)?.[1] ?? ''}`);
  }
  return out.filter(Boolean);
}
