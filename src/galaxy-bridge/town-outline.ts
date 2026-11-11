// The selected town's outline, in `line`. The copied planet code marks the pinned region (a town, i.e. a function)
// with a faint additive fill mesh it adds straight to the scene (planet-scene.js `overlay(k, pinMat)`). This finds that
// mesh after each selection change and adds, as its child, a line along the edges of its triangles that belong to only
// one triangle: the region's border. The outline goes when the copied code removes the fill. Nothing in galaxy/ changes.
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments, Mesh } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { borderOf } from '../core/mesh-border.ts';
import { THEME } from '../core/theme.ts';

/** The pin material's colour in the copied code (planet-scene.js). */
const PIN_COLOR = 0x7cc4ff;
const OUTLINED = 'orreryOutlined';

const material = new LineBasicMaterial({
  color: THEME.line,
  transparent: true,
  opacity: 0.95,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

function isPinFill(o: Object3D): o is Mesh {
  if (!(o as Mesh).isMesh) return false;
  const m = (o as Mesh).material as { color?: { getHex(): number }; blending?: number };
  return !!m?.color && m.color.getHex() === PIN_COLOR && m.blending === AdditiveBlending;
}

const found: Mesh[] = [];
const collect = (o: Object3D) => {
  if (isPinFill(o) && !o.userData[OUTLINED]) found.push(o);
};

/** Outlines every pin fill under `root` (the landed planet's own scene sits inside it) that has no outline yet.
 * Returns how many it outlined. */
export function outlinePinnedTown(root: Object3D): number {
  let made = 0;
  found.length = 0;
  root.traverse(collect);
  for (const child of found) {
    child.userData[OUTLINED] = true;
    const position = child.geometry.getAttribute('position');
    if (!position) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(borderOf(position.array as ArrayLike<number>), 3));
    const line = new LineSegments(geometry, material);
    line.name = 'town-outline';
    line.renderOrder = 5;
    child.add(line);
    child.addEventListener('removed', () => geometry.dispose());
    made++;
  }
  return made;
}
