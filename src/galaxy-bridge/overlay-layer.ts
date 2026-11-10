// Landed planets inside the model. On the desktop a landed planet is an "overlay": its own scene and camera in the
// body's frame, drawn in a second pass. A headset renders each scene once per eye from the head, so here the overlay's
// scene becomes part of the model: one Group per overlay, placed at the frame's origin and scale every frame.
import { Group } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import type { Overlay } from '../ports/scene-kit.ts';

const MIN_OPACITY = 0.02;

export function createOverlayLayer() {
  let parent: Object3D | null = null;
  const groups = new Map<Overlay, Group>();
  // The planet host scene carries copies of the main lights for its own pass. Inside the model they would light
  // everything twice, and the main lights already light the planet identically.
  const hideLightCopies = (o: Object3D) => {
    if ((o as { isLight?: boolean }).isLight && o.name === 'planet-light') o.visible = false;
  };
  return {
    /** The galaxy group the overlays live in. */
    attach(group: Object3D | null) {
      for (const g of groups.values()) g.removeFromParent();
      groups.clear();
      parent = group;
    },
    update(overlays: ReadonlySet<Overlay>) {
      if (!parent) return;
      for (const [overlay, group] of groups)
        if (!overlays.has(overlay)) {
          group.removeFromParent();
          groups.delete(overlay);
        }
      for (const overlay of overlays) {
        // A flat inset (the town plan) has its own screen rectangle; it is not part of the model.
        if (overlay.viewport) continue;
        let group = groups.get(overlay);
        if (!group) {
          group = new Group();
          group.name = 'galaxy-overlay';
          group.add(overlay.scene as unknown as Object3D);
          parent.add(group);
          groups.set(overlay, group);
        }
        (overlay.scene as unknown as Object3D).traverse(hideLightCopies);
        const f = overlay.frame();
        group.position.set(f.origin.x, f.origin.y, f.origin.z);
        group.scale.setScalar(f.scale);
        group.visible = overlay.opacity > MIN_OPACITY;
      }
    },
  };
}

export type OverlayLayer = ReturnType<typeof createOverlayLayer>;
