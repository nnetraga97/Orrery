// A points material's `size` is in world units and ignores its object's scale, so the copied galaxy's starfield and
// particles would draw metres wide once the model is shrunk onto the table. This keeps each material's own size and
// multiplies it by the model's scale every frame. New points (ships, flows) are picked up by a rescan once a second.
import type { Material, Object3D, PointsMaterial } from '@iwsdk/core';

const RESCAN_SECONDS = 1;

export function createPointScaler(root: Object3D) {
  const base = new Map<PointsMaterial, number>();
  let sinceScan = RESCAN_SECONDS;
  const visit = (object: Object3D) => {
    const material = (object as Object3D & { isPoints?: boolean; material?: Material | Material[] }).material;
    if (!(object as { isPoints?: boolean }).isPoints || !material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      const p = m as PointsMaterial;
      if (p.isPointsMaterial && p.sizeAttenuation && !base.has(p)) base.set(p, p.size);
    }
  };
  return {
    /** Call once per frame after the model's scale is set. */
    update(scale: number, delta: number) {
      sinceScan += delta;
      if (sinceScan >= RESCAN_SECONDS) {
        sinceScan = 0;
        root.traverse(visit);
      }
      for (const [material, size] of base) material.size = size * scale;
    },
  };
}
