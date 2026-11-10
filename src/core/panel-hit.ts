// Hit regions on a flat panel: a pinch arrives as a texture coordinate (uv); the panel turns it into a pixel on its
// canvas and finds the button or line under it.

export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The last region containing the pixel (later regions are drawn on top), or null. */
export function regionAt(regions: readonly HitRegion[], px: number, py: number): HitRegion | null {
  for (let k = regions.length - 1; k >= 0; k--) {
    const r = regions[k];
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
  }
  return null;
}

/** Texture coordinate -> canvas pixel. v runs up the texture and pixels run down the canvas. */
export function uvToPixel(u: number, v: number, width: number, height: number): [number, number] {
  return [u * width, (1 - v) * height];
}
